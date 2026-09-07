import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeEfficiency,
  compareBenchmarks,
  deriveCandidatePolicyScenario,
  forecastRunway,
  validateEfficiencyReport,
  type BenchmarkInput,
  type EfficiencyInput,
  type CapacitySnapshot,
  type RunwayDemand,
} from "../src/efficiency.js";
import type { UsageBundle, UsageReport } from "../src/usage-types.js";
import { createUsageReport } from "../src/usage.js";

const source = { id: "capture", harness: "test", format: "fixture", coverage: "complete" as const };

function usageBundle(): UsageBundle {
  return {
    schema_version: "0.4.0",
    dataset_id: "dataset-1",
    sources: [source],
    meters: [
      { id: "input_tokens", unit: "token", description: "input", subset_of: null, overlap: "unknown" },
      { id: "output_tokens", unit: "token", description: "output", subset_of: null, overlap: "unknown" },
      { id: "cache_read_input_tokens", unit: "token", description: "cache reads", subset_of: "input_tokens", overlap: "subset" },
      { id: "duration_ns", unit: "ns", description: "elapsed", subset_of: null, overlap: "unknown" },
    ],
    observations: [
      {
        id: "attempt-a",
        source_refs: [{ source_id: "capture", record: "1" }],
        subject: "model.response",
        accounting_scope: "direct",
        operation_id: "op-a",
        parent_id: null,
        agent_id: "agent",
        session_id: "session",
        work_item_id: "task-a",
        task_id: "task-a",
        status: "error",
        event_at: null,
        started_at: null,
        ended_at: null,
        collected_at: null,
        measurements: {
          input_tokens: { value: "100", evidence: "observed", method: "provider", source_refs: [{ source_id: "capture", record: "1" }], count_basis: "provider_native", aggregation: "delta", scope: "event" },
          output_tokens: { value: "20", evidence: "observed", method: "provider", source_refs: [{ source_id: "capture", record: "1" }], count_basis: "provider_native", aggregation: "delta", scope: "event" },
          cache_read_input_tokens: { value: "50", evidence: "observed", method: "provider", source_refs: [{ source_id: "capture", record: "1" }], count_basis: "provider_native", aggregation: "delta", scope: "event" },
          duration_ns: { value: "1000", evidence: "observed", method: "clock", source_refs: [{ source_id: "capture", record: "1" }], count_basis: "consumed", aggregation: "delta", scope: "event" },
        },
        dimensions: {
          actual_model: { value: "small", evidence: "observed", method: "response", source_refs: [{ source_id: "capture", record: "1" }] },
        },
      },
      {
        id: "attempt-b",
        source_refs: [{ source_id: "capture", record: "2" }],
        subject: "model.response",
        accounting_scope: "direct",
        operation_id: "op-b",
        parent_id: null,
        agent_id: "agent",
        session_id: "session",
        work_item_id: "task-a",
        task_id: "task-a",
        status: "ok",
        event_at: null,
        started_at: null,
        ended_at: null,
        collected_at: null,
        measurements: {
          input_tokens: { value: "300", evidence: "observed", method: "provider", source_refs: [{ source_id: "capture", record: "2" }], count_basis: "provider_native", aggregation: "delta", scope: "event" },
          output_tokens: { value: "60", evidence: "observed", method: "provider", source_refs: [{ source_id: "capture", record: "2" }], count_basis: "provider_native", aggregation: "delta", scope: "event" },
          cache_read_input_tokens: { value: "150", evidence: "observed", method: "provider", source_refs: [{ source_id: "capture", record: "2" }], count_basis: "provider_native", aggregation: "delta", scope: "event" },
          duration_ns: { value: "3000", evidence: "observed", method: "clock", source_refs: [{ source_id: "capture", record: "2" }], count_basis: "consumed", aggregation: "delta", scope: "event" },
        },
        dimensions: {
          actual_model: { value: "small", evidence: "observed", method: "response", source_refs: [{ source_id: "capture", record: "2" }] },
        },
      },
    ],
  };
}

