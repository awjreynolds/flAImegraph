import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fromLegacyEvidence, importUsage, normalizeUsageTimestamp } from "../src/usage-import.js";
import { reconcileUsageBundles } from "../src/usage.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("imports a Codex usage stream with direct counters, request/response model facts and exact UTC time", () => {
  const bundle = importUsage(fixture("usage-codex.jsonl"), {
    format: "codex",
    dataset_id: "usage-test",
    source_id: "codex-fixture",
  });

  assert.equal(bundle.schema_version, "0.4.0");
  assert.equal(bundle.dataset_id, "usage-test");
  assert.equal(bundle.sources.length, 1);
  assert.equal(bundle.sources[0]?.id, "codex-fixture");
  assert.equal(bundle.observations.length, 1);
  const observation = bundle.observations[0];
  assert.ok(observation);
  assert.equal(observation.event_at?.value, "2026-09-07T09:00:00.123456789Z");
  assert.equal(observation.event_at?.evidence, "observed");
  assert.equal(observation.measurements.input_tokens?.value, "100");
  assert.equal(observation.measurements.cache_read_input_tokens?.value, "30");
  assert.equal(observation.measurements.output_tokens?.value, "20");
  assert.equal(observation.measurements.reasoning_output_tokens?.value, "4");
  assert.equal(observation.dimensions.requested_model?.value, "gpt-requested");
  assert.equal(observation.dimensions.actual_model?.value, "gpt-applied-2026");
  assert.equal(observation.dimensions.requested_tier?.value, "flex");
  assert.equal(observation.dimensions.actual_tier?.value, "standard");
  assert.equal(observation.dimensions.requested_reasoning?.value, "high");
  assert.equal(observation.dimensions.actual_region?.value, "eu-west");
  assert.equal(observation.measurements.provider_openai_audio_input_tokens?.value, "2");
});

test("replay and cumulative snapshots keep stable observations without making snapshots additive", () => {
  const input = fixture("usage-codex-snapshot.jsonl");
  const first = importUsage(input, { format: "codex", dataset_id: "usage-test", source_id: "codex-snapshot" });
  const replay = importUsage(`${input}${input}`, { format: "codex", dataset_id: "usage-test", source_id: "codex-snapshot" });

  assert.equal(replay.observations.length, first.observations.length);
  assert.deepEqual(replay.observations.map((item) => item.id), first.observations.map((item) => item.id));
  assert.equal(first.observations[0]?.accounting_scope, "snapshot");
  assert.equal(first.observations[0]?.measurements.input_tokens?.aggregation, "cumulative");
  assert.equal(first.observations[0]?.measurements.input_tokens?.scope, "snapshot");
});

test("imports OTLP generic meters and preserves provider dimensions without raw payloads", () => {
  const bundle = importUsage(fixture("usage-otlp.json"), {
    format: "otel",
    dataset_id: "otel-test",
    source_id: "otel-fixture",
  });

  assert.equal(bundle.observations.length, 1);
  const observation = bundle.observations[0];
  assert.ok(observation);
  assert.equal(observation.parent_id, null);
  assert.equal(observation.dimensions.provider?.value, "openai");
  assert.equal(observation.dimensions.actual_model?.value, "gpt-5.2");
  assert.equal(observation.measurements.input_tokens?.value, "7");
  assert.equal(observation.measurements.tool_calls?.value, "2");
  assert.equal(observation.measurements.provider_openai_ai_units?.value, "1.5");
  assert.equal("prompt" in observation, false);
  assert.equal("raw" in observation, false);
});

test("maps Pi v4 durable rows and cumulative totals without importing the pricing adapter", () => {
  const bundle = importUsage(fixture("usage-pi.jsonl"), {
    format: "pi",
    dataset_id: "pi-test",
    source_id: "pi-fixture",
  });

  const direct = bundle.observations.find((item) => item.subject === "model.response");
  const snapshot = bundle.observations.find((item) => item.subject === "model.usage_totals");
  assert.ok(direct);
  assert.ok(snapshot);
  assert.equal(direct.measurements.input_tokens?.value, "13");
  assert.equal(direct.measurements.provider_anthropic_input_exclusive?.value, "4");
  assert.equal(direct.measurements.cache_read_input_tokens?.value, "8");
  assert.equal(direct.dimensions.requested_model?.value, "pi-v4");
  assert.equal(snapshot.accounting_scope, "snapshot");
  assert.equal(snapshot.measurements.input_tokens?.aggregation, "cumulative");
});

