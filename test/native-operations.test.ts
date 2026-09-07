import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importEvidence } from "../src/adapters/index.js";
import { importNativeOperations, NativeOperationImportError } from "../src/native-operations.js";
import { validateOperationBundle } from "../src/operations.js";

const codexFixture = readFileSync(new URL("./fixtures/operations-codex.jsonl", import.meta.url), "utf8");
const piFixture = readFileSync(new URL("./fixtures/operations-pi.jsonl", import.meta.url), "utf8");

function options(evidence?: Parameters<typeof importNativeOperations>[2]["evidence"]) {
  return { dataset_id: "native-operation-tests", namespace: "test-run", resource_key: "test-resource-key", ...(evidence ? { evidence } : {}) };
}

test("Codex native operation import pairs exact tool IDs and preserves opaque wrappers", () => {
  const bundle = importNativeOperations("codex", codexFixture, options());
  validateOperationBundle(bundle);
  const read = bundle.spans.find((span) => span.kind === "file_read");
  assert.ok(read);
  assert.equal(read.label, "read");
  assert.equal(read.status, "ok");
  assert.deepEqual(read.io?.requested_range, { start_line: 2, end_line: 4 });
  assert.equal(read.io?.read_bytes, null);
  assert.equal(read.io?.returned_bytes, String(Buffer.byteLength("sanitized fixture content", "utf8")));
  assert.equal(read.io?.measurements.read_bytes.evidence, "unknown");
  assert.equal(read.io?.measurements.returned_bytes.evidence, "derived");
  assert.match(read.io?.resource_id ?? "", /^resource:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(bundle), /fixture\/source\.txt|sanitized fixture content|cat \/fixture/);

  const exec = bundle.spans.find((span) => span.label === "functions.exec");
  assert.ok(exec);
  assert.equal(exec.kind, "tool");
  assert.equal(exec.io, null);
  assert.equal(bundle.coverage.boundary, "native_transcript");
  assert.equal(bundle.coverage.complete, false);
  assert.equal(bundle.spans.some((span) => span.kind === "summary" && span.label === "token_count"), false);
  assert.ok(bundle.coverage.limitations.some((message) => message.includes("token-count snapshot") && message.includes("accounting metadata")));
});

test("native operation identities are snapshot-stable and output-first pairing does not guess ancestry", () => {
  const outputFirst = [
    JSON.stringify({ type: "response_item", timestamp: "2026-09-07T12:00:01Z", payload: { type: "function_call_output", call_id: "out-of-order", output: "result" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-09-07T12:00:00Z", payload: { type: "function_call", call_id: "out-of-order", name: "read", arguments: { path: "/fixture/file", start_line: 1, end_line: 1 } } }),
  ].join("\n");
  const first = importNativeOperations("codex", outputFirst, options());
  const second = importNativeOperations("codex", `${outputFirst}\n${outputFirst}`, options());
  const span = first.spans[0]!;
  assert.equal(first.spans.length, 1);
  assert.equal(span.kind, "file_read");
  assert.equal(span.status, "ok");
  assert.equal(span.parent_id, null);
  assert.equal(span.started_at, "2026-09-07T12:00:00Z");
  assert.equal(span.ended_at, "2026-09-07T12:00:01Z");
  assert.equal(second.spans.length, 1);
  assert.equal(second.spans[0]!.id, span.id);

  const conflicting = `${JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "same", name: "read", arguments: { path: "/a" } } })}\n${JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "same", name: "write", arguments: { path: "/b" } } })}`;
  assert.throws(() => importNativeOperations("codex", conflicting, options()), (error: unknown) => error instanceof NativeOperationImportError && error.code === "NATIVE_OPERATION_DUPLICATE");
});

test("native lifecycle metadata must agree while output-first enrichment remains valid", () => {
  const outputFirst = [
    JSON.stringify({ type: "response_item", timestamp: "2026-09-07T12:00:01Z", payload: { type: "function_call_output", call_id: "enrich", output: "result" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-09-07T12:00:00Z", payload: { type: "function_call", call_id: "enrich", name: "read", arguments: { path: "/fixture/file" } } }),
  ].join("\n");
  const enriched = importNativeOperations("codex", outputFirst, options());
  assert.equal(enriched.spans.length, 1);
  assert.equal(enriched.spans[0]!.kind, "file_read");
  assert.equal(enriched.spans[0]!.io?.requested_range, null);

  const parentConflict = [
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "parent-conflict", name: "read", parent_id: "parent-a", arguments: { path: "/fixture/file" } } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "parent-conflict", name: "read", parent_id: "parent-b", output: "result" } }),
  ].join("\n");
  assert.throws(() => importNativeOperations("codex", parentConflict, options()), (error: unknown) => error instanceof NativeOperationImportError && error.code === "NATIVE_OPERATION_CONFLICT");

  const duplicateModel = [
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "metadata-duplicate", name: "read", requesting_model: "model-a", arguments: { path: "/fixture/file" } } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "metadata-duplicate", name: "read", requesting_model: "model-b", arguments: { path: "/fixture/file" } } }),
  ].join("\n");
  assert.throws(() => importNativeOperations("codex", duplicateModel, options()), (error: unknown) => error instanceof NativeOperationImportError && error.code === "NATIVE_OPERATION_DUPLICATE");
});

