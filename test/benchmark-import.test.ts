import assert from "node:assert/strict";
import test from "node:test";

import { importInspectBenchmark, importInspectBenchmarkDetailed } from "../src/benchmark-import.js";
import { compareBenchmarks, validateBenchmarkInput } from "../src/efficiency.js";

function log(model: string): Record<string, unknown> {
  const samples = [
    { id: "task-1", epoch: 1, uuid: `${model}-1`, model_usage: { [model]: { input_tokens: 10, output_tokens: 2 } }, scores: { accuracy: { value: 1 } }, total_time: 1.25 },
    { id: "task-2", epoch: 1, uuid: `${model}-2`, model_usage: { [model]: { input_tokens: 12, output_tokens: 3, input_tokens_cache_read: 2 } }, scores: { accuracy: { value: 0 } }, total_time: 2 },
    { id: "task-3", epoch: 1, uuid: `${model}-3`, model_usage: { [model]: { input_tokens: 8, output_tokens: 1 }, "openai/grader": { input_tokens: 4, output_tokens: 2 } }, scores: { accuracy: { value: 1 } }, total_time: 1.5 },
    { id: "task-4", epoch: 1, uuid: `${model}-4`, model_usage: { [model]: { input_tokens: 9, output_tokens: 2 } }, scores: {}, total_time: 1 },
    { id: "task-5", epoch: 1, uuid: `${model}-5`, model_usage: { [model]: { input_tokens: 7, output_tokens: 1 } }, scores: { accuracy: { value: 1 } }, error: { message: "provider detail must not be retained" }, error_retries: [{}] },
    { id: "task-6", epoch: 1, uuid: `${model}-6`, scores: { accuracy: { value: 0.5 } }, total_time: null },
  ];
  return {
    version: 2,
    status: "success",
    eval: {
      eval_id: `eval-${model}`,
      task: "red-green",
      task_id: "stable-workload",
      task_version: "v1",
      created: "2026-09-07T10:00:00Z",
      model,
      packages: { inspect_ai: "0.3.206" },
      metadata: { cache_policy: "disabled", context_policy: "fixed", routing_policy: "declared", prompt: "must not be copied" },
    },
    samples,
    stats: { model_usage: { [model]: { input_tokens: 46, output_tokens: 9 } } },
  };
}

const options = (role: "baseline" | "candidate", model: string) => ({
  benchmark_id: `${role}-benchmark`,
  role,
  scorer: "accuracy",
  accepted_values: [1],
  workload_id: "red-green",
  scope_revision: "scope-v1",
  acceptance_version: "acceptance-v1",
  model,
  harness_version: "0.3.206",
});

test("imports six Inspect samples with stable task IDs, auxiliary grading meters, missing scores and errors", () => {
  const baseline = importInspectBenchmark(log("openai/gpt-baseline"), options("baseline", "openai/gpt-baseline"));
  const candidate = importInspectBenchmark(log("openai/gpt-candidate"), options("candidate", "openai/gpt-candidate"));
  assert.equal(baseline.samples.length, 6);
  assert.deepEqual(baseline.samples.map((sample) => sample.task_id), candidate.samples.map((sample) => sample.task_id));
  assert.equal(baseline.samples[0]?.accepted, true);
  assert.equal(baseline.samples[1]?.accepted, false);
  assert.equal(baseline.samples[3]?.accepted, null);
  assert.equal(baseline.samples[4]?.accepted, null);
  assert.equal(baseline.samples[5]?.meters.length, 0);
  assert.equal(baseline.samples[2]?.meters.find((meter) => meter.meter_id === "auxiliary_input_tokens")?.quantity, "4");
  assert.equal(baseline.samples[0]?.latency_ns, "1250000000");
  assert.equal(JSON.stringify(baseline).includes("provider detail"), false);
  assert.equal(JSON.stringify(baseline).includes("must not be copied"), false);
  validateBenchmarkInput(baseline);
});

test("does not combine Inspect aggregate stats with per-sample usage", () => {
  const imported = importInspectBenchmark(log("openai/gpt"), options("baseline", "openai/gpt"));
  assert.equal(imported.analysis_overhead, undefined);
  const inputOnly = imported.samples.reduce((total, sample) => total + Number(sample.meters.find((meter) => meter.meter_id === "input_tokens")?.quantity ?? 0), 0);
  assert.equal(inputOnly, 46);
});

test("keeps unknown conditions visible through the detailed import result and defaults evaluation to historical", () => {
  const result = importInspectBenchmarkDetailed({ ...log("openai/gpt"), eval: { ...(log("openai/gpt").eval as object), metadata: {} } }, options("baseline", "openai/gpt"));
  assert.equal(result.benchmark.evaluation, "historical");
  assert.ok(result.limitations.some((item) => item.includes("historical")));
  assert.ok(result.limitations.some((item) => item.includes("cache")));
  assert.equal(result.benchmark.conditions.cache, undefined);
});

test("requires an explicit acceptance rule and rejects binary Inspect logs", () => {
  assert.throws(() => importInspectBenchmark(log("openai/gpt"), { ...options("baseline", "openai/gpt"), accepted_values: undefined }), /accepted_values|score_threshold/iu);
  assert.throws(() => importInspectBenchmark(new Uint8Array([0x28, 0x8b]), options("baseline", "openai/gpt")), /convert.*json|binary/iu);
});

test("supports numeric thresholds without turning an absent score into a failure", () => {
  const imported = importInspectBenchmark(log("openai/gpt"), { ...options("candidate", "openai/gpt"), accepted_values: undefined, score_threshold: { value: 0.75, operator: "gte" } });
  assert.equal(imported.samples[0]?.accepted, true);
  assert.equal(imported.samples[1]?.accepted, false);
  assert.equal(imported.samples[3]?.accepted, null);
  const comparison = compareBenchmarks(imported, { ...imported, benchmark_id: "other", role: "baseline" });
  assert.equal(comparison.accepted_counts.candidate, "2");
});
