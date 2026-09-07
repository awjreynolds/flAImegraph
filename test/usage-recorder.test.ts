import assert from "node:assert/strict";
import test from "node:test";

import { validateUsageBundle } from "../src/usage.js";
import { UsageRecorder, type UsageMeasurementInput } from "../src/usage-recorder.js";

test("records a model call with request and response descriptors, measured meters and nested tool work", async () => {
  const recorder = new UsageRecorder({
    dataset_id: "recorder-test",
    source_id: "recorder-source",
    harness: "test-harness",
  });
  const model = recorder.recordModelCall({
    id: "opaque-response-1",
    request: {
      provider: "openai",
      model: "gpt-requested",
      service_tier: "priority",
      reasoning: { effort: "medium" },
      context: { max_output_tokens: 4000 },
    },
    response: {
      provider: "openai",
      model: "gpt-applied",
      service_tier: "standard",
      region: "us-east",
    },
    started_at: "2026-09-07T09:00:00.000000001+00:00",
    ended_at: "2026-09-07T09:00:01.000000001+00:00",
    measurements: {
      input_tokens: "11",
      output_tokens: "5",
      cache_read_input_tokens: "2",
    },
  });
  recorder.recordToolCall({
    id: "opaque-tool-1",
    parent_id: model.id,
    name: "search",
    event_at: "2026-09-07T09:00:00.500000001+00:00",
    measurements: { tool_calls: "1" },
    result: { text: "secret result must not be retained" },
  });

  const bundle = recorder.snapshot();
  assert.equal(bundle.observations.length, 2);
  const parent = bundle.observations.find((item) => item.id === model.id);
  const child = bundle.observations.find((item) => item.id !== model.id);
  assert.ok(parent);
  assert.ok(child);
  assert.equal(child.parent_id, parent.id);
  assert.equal(parent.dimensions.requested_model?.value, "gpt-requested");
  assert.equal(parent.dimensions.actual_model?.value, "gpt-applied");
  assert.equal(parent.measurements.input_tokens?.value, "11");
  assert.equal(parent.started_at?.value, "2026-09-07T09:00:00.000000001Z");
  assert.equal(parent.ended_at?.value, "2026-09-07T09:00:01.000000001Z");
  assert.equal(child.subject, "tool.search");
  assert.equal("result" in child, false);
  assert.equal(JSON.stringify(bundle).includes("secret result"), false);

  const replay = recorder.snapshot();
  assert.deepEqual(replay, bundle);
  assert.ok(await recorder.withModelCall({ id: "opaque-response-2" }, async () => "ok"));
});

test("bounds capture and marks the source partial without changing accepted event results", () => {
  const recorder = new UsageRecorder({ dataset_id: "bounded-test", max_observations: 1 });
  const first = recorder.recordEvent({ id: "first", subject: "activity" });
  const second = recorder.recordEvent({ id: "second", subject: "activity" });

  assert.equal(first, "first");
  assert.equal(second, null);
  const bundle = recorder.snapshot();
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.sources[0]?.coverage, "partial");
  assert.match(bundle.sources[0]?.description ?? "", /bound|drop/i);
});

