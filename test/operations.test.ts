import assert from "node:assert/strict";
import test from "node:test";
import { validateOperationBundle, createOperationReport, validateOperationReport, reconcileOperationBundles } from "../src/operations.js";
import type { OperationBundle, OperationSpan } from "../src/operation-types.js";
import { OPERATION_IO_MEASURES } from "../src/operation-types.js";
import type { EvidenceBundle } from "../src/types.js";
import { valueEvidence } from "../src/core.js";
import { captureRequestContext, createHarnessProfile } from "../src/context-capture.js";
import { createContextReport } from "../src/context-report.js";
import { exportOperationFolded, exportOperationPprof, exportOperationTrace, renderOperationSvg } from "../src/operation-export.js";
import { gunzipSync } from "node:zlib";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import protobuf from "protobufjs";

function span(id: string, parent_id: string | null, sequence: number): OperationSpan {
  return { id, parent_id, parentage: parent_id ? { evidence: "observed", method: "runtime scope" } : null,
    stream_id: "test", sequence, kind: "work", label: id, classification: { evidence: "declared", method: "fixture" },
    status: "ok", started_at: null, ended_at: null, duration_ns: null,
    timing: { started_at: { evidence: "unknown", method: "not captured" }, ended_at: { evidence: "unknown", method: "not captured" }, duration_ns: { evidence: "unknown", method: "not captured", clock: "unknown" } }, agent_id: null,
    requesting_model: null, executing_model: null, observation_id: null,
    source_refs: [{ source_id: "ops", record: id }], io: null, routing: null };
}
function bundle(): OperationBundle {
  return { schema_version: "0.3.0", dataset_id: "operations-test", artifacts: [{ id: "ops", harness: "test", format: "instrumented", coverage: "complete" }],
    spans: [span("work", null, 0), span("agent", "work", 1), span("research", "agent", 2), span("search", "research", 3), span("directory", "search", 4), span("file", "directory", 5)],
    links: [], coverage: { boundary: "instrumented", complete: true, dropped_spans: 0, dropped_spans_by_stream: {}, dropped_links: 0, dropped_links_by_stream: {}, limitations: [] } };
}

test("operation capture retains six real nested scopes and rejects cyclic execution ancestry", () => {
  const input = bundle();
  assert.deepEqual(validateOperationBundle(input), input);
  input.spans[0]!.parent_id = "file";
  input.spans[0]!.parentage = { evidence: "observed", method: "invalid cycle" };
  assert.throws(() => validateOperationBundle(input), /cycle/i);
});

function costEvidence(): EvidenceBundle {
  return { schema_version: "0.1.0", dataset_id: "operations-test", sources: [{ id: "cost", harness: "test", format: "fixture", coverage: "partial" }],
    observations: [
      { id: "model", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "1" }], usage: null, recorded_cost: { amount: "0.000000101", currency: "USD", basis: "provider_reported" } },
      { id: "unbound", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "2" }], usage: null, recorded_cost: { amount: "0.000000007", currency: "USD", basis: "provider_reported" } },
      { id: "credit", kind: "model", operation: "adjustment", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "3" }], usage: null, recorded_cost: { amount: "-0.000000003", currency: "USD", basis: "provider_reported" } },
      { id: "unknown", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "4" }], usage: null },
    ], relationships: [], issues: [] };
}

test("nested execution charges each valued observation once while preserving credits, unbound and unpriced work", () => {
  const input = bundle();
  input.spans[5]!.observation_id = "model";
  input.spans[5]!.kind = "model";
  input.spans.push({ ...span("unknown-op", "agent", 6), kind: "model", observation_id: "unknown" });
  const evidence = costEvidence();
  const valuation = valueEvidence(evidence, { mode: "recorded" });
  const report = createOperationReport(input, evidence, valuation);
  assert.equal(report.summary.known_net_nanos, "105");
  assert.equal(report.summary.charges_nanos, "108");
  assert.equal(report.summary.credits_nanos, "3");
  assert.equal(report.summary.max_depth, 6);
  assert.deepEqual(report.summary.unbound_observation_ids, ["credit", "unbound"]);
  assert.deepEqual(report.summary.unknown_cost_observation_ids, ["unknown"]);
  assert.deepEqual(report.execution_cost.find(s => s.observation_id === "model")?.operation_ids, ["work", "agent", "research", "search", "directory", "file"]);
  assert.equal(report.nodes.find(n => n.operation_id === "work")?.subtree_charges_nanos, "101");
  assert.equal(report.nodes.find(n => n.operation_id === "work")?.self_cost_state, "not_applicable");
  assert.equal(report.nodes.find(n => n.operation_id === "unknown-op")?.self_cost_state, "unknown");
  assert.deepEqual(report.valuation, valuation);
});

