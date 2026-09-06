import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { advanceCapture, validateCaptureState } from "../src/capture.js";

const codexRow = (responseId: string, input = 10, output = 2): string => JSON.stringify({
  type: "token_usage_record",
  payload: {
    response_id: responseId,
    usage: { input_tokens: input, output_tokens: output, cached_input_tokens: 0, cache_write_input_tokens: 0 },
    thread_id: "thread-1",
    turn_id: responseId,
  },
}) + "\n";

test("advanceCapture anchors a complete first JSONL snapshot in an immutable state", () => {
  const input = codexRow("response-1");
  const state = advanceCapture(input, {
    harness: "codex",
    capture_namespace: "capture-test",
    dataset_id: "dataset-test",
  });

  assert.equal(state.schema_version, "0.2.0");
  assert.equal(state.harness, "codex");
  assert.equal(state.dataset_id, "dataset-test");
  assert.equal(state.capture_namespace, "capture-test");
  assert.equal(state.cursor.sequence, "0");
  assert.equal(state.cursor.prefix_bytes, String(Buffer.byteLength(input, "utf8")));
  assert.equal(state.cursor.record_count, "1");
  assert.equal(state.captures.length, 1);
  assert.equal(state.evidence.sources.length, 1);
  assert.equal(state.evidence.observations.filter((item) => item.accounting_scope === "direct").length, 1);

  assert.throws(() => {
    (state.captures as unknown as Array<unknown>).push({});
  }, TypeError);
  assert.throws(() => {
    (state.cursor as { sequence: string }).sequence = "9";
  }, TypeError);
});

test("Codex response IDs reconcile overlapping prefixes while retaining both artifact refs", () => {
  const lines = readFileSync("examples/dogfood/codex/coordinator.jsonl", "utf8").split("\n").filter(Boolean);
  const prefix = `${lines.slice(0, 250).join("\n")}\n`;
  const complete = `${lines.join("\n")}\n`;
  const first = advanceCapture(prefix, {
    harness: "codex", capture_namespace: "codex-overlap", dataset_id: "dataset-codex-overlap", sequence: "10",
  });
  const merged = advanceCapture(complete, {
    harness: "codex", capture_namespace: "codex-overlap", dataset_id: "dataset-codex-overlap", sequence: "11",
  }, first);

  assert.equal(merged.captures.length, 2);
  assert.equal(merged.evidence.sources.length, 2);
  assert.equal(merged.evidence.observations.filter((item) => item.accounting_scope === "direct").length, 88);
  assert.ok(merged.evidence.observations.some((item) => item.source_refs.length === 2));
  assert.equal(merged.evidence.issues.some((issue) => issue.code === "OBSERVATION_CONFLICT"), false);
});

test("Pi legacy fallback coordinates reconcile 1,003 framed rows and 484 assistant calls", () => {
  const lines = readFileSync("examples/dogfood/pi/before-compaction.jsonl", "utf8").split("\n").filter(Boolean);
  const prefix = `${lines.slice(0, 800).join("\n")}\n`;
  const complete = `${lines.join("\n")}\n`;
  const first = advanceCapture(prefix, {
    harness: "pi", capture_namespace: "pi-legacy-overlap", dataset_id: "dataset-pi-legacy-overlap", sequence: "3",
  });
  const merged = advanceCapture(complete, {
    harness: "pi", capture_namespace: "pi-legacy-overlap", dataset_id: "dataset-pi-legacy-overlap", sequence: "4",
  }, first);

  assert.equal(merged.cursor.record_count, "1003");
  assert.equal(merged.evidence.sources.length, 2);
  assert.equal(merged.evidence.observations.filter((item) => item.accounting_scope === "direct").length, 484);
  assert.equal(merged.evidence.observations.length, 486);
  assert.ok(merged.evidence.observations.some((item) => item.source_refs.length === 2));
});

test("identical payloads at distinct native or verified coordinates remain distinct calls", () => {
  const rowWithoutNativeId = JSON.stringify({
    type: "token_usage_record",
    payload: { usage: { input_tokens: 10, output_tokens: 2, cached_input_tokens: 0, cache_write_input_tokens: 0 } },
  });
  const input = `${rowWithoutNativeId}\n${rowWithoutNativeId}\n`;
  const state = advanceCapture(input, {
    harness: "codex", capture_namespace: "equal-calls", dataset_id: "dataset-equal-calls",
  });
  const direct = state.evidence.observations.filter((item) => item.accounting_scope === "direct");
  assert.equal(direct.length, 2);
  assert.notEqual(direct[0]?.id, direct[1]?.id);
});

