import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importEvidence } from "../src/adapters/index.js";
import { createHarnessProfile } from "../src/context-capture.js";
import { reconstructNativeContext } from "../src/native-context.js";
import type { EvidenceBundle, Source } from "../src/types.js";

const profile = createHarnessProfile({ harness: "native-test", provider: "test-provider", model: "test-model" });

const source: Source = {
  id: "native-source",
  harness: "pi",
  format: "pi-legacy-transcript-jsonl",
  coverage: "complete",
};

function directEvidence(input: string, harness: "codex" | "pi", datasetId: string): EvidenceBundle {
  return importEvidence(harness, input, { source_id: source.id, dataset_id: datasetId });
}

test("Codex native accounting creates unavailable request boundaries without guessing prompt context", () => {
  const input = [
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "super-secret prompt" } }),
    JSON.stringify({ type: "token_usage_record", payload: { response_id: "response-1", usage: { input_tokens: 10, output_tokens: 2, cached_input_tokens: 0, cache_write_input_tokens: 0 } } }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "codex", "native-codex");

  const result = reconstructNativeContext("codex", input, evidence, profile, { source_id: source.id });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.observation_id, evidence.observations.find((item) => item.kind === "model")?.id);
  assert.equal(result.requests[0]?.boundary, "unavailable");
  assert.equal(result.requests[0]?.coverage, "unknown");
  assert.equal(result.requests[0]?.coverage_evidence, "unknown");
  assert.deepEqual(result.requests[0]?.occurrences, []);
  assert.ok(result.issues.some((issue) => issue.code === "NATIVE_REQUEST_BOUNDARY_UNAVAILABLE"));
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
});

test("Pi legacy reconstruction includes only ancestry before each assistant response and hashes content transiently", () => {
  const input = [
    JSON.stringify({ type: "session", timestamp: "2026-01-01T00:00:00Z", provider: "test-provider", modelId: "test-model" }),
    JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "first-secret" }] } }),
    JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "first-answer" }], usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 }, provider: "test-provider", model: "test-model", stopReason: "stop" } }),
    JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:03Z", message: { role: "toolResult", toolCallId: "call-1", toolName: "shell", content: [{ type: "text", text: "tool-secret" }] } }),
    JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:04Z", message: { role: "user", content: [{ type: "text", text: "second-secret" }] } }),
    JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "second-answer" }], usage: { input: 9, output: 4, cacheRead: 0, cacheWrite: 0 }, provider: "test-provider", model: "test-model", stopReason: "stop" } }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi");

  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });
  const modelObservations = evidence.observations.filter((item) => item.kind === "model" && item.accounting_scope === "direct");

  assert.equal(result.requests.length, modelObservations.length);
  assert.ok(result.requests.every((request) => request.boundary === "transcript_reconstruction" && request.coverage === "partial"));
  assert.equal(result.requests[0]?.occurrences.length, 1);
  assert.equal(result.requests[1]?.occurrences.length, 4);
  assert.equal(result.requests[1]?.occurrences.every((occurrence) => occurrence.treatment.value === "unknown"), true);
  assert.equal(result.requests[1]?.overrides.model?.value, "test-model");
  assert.equal(result.revisions.some((revision) => revision.bytes.value !== null && revision.tokens.value === null), true);
  assert.equal(JSON.stringify(result).includes("first-secret"), false);
  assert.equal(JSON.stringify(result).includes("first-answer"), false);
  assert.equal(JSON.stringify(result).includes("tool-secret"), false);
  assert.equal(JSON.stringify(result).includes("second-secret"), false);
  assert.equal(JSON.stringify(result).includes("second-answer"), false);
});

