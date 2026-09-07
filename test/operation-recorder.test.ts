import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OperationRecorder, type OperationScope } from "../src/operation-recorder.js";
import { reconcileOperationBundles, validateOperationBundle } from "../src/operations.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "flaimegraph-operation-recorder-"));
}

test("resource identities preserve byte paths and agree for equivalent string paths", async () => {
  const directory = await temporaryDirectory();
  try {
    const ordinary = join(directory, "ordinary");
    const binaryA = Buffer.concat([Buffer.from(directory + "/"), Buffer.from([0xff])]);
    const binaryB = Buffer.concat([Buffer.from(directory + "/"), Buffer.from([0xfe])]);
    await fsWriteFile(ordinary, "ordinary");
    const recorder = new OperationRecorder({ dataset_id: "byte-paths", namespace: "byte-paths" });
    await recorder.readFile(ordinary);
    await recorder.readFile(Buffer.from(ordinary));
    await recorder.readFile(binaryA).catch(() => undefined);
    await recorder.readFile(binaryB).catch(() => undefined);
    const ids = recorder.snapshot().spans.map(span => span.io?.resource_id);
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[2], ids[3]);
    assert.equal(new Set(ids).size, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records a real file read with truthful byte measurements and local provenance", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "private-source.txt");
    await fsWriteFile(file, "first\nsecond\nthird\n", "utf8");
    const recorder = new OperationRecorder({ dataset_id: "dataset-1", namespace: "test-stream", resource_key: "stable-resource-key" });

    const returned = await recorder.readFile(file, { start_line: 2, end_line: 2 });
    const bundle = recorder.snapshot();
    const span = bundle.spans[0];

    assert.equal(returned, "second\n");
    assert.equal(bundle.schema_version, "0.3.0");
    assert.equal(bundle.coverage.complete, true);
    assert.equal(bundle.artifacts.length, 1);
    assert.equal(bundle.artifacts[0]?.format, "operation-recorder");
    assert.equal(span?.kind, "file_read");
    assert.equal(span?.status, "ok");
    assert.equal(span?.timing.started_at.evidence, "observed");
    assert.equal(span?.timing.ended_at.evidence, "observed");
    assert.equal(span?.timing.duration_ns.clock, "monotonic");
    assert.deepEqual(span?.io?.requested_range, { start_line: 2, end_line: 2 });
    assert.equal(span?.io?.read_bytes, String(Buffer.byteLength("first\nsecond\nthird\n")));
    assert.equal(span?.io?.returned_bytes, String(Buffer.byteLength("second\n")));
    assert.notEqual(span?.io?.resource_id, file);
    assert.notEqual(span?.io?.resource_label, file);
    assert.equal(JSON.stringify(bundle).includes(file), false);
    assert.equal(JSON.stringify(bundle).includes("private-source"), false);
    assert.equal(JSON.stringify(bundle).includes("third"), false);
    assert.equal(JSON.stringify(bundle).includes("ENOENT"), false);
    assert.equal(span?.source_refs[0]?.source_id, bundle.artifacts[0]?.id);
    assert.deepEqual(validateOperationBundle(bundle), bundle);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records writes and directory scans without retaining path or file contents", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "written.txt");
    const recorder = new OperationRecorder({ dataset_id: "dataset-io", namespace: "io-stream", resource_key: "io-key" });

    await recorder.writeFile(file, "written-secret");
    const entries = await recorder.readDirectory(directory);
    const returned = await recorder.readFile(file);
    const bundle = recorder.snapshot();

    assert.deepEqual(entries, ["written.txt"]);
    assert.equal(returned, "written-secret");
    assert.equal(bundle.spans.length, 3);
    assert.equal(bundle.spans[0]?.kind, "file_write");
    assert.equal(bundle.spans[0]?.io?.written_bytes, String(Buffer.byteLength("written-secret")));
    assert.equal(bundle.spans[0]?.io?.inserted_bytes, null);
    assert.equal(bundle.spans[0]?.io?.deleted_bytes, null);
    assert.equal(bundle.spans[1]?.kind, "directory_read");
    assert.equal(bundle.spans[1]?.io?.entry_count, "1");
    assert.equal(bundle.spans[1]?.io?.examined_entries, "1");
    assert.equal(JSON.stringify(bundle).includes(directory), false);
    assert.equal(JSON.stringify(bundle).includes("written-secret"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses runtime async scopes for nesting and concurrent siblings, while preserving caught errors", async () => {
  const recorder = new OperationRecorder({ dataset_id: "dataset-nesting", namespace: "nest-stream" });
  const observed: Record<string, string> = {};
  const privateError = new Error("private callback failure");

  await recorder.run({ kind: "work" }, async (root) => {
    observed.root = root.id;
    await Promise.all([
      recorder.run({ kind: "phase", label: "first" }, async (first) => {
        observed.first = first.id;
        await recorder.run({ kind: "tool", label: "nested" }, async (nested) => {
          observed.nested = nested.id;
        });
      }),
      recorder.run({ kind: "phase", label: "second" }, async (second) => {
        observed.second = second.id;
        try {
          await recorder.run({ kind: "test", label: "fails" }, async () => {
            throw privateError;
          });
        } catch (error) {
          assert.strictEqual(error, privateError);
        }
      }),
    ]);
  });

  const bundle = recorder.snapshot();
  const byId = new Map(bundle.spans.map((span) => [span.id, span]));
  assert.equal(bundle.spans.length, 5);
  assert.equal(byId.get(observed.root)?.parent_id, null);
  assert.equal(byId.get(observed.first)?.parent_id, observed.root);
  assert.equal(byId.get(observed.second)?.parent_id, observed.root);
  assert.equal(byId.get(observed.nested)?.parent_id, observed.first);
  assert.equal(byId.get(observed.nested)?.parentage?.evidence, "observed");
  assert.equal(byId.get(observed.nested)?.parentage?.method, "runtime-scope");
  assert.equal(byId.get(observed.nested)?.status, "ok");
  assert.equal(byId.get(observed.second)?.status, "ok");
  assert.equal(byId.get(observed.second)?.parent_id, observed.root);
  assert.equal(bundle.spans.find((span) => span.label === "fails")?.status, "error");
  assert.ok(bundle.spans.every((span) => span.duration_ns !== null && BigInt(span.duration_ns) >= 0n));
  assert.equal(new Set(bundle.spans.map((span) => `${span.stream_id}:${span.sequence}`)).size, bundle.spans.length);
});

test("shows running spans and keeps returned snapshots detached from recorder state", async () => {
  const recorder = new OperationRecorder({ dataset_id: "dataset-live", namespace: "live-stream" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const running = recorder.run({ kind: "model", executing_model: "test-model" }, async () => gate);

  await new Promise<void>((resolve) => setImmediate(resolve));
  const live = recorder.snapshot();
  assert.equal(live.spans[0]?.status, "running");
  assert.equal(live.spans[0]?.ended_at, null);
  assert.ok(live.spans[0]?.duration_ns !== null);
  assert.equal(live.coverage.complete, false);

  live.spans[0]!.label = "mutated-outside-snapshot";
  live.spans.push(structuredClone(live.spans[0]!));
  release();
  await running;
  const final = recorder.snapshot();
  assert.equal(final.spans.length, 1);
  assert.equal(final.spans[0]?.label, "model");
  assert.equal(final.spans[0]?.status, "ok");
  assert.equal(final.coverage.complete, true);
});

test("continues workload execution after the span cap and never emits a dropped parent", async () => {
  const recorder = new OperationRecorder({ dataset_id: "dataset-cap", namespace: "cap-stream", max_spans: 2 });
  const result = await recorder.run({ kind: "work" }, async () => recorder.run({ kind: "phase" }, async () => recorder.run({ kind: "tool" }, async () => "completed")));
  const bundle = recorder.snapshot();
  const ids = new Set(bundle.spans.map((span) => span.id));

  assert.equal(result, "completed");
  assert.equal(bundle.spans.length, 2);
  assert.equal(bundle.coverage.dropped_spans, 1);
  assert.equal(bundle.coverage.complete, false);
  assert.ok(bundle.coverage.limitations.some((item) => item.includes("max_spans=2")));
  assert.ok(bundle.spans.every((span) => span.parent_id === null || ids.has(span.parent_id)));
  assert.equal(bundle.spans[1]?.parent_id, bundle.spans[0]?.id);
});

test("records failed filesystem operations without exposing the original path or error", async () => {
  const directory = await temporaryDirectory();
  try {
    const missing = join(directory, "secret-missing-file.txt");
    const recorder = new OperationRecorder({ dataset_id: "dataset-error", namespace: "error-stream" });
    await assert.rejects(recorder.readFile(missing), (error: unknown) => error instanceof Error);
    const bundle = recorder.snapshot();
    assert.equal(bundle.spans[0]?.status, "error");
    assert.equal(bundle.spans[0]?.io?.read_bytes, null);
    assert.equal(JSON.stringify(bundle).includes(missing), false);
    assert.equal(JSON.stringify(bundle).includes("ENOENT"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses caller resource keys for stable opaque resource IDs and randomizes omitted keys", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "same-resource.txt");
    await fsWriteFile(file, "same");
    const first = new OperationRecorder({ dataset_id: "dataset-key", namespace: "key-stream", resource_key: "stable" });
    const second = new OperationRecorder({ dataset_id: "dataset-key", namespace: "key-stream", resource_key: "stable" });
    const random = new OperationRecorder({ dataset_id: "dataset-key", namespace: "key-stream" });
    await first.readFile(file);
    await second.readFile(file);
    await random.readFile(file);
    const firstId = first.snapshot().spans[0]?.io?.resource_id;
    const secondId = second.snapshot().spans[0]?.io?.resource_id;
    const randomId = random.snapshot().spans[0]?.io?.resource_id;
    assert.equal(firstId, secondId);
    assert.notEqual(firstId, randomId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exposes context and dependency links with resolved operation identities", async () => {
  const recorder = new OperationRecorder({ dataset_id: "dataset-links", namespace: "link-stream" });
  let producerId = "";
  let consumerId = "";
  await recorder.run({ kind: "work" }, async (root) => {
    producerId = root.id;
    root.linkContext("revision-1");
    await recorder.run({ kind: "model" }, async (consumer) => {
      consumerId = consumer.id;
      consumer.link("depends_on", root.id);
      consumer.link("consumes_context", {
        context_revision_id: "revision-1",
        request_id: "request-1",
        occurrence_id: "occurrence-1",
      });
    });
  });
  const bundle = recorder.snapshot();

  assert.deepEqual(bundle.links.map((link) => link.kind), ["produces_context", "depends_on", "consumes_context"]);
  assert.deepEqual(bundle.links[0], {
    source_refs: [{ source_id: `operation-recorder:link-stream`, record: `span:${producerId}` }],
    from_operation_id: producerId,
    kind: "produces_context",
    to_operation_id: null,
    context_revision_id: "revision-1",
    request_id: null,
    occurrence_id: null,
    evidence: "declared",
    method: "scope.linkContext",
  });
  assert.equal(bundle.links[1]?.to_operation_id, producerId);
  assert.equal(bundle.links[2]?.from_operation_id, consumerId);
  assert.equal(bundle.links[2]?.request_id, "request-1");
  assert.ok(bundle.links.every((link) => link.source_refs.length > 0));
  assert.deepEqual(validateOperationBundle(bundle), bundle);
});

test("duplicate observation IDs at scope creation preserve the first binding and a valid snapshot", async () => {
  const recorder = new OperationRecorder({ dataset_id: "duplicate-bindings", namespace: "duplicate-bindings" });
  await recorder.run({ kind: "model", observation_id: "one-response" }, async () => "first");
  await recorder.run({ kind: "model", observation_id: "one-response" }, async () => "second");
  const bundle = recorder.snapshot();
  assert.deepEqual(bundle.spans.map(span => span.observation_id), ["one-response", null]);
  assert.ok(bundle.coverage.limitations.some(message => message.includes("duplicate observation")));
  assert.deepEqual(validateOperationBundle(bundle), bundle);
});

test("link capture is bounded, replay does not consume capacity, and caller classifications remain declared", async () => {
  const recorder = new OperationRecorder({ dataset_id: "link-cap", namespace: "link-cap", max_links: 2 });
  await recorder.run({ kind: "model", label: "caller-provided label" }, async scope => {
    assert.ok(scope.linkContext("a"));
    assert.ok(scope.linkContext("a"));
    assert.ok(scope.linkContext("b"));
    assert.equal(scope.linkContext("c"), null);
  });
  const bundle = recorder.snapshot();
  assert.equal(bundle.spans[0]!.classification.evidence, "declared");
  assert.equal(bundle.links.length, 2);
  assert.equal(bundle.coverage.dropped_links, 1);
  assert.equal(bundle.coverage.complete, false);
  assert.deepEqual(validateOperationBundle(bundle), bundle);
});

test("invalid context identities and self dependencies do not corrupt a recorder snapshot", async () => {
  const recorder = new OperationRecorder({ dataset_id: "invalid-links", namespace: "invalid-links" });
  await recorder.run({ kind: "model" }, async scope => {
    assert.equal(scope.link("produces_context", { context_revision_id: "" }), null);
    assert.equal(scope.link("consumes_context", { context_revision_id: "revision", request_id: "", occurrence_id: "occurrence" }), null);
    assert.equal(scope.link("depends_on", scope.id), null);
  });
  const bundle = recorder.snapshot();
  assert.equal(bundle.links.length, 0);
  assert.equal(bundle.coverage.complete, false);
  assert.deepEqual(validateOperationBundle(bundle), bundle);
});

test("live snapshots are inspection views and completed scope identities remain immutable", async () => {
  const recorder = new OperationRecorder({ dataset_id: "finalization", namespace: "finalization" });
  let retained: OperationScope | undefined;
  await recorder.run({ kind: "tool", label: "Original" }, async scope => {
    retained = scope;
    assert.throws(() => reconcileOperationBundles([recorder.snapshot()]), /running|live/i);
  });
  const final = recorder.snapshot();
  retained!.setLabel("Late change");
  retained!.bindObservation("late-observation");
  retained!.setIO({ resource_id: "late-resource", resource_label: "Late" });
  assert.equal(retained!.linkContext("late-revision"), null);
  const late = recorder.snapshot();
  assert.deepEqual(late.spans, final.spans);
  assert.deepEqual(late.links, final.links);
  assert.equal(late.coverage.complete, false);
  assert.equal(reconcileOperationBundles([final, late]).spans.length, 1);
});
