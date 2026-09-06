import assert from "node:assert/strict";
import test from "node:test";
import { createContextReport } from "../src/context-report.js";
import { createHarnessProfile } from "../src/context-capture.js";
import { valueEvidence } from "../src/core.js";
import type { EvidenceBundle } from "../src/types.js";
import type { ContextBundle } from "../src/context-types.js";

function fixture(weights = ["30", "20"], input: string | null = "100", amount = "0.000000101") {
  const evidence: EvidenceBundle = { schema_version: "0.1.0", dataset_id: "allocation", sources: [{ id: "log", harness: "test", format: "fixture", coverage: "complete" }], observations: [{ id: "call", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "log", record: "1" }], usage: { input_tokens: input, output_tokens: "5", cache_read_input_tokens: null, cache_write_input_tokens: null, reasoning_output_tokens: null }, recorded_cost: { amount, currency: "USD", basis: "provider_reported" } }], relationships: [], issues: [] };
  const profile = createHarnessProfile({ harness: "fixture" });
  const refs = [{ source_id: "request", record: "/" }];
  const context: ContextBundle = { schema_version: "0.2.0", dataset_id: "allocation", evidence_schema_version: "0.1.0", artifacts: [{ id: "request", harness: "fixture", format: "fixture", coverage: "partial" }], profiles: [profile], sources: weights.map((_, i) => ({ id: `source-${i}`, origin: "repository_file", origin_evidence: "declared", label: `file-${i}`, identity_basis: "producer", source_refs: refs })), revisions: weights.map((weight, i) => ({ id: `revision-${i}`, source_id: `source-${i}`, representation: "original", media: "text", content_sha256: null, fingerprint_evidence: "unknown", fingerprint_method: null, tokens: { value: weight, unit: "tokens", evidence: "estimated", method: "fixture tokenizer", source_refs: refs }, bytes: { value: null, unit: "utf8_bytes", evidence: "unavailable", method: "not captured", source_refs: [] }, source_refs: refs })), requests: [{ id: "request-1", observation_id: "call", profile_id: profile.id, captured_at: null, boundary: "client_request", coverage: "partial", coverage_evidence: "declared", occurrences: weights.map((_, i) => ({ id: `occurrence-${i}`, revision_id: `revision-${i}`, role: "user", placement: "current_turn", treatment: { value: "unknown", evidence: "unknown", method: "not captured", source_refs: [] } })), overrides: {}, source_refs: refs }], transformations: [], issues: [] };
  return { evidence, valuation: valueEvidence(evidence, { mode: "recorded" }), context };
}

test("estimated allocation conserves request cost with an explicit uncovered denominator", () => {
  const { evidence, valuation, context } = fixture();
  const before = JSON.stringify({ evidence, valuation, context });
  const report = createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1"] });
  assert.deepEqual(report.allocations[0]?.portions.map(p => p.amount_nanos), ["30", "20"]);
  assert.equal(report.allocations[0]?.unallocated_nanos, "51");
  assert.equal(report.allocations[0]?.denominator_tokens, "100");
  assert.equal(report.allocations[0]?.unallocated_weight_tokens, "50");
  assert.equal(report.summary.known_cost_nanos, "101");
  assert.equal(report.summary.valuation_complete, true);
  assert.equal(report.summary.partial_context_requests, 1);
  assert.equal(JSON.stringify({ evidence, valuation, context }), before);
  assert.equal(createContextReport(evidence, valuation, context).allocations.length, 0);
});

test("allocation preserves signed credits and integer precision above Number.MAX_SAFE_INTEGER", () => {
  const { evidence, valuation, context } = fixture(["1", "1"], "3", "-9007199.254740995");
  const allocation = createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1"] }).allocations[0]!;
  assert.equal(BigInt(allocation.unallocated_nanos) + allocation.portions.reduce((sum, p) => sum + BigInt(p.amount_nanos), 0n), -9007199254740995n);
  assert.deepEqual(allocation.portions.map(p => p.amount_nanos), ["-3002399751580332", "-3002399751580332"]);
  assert.equal(allocation.unallocated_nanos, "-3002399751580331");
});