test("Pi parentId branches do not mingle sibling ancestry and metadata-only transcripts stay unknown", () => {
  const input = [
    JSON.stringify({ v: 4, kind: "header", sessionId: "session-1" }),
    JSON.stringify({ kind: "entry", entry: { id: "u-root", parentId: null, message: { role: "user", content: [{ type: "text", text: "root-secret" }] } } }),
    JSON.stringify({ kind: "entry", entry: { id: "a-left", parentId: "u-root", message: { role: "assistant", content: [{ type: "text", text: "left-secret" }] } } }),
    JSON.stringify({ kind: "entry", entry: { id: "u-right", parentId: "u-root", message: { role: "user", content: [{ type: "text", text: "right-secret" }] } } }),
    JSON.stringify({ kind: "entry", entry: { id: "a-right", parentId: "u-right", message: { role: "assistant", content: [{ type: "text", text: "right-answer" }] } } }),
    JSON.stringify({ kind: "usage", row: { id: "usage-left", entryId: "a-left", input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    JSON.stringify({ kind: "usage", row: { id: "usage-right", entryId: "a-right", input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-branch");

  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });

  assert.equal(result.requests.length, 2);
  assert.equal(result.requests.every((request) => request.boundary === "transcript_reconstruction"), true);
  assert.equal(result.requests[0]?.occurrences.length, 1);
  assert.equal(result.requests[1]?.occurrences.length, 2);
  assert.equal(JSON.stringify(result).includes("left-secret"), false);
  assert.equal(JSON.stringify(result).includes("right-answer"), false);

  const metadataOnly = [
    JSON.stringify({ type: "session", timestamp: "2026-01-01T00:00:00Z" }),
    JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }),
  ].join("\n") + "\n";
  const metadataEvidence = directEvidence(metadataOnly, "pi", "native-pi-metadata");
  const metadataResult = reconstructNativeContext("pi", metadataOnly, metadataEvidence, profile, { source_id: source.id });
  assert.equal(metadataResult.requests[0]?.occurrences.length, 0);
  assert.equal(metadataResult.requests[0]?.coverage, "unknown");
  assert.ok(metadataResult.issues.some((issue) => issue.code === "NATIVE_TRANSCRIPT_CONTENT_UNAVAILABLE"));
});

test("Pi v4 binds each durable usage identity to its nested entry on a shared transaction line", () => {
  const input = [
    JSON.stringify({ v: 4, kind: "header", sessionId: "session-shared-line" }),
    JSON.stringify({ kind: "transaction", writes: [
      { kind: "entry", entry: { id: "user-a", parentId: null, type: "message", message: { role: "user", content: [{ type: "text", text: "prompt-a" }] } } },
      { kind: "entry", entry: { id: "assistant-a", parentId: "user-a", type: "message", message: { role: "assistant", provider: "provider-a", model: "model-a", content: [{ type: "text", text: "answer-a" }] } } },
      { kind: "usage", row: { id: "usage-a", entryId: "assistant-a", usage: { input: 1, output: 2 } } },
      { kind: "entry", entry: { id: "user-b", parentId: null, type: "message", message: { role: "user", content: [{ type: "text", text: "prompt-b" }] } } },
      { kind: "entry", entry: { id: "assistant-b", parentId: "user-b", type: "message", message: { role: "assistant", provider: "provider-b", model: "model-b", content: [{ type: "text", text: "answer-b" }] } } },
      { kind: "usage", row: { id: "usage-b", entryId: "assistant-b", usage: { input: 3, output: 4 } } },
    ] }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-shared-line");

  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });
  const requestForProvider = (provider: string) => result.requests.find((request) => request.overrides.provider?.value === provider);

  assert.equal(result.requests.length, 2);
  assert.equal(requestForProvider("provider-a")?.overrides.model?.value, "model-a");
  assert.equal(requestForProvider("provider-b")?.overrides.model?.value, "model-b");
  assert.equal(requestForProvider("provider-a")?.occurrences.length, 1);
  assert.equal(requestForProvider("provider-b")?.occurrences.length, 1);
  assert.equal(requestForProvider("provider-a")?.source_refs[0]?.record, "usage:usage-a:line:2");
  assert.equal(requestForProvider("provider-b")?.source_refs[0]?.record, "usage:usage-b:line:2");
  assert.ok(requestForProvider("provider-a")?.overrides.provider?.source_refs.some((ref) => ref.record === "line:2:0.1"));
  assert.ok(requestForProvider("provider-b")?.overrides.provider?.source_refs.some((ref) => ref.record === "line:2:0.4"));
});

test("Pi ancestry cycles never include the target assistant entry in its own context", () => {
  const input = [
    JSON.stringify({ v: 4, kind: "header", sessionId: "session-cycle" }),
    JSON.stringify({ kind: "entry", entry: { id: "assistant-cycle", parentId: "user-cycle", type: "message", message: { role: "assistant", provider: "provider-cycle", model: "model-cycle", content: [{ type: "text", text: "cycle-answer" }] } } }),
    JSON.stringify({ kind: "entry", entry: { id: "user-cycle", parentId: "assistant-cycle", type: "message", message: { role: "user", content: [{ type: "text", text: "cycle-prompt" }] } } }),
    JSON.stringify({ kind: "usage", row: { id: "usage-cycle", entryId: "assistant-cycle", usage: { input: 1, output: 1 } } }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-cycle");

  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.occurrences.length, 1);
  assert.equal(result.sources.some((contextSource) => contextSource.id === "pi-context:assistant-cycle"), false);
  assert.ok(result.issues.some((item) => item.code === "NATIVE_TRANSCRIPT_ANCESTRY_CYCLE"));
});

test("Pi explicit usage references do not fall back to another row on the same line", () => {
  const input = [
    JSON.stringify({ v: 4, kind: "header", sessionId: "session-missing-usage" }),
    JSON.stringify({ kind: "transaction", writes: [
      { kind: "entry", entry: { id: "assistant-present", parentId: null, type: "message", message: { role: "assistant", provider: "provider-present", model: "model-present", content: [{ type: "text", text: "answer-present" }] } } },
      { kind: "usage", row: { id: "usage-present", entryId: "assistant-present", usage: { input: 1, output: 1 } } },
    ] }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-missing-usage");
  const direct = evidence.observations.find((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  assert.ok(direct);
  direct.source_refs = [{ source_id: source.id, record: "usage:usage-missing:line:2" }];

  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });

  assert.equal(result.requests.length, 1);
  assert.deepEqual(result.requests[0]?.occurrences, []);
  assert.equal(result.requests[0]?.overrides.provider?.value, undefined);
  assert.ok(result.issues.some((item) => item.code === "NATIVE_OBSERVATION_ROW_UNAVAILABLE"));
});

test("Pi compaction summary replaces the pre-compaction linear context without inventing token lineage", () => {
  const input = [
    JSON.stringify({ type: "session", timestamp: "2026-01-01T00:00:00Z" }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "before-compaction-secret" }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "before-answer" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }),
    JSON.stringify({ type: "compaction", summary: "compaction-summary-secret", firstKeptEntryIndex: 0 }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "after-compaction-secret" }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "after-answer" }], usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 } } }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-compaction");
  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[1]?.occurrences.length, 2);
  assert.equal(result.issues.some((item) => item.code === "NATIVE_COMPACTION_ANCESTRY_AMBIGUOUS"), true);
  assert.equal(result.transformations.length, 0);
  const summaryOccurrence = result.requests[1]!.occurrences[0]!;
  const summaryRevision = result.revisions.find((item) => item.id === summaryOccurrence.revision_id)!;
  const summarySource = result.sources.find((item) => item.id === summaryRevision.source_id)!;
  assert.equal(summaryRevision.representation, "summary");
  assert.equal(summarySource.origin, "conversation_history");
  assert.equal(summaryOccurrence.role, "unknown");
  assert.ok(summaryRevision.source_refs.some((ref) => ref.record === "line:4:/summary"));
  assert.equal(JSON.stringify(result).includes("before-compaction-secret"), false);
  assert.equal(JSON.stringify(result).includes("compaction-summary-secret"), false);
});

