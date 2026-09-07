import assert from "node:assert/strict";
import { mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OperationRecorder } from "../src/operation-recorder.js";
import { createPiOperationBridge, type PiToolLike } from "../src/pi-operations.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "flaimegraph-pi-operations-"));
}

function fakeTool<TArgs, TResult>(name: string, execute: PiToolLike["execute"]): PiToolLike & { execute: (id: string, args: TArgs, signal?: AbortSignal, onUpdate?: unknown) => Promise<TResult> } {
  return { name, label: name, description: `${name} test tool`, parameters: {}, execute } as PiToolLike & { execute: (id: string, args: TArgs, signal?: AbortSignal, onUpdate?: unknown) => Promise<TResult> };
}

test("captures a tool and its real nested filesystem operations without retaining payloads", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "private-source.txt");
    const secret = "first\nsecond-private\nthird\n";
    await fsWriteFile(file, secret, "utf8");
    const recorder = new OperationRecorder({ dataset_id: "pi-bridge", namespace: "pi-test", resource_key: "stable" });
    const bridge = createPiOperationBridge(recorder);
    const tool = fakeTool<{ path: string }, { content: Array<{ type: "text"; text: string }> }>("read", async (_id, args, signal, onUpdate) => {
      assert.equal(args.path, file);
      assert.equal(signal?.aborted, false);
      assert.equal(typeof onUpdate, "function");
      const value = await bridge.readOperations.readFile(args.path);
      const result = { content: [{ type: "text", text: value.toString("utf8") }] };
      onUpdate?.(result);
      return result;
    });
    const wrapped = bridge.wrapTool(tool);
    const signal = new AbortController().signal;
    const updates: unknown[] = [];
    const result = await wrapped.execute("tool-call", { path: file }, signal, (value: unknown) => updates.push(value));
    const bundle = bridge.snapshot();
    const outer = bundle.spans.find((span) => span.label === "read");
    const read = bundle.spans.find((span) => span.kind === "file_read" && span.parent_id === outer?.id);

    assert.equal(result.content[0]?.text, secret);
    assert.equal(updates.length, 1);
    assert.ok(outer);
    assert.ok(read);
    assert.equal(read.parent_id, outer.id);
    assert.equal(read.io?.read_bytes, String(Buffer.byteLength(secret)));
    assert.equal(read.io?.returned_bytes, String(Buffer.byteLength(secret)));
    assert.equal(read.io?.requested_range, null);
    assert.equal(read.io?.measurements.read_bytes.evidence, "observed");
    assert.equal(read.io?.measurements.returned_bytes.evidence, "observed");
    assert.equal(outer.io?.returned_bytes, String(Buffer.byteLength(secret)));
    assert.equal(outer.io?.measurements.returned_bytes.evidence, "derived");
    assert.notEqual(read.io?.resource_id, file);
    assert.equal(JSON.stringify(bundle).includes(file), false);
    assert.equal(JSON.stringify(bundle).includes(secret), false);
    assert.equal(JSON.stringify(bundle).includes("tool-call"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records permission, directory metadata, and mkdir probes without requiring an image detector", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "probe.txt");
    const created = join(directory, "created", "nested");
    await fsWriteFile(file, "probe\n", "utf8");
    const recorder = new OperationRecorder({ dataset_id: "pi-probes", namespace: "pi-probes-test", resource_key: "stable" });
    const bridge = createPiOperationBridge(recorder);

    await bridge.readOperations.access(file);
    assert.equal(await bridge.lsOperations.exists(directory), true);
    const stats = bridge.lsOperations.stat(directory);
    assert.equal((await stats).isDirectory(), true);
    await bridge.writeOperations.mkdir(created);

    const bundle = bridge.snapshot();
    assert.deepEqual(bundle.spans.map((span) => [span.kind, span.label]), [
      ["other", "access"],
      ["other", "exists"],
      ["other", "stat"],
      ["other", "mkdir"],
    ]);
    assert.equal(bundle.coverage.complete, true);
    assert.ok(bundle.spans.every((span) => span.io?.resource_id.startsWith("hmac-sha256:") === true));
    assert.equal(JSON.stringify(bundle).includes(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records edit byte deltas from the tool's actual read and write boundary", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "edit-me.txt");
    await fsWriteFile(file, "before text\n", "utf8");
    const recorder = new OperationRecorder({ dataset_id: "pi-edit", namespace: "pi-edit-test", resource_key: "stable" });
    const bridge = createPiOperationBridge(recorder);
    const tool = fakeTool<{ path: string }, { content: Array<{ type: "text"; text: string }>; details: { diff: string } }>("edit", async (_id, args) => {
      const before = await bridge.editOperations.readFile(args.path);
      const after = before.toString("utf8").replace("before", "after and more");
      await bridge.editOperations.writeFile(args.path, after);
      return { content: [{ type: "text", text: "done" }], details: { diff: "@@ diff omitted @@" } };
    });
    const result = await bridge.wrapTool(tool).execute("edit-call", { path: file });
    const bundle = bridge.snapshot();
    const read = bundle.spans.find((span) => span.kind === "file_read" && span.parent_id !== null);
    const write = bundle.spans.find((span) => span.kind === "file_write" && span.parent_id !== null);

    assert.equal(result.content[0]?.text, "done");
    assert.ok(read);
    assert.ok(write);
    assert.equal(write.parent_id, read.parent_id);
    assert.equal(write.io?.written_bytes, String(Buffer.byteLength("after and more text\n")));
    assert.equal(write.io?.deleted_bytes, "3");
    assert.equal(write.io?.inserted_bytes, "11");
    assert.equal(write.io?.measurements.deleted_bytes.evidence, "derived");
    assert.equal(write.io?.measurements.inserted_bytes.evidence, "derived");
    assert.equal(write.io?.measurements.written_bytes.evidence, "observed");
    assert.equal(await fsReadFile(file, "utf8"), "after and more text\n");
    assert.equal(JSON.stringify(bundle).includes("@@ diff omitted @@"), false);
    assert.equal(JSON.stringify(bundle).includes("after and more"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves rejected tool errors and keeps failed reads privacy-safe", async () => {
  const directory = await temporaryDirectory();
  try {
    const missing = join(directory, "missing-private.txt");
    const recorder = new OperationRecorder({ dataset_id: "pi-error", namespace: "pi-error-test" });
    const bridge = createPiOperationBridge(recorder);
    const failure = new Error("private workload failure");
    const tool = fakeTool<{ path: string }, never>("read", async () => { throw failure; });
    await assert.rejects(bridge.wrapTool(tool).execute("missing-call", { path: missing }), (error: unknown) => error === failure);
    const bundle = bridge.snapshot();
    const span = bundle.spans.find((candidate) => candidate.label === "read");
    assert.equal(span?.status, "error");
    assert.equal(JSON.stringify(bundle).includes(missing), false);
    assert.equal(JSON.stringify(bundle).includes("private workload failure"), false);
    assert.equal(JSON.stringify(bundle).includes("missing-call"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("isolates same-path edit preimages across concurrent tool scopes", async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, "parallel.txt");
    await fsWriteFile(file, "same-old", "utf8");
    const recorder = new OperationRecorder({ dataset_id: "pi-parallel", namespace: "pi-parallel-test", resource_key: "stable" });
    const bridge = createPiOperationBridge(recorder);
    const edit = fakeTool<{ path: string; value: string }, { content: Array<{ type: "text"; text: string }> }>("edit", async (_id, args) => {
      const before = await bridge.editOperations.readFile(args.path);
      await new Promise<void>((resolve) => setTimeout(resolve, args.value === "first-new" ? 5 : 0));
      await bridge.editOperations.writeFile(args.path, before.toString("utf8").replace("same-old", args.value));
      return { content: [{ type: "text", text: "ok" }] };
    });
    const wrapped = bridge.wrapTool(edit);
    await Promise.all([
      wrapped.execute("first", { path: file, value: "first-new" }),
      wrapped.execute("second", { path: file, value: "second-new" }),
    ]);
    const writes = bridge.snapshot().spans.filter((span) => span.kind === "file_write" && span.parent_id !== null);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes.map((span) => span.io?.deleted_bytes).sort(), ["7", "8"]);
    assert.deepEqual(writes.map((span) => span.io?.inserted_bytes).sort(), ["9", "9"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("forwards the original receiver, argument list, signal, updates, result, and unknown-tool semantics", async () => {
  const recorder = new OperationRecorder({ dataset_id: "pi-forward", namespace: "pi-forward-test" });
  const bridge = createPiOperationBridge(recorder);
  const signal = new AbortController().signal;
  const updates: unknown[] = [];
  const tool = {
    name: "custom-secret-shaped-name",
    label: "do-not-copy-this-label",
    marker: "receiver-marker",
    execute(this: { marker: string }, ...args: unknown[]) {
      assert.equal(this.marker, "receiver-marker");
      assert.equal(args.length, 5);
      assert.equal(args[0], "call-id");
      assert.equal(args[2], signal);
      assert.equal(args[3], updatesCallback);
      return Promise.resolve({ content: [{ type: "text", text: "safe result" }] });
    },
  };
  const updatesCallback = (value: unknown) => updates.push(value);
  const wrapped = bridge.wrapTool(tool);
  const result = await wrapped.execute("call-id", { private: "argument" }, signal, updatesCallback, "extra");
  const bundle = bridge.snapshot();
  const span = bundle.spans[0];

  assert.equal(result.content[0]?.text, "safe result");
  assert.equal(span?.kind, "tool");
  assert.equal(span?.label, "tool");
  assert.equal(span?.io?.returned_bytes, String(Buffer.byteLength("safe result")));
  assert.equal(span?.io?.measurements.returned_bytes.method, "pi.tool.result.text-utf8-byte-length");
  assert.equal(JSON.stringify(bundle).includes("private"), false);
  assert.equal(JSON.stringify(bundle).includes("do-not-copy-this-label"), false);
});

test("survives result metadata failure once and exposes the loss in coverage", async () => {
  const recorder = new OperationRecorder({ dataset_id: "pi-meta-failure", namespace: "pi-meta-failure-test" });
  const bridge = createPiOperationBridge(recorder);
  let calls = 0;
  const result = {} as { readonly content: unknown };
  Object.defineProperty(result, "content", {
    get() {
      throw new Error("private result getter");
    },
  });
  const wrapped = bridge.wrapTool(fakeTool("custom", async () => {
    calls += 1;
    return result;
  }));

  assert.strictEqual(await wrapped.execute("one-call", {}), result);
  const bundle = bridge.snapshot();
  assert.equal(calls, 1);
  assert.equal(bundle.coverage.complete, false);
  assert.ok(bundle.coverage.limitations.some((item) => item.includes("result metadata capture failed")));
  assert.equal(JSON.stringify(bundle).includes("private result getter"), false);
});