test("unknown input and output-only calls remain unallocated, never normalized to known context", () => {
  for (const [weights, input] of [[["30"], null], [["0"], "0"]] as const) {
    const { evidence, valuation, context } = fixture([...weights], input);
    const allocation = createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1"] }).allocations[0]!;
    assert.equal(allocation.allocated_nanos, "0");
    assert.equal(allocation.unallocated_nanos, "101");
    assert.equal(allocation.denominator_tokens, input);
  }
});

test("repeated occurrences consume separate weights, while counterfactual weights are excluded", () => {
  const { evidence, valuation, context } = fixture(["30", "999"], "100", "0.000000100");
  context.revisions[1]!.tokens.evidence = "counterfactual";
  context.requests[0]!.occurrences.push({ ...structuredClone(context.requests[0]!.occurrences[0]!), id: "repeated" });
  const allocation = createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1"] }).allocations[0]!;
  assert.deepEqual(allocation.portions.map(p => p.amount_nanos), ["30", "30"]);
  assert.equal(allocation.unallocated_nanos, "40");
});

test("overcoverage and selecting multiple boundaries for the same call fail", () => {
  const { evidence, valuation, context } = fixture(["101"]);
  assert.throws(() => createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1"] }), /exceeding/);
  context.revisions[0]!.tokens.value = "30";
  const second = structuredClone(context.requests[0]!);
  second.id = "request-2";
  second.boundary = "transcript_reconstruction";
  second.occurrences[0]!.id = "second-occurrence";
  context.requests.push(second);
  assert.throws(() => createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1", "request-2"] }), /at most one/);
});

test("report validation rejects altered summaries and nonconserving allocation payloads", async () => {
  const { validateContextReport } = await import("../src/context-report.js");
  const { evidence, valuation, context } = fixture();
  const report = createContextReport(evidence, valuation, context, { allocation_request_ids: ["request-1"] });
  assert.deepEqual(validateContextReport(JSON.parse(JSON.stringify(report))), report);
  const badTotal = structuredClone(report);
  badTotal.summary.known_cost_nanos = "999";
  assert.throws(() => validateContextReport(badTotal), /summary/);
  const badPortion = structuredClone(report);
  badPortion.allocations[0]!.portions[0]!.amount_nanos = "100";
  assert.throws(() => validateContextReport(badPortion), /allocation/);
  assert.throws(() => validateContextReport({ ...report, surprise: true }), /schema/);
});

test("creation rejects a valuation whose completeness claim contradicts unavailable amounts", () => {
  const { evidence, valuation, context } = fixture();
  valuation.observations[0]!.amount_nanos = null;
  valuation.observations[0]!.basis = null;
  valuation.total_nanos = "0";
  valuation.complete = true;
  assert.throws(() => createContextReport(evidence, valuation, context), /complete valuation/);
});

test("costless recorded evidence can be inspected without inventing a pricing basis or currency", async () => {
  const { evidence, context } = fixture();
  delete evidence.observations[0]!.recorded_cost;
  const { validateContextReport } = await import("../src/context-report.js");
  const { createCostProfile } = await import("../src/profile.js");
  for (const currency of [undefined, "USD"]) {
    const valuation = valueEvidence(evidence, { mode: "recorded", ...(currency ? { currency } : {}) });
    const report = validateContextReport(createContextReport(evidence, valuation, context));
    assert.equal(report.summary.known_cost_nanos, "0");
    assert.equal(report.summary.valuation_complete, false);
    assert.equal(report.valuation.basis, "mixed");
    assert.equal(report.summary.currency, currency ?? "UNKNOWN");
    assert.equal(report.valuation.observations[0]!.amount_nanos, null);
    assert.equal(report.context.requests.length, 1);
    assert.throws(() => createCostProfile(evidence, valuation), { code: "mixed_basis" });
  }
});
