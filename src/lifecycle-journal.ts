import { createHash, randomUUID } from "node:crypto";
import { mkdir, open as openFile, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { canonicalUsage } from "./usage.js";
import { validateLifecycleEvent } from "./lifecycle.js";
import type {
  InterruptionReason,
  LifecycleActionInput,
  LifecycleCapture,
  LifecycleData,
  LifecycleEvent,
} from "./lifecycle-types.js";
import { LIFECYCLE_SCHEMA_VERSION } from "./lifecycle-types.js";
import type { UsageMeasurement, UsageMeter, UsageStatus } from "./usage-types.js";

export const DEFAULT_LIFECYCLE_SEGMENT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_LIFECYCLE_READ_BYTES = 256 * 1024 * 1024;

const SEGMENT_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/u;
const HASH = /^[0-9a-f]{64}$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type ErrorCode =
  | "JOURNAL_BOUNDS"
  | "JOURNAL_CLOSED"
  | "JOURNAL_CORRUPT"
  | "JOURNAL_DIRECTORY"
  | "JOURNAL_EVENT_INVALID"
  | "JOURNAL_IO"
  | "JOURNAL_POISONED"
  | "JOURNAL_READ_BOUND"
  | "JOURNAL_READ"
  | "JOURNAL_SYNC"
  | "JOURNAL_DURABILITY_UNCERTAIN";

/** A storage failure is deliberately typed so callers can distinguish loss from callback failure. */
export class LifecycleJournalError extends Error {
  readonly code: ErrorCode;
  readonly path?: string;
  readonly uncertain: boolean;

  constructor(code: ErrorCode, message: string, options: { path?: string; uncertain?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "LifecycleJournalError";
    this.code = code;
    this.path = options.path;
    this.uncertain = options.uncertain ?? code === "JOURNAL_DURABILITY_UNCERTAIN";
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface LifecycleJournalOptions {
  directory: string;
  dataset_id: string;
  producer_id: string;
  /** Maximum encoded bytes in a single per-open segment, including frame newlines. */
  max_bytes?: number;
}

export interface ReadLifecycleJournalOptions {
  directory: string;
  dataset_id: string;
  /** Maximum bytes read across all recognized segments. */
  max_bytes?: number;
}

export interface LifecycleJournal {
  readonly directory: string;
  readonly dataset_id: string;
  readonly producer_id: string;
  readonly epoch: string;
  append(data: LifecycleData): Promise<LifecycleEvent>;
  start(input: LifecycleActionInput): Promise<LifecycleEvent>;
  end(action_id: string, status: Exclude<UsageStatus, "running">, reason?: InterruptionReason): Promise<LifecycleEvent>;
  end(input: { action_id: string; status: Exclude<UsageStatus, "running">; reason?: InterruptionReason }): Promise<LifecycleEvent>;
  pause(action_id: string, reason: InterruptionReason): Promise<LifecycleEvent>;
  resume(action_id: string): Promise<LifecycleEvent>;
  heartbeat(action_id: string): Promise<LifecycleEvent>;
  measurement(action_id: string, meter: UsageMeter, measurement: Omit<UsageMeasurement, "source_refs">): Promise<LifecycleEvent>;
  withAction<T>(input: LifecycleActionInput, callback: (started: LifecycleEvent) => T | PromiseLike<T>): Promise<T>;
  close(): Promise<void>;
}

interface Frame {
  event: LifecycleEvent;
  previous_hash: string | null;
  hash: string;
}

interface MutableOptions {
  directory: string;
  dataset_id: string;
  producer_id: string;
  epoch: string;
  path: string;
  file: FileHandle;
  max_bytes: number;
}

interface SegmentRead {
  events: LifecycleEvent[];
  issues: LifecycleCapture["issues"];
  dataset_id: string | null;
  bytes: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && onlyAllowedKeys(value, allowed);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeData(data: LifecycleData, allowEpoch = false): LifecycleData {
  if (!isObject(data) || typeof (data as { kind?: unknown }).kind !== "string") {
    throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", "lifecycle data must be an object with a kind");
  }
  const kind = (data as { kind: string }).kind;
  const allowed: Record<string, readonly string[]> = {
    epoch: ["kind"],
    start: ["kind", "action_id", "subject", "parent_id", "retry_of", "work_item_id", "task_id", "agent_id", "session_id", "dimensions"],
    pause: ["kind", "action_id", "reason"],
    resume: ["kind", "action_id"],
    heartbeat: ["kind", "action_id"],
    end: ["kind", "action_id", "status", "reason"],
    measurement: ["kind", "action_id", "meter", "measurement"],
  };
  if (!Object.hasOwn(allowed, kind)) {
    throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `unsupported lifecycle event kind ${kind}`);
  }
  if (!onlyAllowedKeys(data, allowed[kind]!)) {
    throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `lifecycle ${kind} data has unsupported fields`);
  }
  switch (kind) {
    case "epoch":
      if (allowEpoch) return { kind: "epoch" };
      throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", "epoch data is reserved for journal open");
    case "start": {
      const value = data as unknown as Extract<LifecycleData, { kind: "start" }>;
      return {
        kind: "start",
        action_id: value.action_id,
        subject: value.subject,
        ...(value.parent_id === undefined ? {} : { parent_id: value.parent_id }),
        ...(value.retry_of === undefined ? {} : { retry_of: value.retry_of }),
        ...(value.work_item_id === undefined ? {} : { work_item_id: value.work_item_id }),
        ...(value.task_id === undefined ? {} : { task_id: value.task_id }),
        ...(value.agent_id === undefined ? {} : { agent_id: value.agent_id }),
        ...(value.session_id === undefined ? {} : { session_id: value.session_id }),
        ...(value.dimensions === undefined ? {} : { dimensions: clone(value.dimensions) }),
      };
    }
    case "pause": {
      const value = data as unknown as Extract<LifecycleData, { kind: "pause" }>;
      return { kind: "pause", action_id: value.action_id, reason: clone(value.reason) };
    }
    case "resume": {
      const value = data as unknown as Extract<LifecycleData, { kind: "resume" }>;
      return { kind: "resume", action_id: value.action_id };
    }
    case "heartbeat": {
      const value = data as unknown as Extract<LifecycleData, { kind: "heartbeat" }>;
      return { kind: "heartbeat", action_id: value.action_id };
    }
    case "end": {
      const value = data as unknown as Extract<LifecycleData, { kind: "end" }>;
      return {
        kind: "end",
        action_id: value.action_id,
        status: value.status,
        ...(value.reason === undefined ? {} : { reason: clone(value.reason) }),
      };
    }
    case "measurement": {
      const value = data as unknown as Extract<LifecycleData, { kind: "measurement" }>;
      return {
        kind: "measurement",
        action_id: value.action_id,
        meter: clone(value.meter),
        measurement: clone(value.measurement),
      };
    }
  }
  throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `unsupported lifecycle event kind ${kind}`);
}

function frameBytes(frame: Frame): Buffer {
  return Buffer.from(`${JSON.stringify(frame)}\n`, "utf8");
}

function frameHash(event: LifecycleEvent, previous_hash: string | null): string {
  return sha256(canonicalUsage({ event, previous_hash }));
}

function invalidEvent(error: unknown): LifecycleJournalError {
  return new LifecycleJournalError("JOURNAL_EVENT_INVALID", `lifecycle event validation failed: ${errorMessage(error)}`, { cause: error });
}

/** Synchronize directory metadata, failing closed when the platform/filesystem cannot do so. */
async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await openFile(directory, "r");
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    throw new LifecycleJournalError("JOURNAL_SYNC", `could not synchronize journal directory: ${errorMessage(error)}`, { path: directory, cause: error });
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

/** Synchronize the active directory and each newly-created parent entry. */
async function syncCreatedDirectories(directory: string, firstCreated: string | undefined): Promise<void> {
  const active = resolve(directory);
  if (firstCreated === undefined) {
    await syncDirectory(active);
    return;
  }
  const created = resolve(firstCreated);
  const parent = dirname(created);
  const distance = relative(parent, active);
  if (isAbsolute(distance) || distance === ".." || distance.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new LifecycleJournalError("JOURNAL_SYNC", "newly-created journal directory is not an ancestor of the active directory", { path: directory });
  }
  let current = active;
  while (true) {
    await syncDirectory(current);
    if (current === parent) break;
    const next = dirname(current);
    if (next === current) {
      throw new LifecycleJournalError("JOURNAL_SYNC", "could not reach the parent of the first-created journal directory", { path: directory });
    }
    current = next;
  }
}

async function createSegment(options: LifecycleJournalOptions): Promise<MutableOptions> {
  if (!isObject(options) || typeof options.directory !== "string" || options.directory.trim().length === 0) {
    throw new TypeError("lifecycle journal directory is required");
  }
  if (typeof options.dataset_id !== "string" || options.dataset_id.trim().length === 0) throw new TypeError("lifecycle journal dataset_id is required");
  if (typeof options.producer_id !== "string" || options.producer_id.trim().length === 0) throw new TypeError("lifecycle journal producer_id is required");
  const directory = options.directory;
  const max_bytes = positiveLimit(options.max_bytes, DEFAULT_LIFECYCLE_SEGMENT_BYTES, "max_bytes");
  try {
    const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncCreatedDirectories(directory, firstCreated);
  } catch (error) {
    if (error instanceof LifecycleJournalError) throw error;
    throw new LifecycleJournalError("JOURNAL_DIRECTORY", `could not create journal directory: ${errorMessage(error)}`, { path: directory, cause: error });
  }

  const epoch = randomUUID();
  const path = join(directory, `${epoch}.jsonl`);
  let file: FileHandle;
  try {
    file = await openFile(path, "wx", 0o600);
  } catch (error) {
    throw new LifecycleJournalError("JOURNAL_IO", `could not create lifecycle segment: ${errorMessage(error)}`, { path, cause: error });
  }
  const mutable: MutableOptions = { directory, dataset_id: options.dataset_id, producer_id: options.producer_id, epoch, path, file, max_bytes };
  try {
    await syncDirectory(directory);
  } catch (error) {
    await file.close().catch(() => undefined);
    throw error;
  }
  return mutable;
}

class LifecycleJournalWriter implements LifecycleJournal {
  readonly directory: string;
  readonly dataset_id: string;
  readonly producer_id: string;
  readonly epoch: string;
  private readonly path: string;
  private readonly file: FileHandle;
  private readonly max_bytes: number;
  private bytes = 0;
  private sequence = 0;
  private previous_hash: string | null = null;
  private poisoned = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | undefined;
  private readonly actionStates = new Map<string, "running" | "paused" | "ended">();

  private constructor(options: MutableOptions) {
    this.directory = options.directory;
    this.dataset_id = options.dataset_id;
    this.producer_id = options.producer_id;
    this.epoch = options.epoch;
    this.path = options.path;
    this.file = options.file;
    this.max_bytes = options.max_bytes;
  }

  static async open(options: LifecycleJournalOptions): Promise<LifecycleJournalWriter> {
    const segment = await createSegment(options);
    const writer = new LifecycleJournalWriter(segment);
    try {
      await writer.appendInternal({ kind: "epoch" }, true);
      return writer;
    } catch (error) {
      await writer.close().catch(() => undefined);
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private assertWritable(): void {
    if (this.closed) throw new LifecycleJournalError("JOURNAL_CLOSED", "lifecycle journal is closed", { path: this.path });
    if (this.poisoned) throw new LifecycleJournalError("JOURNAL_POISONED", "lifecycle journal is poisoned after a write or synchronization failure", { path: this.path, uncertain: true });
  }

  private buildEvent(data: LifecycleData): LifecycleEvent {
    const sequence = this.sequence;
    const event: LifecycleEvent = {
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      dataset_id: this.dataset_id,
      producer_id: this.producer_id,
      epoch: this.epoch,
      sequence,
      event_id: `${this.epoch}:${sequence}`,
      wall_at: new Date().toISOString(),
      monotonic_ns: process.hrtime.bigint().toString(10),
      data: clone(data),
    };
    try {
      return clone(validateLifecycleEvent(event));
    } catch (error) {
      throw invalidEvent(error);
    }
  }

  private async appendInternal(data: LifecycleData, allowEpoch = false): Promise<LifecycleEvent> {
    this.assertWritable();
    const normalized = normalizeData(data, allowEpoch);
    this.checkTransition(normalized);
    const event = this.buildEvent(normalized);
    const previous_hash = this.previous_hash;
    const hash = frameHash(event, previous_hash);
    const frame = frameBytes({ event, previous_hash, hash });
    if (this.bytes + frame.byteLength > this.max_bytes) {
      throw new LifecycleJournalError("JOURNAL_BOUNDS", `lifecycle segment would exceed max_bytes=${this.max_bytes}`, { path: this.path });
    }

    let offset = 0;
    try {
      while (offset < frame.byteLength) {
        const result = await this.file.write(frame, offset, frame.byteLength - offset, this.bytes + offset);
        if (result.bytesWritten <= 0) throw new Error("short lifecycle segment write");
        offset += result.bytesWritten;
      }
    } catch (error) {
      this.poisoned = true;
      throw new LifecycleJournalError("JOURNAL_IO", `lifecycle segment write failed: ${errorMessage(error)}`, { path: this.path, uncertain: true, cause: error });
    }
    this.bytes += frame.byteLength;
    try {
      await this.file.sync();
    } catch (error) {
      this.poisoned = true;
      throw new LifecycleJournalError("JOURNAL_DURABILITY_UNCERTAIN", `lifecycle segment synchronization failed: ${errorMessage(error)}`, { path: this.path, uncertain: true, cause: error });
    }
    this.previous_hash = hash;
    this.sequence += 1;
    this.applyTransition(event.data);
    return clone(event);
  }

  private checkTransition(data: LifecycleData): void {
    if (data.kind === "epoch") return;
    const actionId = data.action_id;
    const prior = this.actionStates.get(actionId);
    if (data.kind === "start") {
      if (prior !== undefined) throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `action ${actionId} was started more than once in this epoch`, { path: this.path });
      return;
    }
    // A late provider receipt can arrive after the action's terminal event, so
    // measurements are intentionally accepted after "ended". Phase events,
    // by contrast, need a local start to establish their ordering.
    if (data.kind === "measurement") return;
    if (prior === undefined && (data.kind === "pause" || data.kind === "resume" || data.kind === "heartbeat")) {
      throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `action ${actionId} has no local start for ${data.kind}`, { path: this.path });
    }
    if (prior === "ended") throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `action ${actionId} received ${data.kind} after its terminal event`, { path: this.path });
    if (data.kind === "pause" && prior !== "running") {
      throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `action ${actionId} cannot pause while ${prior}`, { path: this.path });
    }
    if (data.kind === "resume" && prior !== "paused") {
      throw new LifecycleJournalError("JOURNAL_EVENT_INVALID", `action ${actionId} cannot resume while ${prior}`, { path: this.path });
    }
  }

  private applyTransition(data: LifecycleData): void {
    if (data.kind === "epoch") return;
    const actionId = data.action_id;
    if (data.kind === "start") this.actionStates.set(actionId, "running");
    else if (data.kind === "pause") this.actionStates.set(actionId, "paused");
    else if (data.kind === "resume") this.actionStates.set(actionId, "running");
    else if (data.kind === "end") this.actionStates.set(actionId, "ended");
  }

  append(data: LifecycleData): Promise<LifecycleEvent> {
    let snapshot: LifecycleData;
    try {
      snapshot = clone(data);
    } catch (error) {
      return Promise.reject(invalidEvent(error));
    }
    return this.enqueue(async () => this.appendInternal(snapshot));
  }

  start(input: LifecycleActionInput): Promise<LifecycleEvent> {
    const value = clone(input);
    return this.append({
      kind: "start",
      action_id: value.action_id,
      subject: value.subject,
      ...(value.parent_id === undefined ? {} : { parent_id: value.parent_id }),
      ...(value.retry_of === undefined ? {} : { retry_of: value.retry_of }),
      ...(value.work_item_id === undefined ? {} : { work_item_id: value.work_item_id }),
      ...(value.task_id === undefined ? {} : { task_id: value.task_id }),
      ...(value.agent_id === undefined ? {} : { agent_id: value.agent_id }),
      ...(value.session_id === undefined ? {} : { session_id: value.session_id }),
      ...(value.dimensions === undefined ? {} : { dimensions: clone(value.dimensions) }),
    });
  }

  end(action_id: string, status: Exclude<UsageStatus, "running">, reason?: InterruptionReason): Promise<LifecycleEvent>;
  end(input: { action_id: string; status: Exclude<UsageStatus, "running">; reason?: InterruptionReason }): Promise<LifecycleEvent>;
  end(
    actionOrInput: string | { action_id: string; status: Exclude<UsageStatus, "running">; reason?: InterruptionReason },
    status?: Exclude<UsageStatus, "running">,
    reason?: InterruptionReason,
  ): Promise<LifecycleEvent> {
    const input = typeof actionOrInput === "string"
      ? { action_id: actionOrInput, status: status as Exclude<UsageStatus, "running">, ...(reason === undefined ? {} : { reason }) }
      : actionOrInput;
    return this.append({ kind: "end", ...clone(input) });
  }

  pause(action_id: string, reason: InterruptionReason): Promise<LifecycleEvent> {
    return this.append({ kind: "pause", action_id, reason: clone(reason) });
  }

  resume(action_id: string): Promise<LifecycleEvent> {
    return this.append({ kind: "resume", action_id });
  }

  heartbeat(action_id: string): Promise<LifecycleEvent> {
    return this.append({ kind: "heartbeat", action_id });
  }

  measurement(action_id: string, meter: UsageMeter, measurement: Omit<UsageMeasurement, "source_refs">): Promise<LifecycleEvent> {
    return this.append({ kind: "measurement", action_id, meter: clone(meter), measurement: clone(measurement) });
  }

  async withAction<T>(input: LifecycleActionInput, callback: (started: LifecycleEvent) => T | PromiseLike<T>): Promise<T> {
    const started = await this.start(input);
    const actionId = started.data.kind === "start" ? started.data.action_id : input.action_id;
    let result: T;
    try {
      result = await callback(started);
    } catch (callbackError) {
      // Preserve the callback's failure even if writing its terminal error
      // event fails; the storage failure must not be misreported as the work
      // failure. The poisoned journal remains close-only for recovery.
      try {
        await this.end(actionId, "error");
      } catch (terminalError) {
        throw new AggregateError([callbackError, terminalError], "lifecycle callback and terminal append both failed", { cause: callbackError });
      }
      throw callbackError;
    }
    // Keep terminal append failures outside the callback try/catch. A successful
    // callback followed by a failed terminal append is an uncertain lifecycle
    // record, not an error thrown by the callback.
    await this.end(actionId, "ok");
    return result;
  }

  async close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closePromise = this.enqueue(async () => {
      if (this.closed) return;
      this.closed = true;
      try {
        await this.file.sync();
      } catch (error) {
        throw new LifecycleJournalError("JOURNAL_SYNC", `lifecycle segment close synchronization failed: ${errorMessage(error)}`, { path: this.path, uncertain: this.poisoned, cause: error });
      } finally {
        await this.file.close().catch(() => undefined);
      }
    });
    return this.closePromise;
  }
}