test("native transcript I/O facts keep derived and unavailable measurements honest", () => {
  const input = [
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "write-1", name: "write", arguments: { path: "/fixture/file", content: "claimed write", content_sha256: "a".repeat(64) } } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "write-1", name: "write", output: "done" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "list-1", name: "list", arguments: { path: "/fixture" } } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "list-1", name: "list", output: ["one", "two"] } }),
  ].join("\n");
  const bundle = importNativeOperations("codex", input, options());
  const write = bundle.spans.find((span) => span.label === "write");
  const list = bundle.spans.find((span) => span.label === "list");
  assert.ok(write?.io);
  assert.equal(write.io.written_bytes, null);
  assert.equal(write.io.inserted_bytes, null);
  assert.equal(write.io.deleted_bytes, null);
  assert.equal(write.io.content_sha256, null);
  assert.equal(write.io.measurements.written_bytes.evidence, "unknown");
  assert.equal(write.io.measurements.content_sha256.evidence, "unknown");
  assert.equal(write.io.measurements.returned_bytes.evidence, "derived");
  assert.ok(list?.io);
  assert.equal(list.io.entry_count, null);
  assert.equal(list.io.measurements.entry_count.evidence, "unknown");
});

test("a native model identity cannot be reused by a tool regardless of arrival order", () => {
  const model = JSON.stringify({ type: "token_usage_record", payload: { response_id: "same-native-id", usage: { input_tokens: 10, output_tokens: 1 } } });
  const call = JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "same-native-id", name: "read", arguments: { path: "/fixture/file" } } });
  const result = JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "same-native-id", output: "content" } });
  for (const records of [[model, call, result], [result, model, call], [call, result, model]]) assert.throws(() => importNativeOperations("codex", records.join("\n"), options()), /identity|non-model|category/i);
});

test("Codex response items do not become model executions without an explicit response identity", () => {
  const input = [
    JSON.stringify({ type: "response_item", payload: { type: "reasoning", id: "item-reasoning", summary: [] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "item-message", role: "assistant", content: [] } }),
    JSON.stringify({ type: "token_usage_record", payload: { response_id: "response-1", usage: { input_tokens: "10", output_tokens: "2" } } }),
  ].join("\n");
  const bundle = importNativeOperations("codex", input, options());
  const models = bundle.spans.filter((span) => span.kind === "model");
  assert.equal(models.length, 1);
  assert.equal(bundle.coverage.dropped_spans, 0);
  assert.ok(bundle.coverage.limitations.some((message) => message.includes("response item") && message.includes("execution")));

  const explicit = [
    JSON.stringify({ type: "response_item", payload: { type: "reasoning", id: "item-reasoning", response_id: "response-2", summary: [] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "item-message", response_id: "response-2", role: "assistant", content: [] } }),
    JSON.stringify({ type: "token_usage_record", payload: { response_id: "response-2", usage: { input_tokens: "10", output_tokens: "2" } } }),
  ].join("\n");
  const explicitBundle = importNativeOperations("codex", explicit, options());
  const explicitModels = explicitBundle.spans.filter((span) => span.kind === "model");
  assert.equal(explicitModels.length, 1);
  assert.equal(explicitModels[0]!.source_refs.length, 3);
});

test("Codex token-count snapshots stay accounting metadata rather than operations or span loss", () => {
  const input = [
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", event_id: "snapshot-1", info: { total_token_usage: { input_tokens: 10 } } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 20 } } } }),
  ].join("\n");
  const bundle = importNativeOperations("codex", input, options());
  assert.equal(bundle.spans.length, 0);
  assert.equal(bundle.coverage.dropped_spans, 0);
  assert.ok(bundle.coverage.limitations.filter((message) => message.includes("token-count snapshot")).length >= 2);

  const compaction = importNativeOperations("pi", JSON.stringify({ kind: "compaction", id: "compaction-1", timestamp: "2026-09-07T12:00:00Z" }), options());
  assert.deepEqual(compaction.spans.map((span) => [span.kind, span.label]), [["summary", "compaction"]]);
});

