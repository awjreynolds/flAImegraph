import assert from "node:assert/strict";
import test from "node:test";
import {
  createUsageReport,
  decimalAdd,
  decimalCompare,
  reconcileUsageBundles,
  validateUsageBundle,
  validateUsageReport,
  type UsageBundle,
  type UsageMeasurement,
  type UsageObservation,
} from "../src/usage.js";

const source = { id: "capture", harness: "fixture", format: "usage", coverage: "complete" as const };
const refs = [{ source_id: "capture", record: "observations" }];
const fact = (value: string) => ({ value, evidence: "observed" as const, method: "fixture", source_refs: refs });
const measurement = (value: string | null, evidence: UsageMeasurement["evidence"] = value === null ? "unknown" : "observed", extra: Partial<UsageMeasurement> = {}): UsageMeasurement => ({ value, evidence, method: "fixture", source_refs: refs, count_basis: "provider_native", aggregation: "delta", scope: "event", ...extra });
const observation = (id: string, value: string | null, extra: Partial<UsageObservation> = {}): UsageObservation => ({ id, source_refs: refs, subject: "model.response", accounting_scope: "direct", operation_id: id, parent_id: null, agent_id: "agent", session_id: "session", work_item_id: "work", task_id: "task", status: "ok", event_at: null, started_at: null, ended_at: null, collected_at: null, measurements: { input_tokens: measurement(value) }, dimensions: { actual_model: fact("model-a") }, ...extra });
const bundle = (observations: UsageObservation[] = [observation("one", "7")]): UsageBundle => ({ schema_version: "0.4.0", dataset_id: "dataset", sources: [source], meters: [{ id: "input_tokens", unit: "tokens", description: "Input tokens", subset_of: null, overlap: "disjoint" }, { id: "reasoning_output_tokens", unit: "tokens", description: "Reasoning output", subset_of: "output_tokens", overlap: "subset" }, { id: "output_tokens", unit: "tokens", description: "Output tokens", subset_of: null, overlap: "disjoint" }], observations });

test("exact decimal helpers preserve arbitrary precision", () => {
  assert.equal(decimalAdd("9007199254740992.75", "0.25"), "9007199254740993");
  assert.equal(decimalAdd("1.20", "-0.20"), "1");
  assert.equal(decimalCompare("1.000", "1"), 0);
  assert.equal(decimalCompare("-2", "-1.5"), -1);
});

test("usage validation rejects invalid calendars, negative quantities and pricing fields", () => {
  assert.deepEqual(validateUsageBundle(bundle()), bundle());
  const invalidDate = structuredClone(bundle());
  invalidDate.observations[0]!.started_at = { value: "2026-02-29T00:00:00.000Z", evidence: "observed", method: "fixture", source_refs: refs };
  assert.throws(() => validateUsageBundle(invalidDate), /calendar/);
  const negative = structuredClone(bundle());
  negative.observations[0]!.measurements.input_tokens = measurement("-1");
  assert.throws(() => validateUsageBundle(negative), /nonnegative/);
  assert.throws(() => validateUsageBundle({ ...bundle(), currency: "USD" }), /not defined/);
});

test("reconciliation is replay safe, merges provenance and fails immutable conflicts", () => {
  const first = bundle();
  const replay = structuredClone(first);
  replay.sources.push({ id: "second", harness: "fixture", format: "usage", coverage: "partial" });
  replay.observations[0]!.source_refs = [...refs, { source_id: "second", record: "line:9" }];
  const merged = reconcileUsageBundles([first, replay]);
  assert.deepEqual(merged.observations[0]!.source_refs, [...refs, { source_id: "second", record: "line:9" }]);
  const conflict = structuredClone(first);
  conflict.observations[0]!.measurements.input_tokens.value = "8";
  assert.throws(() => reconcileUsageBundles([first, conflict]), /Conflicting immutable/);
});