/** Create a new exclusive segment and durably append its epoch frame before returning. */
export async function openLifecycleJournal(options: LifecycleJournalOptions): Promise<LifecycleJournal> {
  return LifecycleJournalWriter.open(options);
}

function parseFrame(line: string, path: string, expectedSequence: number, previousHash: string | null): Frame {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", `newline-terminated lifecycle frame is invalid JSON: ${errorMessage(error)}`, { path, cause: error });
  }
  if (!isObject(raw) || !exactKeys(raw, ["event", "previous_hash", "hash"]) || !isObject(raw.event) || typeof raw.previous_hash !== "string" && raw.previous_hash !== null || typeof raw.hash !== "string") {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle frame envelope is invalid", { path });
  }
  let event: LifecycleEvent;
  try {
    event = clone(validateLifecycleEvent(raw.event));
  } catch (error) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", `lifecycle event is invalid: ${errorMessage(error)}`, { path, cause: error });
  }
  const previous_hash = raw.previous_hash;
  const hash = raw.hash;
  if (!HASH.test(hash) || (previous_hash !== null && !HASH.test(previous_hash))) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle frame hash has an invalid format", { path });
  }
  if (event.sequence !== expectedSequence || event.event_id !== `${event.epoch}:${event.sequence}`) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle frame sequence or event_id is not contiguous", { path });
  }
  if (previous_hash !== previousHash) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle frame hash chain is broken", { path });
  }
  if (frameHash(event, previous_hash) !== hash) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle frame hash does not match its event", { path });
  }
  return { event, previous_hash, hash };
}