test("Pi v4 keeps equal nested writes distinct with a transaction ordinal", () => {
  const header = JSON.stringify({ v: 4, kind: "header", sessionId: "pi-v4-test" });
  const row = {
    kind: "usage",
    row: { usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
  };
  const input = `${header}\n${JSON.stringify({ kind: "transaction", writes: [row, row] })}\n`;
  const state = advanceCapture(input, {
    harness: "pi", capture_namespace: "pi-v4-nested", dataset_id: "dataset-pi-v4-nested",
  });
  const direct = state.evidence.observations.filter((item) => item.accounting_scope === "direct");
  assert.equal(direct.length, 2);
  assert.notEqual(direct[0]?.id, direct[1]?.id);
});

test("capture rejects rewrites, truncation, malformed tails, sequence regressions, and config changes atomically", () => {
  const firstInput = codexRow("response-1");
  const first = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "errors", dataset_id: "dataset-errors", sequence: "5",
  });
  const expectCode = (input: string, options: Parameters<typeof advanceCapture>[1], code: string) => {
    assert.throws(() => advanceCapture(input, options, first), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === code);
  };
  expectCode(`${codexRow("response-1")}garbage\n`, { harness: "codex", capture_namespace: "errors", dataset_id: "dataset-errors", sequence: "6" }, "CAPTURE_MALFORMED_JSONL");
  expectCode("{}\n", { harness: "codex", capture_namespace: "errors", dataset_id: "dataset-errors", sequence: "6" }, "CAPTURE_PREFIX_TRUNCATED");
  expectCode(`${codexRow("response-0")}${codexRow("response-1")}`, { harness: "codex", capture_namespace: "errors", dataset_id: "dataset-errors", sequence: "6" }, "CAPTURE_PREFIX_REWRITTEN");
  expectCode(`${firstInput}${codexRow("response-2")}`, { harness: "codex", capture_namespace: "errors", dataset_id: "dataset-errors", sequence: "4" }, "CAPTURE_SEQUENCE_REGRESSION");
  expectCode(`${firstInput}${codexRow("response-2")}`, { harness: "pi", capture_namespace: "errors", dataset_id: "dataset-errors", sequence: "6" }, "CAPTURE_CONFIGURATION_MISMATCH");
  assert.deepEqual(first.cursor, { sequence: "5", prefix_bytes: String(Buffer.byteLength(firstInput)), prefix_sha256: first.cursor.prefix_sha256, record_count: "1" });
});

test("a repeated native identity with a changed appended payload is an observation conflict", () => {
  const firstInput = codexRow("response-1", 10, 2);
  const first = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "payload-conflict", dataset_id: "dataset-payload-conflict",
  });
  const changed = `${firstInput}${codexRow("response-1", 11, 2)}`;
  assert.throws(() => advanceCapture(changed, {
    harness: "codex", capture_namespace: "payload-conflict", dataset_id: "dataset-payload-conflict", sequence: "1",
  }, first), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "OBSERVATION_CONFLICT");
});

test("exact replay is idempotent and default sequence advances only for content extensions", () => {
  const firstInput = codexRow("response-1");
  const first = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "replay", dataset_id: "dataset-replay",
  });
  const replay = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "replay", dataset_id: "dataset-replay",
  }, first);
  assert.deepEqual(replay, first);
  const extended = advanceCapture(`${firstInput}${codexRow("response-2")}`, {
    harness: "codex", capture_namespace: "replay", dataset_id: "dataset-replay",
  }, replay);
  assert.equal(extended.cursor.sequence, "1");
  assert.equal(extended.captures.length, 2);
});

test("replay preserves the byte cursor for an exact extension and rejects unsupported options", () => {
  const firstInput = codexRow("response-1");
  const first = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "byte-exact-replay", dataset_id: "dataset-byte-exact-replay",
  });
  const replay = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "byte-exact-replay", dataset_id: "dataset-byte-exact-replay",
  }, first);
  const extendedInput = `${firstInput}${codexRow("response-2")}`;
  const extended = advanceCapture(extendedInput, {
    harness: "codex", capture_namespace: "byte-exact-replay", dataset_id: "dataset-byte-exact-replay",
  }, replay);

  assert.equal(extended.cursor.prefix_bytes, String(Buffer.byteLength(extendedInput, "utf8")));
  assert.equal(extended.cursor.record_count, "2");
  assert.equal(extended.captures.length, 2);
  assert.throws(() => advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "byte-exact-replay", dataset_id: "dataset-byte-exact-replay",
    source_id: "caller-selected",
  } as unknown as Parameters<typeof advanceCapture>[1]), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "CAPTURE_INVALID_OPTIONS");
  assert.throws(() => advanceCapture(extendedInput, {
    harness: "codex", capture_namespace: "byte-exact-replay", dataset_id: "dataset-byte-exact-replay",
    source_id: "caller-selected",
  } as unknown as Parameters<typeof advanceCapture>[1], replay), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "CAPTURE_INVALID_OPTIONS");
  assert.throws(() => advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "byte-exact-replay", dataset_id: "dataset-byte-exact-replay",
    unsupported: true,
  } as unknown as Parameters<typeof advanceCapture>[1]), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "CAPTURE_INVALID_OPTIONS");
});