test("keeps provider request settings separate from applied response settings", () => {
  const bundle = importUsage(fixture("usage-provider-records.jsonl"), {
    format: "anthropic",
    dataset_id: "provider-test",
    source_id: "provider-fixture",
  });

  assert.equal(bundle.observations.length, 2);
  const anthropic = bundle.observations[0];
  const gemini = bundle.observations[1];
  assert.ok(anthropic);
  assert.ok(gemini);
  assert.equal(anthropic.dimensions.requested_model?.value, "claude-requested");
  assert.equal(anthropic.dimensions.actual_model?.value, "claude-applied");
  assert.equal(anthropic.measurements.cache_write_input_tokens?.value, "3");
  assert.equal(gemini.measurements.input_tokens?.value, "100");
  assert.equal(gemini.measurements.cache_read_input_tokens?.value, "30");
  assert.equal(gemini.measurements.output_tokens?.value, "22");
  assert.equal(gemini.measurements.reasoning_output_tokens?.value, "6");
});

test("classifies a bare provider response as applied response metadata", () => {
  const bundle = importUsage({
    id: "bare-response",
    model: "gpt-applied",
    provider: "openai",
    service_tier: "standard",
    usage: { input_tokens: "4", output_tokens: "2" },
  }, { format: "openai", dataset_id: "bare-response-test" });
  const observation = bundle.observations[0];
  assert.ok(observation);
  assert.equal(observation.dimensions.actual_model?.value, "gpt-applied");
  assert.equal(observation.dimensions.actual_tier?.value, "standard");
  assert.equal(observation.dimensions.requested_model, undefined);
});

test("legacy evidence migration drops monetary fields while preserving source lineage", () => {
  const bundle = fromLegacyEvidence({
    schema_version: "0.1.0",
    dataset_id: "legacy-test",
    sources: [{ id: "legacy-source", harness: "legacy", format: "evidence", coverage: "complete" }],
    relationships: [],
    issues: [],
    observations: [{
      id: "legacy-observation",
      source_refs: [{ source_id: "legacy-source", record: "line:1" }],
      kind: "model",
      operation: "legacy.model",
      status: "ok",
      accounting_scope: "direct",
      provider: "openai",
      model: "gpt-4.1",
      timestamp: "2026-09-07T09:00:00.123456789+00:00",
      usage: {
        input_tokens: "10",
        output_tokens: "3",
        cache_read_input_tokens: "2",
        cache_write_input_tokens: null,
        reasoning_output_tokens: "1",
      },
      recorded_cost: { amount: "0.12", currency: "USD", basis: "provider_reported" },
    }],
  }, { dataset_id: "migrated-test", source_id: "legacy-source" });

  assert.equal(bundle.dataset_id, "migrated-test");
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.observations[0]?.measurements.input_tokens?.value, "10");
  assert.equal(bundle.observations[0]?.event_at?.value, "2026-09-07T09:00:00.123456789Z");
  assert.equal(bundle.observations[0]?.dimensions.model?.value, "gpt-4.1");
  assert.equal("recorded_cost" in bundle.observations[0]!, false);
  assert.equal(bundle.sources[0]?.id, "legacy-source");
  assert.match(bundle.sources[0]?.description ?? "", /monetary|cost/i);
});

test("rejects invalid source calendars and timezone offsets without fabricating an instant", () => {
  assert.equal(normalizeUsageTimestamp("2026-02-30T00:00:00Z"), null);
  assert.equal(normalizeUsageTimestamp("2026-01-01T00:00:00+24:00"), null);
  assert.equal(normalizeUsageTimestamp("2026-01-01T00:00:00+01:60"), null);
  assert.equal(normalizeUsageTimestamp("2024-02-29T00:00:00Z"), "2024-02-29T00:00:00Z");
});

test("omits malformed JSONL records and carries non-sensitive loss evidence", () => {
  const input = `${JSON.stringify({ id: "valid", usage: { input_tokens: "2" } })}\nnot-json-with-secret\n`;
  const bundle = importUsage(input, { format: "openai", dataset_id: "malformed-test" });
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.coverage?.dropped_observations, 1);
  assert.equal(bundle.sources[0]?.coverage, "partial");
  assert.equal(bundle.issues?.[0]?.code, "MALFORMED_JSON_RECORD");
  assert.equal(JSON.stringify(bundle).includes("not-json-with-secret"), false);
});

