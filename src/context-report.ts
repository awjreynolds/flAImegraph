import { CoreError } from "./core.js";
import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import { validateContextBundle } from "./context.js";
import { validateContextReportInputs } from "./profile.js";
import { validateValuation } from "./work-items.js";
import type { EvidenceBundle, Valuation } from "./types.js";
import type { ContextAllocation, ContextBundle, ContextReport, ContextReportOptions, RequestContext } from "./context-types.js";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
let reportShapeValidator: ValidateFunction | undefined;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Validates both transport shape and recomputed accounting/coverage invariants. */
export function validateContextReport(value: unknown): ContextReport {
  if (!reportShapeValidator) {
    const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true, validateFormats: false });
    for (const path of ["0.1/evidence", "0.1/valuation", "0.2/context"]) {
      const [version, name] = path.split("/");
      ajv.addSchema(JSON.parse(readFileSync(new URL(`../spec/${version}/schemas/${name}.schema.json`, import.meta.url), "utf8")));
    }
    reportShapeValidator = ajv.compile(JSON.parse(readFileSync(new URL("../spec/0.2/schemas/context-report.schema.json", import.meta.url), "utf8")));
  }
  if (!reportShapeValidator(value)) throw new CoreError("CONTEXT_REPORT_SCHEMA_INVALID", `Context report schema validation failed: ${reportShapeValidator.errors?.[0]?.message ?? "invalid shape"}`);
  const report = value as ContextReport;
  const expected = createContextReport(report.evidence, report.valuation, report.context, { allocation_request_ids: report.allocations.map(item => item.request_id) });
  if (report.dataset_id !== expected.dataset_id) throw new CoreError("CONTEXT_REPORT_DATASET_MISMATCH", "Context report dataset differs from its embedded artifacts");
  if (canonical(report.summary) !== canonical(expected.summary)) throw new CoreError("CONTEXT_REPORT_SUMMARY_MISMATCH", "Context report summary does not match its embedded artifacts");
  if (canonical(report.allocations) !== canonical(expected.allocations)) throw new CoreError("CONTEXT_REPORT_ALLOCATION_MISMATCH", "Context report allocation does not match the named conserving method");
  if (canonical(report.issues) !== canonical(expected.issues)) throw new CoreError("CONTEXT_REPORT_ISSUES_MISMATCH", "Context report issues differ from the embedded context and allocation issues");
  return structuredClone(report);
}

