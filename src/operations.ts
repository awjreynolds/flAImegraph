import { validateContextReportInputs } from "./profile.js";
import { validateValuation } from "./work-items.js";
import { validateContextReport } from "./context-report.js";
import type { ContextReport } from "./context-types.js";
import type { EvidenceBundle, Valuation } from "./types.js";
import type { OperationBundle, OperationReport, OperationNode, OperationCostSample } from "./operation-types.js";

import { OperationError, validateOperationBundle } from "./operation-capture.js";
export { OperationError, validateOperationBundle, reconcileOperationBundles } from "./operation-capture.js";

function fail(code: string, message: string): never { throw new OperationError(code, message); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Report fields are derived and checked against their embedded source artifacts. */
export function validateOperationReport(value: unknown): OperationReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("OPERATION_REPORT", "Operation report must be an object");
  const report = value as OperationReport;
  const expected = createOperationReport(report.operations, report.evidence, report.valuation, report.context_report === null ? undefined : report.context_report);
  if (canonical(value) !== canonical(expected)) fail("OPERATION_REPORT", "Operation report differs from its recomputed source evidence, totals or projections");
  return expected;
}

/** Exact monetary self cost follows recorded ancestry; missing links remain unbound. */
export function createOperationReport(operations: OperationBundle, evidence: EvidenceBundle, valuation: Valuation, contextReport?: ContextReport): OperationReport {
  const bundle = validateOperationBundle(operations);
  validateValuation(valuation);
  validateContextReportInputs(evidence, valuation);
  if (bundle.dataset_id !== evidence.dataset_id) fail("OPERATION_DATASET", "Operations and cost evidence have different datasets");
  const spans = new Map(bundle.spans.map(span => [span.id, span]));
  const context = contextReport === undefined ? null : validateContextReport(contextReport);
  if (context && (canonical(context.evidence) !== canonical(evidence) || canonical(context.valuation) !== canonical(valuation))) fail("OPERATION_CONTEXT", "Context report must use the same evidence and valuation");
  const revisions = new Set(context?.context.revisions.map(revision => revision.id));
  const requests = new Map(context?.context.requests.map(request => [request.id, request]));
  const producers = new Map<string, Set<string>>();
  const consumption = new Set<string>();
  for (const link of bundle.links) {
    if (link.context_revision_id === null) continue;
    if (!revisions.has(link.context_revision_id)) fail("OPERATION_CONTEXT", `Unknown context revision ${link.context_revision_id}; supply the matching context report`);
    if (link.kind === "produces_context") {
      const ids = producers.get(link.context_revision_id) ?? new Set<string>();
      ids.add(link.from_operation_id); producers.set(link.context_revision_id, ids);
    }
    if (link.kind === "consumes_context") {
      const request = requests.get(link.request_id!);
      const occurrence = request?.occurrences.find(item => item.id === link.occurrence_id);
      if (!occurrence || occurrence.revision_id !== link.context_revision_id) fail("OPERATION_OCCURRENCE", "Unknown or mismatched consuming context occurrence");
      if (request!.observation_id === null || spans.get(link.from_operation_id)!.observation_id !== request!.observation_id) fail("OPERATION_OCCURRENCE", "Consuming operation must bind to the request's model observation");
      consumption.add(JSON.stringify([request!.id, occurrence.id]));
    }
  }
  const evidenceById = new Map(evidence.observations.map(observation => [observation.id, observation]));
  const operationByObservation = new Map<string, string>();
  const paths = new Map<string, string[]>();
  for (const span of bundle.spans) {
    if (span.observation_id !== null) {
      if (!evidenceById.has(span.observation_id)) fail("OPERATION_OBSERVATION", `Unknown cost observation ${span.observation_id}`);
      operationByObservation.set(span.observation_id, span.id);
    }
    const path: string[] = [];
    let current: typeof span | undefined = span;
    while (current) { path.push(current.id); current = current.parent_id === null ? undefined : spans.get(current.parent_id); }
    paths.set(span.id, path.reverse());
  }
  const nodeById = new Map<string, OperationNode>(bundle.spans.map(span => [span.id, {
    operation_id: span.id, depth: paths.get(span.id)!.length, child_count: 0,
    self_cost_state: span.kind === "model" ? "unknown" : "not_applicable",
    self_charges_nanos: "0", subtree_charges_nanos: "0", self_credits_nanos: "0", subtree_credits_nanos: "0", unknown_cost_observation_ids: [],
  }]));
  for (const span of bundle.spans) if (span.parent_id !== null) nodeById.get(span.parent_id)!.child_count++;
  const samples: OperationCostSample[] = [];
  const unbound: string[] = [], unknown: string[] = [];
  let charges = 0n, credits = 0n;
  for (const line of [...valuation.observations].sort((a, b) => compare(a.observation_id, b.observation_id))) {
    if (evidenceById.get(line.observation_id)?.accounting_scope !== "direct") continue;
    const operationId = operationByObservation.get(line.observation_id);
    const path = operationId === undefined ? [] : paths.get(operationId)!;
    const node = operationId === undefined ? undefined : nodeById.get(operationId)!;
    if (operationId === undefined) unbound.push(line.observation_id);
    if (line.amount_nanos === null) {
      unknown.push(line.observation_id);
      if (node) node.self_cost_state = "unknown";
      for (const id of path) nodeById.get(id)!.unknown_cost_observation_ids.push(line.observation_id);
      continue;
    }
    const amount = BigInt(line.amount_nanos);
    const charge = amount > 0n ? amount : 0n;
    const credit = amount < 0n ? -amount : 0n;
    charges += charge; credits += credit;
    if (node) { node.self_cost_state = "priced"; node.self_charges_nanos = charge.toString(); node.self_credits_nanos = credit.toString(); }
    for (const id of path) {
      const ancestor = nodeById.get(id)!;
      ancestor.subtree_charges_nanos = (BigInt(ancestor.subtree_charges_nanos) + charge).toString();
      ancestor.subtree_credits_nanos = (BigInt(ancestor.subtree_credits_nanos) + credit).toString();
    }
    samples.push({ observation_id: line.observation_id, operation_ids: path, amount_nanos: amount.toString(),
      context_source_id: null, context_revision_id: null, occurrence_id: null, request_id: null, attribution: "execution", label: evidenceById.get(line.observation_id)!.operation });
  }
  const allocations = new Map(context?.allocations.map(allocation => [allocation.observation_id, allocation]));
  const sourceSamples = samples.flatMap(sample => {
    const allocation = allocations.get(sample.observation_id);
    if (!allocation) return [{ ...sample, attribution: "unallocated" as const, label: "Unallocated request cost" }];
    const portions: OperationCostSample[] = allocation.portions.map(portion => {
      const candidates = producers.get(portion.revision_id);
      const producer = candidates?.size === 1 && consumption.has(JSON.stringify([allocation.request_id, portion.occurrence_id])) ? [...candidates][0] : undefined;
      return { observation_id: sample.observation_id, operation_ids: producer === undefined ? [] : paths.get(producer)!, amount_nanos: portion.amount_nanos,
        context_source_id: portion.source_id, context_revision_id: portion.revision_id, occurrence_id: portion.occurrence_id, request_id: allocation.request_id,
        attribution: "estimated_source", label: context!.context.sources.find(source => source.id === portion.source_id)!.label };
    });
    portions.push({ ...sample, amount_nanos: allocation.unallocated_nanos, request_id: allocation.request_id, attribution: "unallocated", label: "Unallocated request cost" });
    return portions;
  });
  return structuredClone({ schema_version: "0.3.0", dataset_id: bundle.dataset_id, operations: bundle, evidence, valuation, context_report: context,
    nodes: [...nodeById.values()], execution_cost: samples,
    source_cost: sourceSamples,
    summary: { spans: bundle.spans.length, max_depth: [...nodeById.values()].reduce((depth, node) => Math.max(depth, node.depth), 0), known_net_nanos: (charges - credits).toString(), charges_nanos: charges.toString(), credits_nanos: credits.toString(), currency: valuation.currency, unbound_observation_ids: unbound, unknown_cost_observation_ids: unknown },
    assumptions: [
      "Execution paths follow recorded parent containment; dependency and context links never create execution parents.",
      "Each direct valued observation contributes self cost once. Ancestor totals are rollups, not additional charges. Unbound cost is retained.",
      "A file operation without a linked monetary observation has no applicable self model cost; this does not assert free infrastructure or zero downstream model cost.",
      "Source cost is a separate estimated information-flow projection of selected request allocations, including output cost. It is not per-source billing or causal savings.",
      "Source paths require one recorded producer and an explicit consuming request occurrence link. Missing consumption links or multiple producers leave the operation path unattributed; summaries are never back-allocated to their ancestors.",
      "Null timing and IO quantities mean unavailable. Overlapping elapsed durations must not be summed as wall-clock time.",
    ],
  });
}