test("operation provenance and identity cannot be silently rebound or dropped", () => {
  const change = (modify: (input: OperationBundle) => void, pattern: RegExp) => {
    const input = bundle(); modify(input); assert.throws(() => validateOperationBundle(input), pattern);
  };
  change(input => input.spans.push(structuredClone(input.spans[0]!)), /duplicate/i);
  change(input => { input.spans[1]!.sequence = 0; }, /sequence/i);
  change(input => { input.spans[1]!.parent_id = "missing"; }, /parent/i);
  change(input => { input.spans[1]!.parentage = null; }, /parent/i);
  change(input => { input.spans[1]!.source_refs[0]!.source_id = "missing"; }, /source/i);
  change(input => { input.coverage.dropped_spans = 1; }, /coverage/i);
  change(input => { input.spans[0]!.started_at = "2026-01-01T02:00:00Z"; input.spans[0]!.ended_at = "2026-01-01T01:00:00Z"; }, /time/i);
});

test("source-cost projection follows the producing file and repeated consuming occurrences without adding another charge", () => {
  const input = bundle();
  input.spans[5]!.kind = "file_read";
  input.spans.push({ ...span("consumer", "agent", 6), kind: "model", observation_id: "model" });
  const evidence = costEvidence();
  evidence.observations[0]!.usage = { input_tokens: "100", output_tokens: "5", cache_read_input_tokens: null, cache_write_input_tokens: null, reasoning_output_tokens: null };
  const context = captureRequestContext({ dataset_id: input.dataset_id, request_id: "request", observation_id: "model", profile: createHarnessProfile({ harness: "test" }),
    boundary: "client_request", coverage: "partial", artifact: { id: "request-artifact", harness: "test", format: "fixture", coverage: "partial" }, record: "/",
    blocks: [0, 1].map(() => ({ source_id: "file-source", label: "Source file", origin: "repository_file" as const, representation: "excerpt" as const, media: "text" as const, role: "tool" as const, placement: "tool_result" as const, content: "same material",
      tokens: { value: "30", unit: "tokens" as const, evidence: "estimated" as const, method: "fixture weight", source_refs: [{ source_id: "request-artifact", record: "/" }] } })) });
  const revision = context.revisions[0]!;
  input.links.push({ from_operation_id: "file", kind: "produces_context", to_operation_id: null, context_revision_id: revision.id, request_id: null, occurrence_id: null, evidence: "observed", method: "request boundary", source_refs: [{ source_id: "ops", record: "file/context" }] });
  for (const occurrence of context.requests[0]!.occurrences) input.links.push({ from_operation_id: "consumer", kind: "consumes_context", to_operation_id: null, context_revision_id: revision.id, request_id: "request", occurrence_id: occurrence.id, evidence: "observed", method: "request boundary", source_refs: [{ source_id: "ops", record: "consumer/context" }] });
  const valuation = valueEvidence(evidence, { mode: "recorded" });
  const contextReport = createContextReport(evidence, valuation, context, { allocation_request_ids: ["request"] });
  const report = createOperationReport(input, evidence, valuation, contextReport);
  const portions = report.source_cost.filter(sample => sample.attribution === "estimated_source");
  assert.deepEqual(portions.map(sample => sample.amount_nanos), ["30", "30"]);
  assert.deepEqual(portions[0]!.operation_ids, ["work", "agent", "research", "search", "directory", "file"]);
  assert.deepEqual(report.execution_cost.find(sample => sample.observation_id === "model")?.operation_ids, ["work", "agent", "consumer"]);
  assert.equal(report.source_cost.find(sample => sample.observation_id === "model" && sample.attribution === "unallocated")?.amount_nanos, "41");
  assert.equal(report.source_cost.reduce((sum, sample) => sum + BigInt(sample.amount_nanos), 0n), 105n);
  assert.equal(report.execution_cost.reduce((sum, sample) => sum + BigInt(sample.amount_nanos), 0n), 105n);
  const withoutConsumption = structuredClone(input); withoutConsumption.links = withoutConsumption.links.filter(link => link.kind !== "consumes_context");
  assert.ok(createOperationReport(withoutConsumption, evidence, valuation, contextReport).source_cost.filter(sample => sample.attribution === "estimated_source").every(sample => sample.operation_ids.length === 0));
  input.links.at(-1)!.occurrence_id = "missing";
  assert.throws(() => createOperationReport(input, evidence, valuation, contextReport), /occurrence/i);
});