function firstFrame(bytes: Buffer, path: string): { line: string; end: number } | null {
  const newline = bytes.indexOf(0x0a);
  if (newline < 0) return null;
  try {
    return { line: UTF8_DECODER.decode(bytes.subarray(0, newline)), end: newline + 1 };
  } catch (error) {
    throw new LifecycleJournalError("JOURNAL_CORRUPT", `lifecycle frame is not valid UTF-8: ${errorMessage(error)}`, { path, cause: error });
  }
}

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_READ_ATTEMPTS = 4;

async function readAtMost(file: FileHandle, max_bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let position = 0;
  while (true) {
    const remaining = max_bytes - total;
    const requested = Math.min(READ_CHUNK_BYTES, remaining >= READ_CHUNK_BYTES ? remaining : remaining + 1);
    const buffer = Buffer.allocUnsafe(requested);
    const result = await file.read(buffer, 0, requested, position);
    if (result.bytesRead === 0) break;
    chunks.push(buffer.subarray(0, result.bytesRead));
    total += result.bytesRead;
    position += result.bytesRead;
    // The extra byte is enough to prove that the caller's bound was crossed;
    // do not read any further from a file that may be growing without limit.
    if (total > max_bytes) break;
  }
  return Buffer.concat(chunks, total);
}

/** Read a stable, bounded snapshot from an already-open segment handle. */
async function readBounded(file: FileHandle, path: string, max_bytes: number): Promise<Buffer> {
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
    let before: number;
    try {
      before = (await file.stat()).size;
    } catch (error) {
      throw new LifecycleJournalError("JOURNAL_READ", `could not stat lifecycle segment: ${errorMessage(error)}`, { path, cause: error });
    }
    if (before > max_bytes) throw new LifecycleJournalError("JOURNAL_READ_BOUND", `lifecycle segment exceeds max_bytes=${max_bytes}`, { path });

    let bytes: Buffer;
    try {
      bytes = await readAtMost(file, max_bytes);
    } catch (error) {
      throw new LifecycleJournalError("JOURNAL_READ", `could not read lifecycle segment: ${errorMessage(error)}`, { path, cause: error });
    }
    if (bytes.byteLength > max_bytes) throw new LifecycleJournalError("JOURNAL_READ_BOUND", `lifecycle segment exceeds max_bytes=${max_bytes}`, { path });

    let after: number;
    try {
      after = (await file.stat()).size;
    } catch (error) {
      throw new LifecycleJournalError("JOURNAL_READ", `could not stat lifecycle segment after read: ${errorMessage(error)}`, { path, cause: error });
    }
    if (after > max_bytes) throw new LifecycleJournalError("JOURNAL_READ_BOUND", `lifecycle segment exceeds max_bytes=${max_bytes}`, { path });
    // A growing writer can make a path-based read return a prefix that was
    // never a complete snapshot. Retry from the same handle while bounded;
    // persistent churn is surfaced rather than silently accepting that prefix.
    if (after === bytes.byteLength) return bytes;
  }
  throw new LifecycleJournalError("JOURNAL_READ", "lifecycle segment changed while reading; retry after the writer settles", { path });
}