test("retains lifecycle identities and supplies valid default start/end timestamps", () => {
  const recorder = new UsageRecorder({ dataset_id: "lifecycle-test", source_id: "lifecycle-source", collected_at: "2026-09-07T09:00:00Z" });
  const handle = recorder.startModelCall({
    id: "response-1",
    operation_id: "operation-1",
    parent_id: "parent-1",
    agent_id: "agent-1",
    session_id: "session-1",
    work_item_id: "work-1",
    task_id: "task-1",
    request: { provider: "openai", model: "requested-model" },
    measurements: { input_tokens: "10" },
  });
  const ended = handle.end({ provider: "openai", actual_model: "applied-model", usage: { output_tokens: "4" } });
  assert.ok(ended);
  assert.equal(ended.operation_id, "operation-1");
  assert.equal(ended.parent_id, "parent-1");
  assert.equal(ended.agent_id, "agent-1");
  assert.equal(ended.session_id, "session-1");
  assert.equal(ended.work_item_id, "work-1");
  assert.equal(ended.task_id, "task-1");
  assert.equal(ended.status, "ok");
  assert.match(ended.started_at?.value ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(ended.ended_at?.value ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.equal(ended.dimensions.requested_model?.value, "requested-model");
  assert.equal(ended.dimensions.actual_model?.value, "applied-model");
  assert.equal(ended.measurements.input_tokens?.value, "10");
  assert.equal(ended.measurements.output_tokens?.value, "4");
  assert.equal(handle.end(), null);
});

test("requires positive safe-integer recorder bounds", () => {
  assert.throws(() => new UsageRecorder({ dataset_id: "bounds", max_observations: 0 }), /positive safe integers/iu);
  assert.throws(() => new UsageRecorder({ dataset_id: "bounds", max_observations: 1.5 }), /positive safe integers/iu);
  assert.throws(() => new UsageRecorder({ dataset_id: "bounds", max_observations: Number.NaN }), /positive safe integers/iu);
  assert.throws(() => new UsageRecorder({ dataset_id: "bounds", max_measurements_per_observation: 0 }), /positive safe integers/iu);
});

test("filters credential-labelled context and explicit extension dimensions", () => {
  const recorder = new UsageRecorder({ dataset_id: "privacy-test", source_id: "privacy-source" });
  recorder.recordModelCall({
    id: "privacy-call",
    request: {
      provider: "openai",
      context: {
        credential: "credential-secret",
        accessToken: "access-secret",
        bearer: "bearer-secret",
        apiKey: "api-secret",
        max_output_tokens: 512,
      },
    },
    dimensions: {
      extensions: {
        "provider.api_key": { value: "dimension-secret", evidence: "observed", method: "test", source_refs: [] },
        "provider.authToken": { value: "auth-secret", evidence: "observed", method: "test", source_refs: [] },
        "provider.region": { value: "eu-west", evidence: "observed", method: "test", source_refs: [] },
      },
    },
  });
  const serialized = JSON.stringify(recorder.snapshot());
  assert.equal(serialized.includes("credential-secret"), false);
  assert.equal(serialized.includes("access-secret"), false);
  assert.equal(serialized.includes("bearer-secret"), false);
  assert.equal(serialized.includes("api-secret"), false);
  assert.equal(serialized.includes("dimension-secret"), false);
  assert.equal(serialized.includes("auth-secret"), false);
  assert.equal(serialized.includes("max_output_tokens"), true);
  assert.equal(serialized.includes("eu-west"), true);
});

test("reports measurement loss as incomplete capture without miscounting observations", () => {
  const recorder = new UsageRecorder({ dataset_id: "measurement-bound", max_measurements_per_observation: 1 });
  recorder.recordEvent({ id: "bounded-event", measurements: { input_tokens: "1", output_tokens: "2" } });
  const bundle = recorder.snapshot();
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.coverage?.dropped_observations, 0);
  assert.equal(bundle.coverage?.complete, false);
  assert.match(bundle.sources[0]?.description ?? "", /measurement/i);
  assert.match(bundle.coverage?.limitations.join(" ") ?? "", /measurement/i);
});

test("marks unsafe numeric measurements unavailable while preserving exact strings", () => {
  const recorder = new UsageRecorder({ dataset_id: "unsafe-number" });
  recorder.recordModelCall({ id: "numeric-call", measurements: { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: "9007199254740993" } });
  const observation = recorder.snapshot().observations[0];
  assert.equal(observation?.measurements.input_tokens?.value, null);
  assert.equal(observation?.measurements.input_tokens?.evidence, "unknown");
  assert.equal(observation?.measurements.output_tokens?.value, "9007199254740993");
});

test("emits canonical fractional quantities and rejects invalid measurement values", () => {
  const recorder = new UsageRecorder({ dataset_id: "measurement-values" });
  assert.throws(() => recorder.recordEvent({ id: "boolean", measurements: { input_tokens: true as unknown as UsageMeasurementInput } }), /measurement/iu);
  assert.throws(() => recorder.recordEvent({ id: "negative", measurements: { input_tokens: "-1" } }), /measurement/iu);
  recorder.recordEvent({ id: "fraction", measurements: { provider_units: 1e-7 } });
  const bundle = recorder.snapshot();
  assert.equal(bundle.observations[0]?.measurements.provider_units?.value, "0.0000001");
  assert.doesNotThrow(() => validateUsageBundle(bundle));
});

test("retains typed custom meter metadata and rejects conflicting definitions", () => {
  const recorder = new UsageRecorder({ dataset_id: "custom-meter-metadata" });
  recorder.recordEvent({
    id: "custom-meters",
    measurements: {
      bytes: { value: "4", unit: "bytes", description: "Bytes transferred", overlap: "disjoint" },
      payload_bytes: { value: "3", unit: "bytes", description: "Payload bytes", subset_of: "bytes", overlap: "subset" },
      seconds: { value: "1.5", unit: "seconds", description: "Elapsed seconds", subset_of: null, overlap: "disjoint" },
    },
  });
  const observation = recorder.recordEvent({ id: "record-measurement-target" });
  assert.equal(observation, "record-measurement-target");
  assert.equal(recorder.recordMeasurement("record-measurement-target", "seconds", {
    value: "2.5", unit: "seconds", description: "Elapsed seconds", subset_of: null, overlap: "disjoint",
  }), true);

  const bundle = recorder.snapshot();
  assert.deepEqual(bundle.meters.find((meter) => meter.id === "bytes"), {
    id: "bytes", unit: "bytes", description: "Bytes transferred", subset_of: null, overlap: "disjoint",
  });
  assert.deepEqual(bundle.meters.find((meter) => meter.id === "payload_bytes"), {
    id: "payload_bytes", unit: "bytes", description: "Payload bytes", subset_of: "bytes", overlap: "subset",
  });
  assert.deepEqual(bundle.meters.find((meter) => meter.id === "seconds"), {
    id: "seconds", unit: "seconds", description: "Elapsed seconds", subset_of: null, overlap: "disjoint",
  });
  assert.equal(bundle.observations.find((item) => item.id === "record-measurement-target")?.measurements.seconds?.value, "2.5");
  assert.doesNotThrow(() => validateUsageBundle(bundle));

  assert.throws(() => recorder.recordEvent({
    id: "conflicting-meter-definition",
    measurements: { bytes: { value: "1", unit: "bits", description: "Bytes transferred", overlap: "disjoint" } },
  }), /conflicting.*unit|meter.*unit/iu);

  const definitionConflict = new UsageRecorder({ dataset_id: "custom-meter-definition-conflict" });
  assert.throws(() => definitionConflict.recordEvent({
    id: "definition-conflict",
    meters: { transfer: { unit: "seconds", description: "Transfer duration", subset_of: null, overlap: "disjoint" } },
    measurements: { transfer: { value: "1", unit: "bytes", description: "Transfer bytes", subset_of: null, overlap: "disjoint" } },
  }), /conflicting.*(?:unit|description)/iu);
});

test("an unfinished usage scope cannot declare complete capture", () => {
  const recorder = new UsageRecorder({ dataset_id: "unfinished-capture" });
  const call = recorder.startModelCall({ id: "open-call" });
  const open = recorder.snapshot();
  assert.equal(open.coverage?.complete, false);
  assert.match(open.coverage?.limitations.join(" ") ?? "", /running/);
  call.end();
  assert.equal(recorder.snapshot().coverage?.complete, true);
});