test("the sanitized Pi metadata fixture keeps one unknown boundary per direct model row", () => {
  const input = readFileSync("examples/dogfood/pi/before-compaction.jsonl", "utf8");
  const fixtureSource: Source = { id: "pi-native-fixture", harness: "pi", format: "pi-legacy-transcript-jsonl", coverage: "complete" };
  const evidence = importEvidence("pi", input, { source_id: fixtureSource.id, dataset_id: "native-pi-fixture" });
  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: fixtureSource.id });
  const direct = evidence.observations.filter((item) => item.kind === "model" && item.accounting_scope === "direct");

  assert.equal(direct.length, 484);
  assert.equal(result.requests.length, direct.length);
  assert.equal(result.requests.every((request) => request.boundary === "transcript_reconstruction" && request.coverage === "unknown"), true);
  assert.equal(result.requests.every((request) => request.occurrences.length === 0), true);
  assert.equal(result.revisions.every((revision) => revision.tokens.value === null), true);
  assert.equal(result.revisions.every((revision) => revision.bytes.value === null), true);
  assert.equal(result.requests.reduce((total, request) => total + request.occurrences.length, 0), 0);
});

test("unresolved native row references keep transcript context unknown", () => {
  const input = [
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "should-not-be-inferred" }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }),
  ].join("\n") + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-unresolved-row");
  const direct = evidence.observations.find((item) => item.kind === "model" && item.accounting_scope === "direct");
  assert.ok(direct);
  direct.source_refs = [{ source_id: source.id, record: "response:missing:line:999" }];

  const result = reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.coverage, "unknown");
  assert.deepEqual(result.requests[0]?.occurrences, []);
  assert.ok(result.issues.some((item) => item.code === "NATIVE_TRANSCRIPT_ROW_UNAVAILABLE"));
  assert.equal(JSON.stringify(result).includes("should-not-be-inferred"), false);
});

test("native reconstruction rejects input that does not match the selected source artifact", () => {
  const input = JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }) + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-digest");

  assert.throws(
    () => reconstructNativeContext("pi", `${input} \n`, evidence, profile, { source_id: source.id }),
    (error: unknown) => error instanceof Error && (error as { code?: unknown }).code === "NATIVE_SOURCE_DIGEST_MISMATCH",
  );
});

test("native reconstruction rejects a selected source artifact without a digest", () => {
  const input = JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }) + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-missing-digest");
  const artifact = evidence.sources[0];
  assert.ok(artifact);
  artifact.sha256 = undefined;

  assert.throws(
    () => reconstructNativeContext("pi", input, evidence, profile, { source_id: source.id }),
    (error: unknown) => error instanceof Error && (error as { code?: unknown }).code === "NATIVE_SOURCE_DIGEST_MISSING",
  );
});

test("native reconstruction reports invalid input types as a core error", () => {
  const input = JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }) + "\n";
  const evidence = directEvidence(input, "pi", "native-pi-input-type");

  assert.throws(
    () => reconstructNativeContext("pi", null as unknown as string, evidence, profile, { source_id: source.id }),
    (error: unknown) => error instanceof Error && (error as { code?: unknown }).code === "NATIVE_INPUT_INVALID",
  );
});
