import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, open as openFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LifecycleJournalError,
  openLifecycleJournal,
  readLifecycleJournal,
} from "../src/lifecycle-journal.js";
import type { LifecycleData } from "../src/lifecycle-types.js";
import { projectLifecycle } from "../src/lifecycle.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "flaimegraph-lifecycle-journal-"));
}

async function segmentFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => /^[0-9a-f-]{36}\.jsonl$/u.test(name)).sort().map((name) => join(directory, name));
}

test("durable start survives a killed child and preserves parent structure", async () => {
  const directory = await temporaryDirectory();
  const journalDirectory = join(directory, "journal");
  const childSource = `
    import { openLifecycleJournal } from './src/lifecycle-journal.ts';
    const journal = await openLifecycleJournal({ directory: ${JSON.stringify(journalDirectory)}, dataset_id: 'killed-child', producer_id: 'child' });
    await journal.start({ action_id: 'parent', subject: 'work' });
    await journal.start({ action_id: 'child', subject: 'tool.read', parent_id: 'parent' });
    process.stdout.write('ready\\n');
    await new Promise(() => {});
  `;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "-e", childSource], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("ready")) resolve();
        });
        child.once("error", reject);
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`child did not become ready: ${stderr}`)), 10_000)),
    ]);
    child.kill("SIGKILL");
    await once(child, "close");

    const capture = await readLifecycleJournal({ directory: journalDirectory, dataset_id: "killed-child" });
    const projection = projectLifecycle(capture);
    assert.equal(capture.events.filter((event) => event.data.kind === "start").length, 2);
    assert.equal(projection.actions.find((action) => action.action_id === "child")?.parent_id, "parent");
    assert.equal(projection.actions.find((action) => action.action_id === "child")?.state, "completion_unobserved");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a process killed during a frame write leaves only the durable prefix", async () => {
  const directory = await temporaryDirectory();
  const journalDirectory = join(directory, "journal");
  const childSource = `
    import { openLifecycleJournal } from './src/lifecycle-journal.ts';
    const journal = await openLifecycleJournal({ directory: ${JSON.stringify(journalDirectory)}, dataset_id: 'killed-write', producer_id: 'child' });
    const file = (journal as any).file;
    const originalWrite = file.write.bind(file);
    let firstWrite = true;
    file.write = async (buffer: any, offset: number, length: number, position: number) => {
      if (firstWrite) {
        firstWrite = false;
        await originalWrite(buffer, offset, 1, position);
        process.stdout.write('writing\\n');
        await new Promise(() => {});
      }
      return originalWrite(buffer, offset, length, position);
    };
    void journal.start({ action_id: 'interrupted', subject: 'work' });
    setInterval(() => {}, 1_000);
  `;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "-e", childSource], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    await Promise.race([
      new Promise<void>((resolveReady, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("writing")) resolveReady();
        });
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`child exited before write interception (${code}): ${stderr}`)));
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`child did not reach write: ${stderr}`)), 10_000)),
    ]);
    child.kill("SIGKILL");
    await once(child, "close");

    const capture = await readLifecycleJournal({ directory: journalDirectory, dataset_id: "killed-write" });
    assert.equal(capture.events.filter((event) => event.data.kind === "start").length, 0);
    assert.ok(capture.issues.some((issue) => issue.code === "journal_torn_suffix"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("read replay is deterministic and a restart gets a new epoch while accepting a late terminal event", async () => {
  const directory = await temporaryDirectory();
  try {
    const first = await openLifecycleJournal({ directory, dataset_id: "restart", producer_id: "agent" });
    await first.start({ action_id: "call", subject: "model.response", parent_id: "parent" });
    await first.close();

    const second = await openLifecycleJournal({ directory, dataset_id: "restart", producer_id: "agent" });
    await second.end("call", "ok");
    await second.measurement("call", {
      id: "input_tokens",
      unit: "tokens",
      description: "Input tokens",
      subset_of: null,
      overlap: "disjoint",
    }, {
      value: "7",
      evidence: "observed",
      method: "late provider receipt",
      count_basis: "consumed",
      aggregation: "delta",
      scope: "event",
    });
    await second.close();

    const capture = await readLifecycleJournal({ directory, dataset_id: "restart" });
    const replay = await readLifecycleJournal({ directory, dataset_id: "restart" });
    assert.deepEqual(replay, capture);
    assert.equal(new Set(capture.events.map((event) => event.epoch)).size, 2);
    const action = projectLifecycle(capture).actions.find((item) => item.action_id === "call");
    assert.equal(action?.state, "ok");
    assert.equal(action?.parent_id, "parent");
    assert.equal(projectLifecycle(capture).usage.observations.filter((item) => item.measurements.input_tokens).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("independent writers use isolated segments and serialized appends preserve each chain", async () => {
  const directory = await temporaryDirectory();
  try {
    const [left, right] = await Promise.all([
      openLifecycleJournal({ directory, dataset_id: "writers", producer_id: "left" }),
      openLifecycleJournal({ directory, dataset_id: "writers", producer_id: "right" }),
    ]);
    await Promise.all([
      left.start({ action_id: "left-action", subject: "left" }),
      right.start({ action_id: "right-action", subject: "right" }),
    ]);
    await Promise.all(Array.from({ length: 20 }, () => left.heartbeat("left-action")));
    await left.end("left-action", "ok");
    await right.end("right-action", "ok");
    await Promise.all([left.close(), right.close()]);

    assert.equal((await segmentFiles(directory)).length, 2);
    const capture = await readLifecycleJournal({ directory, dataset_id: "writers" });
    const leftEvents = capture.events.filter((event) => event.producer_id === "left");
    assert.deepEqual(leftEvents.map((event) => event.sequence), Array.from({ length: 23 }, (_, index) => index));
    assert.equal(new Set(capture.events.map((event) => event.epoch)).size, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unterminated suffix is reported while the original segment remains untouched", async () => {
  const directory = await temporaryDirectory();
  try {
    const journal = await openLifecycleJournal({ directory, dataset_id: "tail", producer_id: "agent" });
    await journal.start({ action_id: "read", subject: "tool.read" });
    await journal.close();
    const [path] = await segmentFiles(directory);
    assert.ok(path);
    const before = await readFile(path);
    const handle = await openFile(path, "a");
    await handle.write(Buffer.from('{"event":', "utf8"));
    await handle.close();
    const afterWrite = await readFile(path);
    const capture = await readLifecycleJournal({ directory, dataset_id: "tail" });
    const afterRead = await readFile(path);
    assert.equal(afterRead.toString("hex"), afterWrite.toString("hex"));
    assert.equal(capture.events.filter((event) => event.data.kind === "start").length, 1);
    assert.ok(capture.issues.some((issue) => issue.code === "journal_torn_suffix"));
    assert.ok(afterWrite.byteLength > before.byteLength);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("newline-terminated corruption fails closed", async () => {
  const directory = await temporaryDirectory();
  try {
    await writeFile(join(directory, `${randomUUID()}.jsonl`), "{\"not\":\"a lifecycle frame\"}\n", { mode: 0o600 });
    await assert.rejects(
      readLifecycleJournal({ directory, dataset_id: "corrupt" }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_CORRUPT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writer and reader reject unsupported lifecycle fields", async () => {
  const directory = await temporaryDirectory();
  try {
    const journal = await openLifecycleJournal({ directory, dataset_id: "strict-fields", producer_id: "agent" });
    await assert.rejects(
      journal.append({ kind: "start", action_id: "bad", subject: "work", extra: true } as never),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_EVENT_INVALID",
    );
    await journal.close();
    const [path] = await segmentFiles(directory);
    assert.ok(path);
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    const frame = JSON.parse(lines[0]!) as Record<string, unknown>;
    frame.extra = true;
    lines[0] = JSON.stringify(frame);
    await writeFile(path, `${lines.join("\n")}\n`);
    await assert.rejects(
      readLifecycleJournal({ directory, dataset_id: "strict-fields" }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_CORRUPT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reader rejects malformed UTF-8 in a complete frame", async () => {
  const directory = await temporaryDirectory();
  try {
    const journal = await openLifecycleJournal({ directory, dataset_id: "utf8", producer_id: "agent" });
    await journal.close();
    const [path] = await segmentFiles(directory);
    assert.ok(path);
    const bytes = await readFile(path);
    const newline = bytes.indexOf(0x0a);
    assert.ok(newline > 0);
    const malformed = Buffer.concat([bytes.subarray(0, newline), Buffer.from([0xff]), bytes.subarray(newline)]);
    await writeFile(path, malformed);
    await assert.rejects(
      readLifecycleJournal({ directory, dataset_id: "utf8" }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_CORRUPT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("segment bounds fail before dispatch and never silently drop a start", async () => {
  const directory = await temporaryDirectory();
  try {
    const journal = await openLifecycleJournal({ directory, dataset_id: "bounded", producer_id: "agent", max_bytes: 512 });
    let called = false;
    await assert.rejects(
      journal.withAction({ action_id: "too-large", subject: "x".repeat(2_000) }, async () => {
        called = true;
      }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_BOUNDS",
    );
    assert.equal(called, false);
    await journal.close();
    const capture = await readLifecycleJournal({ directory, dataset_id: "bounded" });
    assert.equal(capture.events.filter((event) => event.data.kind === "start").length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reader enforces its byte bound across recognized segments", async () => {
  const directory = await temporaryDirectory();
  try {
    const [left, right] = await Promise.all([
      openLifecycleJournal({ directory, dataset_id: "read-bound", producer_id: "left" }),
      openLifecycleJournal({ directory, dataset_id: "read-bound", producer_id: "right" }),
    ]);
    await Promise.all([
      left.start({ action_id: "left", subject: "work" }),
      right.start({ action_id: "right", subject: "work" }),
    ]);
    await Promise.all([left.close(), right.close()]);
    const files = await segmentFiles(directory);
    const total = (await Promise.all(files.map(async (path) => (await readFile(path)).byteLength))).reduce((sum, size) => sum + size, 0);
    await assert.rejects(
      readLifecycleJournal({ directory, dataset_id: "read-bound", max_bytes: total - 1 }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_READ_BOUND",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("write and synchronization uncertainty poison a writer until close", async () => {
  const writeDirectory = await temporaryDirectory();
  const syncDirectoryPath = await temporaryDirectory();
  try {
    const writeJournal = await openLifecycleJournal({ directory: writeDirectory, dataset_id: "write-fault", producer_id: "agent" });
    const writeFileHandle = (writeJournal as unknown as { file: { write: (...args: unknown[]) => Promise<unknown> } }).file;
    writeFileHandle.write = async () => { throw new Error("injected write failure"); };
    await assert.rejects(
      writeJournal.start({ action_id: "write", subject: "work" }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_IO" && error.uncertain,
    );
    await assert.rejects(writeJournal.start({ action_id: "again", subject: "work" }), (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_POISONED");
    await writeJournal.close();

    const syncJournal = await openLifecycleJournal({ directory: syncDirectoryPath, dataset_id: "sync-fault", producer_id: "agent" });
    const syncFileHandle = (syncJournal as unknown as { file: { sync: () => Promise<void> } }).file;
    syncFileHandle.sync = async () => { throw new Error("injected sync failure"); };
    await assert.rejects(
      syncJournal.start({ action_id: "sync", subject: "work" }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_DURABILITY_UNCERTAIN" && error.uncertain,
    );
    await assert.rejects(syncJournal.start({ action_id: "again", subject: "work" }), (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_POISONED");
    await assert.rejects(syncJournal.close(), (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_SYNC");
  } finally {
    await rm(writeDirectory, { recursive: true, force: true });
    await rm(syncDirectoryPath, { recursive: true, force: true });
  }
});

test("a filesystem path error is surfaced as a journal storage error", async () => {
  const directory = await temporaryDirectory();
  const file = join(directory, "not-a-directory");
  try {
    await writeFile(file, "file", { mode: 0o600 });
    await assert.rejects(
      openLifecycleJournal({ directory: join(file, "child"), dataset_id: "io", producer_id: "agent" }),
      (error: unknown) => error instanceof LifecycleJournalError && error.code === "JOURNAL_DIRECTORY",
    );
  } finally {
    await chmod(file, 0o600).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("append snapshots queued data and withAction retains its started action identity", async () => {
  const directory = await temporaryDirectory();
  try {
    const journal = await openLifecycleJournal({ directory, dataset_id: "immutable", producer_id: "agent" });
    const data: Extract<LifecycleData, { kind: "start" }> = { kind: "start", action_id: "queued", subject: "original" };
    const appended = journal.append(data);
    data.subject = "mutated before dispatch";
    await appended;

    const input = { action_id: "stable", subject: "work" };
    await journal.withAction(input, async (started) => {
      input.action_id = "mutated input";
      if (started.data.kind === "start") started.data.action_id = "mutated event";
    });
    await journal.close();

    const capture = await readLifecycleJournal({ directory, dataset_id: "immutable" });
    const queued = capture.events.find((event) => event.data.kind === "start" && event.data.action_id === "queued");
    assert.equal(queued?.data.kind, "start");
    assert.equal(queued?.data.subject, "original");
    assert.ok(capture.events.some((event) => event.data.kind === "end" && event.data.action_id === "stable"));
    assert.equal(capture.events.some((event) => event.data.kind === "end" && event.data.action_id === "mutated input"), false);
    assert.equal(capture.events.some((event) => event.data.kind === "end" && event.data.action_id === "mutated event"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("withAction preserves callback and terminal append failures", async () => {
  const directory = await temporaryDirectory();
  try {
    const journal = await openLifecycleJournal({ directory, dataset_id: "aggregate", producer_id: "agent", max_bytes: 1_000 });
    const callbackError = new Error("provider failed");
    await assert.rejects(
      journal.withAction({ action_id: "failed", subject: "work" }, async () => {
        throw callbackError;
      }),
      (error: unknown) => {
        if (!(error instanceof AggregateError)) return false;
        assert.equal(error.errors[0], callbackError);
        assert.ok(error.errors[1] instanceof LifecycleJournalError);
        assert.equal((error.errors[1] as LifecycleJournalError).code, "JOURNAL_BOUNDS");
        return true;
      },
    );
    await journal.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