test("a child imported before its native parent resolves after the later prefix is merged", () => {
  const child = JSON.stringify({ type: "event_msg", payload: { type: "task_started", id: "child", parent_id: "parent" } }) + "\n";
  const parent = JSON.stringify({ type: "event_msg", payload: { type: "task_started", id: "parent" } }) + "\n";
  const first = advanceCapture(child, {
    harness: "codex", capture_namespace: "late-parent", dataset_id: "dataset-late-parent", sequence: "1",
  });
  assert.equal(first.evidence.observations.some((item) => item.parent_id), false);
  const merged = advanceCapture(`${child}${parent}`, {
    harness: "codex", capture_namespace: "late-parent", dataset_id: "dataset-late-parent", sequence: "2",
  }, first);
  assert.equal(merged.evidence.issues.some((issue) => issue.code === "lineage_parent_unresolved"), false);
  assert.ok(merged.evidence.observations.some((item) => item.parent_id !== undefined));
});

test("a native two-node parent cycle remains hashed with coverage issues", () => {
  const event = (id: string, parent_id?: string): string => JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started", id, ...(parent_id ? { parent_id } : {}) },
  }) + "\n";
  const input = `${event("a", "b")}${event("b", "a")}`;
  const state = advanceCapture(input, {
    harness: "codex", capture_namespace: "cycle", dataset_id: "dataset-cycle", sequence: "1",
  });
  const activities = state.evidence.observations.filter((item) => item.kind === "activity");
  assert.equal(activities.length, 2);
  assert.equal(activities.some((item) => item.parent_id !== undefined), false);
  assert.equal(state.evidence.issues.filter((issue) => issue.code === "lineage_parent_cycle").length, 2);
});

test("a late native parent cycle remains hashed with coverage issues", () => {
  const event = (id: string, parent_id?: string): string => JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started", id, ...(parent_id ? { parent_id } : {}) },
  }) + "\n";
  const firstInput = event("a", "b");
  const first = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "late-cycle", dataset_id: "dataset-late-cycle", sequence: "1",
  });
  const merged = advanceCapture(`${firstInput}${event("b", "a")}`, {
    harness: "codex", capture_namespace: "late-cycle", dataset_id: "dataset-late-cycle", sequence: "2",
  }, first);
  assert.equal(merged.evidence.observations.some((item) => item.parent_id !== undefined), false);
  assert.equal(merged.evidence.issues.filter((issue) => issue.code === "lineage_parent_cycle").length, 2);
});

test("validateCaptureState rejects cursor and descriptor divergence", () => {
  const state = advanceCapture(codexRow("response-1"), {
    harness: "codex", capture_namespace: "state-validation", dataset_id: "dataset-state-validation",
  });
  const invalid = structuredClone(state);
  invalid.cursor.record_count = "2";
  assert.throws(() => validateCaptureState(invalid), /cursor must match/);
});

test("validateCaptureState rejects tampered descriptor IDs and non-monotonic history", () => {
  const firstInput = codexRow("response-1");
  const first = advanceCapture(firstInput, {
    harness: "codex", capture_namespace: "history-validation", dataset_id: "dataset-history-validation",
  });
  const second = advanceCapture(`${firstInput}${codexRow("response-2")}`, {
    harness: "codex", capture_namespace: "history-validation", dataset_id: "dataset-history-validation",
  }, first);

  const tamperedId = structuredClone(second);
  tamperedId.captures[0]!.id = "garbage";
  assert.throws(() => validateCaptureState(tamperedId), /descriptor ID/);

  const duplicateDescriptorId = structuredClone(second);
  duplicateDescriptorId.captures[0]!.id = duplicateDescriptorId.captures[1]!.id;
  assert.throws(() => validateCaptureState(duplicateDescriptorId), /descriptor ID/);

  const duplicateSourceId = structuredClone(second);
  duplicateSourceId.captures[1]!.source_id = duplicateSourceId.captures[0]!.source_id;
  assert.throws(() => validateCaptureState(duplicateSourceId), /source ID/);

  const descendingBytes = structuredClone(second);
  descendingBytes.captures[0]!.prefix_bytes = "999999";
  assert.throws(() => validateCaptureState(descendingBytes), /prefix_bytes/);

  const descendingRecords = structuredClone(second);
  descendingRecords.captures[0]!.record_count = "999";
  assert.throws(() => validateCaptureState(descendingRecords), /record_count/);
});