test("reports add only direct deltas, keep unknowns, and keep subset meters separate", () => {
  const direct = observation("direct", "5");
  const aggregate = observation("aggregate", "99", { accounting_scope: "aggregate" });
  const snapshot = observation("snapshot", "100", { accounting_scope: "snapshot", measurements: { input_tokens: measurement("100", "observed", { aggregation: "cumulative", scope: "snapshot" }) } });
  const unknown = observation("unknown", null);
  const child = observation("child", "2", { parent_id: "direct", measurements: { input_tokens: measurement("2"), output_tokens: measurement("4"), reasoning_output_tokens: measurement("1", "estimated") } });
  // The fixture's reasoning meter is declared as a subset of output; both are comparable.
  child.measurements.output_tokens = measurement("4");
  const report = createUsageReport(bundle([direct, aggregate, snapshot, unknown, child]), { meter_ids: ["input_tokens", "output_tokens", "reasoning_output_tokens"] });
  const input = report.meter_totals.find(total => total.meter_id === "input_tokens")!;
  assert.equal(input.known_total, "7");
  assert.equal(input.coverage.unknown_observations, 1);
  assert.equal(input.coverage.excluded_observations, 2);
  assert.equal(input.coverage.unknown_observation_ids[0], "unknown");
  const reasoning = report.meter_totals.find(total => total.meter_id === "reasoning_output_tokens")!;
  assert.equal(reasoning.known_total, "1");
  assert.equal(report.observations.find(row => row.observation_id === "child")!.ancestry.join("/"), "direct/child");
  assert.equal(report.observations.find(row => row.observation_id === "aggregate")!.ancestry.join("/"), "aggregate");
  assert.deepEqual(validateUsageReport(report), report);
  const drift = structuredClone(report); drift.meter_totals[0]!.known_total = "999";
  assert.throws(() => validateUsageReport(drift), /canonical recomputation/);
});

test("independent loss counters add once and survive staged reconciliation", () => {
  const capture = (id: string, count: number): UsageBundle => ({ ...bundle([]), sources: [{ ...source, id, coverage: "partial" }], coverage: { boundary: "instrumented", complete: false, dropped_observations: count, limitations: [] } });
  const a = capture("a", 2), b = capture("b", 3);
  const merged = reconcileUsageBundles([a, b]);
  assert.equal(merged.coverage?.dropped_observations, 5);
  assert.deepEqual(reconcileUsageBundles([merged, a, b]), merged);
  assert.deepEqual(reconcileUsageBundles([b, a]), merged);
  const ambiguous = { ...merged, coverage: { ...merged.coverage!, dropped_by_source: undefined } };
  assert.throws(() => reconcileUsageBundles([ambiguous]), /requires dropped_by_source/);
});

test("dimensions remain namespaced and grouping chooses actual model over requested model", () => {
  const item = observation("model", "3", { dimensions: { requested_model: fact("alias"), actual_model: fact("provider-model"), extensions: { "provider.example.cache_mode": fact("read") } } });
  const report = createUsageReport(bundle([item]), { group_by: ["model"] });
  assert.equal(report.groups[0]!.dimensions.model, "provider-model");
  assert.deepEqual(report.bundle.observations[0]!.dimensions.extensions, { "provider.example.cache_mode": fact("read") });
});

test("custom work identifiers group separate tasks and agents within a dataset", () => {
  const work = "Team A / PROJ-142 · repair cache";
  const capture = bundle([observation("one", "7", { work_item_id: work, task_id: "implement", agent_id: "worker" }), observation("two", "3", { work_item_id: work, task_id: "review", agent_id: "reviewer" }), observation("three", "2", { work_item_id: "https://github.com/example/repo/issues/12" })]);
  const report = createUsageReport(capture, { group_by: ["work_item"] });
  assert.equal(report.groups.length, 2);
  const group = report.groups.find(row => row.dimensions.work_item === work)!;
  assert.equal(group.meter_totals.find(row => row.meter_id === "input_tokens")!.known_total, "10");
  assert.deepEqual(group.observation_ids, ["one", "two"]);
  assert.equal(validateUsageReport(report).groups.length, 2);
  const literalUnknown = createUsageReport(bundle([observation("one", "7", { work_item_id: "unknown" }), observation("two", "3", { work_item_id: null })]), { group_by: ["work_item"] });
  assert.equal(literalUnknown.groups.length, 2, "a custom literal must not collide with an unavailable work identifier");
});

test("incompatible additive bases and impossible subsets fail closed", () => {
  const over = observation("over", "5", { measurements: { output_tokens: measurement("5"), reasoning_output_tokens: measurement("6") } });
  assert.throws(() => validateUsageBundle(bundle([over])), /subset parent|subset/);
  const mixed = observation("mixed", "2", { measurements: { input_tokens: measurement("2", "observed", { count_basis: "consumed" }) } });
  assert.throws(() => createUsageReport(bundle([observation("native", "1"), mixed])), /count bases/);
});