function allocate(evidence: EvidenceBundle, valuation: Valuation, context: ContextBundle, request: RequestContext): ContextAllocation {
  const observation = evidence.observations.find(item => item.id === request.observation_id);
  const valued = valuation.observations.find(item => item.observation_id === request.observation_id);
  if (!observation || observation.kind !== "model" || observation.accounting_scope !== "direct" || valued?.amount_nanos == null) {
    throw new CoreError("CONTEXT_ALLOCATION_COST_UNAVAILABLE", `Request ${request.id} needs a directly valued model observation`);
  }
  if (request.boundary === "unavailable") throw new CoreError("CONTEXT_ALLOCATION_BOUNDARY_UNAVAILABLE", `Request ${request.id} has no captured context boundary`);
  const amount = BigInt(valued.amount_nanos);
  const revisions = new Map(context.revisions.map(item => [item.id, item]));
  const portions = request.occurrences.flatMap(occurrence => {
    const revision = revisions.get(occurrence.revision_id)!;
    if (revision.tokens.value === null || revision.tokens.evidence === "counterfactual") return [];
    return [{ occurrence_id: occurrence.id, revision_id: revision.id, source_id: revision.source_id, weight_tokens: revision.tokens.value, amount_nanos: "0" }];
  });
  const denominator = observation.usage?.input_tokens ?? null;
  const result: ContextAllocation = {
    request_id: request.id, observation_id: observation.id, method: "proportional-input-coverage-v1", evidence: "estimated",
    amount_nanos: amount.toString(), denominator_tokens: denominator, unallocated_weight_tokens: null,
    allocated_nanos: "0", unallocated_nanos: amount.toString(), portions,
    assumptions: [
      "This estimates a distribution of the whole selected request cost, including any output component; it is not source billing or causal savings.",
      "Eligible occurrence token counts are weights against observed inclusive input tokens. Repeated occurrences count separately; transformation ancestors do not receive implicit weights.",
      `Selected capture boundary: ${request.boundary}; coverage: ${request.coverage}. Missing input weight remains unallocated.`,
      "Counterfactual and unavailable measurements are excluded. Observed, derived and estimated token measurements can supply weights without changing the allocation's estimated status.",
    ], issues: [],
  };
  if (denominator === null) {
    result.issues.push({ code: "CONTEXT_INPUT_DENOMINATOR_UNAVAILABLE", severity: "warning", request_id: request.id, message: "Observed inclusive input tokens are unavailable; the entire selected request cost remains unallocated." });
    return result;
  }
  const total = BigInt(denominator);
  const known = portions.reduce((sum, part) => sum + BigInt(part.weight_tokens), 0n);
  if (known > total) throw new CoreError("CONTEXT_ALLOCATION_OVER_COVERAGE", `Request ${request.id} has ${known} weighted tokens exceeding ${total} observed input tokens`);
  result.unallocated_weight_tokens = (total - known).toString();
  if (total === 0n) return result;
  const magnitude = amount < 0n ? -amount : amount;
  const sign = amount < 0n ? -1n : 1n;
  const buckets = [
    ...portions.map((part, index) => ({ key: `occurrence:${part.occurrence_id}`, index, weight: BigInt(part.weight_tokens) })),
    { key: "unallocated", index: -1, weight: total - known },
  ].map(bucket => ({ ...bucket, amount: magnitude * bucket.weight / total, remainder: magnitude * bucket.weight % total }));
  let residual = magnitude - buckets.reduce((sum, bucket) => sum + bucket.amount, 0n);
  for (const bucket of [...buckets].sort((a, b) => a.remainder === b.remainder ? compare(a.key, b.key) : a.remainder > b.remainder ? -1 : 1)) {
    if (residual === 0n) break;
    bucket.amount += 1n;
    residual -= 1n;
  }
  for (const bucket of buckets) {
    const quantity = (sign * bucket.amount).toString();
    if (bucket.index === -1) result.unallocated_nanos = quantity;
    else portions[bucket.index]!.amount_nanos = quantity;
  }
  result.allocated_nanos = (amount - BigInt(result.unallocated_nanos)).toString();
  return result;
}

/** Exact valuation is retained unchanged; optional estimated allocations are a separate view. */
export function createContextReport(evidence: EvidenceBundle, valuation: Valuation, context: ContextBundle, options: ContextReportOptions = {}): ContextReport {
  // Reuse the established evidence/valuation join validator without changing the selected cost view.
  validateValuation(valuation);
  validateContextReportInputs(evidence, valuation);
  const validated = validateContextBundle(context, evidence);
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => key !== "allocation_request_ids")) throw new CoreError("CONTEXT_REPORT_OPTIONS_INVALID", "Unknown context report options");
  const selected = options.allocation_request_ids ?? [];
  if (!Array.isArray(selected) || selected.some(id => typeof id !== "string") || new Set(selected).size !== selected.length) throw new CoreError("CONTEXT_REPORT_OPTIONS_INVALID", "Allocation request IDs must be unique strings");
  const requests = new Map(validated.requests.map(request => [request.id, request]));
  const seenObservations = new Set<string>();
  const allocations = [...selected].sort(compare).map(id => {
    const request = requests.get(id);
    if (!request) throw new CoreError("CONTEXT_ALLOCATION_REQUEST_MISSING", `Unknown allocation request ${id}`);
    if (request.observation_id !== null && seenObservations.has(request.observation_id)) throw new CoreError("CONTEXT_ALLOCATION_DUPLICATE_OBSERVATION", `Select at most one context request for observation ${request.observation_id}`);
    if (request.observation_id !== null) seenObservations.add(request.observation_id);
    return allocate(evidence, valuation, validated, request);
  });
  return structuredClone({ schema_version: "0.2.0", dataset_id: evidence.dataset_id, evidence, valuation, context: validated, allocations,
    summary: { requests: validated.requests.length, linked_observations: new Set(validated.requests.flatMap(request => request.observation_id === null ? [] : [request.observation_id])).size, context_sources: validated.sources.length, known_cost_nanos: valuation.total_nanos, currency: valuation.currency, valuation_complete: valuation.complete, complete_context_requests: validated.requests.filter(request => request.coverage === "complete").length, partial_context_requests: validated.requests.filter(request => request.coverage === "partial").length, unknown_context_requests: validated.requests.filter(request => request.coverage === "unknown").length },
    issues: [...validated.issues, ...allocations.flatMap(item => item.issues)],
  });
}