test("classifies OTLP delta and cumulative sums with distinct temporal semantics", () => {
  const bundle = importUsage({
    resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [{ metrics: [
      { name: "tokens.delta", sum: { aggregationTemporality: "1", dataPoints: [{ startTimeUnixNano: "1000000000", timeUnixNano: "2000000000", asInt: "4" }] } },
      { name: "tokens.cumulative", sum: { aggregationTemporality: "2", dataPoints: [{ startTimeUnixNano: "1000000000", timeUnixNano: "2000000000", asInt: "9" }] } },
    ] }] }],
  }, { format: "otlp", dataset_id: "temporality-test" });
  const delta = bundle.observations.find((item) => item.subject === "metric.tokens_delta");
  const cumulative = bundle.observations.find((item) => item.subject === "metric.tokens_cumulative");
  assert.ok(delta);
  assert.ok(cumulative);
  assert.equal(delta.accounting_scope, "direct");
  assert.equal(delta.measurements.provider_otel_tokens_delta?.aggregation, "delta");
  assert.equal(delta.measurements.provider_otel_tokens_delta?.scope, "interval");
  assert.equal(cumulative.accounting_scope, "snapshot");
  assert.equal(cumulative.measurements.provider_otel_tokens_cumulative?.aggregation, "cumulative");
  assert.equal(cumulative.measurements.provider_otel_tokens_cumulative?.scope, "snapshot");
});

test("imports only Codex tool call/output response items and separates their identities", () => {
  const input = [
    { type: "response_item", payload: { type: "message", id: "message-1", content: [{ text: "hello" }] } },
    { type: "response_item", payload: { type: "function_call", id: "item-call", call_id: "call-1", name: "search" } },
    { type: "response_item", payload: { type: "function_call_output", id: "item-output", call_id: "call-1", output: "secret result" } },
  ].map(JSON.stringify).join("\n");
  const bundle = importUsage(input, { format: "codex", dataset_id: "response-items" });
  assert.equal(bundle.observations.length, 2);
  const call = bundle.observations.find((item) => item.operation_id === "tool-call:call-1");
  const output = bundle.observations.find((item) => item.operation_id === "tool-output:item-output");
  assert.ok(call);
  assert.ok(output);
  assert.notEqual(call.id, output.id);
  assert.equal(output.parent_id, call.id);
  assert.equal(JSON.stringify(bundle).includes("secret result"), false);
});

test("uses source work item mappings and rejects contradictory caller assignment", () => {
  const input = JSON.stringify({ id: "work-response", work_item_id: "https://github.com/acme/repo/issues/42", usage: { input_tokens: "1" } });
  const source = importUsage(input, { format: "openai", dataset_id: "work-test" });
  assert.equal(source.observations[0]?.work_item_id, "https://github.com/acme/repo/issues/42");
  const assigned = importUsage(JSON.stringify({ id: "unassigned", usage: { input_tokens: "1" } }), { format: "openai", dataset_id: "work-test", work_item_id: "JIRA-123 / migration" });
  assert.equal(assigned.observations[0]?.work_item_id, "JIRA-123 / migration");
  assert.throws(() => importUsage(input, { format: "openai", dataset_id: "work-test", work_item_id: "JIRA-999" }), /contradict/iu);
});

test("keeps native identities stable across overlapping source artifacts", () => {
  const first = importUsage(JSON.stringify({ id: "response-a", usage: { input_tokens: "2" } }), { format: "openai", dataset_id: "overlap-test" });
  const second = importUsage(JSON.stringify({ id: "response-b", usage: { input_tokens: "3" } }), { format: "openai", dataset_id: "overlap-test" });
  const replayed = reconcileUsageBundles([first, second]);
  assert.equal(replayed.observations.length, 2);
  assert.equal(new Set(replayed.observations.map((item) => item.id)).size, 2);
  assert.equal(replayed.sources.length, 2);
});

test("does not claim unsafe JSON numbers are exact usage quantities", () => {
  const bundle = importUsage({ id: "unsafe", usage: { input_tokens: Number.MAX_SAFE_INTEGER + 1 } }, { format: "openai", dataset_id: "unsafe-number" });
  assert.equal(bundle.observations[0]?.measurements.input_tokens?.value, null);
  assert.equal(bundle.observations[0]?.measurements.input_tokens?.evidence, "unknown");
});