function usageReport(bundle: UsageBundle): UsageReport {
  return createUsageReport(bundle, { group_by: ["task"] });
}

function sampleInput(): EfficiencyInput {
  return {
    usage: usageReport(usageBundle()),
    work_items: [
      {
        work_item_id: "task-a",
        scope: { revision: "scope-1", version: "1" },
        acceptance: { version: "acceptance-1", status: "accepted", evidence: "observed" },
        attempts: [
          { attempt_id: "a", observation_ids: ["attempt-a"], status: "failed", kind: "initial" },
          { attempt_id: "b", observation_ids: ["attempt-b"], status: "accepted", kind: "retry", retry_of: "a" },
        ],
      },
    ],
  };
}

test("analyzeEfficiency includes failed retries in the per-accepted denominator", () => {
  const result = analyzeEfficiency(sampleInput());

  assert.equal(result.cohort.task_count, "1");
  assert.equal(result.cohort.accepted_count, "1");
  assert.deepEqual(result.cohort.per_accepted.find((item) => item.meter_id === "input_tokens")?.rate, { numerator: "400", denominator: "1" });
  assert.equal(result.cohort.retry_count, "1");
  assert.equal(result.cohort.acceptance_rate, "1/1");
  assert.ok(result.findings.some((finding) => finding.rule === "retry-burden" && finding.status === "measured"));
});