test("immutable capture replay is idempotent and conflicting identities or fabricated report totals fail closed", () => {
  const input = bundle();
  assert.deepEqual(reconcileOperationBundles([input, input]), input);
  const conflicting = structuredClone(input); conflicting.spans[5]!.label = "different operation";
  assert.throws(() => reconcileOperationBundles([input, conflicting]), /conflict/i);
  const evidence = costEvidence();
  const report = createOperationReport(input, evidence, valueEvidence(evidence, { mode: "recorded" }));
  assert.deepEqual(validateOperationReport(JSON.parse(JSON.stringify(report))), report);
  report.summary.charges_nanos = "9999";
  assert.throws(() => validateOperationReport(report), /report/i);
});

test("overlapping captures retain cumulative drop counts once and cannot claim complete native coverage", () => {
  const first = bundle(); first.coverage.complete = false; first.coverage.dropped_spans = 1; first.coverage.dropped_spans_by_stream = { test: 1 };
  const later = structuredClone(first); later.spans.push(span("next", "work", 6));
  assert.equal(reconcileOperationBundles([first, later]).coverage.dropped_spans, 1);
  const native = bundle(); native.coverage.boundary = "native_transcript";
  assert.throws(() => validateOperationBundle(native), /coverage/i);
  const partial = bundle(); partial.artifacts[0]!.coverage = "partial";
  assert.throws(() => validateOperationBundle(partial), /coverage/i);
  const selfLink = bundle(); selfLink.links.push({ from_operation_id: "work", kind: "delegates", to_operation_id: "work", context_revision_id: null, request_id: null, occurrence_id: null, evidence: "declared", method: "invalid self", source_refs: [{ source_id: "ops", record: "work/link" }] });
  assert.throws(() => validateOperationBundle(selfLink), /self/i);
});

test("standard profiles preserve exact monetary totals and expose every recorded operation through a separate count view", () => {
  const input = bundle(); input.spans[5]!.observation_id = "model";
  const evidence = costEvidence();
  const report = createOperationReport(input, evidence, valueEvidence(evidence, { mode: "recorded" }));
  const chargeLines = exportOperationFolded(report, { projection: "execution", measure: "charges" }).trim().split("\n");
  assert.equal(chargeLines.reduce((total, line) => total + BigInt(line.split(" ").at(-1)!), 0n), 108n);
  assert.equal(chargeLines.find(line => line.endsWith(" 101"))!.split(";").length, 8);
  const countLines = exportOperationFolded(report, { projection: "execution", measure: "operations" }).trim().split("\n");
  assert.equal(countLines.length, 6);
  assert.ok(countLines.every(line => line.endsWith(" 1")));
  const type = protobuf.parse(readFileSync(new URL("../vendor/pprof/profile.proto", import.meta.url), "utf8")).root.lookupType("perftools.profiles.Profile");
  const decoded = type.toObject(type.decode(gunzipSync(exportOperationPprof(report, { projection: "execution", measure: "credits" }))), { longs: String });
  assert.deepEqual(decoded.sample.map((sample: { value: string[] }) => sample.value), [["3"]]);
  assert.ok(decoded.stringTable.includes("USD_nanos"));
  const trace = exportOperationTrace(report);
  assert.deepEqual(trace.missing_timing_operation_ids, ["work", "agent", "research", "search", "directory", "file"]);
  assert.equal(trace.traceEvents.length, 0);
});

test("upstream FlameGraph renders nested operation counts while escaping captured labels", () => {
  const input = bundle(); input.spans[5]!.label = "<script>alert('private')\n;second</script>";
  const evidence = costEvidence();
  const report = createOperationReport(input, evidence, valueEvidence(evidence, { mode: "recorded" }));
  const svg = renderOperationSvg(report, { projection: "execution", measure: "operations" });
  assert.match(svg!, /6 recorded operations/);
  assert.doesNotMatch(svg!, /<script>alert/);
  assert.match(svg!, /%3Cscript%3E/);
  const monetary = renderOperationSvg(report, { projection: "execution", measure: "charges" });
  assert.match(monetary!, /\$0\.000000108/);
});

