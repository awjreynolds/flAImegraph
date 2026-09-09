import assert from "node:assert/strict";
import test from "node:test";
import { importUsage } from "../src/usage-import.js";
import { createUsageReport, validateUsageBundle } from "../src/usage.js";

const usage = { input_tokens: 3, cache_creation_input_tokens: 2, cache_read_input_tokens: 7, output_tokens: 5 };
const assistant = (content: unknown[], output = 5) => ({ type: "assistant", uuid: "envelope", session_id: "session", parent_tool_use_id: null, message: { id: "msg-one", model: "fixture-model", usage: { ...usage, output_tokens: output }, stop_reason: "tool_use", content } });
const tool = { type: "tool_use", id: "tool-a", name: "Read", input: { file_path: "PRIVATE_CONTENT" } };
const finish = { type: "result", uuid: "query-one", session_id: "session", usage: { ...usage, output_tokens: 8 }, is_error: false, result: "PRIVATE_CONTENT", total_cost_usd: 99 };

test("Claude repeated envelopes count one response and retain higher final output", () => {
  const rows = [assistant([{ type: "text", text: "PRIVATE_CONTENT" }]), assistant([tool], 8), assistant([tool], 8), { type: "user", session_id: "session", message: { content: [{ type: "tool_result", tool_use_id: "tool-a", is_error: true, content: "PRIVATE_CONTENT" }] } }, finish];
  const bundle = validateUsageBundle(importUsage(rows, { format: "claude", dataset_id: "claude-fixture" }));
  const report = createUsageReport(bundle);
  assert.equal(bundle.observations.length, 4);
  assert.equal(report.meter_totals.find(m => m.meter_id === "input_tokens")!.known_total, "12");
  assert.equal(report.meter_totals.find(m => m.meter_id === "output_tokens")!.known_total, "8");
  assert.equal(report.meter_totals.find(m => m.meter_id === "tool_calls")!.known_total, "1");
  const response = bundle.observations.find(row => row.subject === "model.response")!;
  const call = bundle.observations.find(row => row.subject === "tool.Read")!;
  const result = bundle.observations.find(row => row.subject === "tool.result")!;
  assert.equal(call.parent_id, response.id);
  assert.equal(result.parent_id, call.id);
  assert.equal(result.status, "error");
  assert.equal(response.dimensions.actual_model!.value, "fixture-model");
  assert.equal(response.event_at, null);
  assert.equal(JSON.stringify(bundle).includes("PRIVATE_CONTENT"), false);
  assert.equal(JSON.stringify(bundle).includes("cost_usd"), false);
  assert.equal(bundle.observations.find(row => row.subject === "model.query_total")!.accounting_scope, "aggregate");
});

test("Claude partial streams and absent cache counters remain visibly incomplete", () => {
  const row = assistant([]);
  const incomplete = { ...row, message: { ...row.message, usage: { input_tokens: 3, output_tokens: 5 } } };
  const bundle = validateUsageBundle(importUsage([incomplete, { type: "stream_event", event: { type: "message_start", message: { id: "unfinished", usage } } }], { format: "claude", dataset_id: "partial" }));
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.observations[0]!.measurements.input_tokens!.value, null);
  assert.equal(bundle.coverage!.complete, false);
  assert.ok(bundle.coverage!.limitations.some(text => text.includes("No final query result")));
  assert.ok(bundle.coverage!.limitations.some(text => text.includes("partial streaming")));
});

test("Claude rejects conflicting response ownership and imports error aggregates without zeroing them", () => {
  assert.throws(() => importUsage([assistant([]), { ...assistant([]), session_id: "another" }], { format: "claude", dataset_id: "conflict" }), /Conflicting Claude response identity/);
  const bundle = validateUsageBundle(importUsage([{ ...finish, is_error: true, subtype: "error_during_execution" }], { format: "claude", dataset_id: "failure" }));
  assert.equal(bundle.observations[0]!.status, "error");
  assert.equal(bundle.observations[0]!.measurements.output_tokens!.value, "8");
  assert.equal(createUsageReport(bundle).meter_totals[0]!.known_total, "0", "Aggregate is excluded from direct totals");
});

test("Claude synthetic authentication errors do not turn placeholder zeros into provider receipts", () => {
  const row = assistant([]);
  const bundle = validateUsageBundle(importUsage([{ type: "system", subtype: "api_retry", error: "authentication_failed" }, { ...row, error: "authentication_failed", message: { ...row.message, model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }], { format: "claude", dataset_id: "auth-failure" }));
  assert.equal(bundle.observations.length, 2);
  assert.deepEqual(bundle.observations.find(row => row.subject === "harness.error")!.measurements, {});
  assert.equal(bundle.observations.find(row => row.subject === "harness.error")!.status, "error");
  assert.equal(bundle.observations[0]!.subject, "harness.retry");
  assert.equal(createUsageReport(bundle).meter_totals.length, 0);
});