test("analyzeEfficiency rejects one observation explicitly joined to two work items", () => {
  const input = sampleInput();
  const bundle = (input.usage as UsageReport).bundle;
  for (const observation of bundle.observations) {
    observation.work_item_id = null;
    observation.task_id = null;
  }
  const first = input.work_items![0]!;
  const second = {
    ...first,
    work_item_id: "task-b",
    task_id: "task-b",
    attempts: first.attempts!.map((attempt) => ({ ...attempt })),
  };
  assert.throws(
    () => analyzeEfficiency({ ...input, usage: bundle, work_items: [first, second] }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONFLICTING_OBSERVATION_JOIN",
  );
});

test("efficiency joins preserve opaque work item identifiers containing spaces", () => {
  const bundle = usageBundle();
  bundle.observations[0]!.work_item_id = "JIRA-42 / cache repair";
  bundle.observations[0]!.task_id = "JIRA-42 / cache repair";
  bundle.observations[1]!.work_item_id = "JIRA-42 / cache repair";
  bundle.observations[1]!.task_id = "JIRA-42 / cache repair";
  const result = analyzeEfficiency({
    usage: bundle,
    cohort: { work_item_ids: ["JIRA-42 / cache repair"] },
    work_items: [{ work_item_id: "JIRA-42 / cache repair", scope: { revision: "scope-1" }, acceptance: { status: "accepted", evidence: "declared" } }],
  });
  assert.equal(result.cohort.accepted_count, "1");
  assert.equal(result.tasks[0]?.work_item_id, "JIRA-42 / cache repair");
});

test("session totals and cache facts remain useful when outcomes are unjoined", () => {
  const bundle = usageBundle();
  for (const observation of bundle.observations) {
    observation.work_item_id = null;
    observation.task_id = null;
  }
  const result = analyzeEfficiency(usageReport(bundle));
  assert.equal(result.tasks.length, 0);
  assert.equal(result.session.totals.find((item) => item.meter_id === "input_tokens")?.quantity, "400");
  assert.equal(result.cohort.per_accepted.length, 0);
  assert.equal(result.findings.find((finding) => finding.rule === "missing-acceptance")?.status, "unknown");
  assert.equal(result.findings.find((finding) => finding.rule === "cache-read-ratio")?.status, "measured");
});

test("efficiency report validation rejects forged versions, counts and quantities", () => {
  const report = analyzeEfficiency(sampleInput());

  const badVersion = structuredClone(report);
  badVersion.usage_schema_version = "forged";
  assert.throws(() => validateEfficiencyReport(badVersion), /usage_schema_version/i);

  const badCount = structuredClone(report);
  badCount.cohort.accepted_count = "banana";
  assert.throws(() => validateEfficiencyReport(badCount), /accepted_count/i);

  const badQuantity = structuredClone(report);
  badQuantity.session.totals[0]!.quantity = "not-a-quantity";
  assert.throws(() => validateEfficiencyReport(badQuantity), /quantity/i);

  const forgedQuantity = structuredClone(report);
  forgedQuantity.session.totals[0]!.quantity = "999999999999";
  assert.throws(() => validateEfficiencyReport(forgedQuantity), /canonical recomputation/i);

  const forgedInput = structuredClone(report);
  Object.assign(forgedInput.input, { unexpected: true });
  assert.throws(() => validateEfficiencyReport(forgedInput), /input contract/i);

  const forgedOptions = structuredClone(report);
  Object.assign(forgedOptions.options, { unexpected: true });
  assert.throws(() => validateEfficiencyReport(forgedOptions), /input contract/i);
});

test("cache ratio is measured only with a known input denominator", () => {
  const result = analyzeEfficiency(sampleInput());

  const cache = result.findings.find((finding) => finding.rule === "cache-read-ratio");
  assert.equal(cache?.status, "measured");
  assert.deepEqual(cache?.measurement, { numerator: "200", denominator: "400", unit: "ratio" });

  const bundle = usageBundle();
  bundle.observations[1].measurements.input_tokens.value = null;
  bundle.observations[1].measurements.input_tokens.evidence = "unknown";
  const unknown = analyzeEfficiency({ ...sampleInput(), usage: usageReport(bundle) });
  assert.equal(unknown.findings.find((finding) => finding.rule === "cache-read-ratio")?.status, "unknown");
});

function benchmark(id: string, role: "baseline" | "candidate", input: string, accepted: boolean): BenchmarkInput {
  return {
    benchmark_id: id,
    role,
    cohort: { workload_id: "workload-1", task_class: "edit", scope_revision: "scope-1", acceptance_version: "acceptance-1" },
    conditions: { harness: "test", harness_version: "harness-1", tools_version: "tools-1", cache: "warm", context_policy: "full", routing_policy: "fixed" },
    model_config: { model: role === "baseline" ? "small" : "large", reasoning: "medium" },
    evaluation: "held_out",
    samples: [
      {
        sample_id: `${id}-sample`,
        task_id: "task-x",
        accepted,
        quality: { passed: accepted, evidence: "observed" },
        latency_ns: "1000",
        meters: [{ meter_id: input, unit: "token", quantity: role === "baseline" ? "400" : "250", evidence: "observed" }],
        source_refs: [{ source_id: "benchmark", record: id }],
      },
    ],
    provenance: [{ source_id: "benchmark", record: id }],
  };
}

test("matched held-out benchmarks report vector deltas and reject scope mismatches", () => {
  const baseline = benchmark("base", "baseline", "input_tokens", true);
  const candidate = benchmark("candidate", "candidate", "input_tokens", true);
  const comparison = compareBenchmarks(baseline, candidate);

  assert.equal(comparison.status, "validated");
  assert.equal(comparison.resource_deltas[0]?.delta, "150");
  assert.equal(comparison.acceptance_rate_delta, "0/1");

  const incompatible = compareBenchmarks(candidate, {
    ...baseline,
    benchmark_id: "other",
    cohort: { ...baseline.cohort, scope_revision: "different" },
  });
  assert.equal(incompatible.status, "incompatible");
  assert.ok(incompatible.limitations.some((item) => item.includes("scope revision")));

  const candidateFirst = compareBenchmarks(candidate, baseline);
  assert.equal(candidateFirst.baseline_id, baseline.benchmark_id);
  assert.equal(candidateFirst.candidate_id, candidate.benchmark_id);
  assert.equal(candidateFirst.resource_deltas[0]?.delta, "150");
  assert.throws(() => compareBenchmarks(candidate, candidate), /one baseline.*candidate/i);
});

test("benchmark comparisons reject disjoint task identities and unknown conditions", () => {
  const baseline = benchmark("base-tasks", "baseline", "input_tokens", true);
  const candidate = { ...benchmark("candidate-tasks", "candidate", "input_tokens", true), samples: [{ ...benchmark("candidate-tasks-2", "candidate", "input_tokens", true).samples[0]!, task_id: "task-y" }] };
  const disjoint = compareBenchmarks(baseline, candidate);
  assert.equal(disjoint.status, "incompatible");
  assert.ok(disjoint.limitations.some((item) => item.includes("task identity multiset")));

  const incomplete = benchmark("candidate-conditions", "candidate", "input_tokens", true);
  delete incomplete.conditions.cache;
  const limited = compareBenchmarks(baseline, incomplete);
  assert.equal(limited.status, "limited");
  assert.ok(limited.limitations.some((item) => item.includes("cache is not declared")));
});

test("benchmark comparisons limit mismatched evaluation designs and quality", () => {
  const baseline = benchmark("quality-base", "baseline", "input_tokens", true);
  const candidate = benchmark("quality-candidate", "candidate", "input_tokens", true);
  candidate.evaluation = "controlled";
  candidate.samples[0]!.quality = { passed: false, evidence: "observed" };
  const comparison = compareBenchmarks(baseline, candidate);
  assert.equal(comparison.status, "limited");
  assert.ok(comparison.limitations.some((item) => item.includes("evaluation design")));
  assert.ok(comparison.limitations.some((item) => item.includes("quality evidence")));
});

test("benchmark validation rejects duplicate samples, meters and units", () => {
  const duplicateSample = benchmark("duplicate-sample", "candidate", "input_tokens", true);
  duplicateSample.samples.push({ ...duplicateSample.samples[0]! });
  assert.throws(() => compareBenchmarks(benchmark("base-duplicate-sample", "baseline", "input_tokens", true), duplicateSample), /duplicate sample/i);

  const duplicateMeter = benchmark("duplicate-meter", "candidate", "input_tokens", true);
  duplicateMeter.samples[0]!.meters.push({ ...duplicateMeter.samples[0]!.meters[0]! });
  assert.throws(() => compareBenchmarks(benchmark("base-duplicate-meter", "baseline", "input_tokens", true), duplicateMeter), /duplicate meter/i);

  const conflictingUnit = benchmark("conflicting-unit", "candidate", "input_tokens", true);
  conflictingUnit.samples.push({ ...conflictingUnit.samples[0]!, sample_id: "second", meters: [{ ...conflictingUnit.samples[0]!.meters[0]!, unit: "byte" }] });
  assert.throws(() => compareBenchmarks(benchmark("base-conflicting-unit", "baseline", "input_tokens", true), conflictingUnit), /conflicting units/i);

  const overheadConflict = benchmark("overhead-conflict", "candidate", "input_tokens", true);
  overheadConflict.analysis_overhead = [{ meter_id: "input_tokens", unit: "byte", quantity: "1", evidence: "observed" }];
  assert.throws(() => compareBenchmarks(benchmark("base-overhead-conflict", "baseline", "input_tokens", true), overheadConflict), /conflicting units/i);
});

test("candidate policy derivation requires candidate role and passing quality for accepted work", () => {
  const policy = { policy_id: "policy-1", policy_version: "1", benchmark_id: "candidate-policy" };
  const failedQuality = benchmark("candidate-policy", "candidate", "input_tokens", true);
  failedQuality.samples[0]!.quality = { passed: false, evidence: "observed" };
  const rejected = deriveCandidatePolicyScenario(policy, failedQuality);
  assert.equal(rejected.status, "unknown");
  assert.ok(rejected.limitations.some((item) => item.includes("passing quality")));

  const baseline = benchmark("baseline-policy", "baseline", "input_tokens", true);
  const wrongRole = deriveCandidatePolicyScenario({ ...policy, benchmark_id: "baseline-policy" }, baseline);
  assert.equal(wrongRole.status, "unknown");
  assert.ok(wrongRole.limitations.some((item) => item.includes("candidate role")));

  const failedAttempt = benchmark("candidate-failed-attempt", "candidate", "input_tokens", true);
  failedAttempt.samples.push({
    ...failedAttempt.samples[0]!,
    sample_id: "failed",
    task_id: "task-failed",
    accepted: false,
    quality: { passed: false, evidence: "observed" },
    meters: [{ meter_id: "input_tokens", unit: "token", quantity: "100", evidence: "observed" }],
  });
  const derived = deriveCandidatePolicyScenario({ ...policy, benchmark_id: "candidate-failed-attempt" }, failedAttempt);
  assert.equal(derived.status, "derived");
  assert.equal(derived.expected_per_accepted[0]?.rate.numerator, "350");
});

test("benchmark comparisons allocate analysis overhead across accepted samples", () => {
  const baseline = benchmark("base-overhead", "baseline", "input_tokens", true);
  baseline.analysis_overhead = [{
    meter_id: "input_tokens",
    unit: "token",
    quantity: "1000",
    evidence: "observed",
    source_refs: [{ source_id: "benchmark", record: "analysis" }],
  }];
  const candidate = benchmark("candidate-overhead", "candidate", "input_tokens", true);
  const comparison = compareBenchmarks(baseline, candidate);
  assert.equal(comparison.status, "validated");
  assert.equal(comparison.resource_deltas[0]?.delta, "1150");
  assert.ok(comparison.limitations.some((item) => item.includes("analysis overhead")) === false);
  assert.ok(comparison.source_refs.some((ref) => ref.record === "analysis"));
});

test("efficiency reports retain references used by external benchmark inputs", () => {
  const baseline = benchmark("analysis-base", "baseline", "input_tokens", true);
  const candidate = benchmark("analysis-candidate", "candidate", "input_tokens", true);
  const result = analyzeEfficiency({ ...sampleInput(), benchmarks: [baseline, candidate] });
  assert.ok(result.benchmark_comparisons.length === 1);
  assert.ok(result.source_refs.some((ref) => ref.record === "analysis-base"));
  assert.ok(result.source_refs.some((ref) => ref.record === "analysis-candidate"));
});

test("runway uses same-unit observed demand and floors exact capacity ratios", () => {
  const demand: RunwayDemand = {
    workload_id: "workload-1",
    scope_id: "shared",
    accepted_count: "2",
    per_accepted: [{ meter_id: "input_tokens", unit: "token", rate: { numerator: "3", denominator: "2" }, evidence: "observed" }],
  };
  const snapshot: CapacitySnapshot = {
    snapshot_id: "capacity-1",
    meter_id: "input_tokens",
    unit: "token",
    remaining: "10",
    scope: "shared_pool",
    scope_id: "shared",
    workload_id: "workload-1",
    observed_at: "2026-09-07T10:00:00Z",
    reset_at: "2026-09-07T12:00:00Z",
    evidence: "observed",
    coverage: "complete",
    source_refs: [{ source_id: "capacity", record: "1" }],
  };
  const result = forecastRunway([snapshot], demand, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" });
  assert.equal(result.status, "ready");
  assert.equal(result.accepted_work, "6");
  assert.equal(result.limiting_snapshot_id, "capacity-1");

  assert.throws(
    () => forecastRunway([snapshot], { ...demand, accepted_count: "0" }, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" }),
    /zero accepted/i,
  );
});

test("runway keeps derived demand limited and requires opt in for unverified demand", () => {
  const snapshot: CapacitySnapshot = {
    snapshot_id: "derived-capacity",
    meter_id: "input_tokens",
    unit: "token",
    remaining: "10",
    scope: "shared_pool",
    scope_id: "shared",
    workload_id: "workload-1",
    observed_at: "2026-09-07T10:00:00Z",
    reset_at: "2026-09-07T12:00:00Z",
    evidence: "observed",
    coverage: "complete",
    source_refs: [{ source_id: "capacity", record: "derived" }],
  };
  const derived: RunwayDemand = {
    workload_id: "workload-1",
    scope_id: "shared",
    accepted_count: "1",
    per_accepted: [{ meter_id: "input_tokens", unit: "token", rate: { numerator: "2", denominator: "1" }, evidence: "derived", source_refs: [{ source_id: "benchmark", record: "sample" }] }],
  };
  const limited = forecastRunway([snapshot], derived, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" });
  assert.equal(limited.status, "limited");
  assert.equal(limited.accepted_work, "5");
  assert.ok(limited.limitations.some((item) => item.includes("derived")));

  const declared = forecastRunway([snapshot], { ...derived, per_accepted: [{ ...derived.per_accepted[0]!, evidence: "declared" }] }, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" });
  assert.equal(declared.status, "unknown");
  const optedIn = forecastRunway([snapshot], { ...derived, per_accepted: [{ ...derived.per_accepted[0]!, evidence: "declared" }] }, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z", allow_unverified_demand: true });
  assert.equal(optedIn.status, "limited");
  assert.equal(optedIn.accepted_work, "5");

  const declaredCapacity = forecastRunway([{ ...snapshot, evidence: "declared" }], demandFrom(derived), { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" });
  assert.equal(declaredCapacity.status, "limited");
  assert.ok(declaredCapacity.limitations.some((item) => item.includes("remaining-capacity evidence")));
});

function demandFrom(value: RunwayDemand): RunwayDemand {
  return { ...value, per_accepted: [{ ...value.per_accepted[0]!, evidence: "observed" }] };
}

test("decimal meters and decimal remaining capacity retain exact ratios", () => {
  const bundle = usageBundle();
  bundle.meters.push({ id: "compute_seconds", unit: "seconds", description: "compute", subset_of: null, overlap: "disjoint" });
  bundle.observations[0].measurements.compute_seconds = { value: "0.125", evidence: "observed", method: "clock", source_refs: [{ source_id: "capture", record: "1" }], count_basis: "consumed", aggregation: "delta", scope: "interval" };
  bundle.observations[1].measurements.compute_seconds = { value: "0.375", evidence: "observed", method: "clock", source_refs: [{ source_id: "capture", record: "2" }], count_basis: "consumed", aggregation: "delta", scope: "interval" };
  const result = analyzeEfficiency({ ...sampleInput(), usage: usageReport(bundle) });
  assert.equal(result.cohort.totals.find((item) => item.meter_id === "compute_seconds")?.quantity, "0.5");
  assert.deepEqual(result.cohort.per_accepted.find((item) => item.meter_id === "compute_seconds")?.rate, { numerator: "1", denominator: "2" });

  const forecast = forecastRunway([{
    snapshot_id: "compute-capacity",
    meter_id: "compute_seconds",
    unit: "seconds",
    remaining: "1.5",
    scope: "shared_pool",
    scope_id: "shared",
    workload_id: "workload-1",
    observed_at: "2026-09-07T10:00:00Z",
    reset_at: "2026-09-07T12:00:00Z",
    evidence: "observed",
    coverage: "complete",
    source_refs: [{ source_id: "capacity", record: "compute" }],
  }], {
    workload_id: "workload-1",
    scope_id: "shared",
    accepted_count: "2",
    per_accepted: [{ meter_id: "compute_seconds", unit: "seconds", rate: { numerator: "3", denominator: "4" }, evidence: "observed" }],
  }, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" });
  assert.equal(forecast.accepted_work, "2");
});

test("elapsed duration meters union overlapping parallel intervals", () => {
  const bundle = usageBundle();
  bundle.meters.push({ id: "elapsed_ns", unit: "ns", description: "wall clock elapsed duration", subset_of: null, overlap: "unknown" });
  const first = bundle.observations[0];
  const second = bundle.observations[1];
  first.started_at = { value: "2026-09-07T10:00:00.000Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  first.ended_at = { value: "2026-09-07T10:00:00.002Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  second.started_at = { value: "2026-09-07T10:00:00.001Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  second.ended_at = { value: "2026-09-07T10:00:00.003Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  first.measurements.elapsed_ns = { value: "2000000", evidence: "observed", method: "clock", source_refs: first.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  second.measurements.elapsed_ns = { value: "2000000", evidence: "observed", method: "clock", source_refs: second.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  const result = analyzeEfficiency({ ...sampleInput(), usage: usageReport(bundle) });
  assert.equal(result.session.totals.find((item) => item.meter_id === "elapsed_ns")?.quantity, "3000000");
  assert.equal(result.session.totals.find((item) => item.meter_id === "elapsed_ns")?.evidence, "derived");
  assert.ok(result.session.limitations.some((item) => item.includes("union of overlapping")));
});

test("elapsed seconds meters convert the nanosecond interval union exactly", () => {
  const bundle = usageBundle();
  bundle.meters.push({ id: "elapsed_seconds", unit: "seconds", description: "wall clock elapsed duration", subset_of: null, overlap: "unknown" });
  const first = bundle.observations[0]!;
  const second = bundle.observations[1]!;
  first.started_at = { value: "2026-09-07T10:00:00.000Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  first.ended_at = { value: "2026-09-07T10:00:00.002Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  second.started_at = { value: "2026-09-07T10:00:00.001Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  second.ended_at = { value: "2026-09-07T10:00:00.003Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  first.measurements.elapsed_seconds = { value: "0.002", evidence: "observed", method: "clock", source_refs: first.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  second.measurements.elapsed_seconds = { value: "0.002", evidence: "observed", method: "clock", source_refs: second.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  const result = analyzeEfficiency({ ...sampleInput(), usage: usageReport(bundle) });
  const duration = result.session.totals.find((item) => item.meter_id === "elapsed_seconds");
  assert.equal(duration?.quantity, "0.003");
  assert.equal(duration?.evidence, "derived");
});

test("descriptive audio duration remains additive", () => {
  const bundle = usageBundle();
  bundle.meters.push({ id: "audio_duration_seconds", unit: "seconds", description: "elapsed audio duration", subset_of: null, overlap: "disjoint" });
  const first = bundle.observations[0]!;
  const second = bundle.observations[1]!;
  first.started_at = { value: "2026-09-07T10:00:00.000Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  first.ended_at = { value: "2026-09-07T10:00:00.002Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  second.started_at = { value: "2026-09-07T10:00:00.001Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  second.ended_at = { value: "2026-09-07T10:00:00.003Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  first.measurements.audio_duration_seconds = { value: "0.002", evidence: "observed", method: "audio-clock", source_refs: first.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  second.measurements.audio_duration_seconds = { value: "0.002", evidence: "observed", method: "audio-clock", source_refs: second.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  const result = analyzeEfficiency({ ...sampleInput(), usage: usageReport(bundle) });
  const duration = result.session.totals.find((item) => item.meter_id === "audio_duration_seconds");
  assert.equal(duration?.quantity, "0.004");
  assert.equal(duration?.evidence, "observed");
});

test("elapsed union does not truncate subnanosecond timestamps", () => {
  const bundle = usageBundle();
  bundle.meters.push({ id: "elapsed_ns", unit: "ns", description: "wall clock elapsed duration", subset_of: null, overlap: "unknown" });
  const first = bundle.observations[0]!;
  const second = bundle.observations[1]!;
  first.started_at = { value: "2026-09-07T10:00:00.0000000001Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  first.ended_at = { value: "2026-09-07T10:00:00.0000000002Z", evidence: "observed", method: "clock", source_refs: first.source_refs };
  second.started_at = { value: "2026-09-07T10:00:00.00000000015Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  second.ended_at = { value: "2026-09-07T10:00:00.00000000025Z", evidence: "observed", method: "clock", source_refs: second.source_refs };
  first.measurements.elapsed_ns = { value: "1", evidence: "observed", method: "clock", source_refs: first.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  second.measurements.elapsed_ns = { value: "1", evidence: "observed", method: "clock", source_refs: second.source_refs, count_basis: "consumed", aggregation: "delta", scope: "interval" };
  const result = analyzeEfficiency({ ...sampleInput(), usage: usageReport(bundle) });
  const duration = result.session.totals.find((item) => item.meter_id === "elapsed_ns");
  assert.equal(duration?.quantity, "2");
  assert.equal(duration?.evidence, "observed");
  assert.ok(result.session.limitations.some((item) => item.includes("finer than nanoseconds")));
});

test("runway keeps stale, reset, unit and shared-pool limits explicit", () => {
  const demand: RunwayDemand = {
    workload_id: "workload-1",
    scope_id: "shared",
    accepted_count: "1",
    per_accepted: [{ meter_id: "input_tokens", unit: "token", rate: { numerator: "2", denominator: "1" }, evidence: "observed" }],
  };
  const good: CapacitySnapshot = {
    snapshot_id: "good",
    meter_id: "input_tokens",
    unit: "token",
    remaining: "10",
    scope: "shared_pool",
    scope_id: "shared",
    workload_id: "workload-1",
    observed_at: "2026-09-07T10:00:00Z",
    reset_at: "2026-09-07T12:00:00Z",
    evidence: "observed",
    coverage: "complete",
    source_refs: [{ source_id: "capacity", record: "good" }],
  };
  const wrongScope = { ...good, snapshot_id: "wrong-scope", scope_id: "other" };
  const limited = forecastRunway([good, wrongScope], demand, { now: "2026-09-07T10:30:00Z", horizon_end: "2026-09-07T11:30:00Z" });
  assert.equal(limited.status, "unknown");
  assert.equal(limited.accepted_work, null);
  assert.ok(limited.limitations.some((item) => item.includes("shared scope")));

  const stale = forecastRunway([good], demand, { now: "2026-09-07T11:00:00Z", horizon_end: "2026-09-07T11:30:00Z", stale_after_seconds: "1" });
  assert.equal(stale.status, "unknown");
  assert.ok(stale.limitations.some((item) => item.includes("stale")));
});

test("runway validates calendar dates and compares submillisecond instants exactly", () => {
  const demand: RunwayDemand = {
    workload_id: "workload-1",
    scope_id: "shared",
    accepted_count: "1",
    per_accepted: [{ meter_id: "input_tokens", unit: "token", rate: { numerator: "1", denominator: "1" }, evidence: "observed" }],
  };
  const snapshot: CapacitySnapshot = {
    snapshot_id: "exact-time",
    meter_id: "input_tokens",
    unit: "token",
    remaining: "5",
    scope: "shared_pool",
    scope_id: "shared",
    workload_id: "workload-1",
    observed_at: "2026-09-07T10:00:00.000000000Z",
    reset_at: "2026-09-07T10:00:00.000000002Z",
    evidence: "observed",
    coverage: "complete",
    source_refs: [{ source_id: "capacity", record: "exact" }],
  };
  const exact = forecastRunway([snapshot], demand, { now: "2026-09-07T10:00:00.000000001Z", horizon_end: "2026-09-07T10:00:00.0000000015Z" });
  assert.equal(exact.status, "ready");
  assert.equal(exact.accepted_work, "5");
  assert.throws(() => forecastRunway([snapshot], demand, { now: "2026-02-30T00:00:00Z", horizon_end: "2026-03-01T00:00:00Z" }), /calendar/i);
  assert.throws(() => forecastRunway([snapshot], demand, { now: "2026-09-07T10:00:00.0000000015Z", horizon_end: "2026-09-07T10:00:00.000000001Z" }), /horizon/i);
});