async function readSegment(entry: Dirent, options: ReadLifecycleJournalOptions, max_bytes: number): Promise<SegmentRead> {
  const path = join(options.directory, entry.name);
  let file: FileHandle | undefined;
  let bytes: Buffer;
  try {
    file = await openFile(path, "r");
    bytes = await readBounded(file, path, max_bytes);
  } catch (error) {
    if (error instanceof LifecycleJournalError) throw error;
    throw new LifecycleJournalError("JOURNAL_READ", `could not open lifecycle segment: ${errorMessage(error)}`, { path, cause: error });
  } finally {
    if (file !== undefined) await file.close().catch(() => undefined);
  }
  const issues: LifecycleCapture["issues"] = [];
  if (bytes.length === 0) {
    issues.push({ code: "journal_empty_segment", message: `lifecycle segment ${entry.name} is empty` });
    return { events: [], issues, dataset_id: null, bytes: bytes.byteLength };
  }
  const first = firstFrame(bytes, path);
  if (first === null) {
    issues.push({ code: "journal_torn_suffix", message: `lifecycle segment ${entry.name} contains no complete newline-terminated frame; raw bytes were retained` });
    return { events: [], issues, dataset_id: null, bytes: bytes.byteLength };
  }
  let firstParsed: Frame;
  try {
    firstParsed = parseFrame(first.line, path, 0, null);
  } catch (error) {
    if (error instanceof LifecycleJournalError) throw error;
    throw new LifecycleJournalError("JOURNAL_CORRUPT", errorMessage(error), { path, cause: error });
  }
  const segmentEpoch = entry.name.slice(0, -".jsonl".length);
  if (firstParsed.event.epoch !== segmentEpoch) throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle segment filename does not match its epoch", { path });
  if (firstParsed.event.dataset_id !== options.dataset_id) return { events: [], issues: [], dataset_id: firstParsed.event.dataset_id, bytes: bytes.byteLength };
  if (firstParsed.event.data.kind !== "epoch") throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle segment must begin with an epoch frame", { path });

  const events = [firstParsed.event];
  let previousHash = firstParsed.hash;
  let expectedSequence = 1;
  let offset = first.end;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    if (newline < 0) {
      issues.push({ code: "journal_torn_suffix", message: `lifecycle segment ${entry.name} has an unterminated final suffix at byte ${offset}; raw bytes were retained` });
      break;
    }
    let line: string;
    try {
      line = UTF8_DECODER.decode(bytes.subarray(offset, newline));
    } catch (error) {
      throw new LifecycleJournalError("JOURNAL_CORRUPT", `lifecycle frame is not valid UTF-8: ${errorMessage(error)}`, { path, cause: error });
    }
    const frame = parseFrame(line, path, expectedSequence, previousHash);
    if (frame.event.dataset_id !== options.dataset_id || frame.event.epoch !== firstParsed.event.epoch || frame.event.producer_id !== firstParsed.event.producer_id) {
      throw new LifecycleJournalError("JOURNAL_CORRUPT", "lifecycle segment changes producer, dataset or epoch within one segment", { path });
    }
    events.push(frame.event);
    previousHash = frame.hash;
    expectedSequence += 1;
    offset = newline + 1;
  }
  if (bytes.byteLength > max_bytes) throw new LifecycleJournalError("JOURNAL_READ_BOUND", `lifecycle segment exceeds max_bytes=${max_bytes}`, { path });
  return { events, issues, dataset_id: firstParsed.event.dataset_id, bytes: bytes.byteLength };
}