test("missing native IDs are explicit loss and exact source digests gate evidence joins", () => {
  const missing = `${JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "read", arguments: { path: "/fixture/file" } } })}\n${JSON.stringify({ type: "token_usage_record", payload: { response_id: "r1", usage: { input_tokens: "1" } } })}`;
  const evidence = importEvidence("codex", missing, { dataset_id: "native-operation-tests" });
  const bundle = importNativeOperations("codex", missing, options(evidence));
  validateOperationBundle(bundle);
  assert.equal(bundle.coverage.dropped_spans, 1);
  assert.equal(Object.values(bundle.coverage.dropped_spans_by_stream).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(bundle.spans.filter((span) => span.kind === "model")[0]?.observation_id, evidence.observations[0]?.id ?? null);

  const changed = importNativeOperations("codex", `${missing}\n`, options({ ...evidence, sources: evidence.sources.map((source) => ({ ...source, sha256: "0".repeat(64) })) }));
  assert.equal(changed.spans.find((span) => span.kind === "model")?.observation_id, null);
  assert.ok(changed.coverage.limitations.some((message) => message.includes("exact native input digest")));

  const missingDigest = importNativeOperations("codex", missing, options({ ...evidence, sources: evidence.sources.map((source) => ({ ...source, id: bundle.artifacts[0]!.id, sha256: undefined })) }));
  assert.equal(missingDigest.spans.find((span) => span.kind === "model")?.observation_id, null);
  assert.ok(missingDigest.coverage.limitations.some((message) => message.includes("exact native input digest")));
});

test("implicit and explicit Codex session identities are normalized once", () => {
  const input = [
    JSON.stringify({ type: "session_meta", payload: { id: "session-1" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: "mixed-session", name: "read", arguments: { path: "/fixture/file" } } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "mixed-session", session_id: "session-1", name: "read", output: "result" } }),
  ].join("\n");
  const bundle = importNativeOperations("codex", input, options());
  assert.equal(bundle.spans.length, 1);
  assert.equal(bundle.spans[0]!.status, "ok");
  assert.equal(bundle.spans[0]!.started_at, null);
  assert.equal(bundle.spans[0]!.ended_at, null);
});

test("an explicit native error flag cannot be overwritten by an ok result status", () => {
  const input = JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "contradictory-error", name: "read", is_error: true, status: "ok", output: "result" } });
  assert.throws(() => importNativeOperations("codex", input, options()), (error: unknown) => error instanceof NativeOperationImportError && error.code === "NATIVE_OPERATION_CONFLICT");
});

test("malformed native input does not echo secret text into coverage limitations", () => {
  const secret = "TOP_SECRET_TRANSCRIPT_FRAGMENT";
  const bundle = importNativeOperations("codex", `${secret}\n`, options());
  assert.doesNotMatch(JSON.stringify(bundle), new RegExp(secret));
  assert.ok(bundle.coverage.limitations.some((message) => message.includes("jsonl_parse_error")));
});

test("Pi v4 entries and usage rows share one model operation while tool results close exact calls", () => {
  const bundle = importNativeOperations("pi", piFixture, options());
  validateOperationBundle(bundle);
  const models = bundle.spans.filter((span) => span.kind === "model");
  assert.equal(models.length, 1);
  const read = bundle.spans.find((span) => span.kind === "file_read");
  assert.ok(read);
  assert.equal(read.status, "ok");
  assert.deepEqual(read.io?.requested_range, { start_line: 3, end_line: 4 });
  assert.equal(read.io?.returned_bytes, String(Buffer.byteLength("sanitized Pi result", "utf8")));
  assert.equal(models[0]!.executing_model, "fixture-model");
  assert.equal(bundle.coverage.dropped_spans, 0);
});

test("five thousand native read attempts remain distinct without a visible payload copy", () => {
  const input = Array.from({ length: 5000 }, (_, index) => JSON.stringify({ type: "tool_call", session_id: "pi-session", toolCallId: `read-${index}`, toolName: "read", input: { path: "/fixture/repeated", start_line: 1, end_line: 1 } })).join("\n");
  const bundle = importNativeOperations("pi", input, options());
  validateOperationBundle(bundle);
  assert.equal(bundle.spans.length, 5000);
  assert.equal(new Set(bundle.spans.map((span) => span.id)).size, 5000);
  assert.equal(new Set(bundle.spans.map((span) => span.io?.resource_id)).size, 1);
  assert.doesNotMatch(JSON.stringify(bundle), /fixture\/repeated/);
});