test("CLI validates, reports and exports operation captures while protecting source artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "operation-cli-"));
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });
  try {
    const operations = join(dir, "operations.json"), evidenceFile = join(dir, "evidence.json"), valuationFile = join(dir, "valuation.json"), reportFile = join(dir, "report.json");
    const evidence = costEvidence();
    for (const [file, value] of [[operations, bundle()], [evidenceFile, evidence], [valuationFile, valueEvidence(evidence, { mode: "recorded" })]] as const) writeFileSync(file, JSON.stringify(value));
    const result = cli("operation-report", "--input", operations, "--evidence", evidenceFile, "--valuation", valuationFile, "--out", reportFile);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(cli("validate", "--kind", "operation-report", "--input", reportFile).status, 0);
    const exported = cli("operation-export", "--input", reportFile, "--out-dir", join(dir, "exports"), "--svg", "true");
    assert.equal(exported.status, 0, exported.stderr);
    assert.match(readFileSync(join(dir, "exports", "operations.svg"), "utf8"), /6 recorded operations/);
    assert.equal(JSON.parse(readFileSync(join(dir, "exports", "export.json"), "utf8")).summary.known_net_nanos, "105");
    assert.notEqual(cli("operation-report", "--input", operations, "--evidence", evidenceFile, "--valuation", valuationFile, "--out", operations).status, 0);
    assert.equal(JSON.parse(readFileSync(operations, "utf8")).spans.length, 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI imports native operations with explicit dataset identity and protects the native input", () => {
  const dir = mkdtempSync(join(tmpdir(), "native-operation-cli-"));
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });
  try {
    const input = join(dir, "native.jsonl"), output = join(dir, "operations.json");
    const fixture = readFileSync("test/fixtures/operations-codex.jsonl", "utf8");
    writeFileSync(input, fixture);
    const args = ["operation-import", "--harness", "codex", "--input", input, "--dataset-id", "native-cli", "--namespace", "native-cli"];
    const result = cli(...args, "--out", output);
    assert.equal(result.status, 0, result.stderr);
    const bundle = validateOperationBundle(JSON.parse(readFileSync(output, "utf8")));
    assert.equal(bundle.dataset_id, "native-cli");
    assert.ok(bundle.spans.some(span => span.kind === "file_read"));
    assert.notEqual(cli(...args, "--out", input).status, 0);
    assert.equal(readFileSync(input, "utf8"), fixture);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("timing and IO facts cannot upgrade unknown evidence, and dependency links carry resolvable provenance", () => {
  const input = bundle();
  input.spans[0]!.started_at = "2026-01-01T00:00:00Z";
  input.spans[0]!.ended_at = "2026-01-01T00:00:00.002Z";
  input.spans[0]!.duration_ns = "1250000";
  assert.throws(() => validateOperationBundle(input), /timing/i);
  input.spans[0]!.timing = { started_at: { evidence: "observed", method: "wall clock" }, ended_at: { evidence: "observed", method: "wall clock" }, duration_ns: { evidence: "declared", method: "external timer", clock: "monotonic" } };
  const evidence = costEvidence();
  const trace = exportOperationTrace(createOperationReport(input, evidence, valueEvidence(evidence, { mode: "recorded" })));
  assert.equal(trace.traceEvents[0]!.dur, 1250);
  assert.deepEqual((trace.traceEvents[0]!.args as { timing: unknown }).timing, input.spans[0]!.timing);
  input.links.push({ from_operation_id: "file", kind: "depends_on", to_operation_id: "search", context_revision_id: null, request_id: null, occurrence_id: null, evidence: "observed", method: "runtime", source_refs: [] });
  assert.throws(() => validateOperationBundle(input), /provenance/i);
  input.links = [];
  input.spans[5]!.io = { resource_id: "file", resource_label: "file", requested_range: null, read_bytes: "10", returned_bytes: null, written_bytes: null, inserted_bytes: null, deleted_bytes: null, entry_count: null, examined_entries: null, content_sha256: null,
    measurements: Object.fromEntries(OPERATION_IO_MEASURES.map(measure => [measure, { evidence: "unknown", method: "not captured" }])) as NonNullable<OperationSpan["io"]>["measurements"] };
  assert.throws(() => validateOperationBundle(input), /measurement|read_bytes/i);
});