/** Read all valid per-open segments without modifying any file. */
export async function readLifecycleJournal(options: ReadLifecycleJournalOptions): Promise<LifecycleCapture> {
  if (!isObject(options) || typeof options.directory !== "string" || options.directory.trim().length === 0) throw new TypeError("lifecycle journal directory is required");
  if (typeof options.dataset_id !== "string" || options.dataset_id.trim().length === 0) throw new TypeError("lifecycle journal dataset_id is required");
  const max_bytes = positiveLimit(options.max_bytes, DEFAULT_LIFECYCLE_READ_BYTES, "max_bytes");
  let entries: Dirent[];
  try {
    entries = await readdir(options.directory, { withFileTypes: true });
  } catch (error) {
    throw new LifecycleJournalError("JOURNAL_READ", `could not list lifecycle journal directory: ${errorMessage(error)}`, { path: options.directory, cause: error });
  }
  const segments = entries.filter((entry) => entry.isFile() && SEGMENT_NAME.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
  const events: LifecycleEvent[] = [];
  const issues: LifecycleCapture["issues"] = [];
  const eventIds = new Set<string>();
  let totalBytes = 0;
  for (const segment of segments) {
    const segmentPath = join(options.directory, segment.name);
    let segmentSize: number;
    try {
      segmentSize = (await stat(segmentPath)).size;
    } catch (error) {
      throw new LifecycleJournalError("JOURNAL_READ", `could not stat lifecycle segment: ${errorMessage(error)}`, { path: segmentPath, cause: error });
    }
    if (segmentSize > max_bytes - totalBytes) throw new LifecycleJournalError("JOURNAL_READ_BOUND", `recognized lifecycle segments exceed max_bytes=${max_bytes}`, { path: options.directory });
    const segmentLimit = Math.max(1, max_bytes - totalBytes);
    const result = await readSegment(segment, options, segmentLimit);
    totalBytes += result.bytes;
    if (totalBytes > max_bytes) throw new LifecycleJournalError("JOURNAL_READ_BOUND", `recognized lifecycle segments exceed max_bytes=${max_bytes}`, { path: options.directory });
    for (const event of result.events) {
      if (eventIds.has(event.event_id)) throw new LifecycleJournalError("JOURNAL_CORRUPT", `duplicate lifecycle event ${event.event_id}`, { path: join(options.directory, segment.name) });
      eventIds.add(event.event_id);
      events.push(clone(event));
    }
    issues.push(...result.issues);
  }
  events.sort((left, right) => left.producer_id.localeCompare(right.producer_id) || left.epoch.localeCompare(right.epoch) || left.sequence - right.sequence || left.event_id.localeCompare(right.event_id));
  return {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "lifecycle",
    dataset_id: options.dataset_id,
    events,
    issues,
  };
}
