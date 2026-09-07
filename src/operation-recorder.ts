import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile as readFileFromFs, readdir as readDirectoryFromFs, writeFile as writeFileToFs } from "node:fs/promises";
import type { PathLike } from "node:fs";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";

import type {
  OperationBundle,
  OperationClassification,
  OperationIO,
  OperationKind,
  OperationLink,
  OperationSpan,
  OperationTiming,
  RoutingDecision,
} from "./operation-types.js";
import { OPERATION_IO_MEASURES, OPERATION_KINDS } from "./operation-types.js";
import type { Source, SourceRef } from "./types.js";

const DEFAULT_MAX_SPANS = 10_000;
const OPAQUE_RESOURCE_LABEL = "opaque-resource";
const UNKNOWN_IO_METHOD = "not-captured";
const RECORDER_METHOD = "operation-recorder.run";

type QuantityInput = string | number | bigint | null | undefined;

/** Input accepted by the recorder for a measured operation descriptor. */
export type OperationIOInput = Partial<Omit<OperationIO, "measurements">> & {
  measurements?: Partial<OperationIO["measurements"]>;
};

/** A workload policy decision observed by the recorder. */
export type OperationRoutingInput = Omit<RoutingDecision, "origin"> & {
  origin?: "workload_policy";
};

export interface OperationRecorderOptions {
  dataset_id: string;
  namespace: string;
  max_spans?: number;
  max_links?: number;
  /** A caller-controlled secret used to make resource IDs stable across runs. */
  resource_key?: string | Uint8Array;
}

export interface ReadFileOptions {
  label?: string;
  start_line?: number;
  end_line?: number;
}

export interface ReadDirectoryOptions {
  label?: string;
}

export interface WriteFileOptions {
  label?: string;
}

export interface OperationRunSpec {
  kind: OperationKind;
  /** Explicit labels are published by caller choice. Omitted labels stay semantic and opaque. */
  label?: string;
  agent?: string | null;
  agent_id?: string | null;
  requesting_model?: string | null;
  executing_model?: string | null;
  /** Alias useful for model wrappers that have one model identity. */
  model?: string | null;
  observation_id?: string | null;
  classification?: OperationClassification;
  routing?: OperationRoutingInput | RoutingDecision | null;
  io?: OperationIOInput | OperationIO | null;
  /** Explicit parentage is used by integrations that cannot use the current async scope. */
  parent?: string | OperationScope | null;
  /** Alias for integrations that already use the serialized field name. */
  parent_id?: string | null;
  /** Alias used by some integrations for an external parent handle. */
  parent_operation_id?: string | null;
}

export interface OperationMetadataUpdate {
  label?: string;
  classification?: OperationClassification;
  agent?: string | null;
  agent_id?: string | null;
  requesting_model?: string | null;
  executing_model?: string | null;
  observation_id?: string | null;
  routing?: OperationRoutingInput | RoutingDecision | null;
  io?: OperationIOInput | OperationIO | null;
}

export interface OperationLinkInput {
  to_operation_id?: string | null;
  context_revision_id?: string | null;
  request_id?: string | null;
  occurrence_id?: string | null;
  evidence?: OperationLink["evidence"];
  method?: string;
  source_refs?: SourceRef[];
}

interface MutableSpan extends OperationSpan {
  readonly started_monotonic_ns: bigint;
  ended_monotonic_ns: bigint | null;
}

interface ResolvedParent {
  id: string | null;
  parentage: OperationClassification | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  return assertNonEmpty(String(value), name);
}

function classification(value: OperationClassification | undefined, fallbackMethod: string): OperationClassification {
  if (value === undefined) return { evidence: "declared", method: fallbackMethod };
  if (value === null || typeof value !== "object") throw new TypeError("operation classification must be an object");
  const evidence = value.evidence;
  if (evidence !== "observed" && evidence !== "declared" && evidence !== "derived" && evidence !== "unknown") {
    throw new TypeError("operation classification evidence is invalid");
  }
  return { evidence, method: assertNonEmpty(value.method, "operation classification method") };
}

type OperationIOMeasure = typeof OPERATION_IO_MEASURES[number];
type OperationIOMeasurementInput = Partial<Record<OperationIOMeasure, OperationClassification>>;

function unknownMeasurements(): OperationIO["measurements"] {
  return Object.fromEntries(OPERATION_IO_MEASURES.map((key) => [key, { evidence: "unknown", method: UNKNOWN_IO_METHOD }])) as OperationIO["measurements"];
}

function normalizeMeasurements(
  value: OperationIOMeasurementInput | undefined,
  fields: Partial<Record<OperationIOMeasure, string | null>> = {},
  prior?: OperationIO["measurements"],
): OperationIO["measurements"] {
  const result = prior === undefined ? unknownMeasurements() : clone(prior);
  for (const key of OPERATION_IO_MEASURES) {
    const supplied = value !== undefined && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
    if (supplied !== undefined) {
      result[key] = classification(supplied, UNKNOWN_IO_METHOD);
      continue;
    }
    // A caller-provided quantity without a fact is a declared measurement;
    // an omitted/null quantity remains explicitly unknown.
    if (fields[key] !== undefined && fields[key] !== null) {
      result[key] = { evidence: "declared", method: "caller-provided" };
    }
  }
  return result;
}

function quantity(value: QuantityInput, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
    return String(value);
  }
  if (typeof value === "bigint") {
    if (value < 0n) throw new TypeError(`${name} must be a non-negative integer`);
    return value.toString(10);
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${name} must be a canonical non-negative integer string`);
  }
  return value;
}

function lineNumber(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function requestedRange(options: ReadFileOptions): OperationIO["requested_range"] {
  const start = lineNumber(options.start_line, "start_line");
  const end = lineNumber(options.end_line, "end_line");
  if (start === undefined && end === undefined) return null;
  if (start === undefined && end !== undefined) {
    if (end < 1) throw new RangeError("end_line must be a positive integer");
    return { start_line: 1, end_line: end };
  }
  const startLine = start as number;
  if (end !== undefined && end < startLine) throw new RangeError("end_line must not precede start_line");
  return { start_line: startLine, end_line: end ?? null };
}

function pathIdentity(path: PathLike): string {
  if (typeof path === "string") return `path-bytes:${Buffer.from(path, "utf8").toString("hex")}`;
  if (path instanceof URL) {
    try { return pathIdentity(fileURLToPath(path)); }
    catch { return `invalid-url:${path.href}`; }
  }
  return `path-bytes:${path.toString("hex")}`;
}

function bytes(value: string | Uint8Array): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function excerpt(text: string, range: OperationIO["requested_range"]): string {
  if (range === null) return text;
  // Keep original line terminators so returned bytes describe the actual result.
  const lines = text.split(/(?<=\n)/);
  const first = Math.max(0, range.start_line - 1);
  const last = range.end_line === null ? lines.length : range.end_line;
  return lines.slice(first, last).join("");
}

function normalizeRouting(value: OperationRoutingInput | RoutingDecision | null | undefined): RoutingDecision | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") throw new TypeError("routing must be an object");
  if (value.origin !== undefined && value.origin !== "workload_policy") {
    throw new TypeError("routing origin must be workload_policy");
  }
  return {
    origin: "workload_policy",
    policy_id: assertNonEmpty(value.policy_id, "routing policy_id"),
    policy_version: assertNonEmpty(value.policy_version, "routing policy_version"),
    action: value.action,
    facts: clone(value.facts),
    reason: assertNonEmpty(value.reason, "routing reason"),
    requested_model: optionalText(value.requested_model, "routing requested_model"),
    selected_model: optionalText(value.selected_model, "routing selected_model"),
    evidence: value.evidence,
  };
}

function normalizeRange(value: OperationIO["requested_range"] | undefined): OperationIO["requested_range"] {
  if (value === undefined || value === null) return null;
  const start = lineNumber(value.start_line, "requested_range.start_line");
  const end = lineNumber(value.end_line ?? undefined, "requested_range.end_line");
  if (start === undefined) throw new TypeError("requested_range.start_line is required");
  if (end !== undefined && end < start) throw new RangeError("requested_range.end_line must not precede start_line");
  return { start_line: start, end_line: end ?? null };
}

function defaultIO(resourceId: string, resourceLabel: string): OperationIO {
  return {
    measurements: unknownMeasurements(),
    resource_id: resourceId,
    resource_label: resourceLabel,
    requested_range: null,
    read_bytes: null,
    returned_bytes: null,
    written_bytes: null,
    inserted_bytes: null,
    deleted_bytes: null,
    entry_count: null,
    examined_entries: null,
    content_sha256: null,
  };
}

function normalizeIO(
  value: OperationIOInput | OperationIO,
  fallbackResourceId: string,
  fallbackLabel: string,
  priorMeasurements?: OperationIO["measurements"],
): OperationIO {
  const raw = value as Partial<OperationIO>;
  const resourceId = raw.resource_id === undefined ? fallbackResourceId : assertNonEmpty(raw.resource_id, "io.resource_id");
  const resourceLabel = raw.resource_label === undefined ? fallbackLabel : assertNonEmpty(raw.resource_label, "io.resource_label");
  let readBytes = quantity(raw.read_bytes, "io.read_bytes");
  let returnedBytes = quantity(raw.returned_bytes, "io.returned_bytes");
  let writtenBytes = quantity(raw.written_bytes, "io.written_bytes");
  let insertedBytes = quantity(raw.inserted_bytes, "io.inserted_bytes");
  let deletedBytes = quantity(raw.deleted_bytes, "io.deleted_bytes");
  let entryCount = quantity(raw.entry_count, "io.entry_count");
  let examinedEntries = quantity(raw.examined_entries, "io.examined_entries");
  let contentSha256 = raw.content_sha256 === undefined || raw.content_sha256 === null
    ? null
    : assertNonEmpty(raw.content_sha256, "io.content_sha256").toLowerCase();
  const measurements = normalizeMeasurements(raw.measurements, {
    ...(raw.read_bytes === undefined ? {} : { read_bytes: readBytes }),
    ...(raw.returned_bytes === undefined ? {} : { returned_bytes: returnedBytes }),
    ...(raw.written_bytes === undefined ? {} : { written_bytes: writtenBytes }),
    ...(raw.inserted_bytes === undefined ? {} : { inserted_bytes: insertedBytes }),
    ...(raw.deleted_bytes === undefined ? {} : { deleted_bytes: deletedBytes }),
    ...(raw.entry_count === undefined ? {} : { entry_count: entryCount }),
    ...(raw.examined_entries === undefined ? {} : { examined_entries: examinedEntries }),
    ...(raw.content_sha256 === undefined ? {} : { content_sha256: contentSha256 }),
  }, priorMeasurements);
  const fields: Partial<Record<OperationIOMeasure, string | null>> = {
    ...(raw.read_bytes === undefined ? {} : { read_bytes: readBytes }),
    ...(raw.returned_bytes === undefined ? {} : { returned_bytes: returnedBytes }),
    ...(raw.written_bytes === undefined ? {} : { written_bytes: writtenBytes }),
    ...(raw.inserted_bytes === undefined ? {} : { inserted_bytes: insertedBytes }),
    ...(raw.deleted_bytes === undefined ? {} : { deleted_bytes: deletedBytes }),
    ...(raw.entry_count === undefined ? {} : { entry_count: entryCount }),
    ...(raw.examined_entries === undefined ? {} : { examined_entries: examinedEntries }),
    ...(raw.content_sha256 === undefined ? {} : { content_sha256: contentSha256 }),
  };
  // Keep a field and its evidence coherent even for a loose caller-provided
  // descriptor. Unknown evidence means unavailable, never a numeric value.
  for (const key of OPERATION_IO_MEASURES) {
    if (measurements[key].evidence === "unknown") fields[key] = null;
    else if (fields[key] === null || (fields[key] === undefined && priorMeasurements === undefined)) {
      measurements[key] = { evidence: "unknown", method: UNKNOWN_IO_METHOD };
      fields[key] = null;
    }
  }
  readBytes = fields.read_bytes ?? null;
  returnedBytes = fields.returned_bytes ?? null;
  writtenBytes = fields.written_bytes ?? null;
  insertedBytes = fields.inserted_bytes ?? null;
  deletedBytes = fields.deleted_bytes ?? null;
  entryCount = fields.entry_count ?? null;
  examinedEntries = fields.examined_entries ?? null;
  contentSha256 = fields.content_sha256 ?? null;
  return {
    measurements,
    resource_id: resourceId,
    resource_label: resourceLabel,
    requested_range: normalizeRange(raw.requested_range),
    read_bytes: readBytes,
    returned_bytes: returnedBytes,
    written_bytes: writtenBytes,
    inserted_bytes: insertedBytes,
    deleted_bytes: deletedBytes,
    entry_count: entryCount,
    examined_entries: examinedEntries,
    content_sha256: contentSha256,
  };
}

function assertHash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError("io.content_sha256 must be a SHA-256 hex digest");
  return value;
}

function initialTiming(): OperationTiming {
  return {
    started_at: { evidence: "observed", method: "Date.now" },
    ended_at: { evidence: "unknown", method: "not-ended" },
    duration_ns: { evidence: "observed", method: "process.hrtime.bigint", clock: "monotonic" },
  };
}

/** A handle passed to a run callback for updating the captured operation. */
export class OperationScope {
  readonly id: string;
  private readonly recorder: OperationRecorder;
  private readonly retained: MutableSpan | null;
  private readonly parentForChildren: string | null;

  /** @internal */
  constructor(recorder: OperationRecorder, id: string, retained: MutableSpan | null, parentForChildren: string | null) {
    this.recorder = recorder;
    this.id = id;
    this.retained = retained;
    this.parentForChildren = parentForChildren;
  }

  /** @internal */
  get retainedOperationId(): string | null {
    return this.retained?.id ?? null;
  }

  /** @internal */
  get fallbackParentId(): string | null {
    return this.parentForChildren;
  }

  bindObservation(observationId: string | null): void {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return;
    this.recorder.bindObservation(this.retained, observationId);
  }

  setIO(io: OperationIOInput | OperationIO | null): void {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return;
    this.recorder.setIO(this.retained, io);
  }

  setClassification(value: OperationClassification): void {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return;
    this.retained.classification = classification(value, RECORDER_METHOD);
  }

  setRouting(value: OperationRoutingInput | RoutingDecision | null): void {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return;
    this.retained.routing = normalizeRouting(value);
  }

  setLabel(value: string): void {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return;
    this.retained.label = assertNonEmpty(value, "operation label");
  }

  update(update: OperationMetadataUpdate): void {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return;
    if (update.label !== undefined) this.setLabel(update.label);
    if (update.classification !== undefined) this.setClassification(update.classification);
    if (update.agent !== undefined || update.agent_id !== undefined) {
      this.retained.agent_id = optionalText(update.agent_id ?? update.agent, "agent_id");
    }
    if (update.requesting_model !== undefined) this.retained.requesting_model = optionalText(update.requesting_model, "requesting_model");
    if (update.executing_model !== undefined) this.retained.executing_model = optionalText(update.executing_model, "executing_model");
    if (update.observation_id !== undefined) this.bindObservation(update.observation_id);
    if (update.routing !== undefined) this.setRouting(update.routing);
    if (update.io !== undefined) this.setIO(update.io);
  }

  linkContext(contextRevisionId: string, options: Pick<OperationLinkInput, "evidence" | "method" | "source_refs"> = {}): OperationLink | null {
    return this.link("produces_context", {
      context_revision_id: assertNonEmpty(contextRevisionId, "context revision id"),
      evidence: options.evidence,
      method: options.method ?? "scope.linkContext",
      source_refs: options.source_refs,
    });
  }

  link(kind: OperationLink["kind"], target?: string | OperationScope | OperationLinkInput | null): OperationLink | null {
    if (this.retained === null || !this.recorder.allowMutation(this.retained)) return null;
    return this.recorder.addLink(this, kind, target);
  }
}

/**
 * A bounded, zero-model-call operation recorder. It captures execution
 * metadata and measured filesystem I/O while allowing the workload to run
 * when the span cap is exhausted.
 */
export class OperationRecorder {
  readonly dataset_id: string;
  readonly namespace: string;
  readonly max_spans: number;
  readonly max_links: number;
  private readonly resourceKey: Buffer;
  private readonly artifact: Source;
  private readonly storage = new AsyncLocalStorage<OperationScope>();
  private readonly spans: MutableSpan[] = [];
  private readonly spanById = new Map<string, MutableSpan>();
  private readonly observationToSpan = new Map<string, string>();
  private readonly links: OperationLink[] = [];
  private readonly linkByKey = new Map<string, OperationLink>();
  private droppedLinks = 0;
  private readonly limitations = new Set<string>();
  private nextSequence = 0;
  private dropped = 0;

  constructor(options: OperationRecorderOptions) {
    this.dataset_id = assertNonEmpty(options.dataset_id, "dataset_id");
    this.namespace = assertNonEmpty(options.namespace, "namespace");
    const maxSpans = options.max_spans ?? DEFAULT_MAX_SPANS;
    if (!Number.isSafeInteger(maxSpans) || maxSpans < 0) throw new RangeError("max_spans must be a non-negative safe integer");
    this.max_spans = maxSpans;
    this.max_links = options.max_links ?? Math.min(maxSpans * 4, 100_000);
    if (!Number.isSafeInteger(this.max_links) || this.max_links < 0) throw new RangeError("max_links must be a non-negative safe integer");
    this.resourceKey = options.resource_key === undefined
      ? randomBytes(32)
      : Buffer.from(options.resource_key);
    if (this.resourceKey.byteLength === 0) throw new TypeError("resource_key must not be empty");
    this.artifact = {
      id: `operation-recorder:${this.namespace}`,
      harness: "flaimegraph",
      format: "operation-recorder",
      version: "0.3.0",
      coverage: "complete",
      description: "Local operation recorder metadata capture",
    };
  }

  /** Run a callback in an asynchronously inherited operation scope. */
  async run<T>(spec: OperationRunSpec, callback: (scope: OperationScope) => T | PromiseLike<T>, parent?: string | OperationScope | null): Promise<T> {
    const effectiveSpec = parent === undefined ? spec : { ...spec, parent };
    const entry = this.begin(effectiveSpec);
    return this.storage.run(entry.scope, async () => {
      try {
        const result = await callback(entry.scope);
        this.finish(entry.span, "ok");
        return result;
      } catch (error) {
        this.finish(entry.span, "error");
        throw error;
      }
    });
  }

  /** Return a detached snapshot, including spans that are still running. */
  snapshot(): OperationBundle {
    const now = process.hrtime.bigint();
    const spans = this.spans.map((span) => this.materialize(span, now));
    const running = spans.some((span) => span.status === "running");
    const limitations = [...this.limitations];
    if (running) limitations.push("capture is still running");
    return clone({
      schema_version: "0.3.0",
      dataset_id: this.dataset_id,
      artifacts: [clone(this.artifact)],
      spans,
      links: clone(this.links),
      coverage: {
        boundary: "instrumented",
        complete: this.dropped === 0 && !running && this.limitations.size === 0,
        dropped_spans: this.dropped,
        dropped_spans_by_stream: this.dropped === 0 ? {} : { [this.namespace]: this.dropped },
        dropped_links: this.droppedLinks,
        dropped_links_by_stream: this.droppedLinks === 0 ? {} : { [this.namespace]: this.droppedLinks },
        limitations,
      },
    } satisfies OperationBundle);
  }

  /** Read a UTF-8 file and report backing bytes separately from excerpt bytes. */
  async readFile(path: PathLike, options: ReadFileOptions = {}): Promise<string> {
    const range = requestedRange(options);
    const identity = this.resourceId(path);
    const resourceLabel = this.resourceLabel(identity, options.label);
    return this.run({ kind: "file_read", label: options.label ?? "file_read", classification: { evidence: "observed", method: "filesystem read wrapper" } }, async (scope) => {
      scope.setIO({
        resource_id: identity,
        resource_label: resourceLabel,
        requested_range: range,
      });
      const raw = await readFileFromFs(path);
      const text = raw.toString("utf8");
      const returned = excerpt(text, range);
      scope.setIO({
        measurements: {
          read_bytes: { evidence: "observed", method: "node:fs/promises.readFile" },
          returned_bytes: { evidence: "derived", method: "utf8-byte-length-of-returned-excerpt" },
          content_sha256: { evidence: "derived", method: "sha256-of-backing-bytes" },
        },
        read_bytes: String(raw.byteLength),
        returned_bytes: String(Buffer.byteLength(returned, "utf8")),
        content_sha256: sha256(raw),
      });
      return returned;
    });
  }

  /** Enumerate a directory and report entries observed by the scan. */
  async readDirectory(path: PathLike, options: ReadDirectoryOptions = {}): Promise<string[]> {
    const identity = this.resourceId(path);
    const resourceLabel = this.resourceLabel(identity, options.label);
    return this.run({ kind: "directory_read", label: options.label ?? "directory_read", classification: { evidence: "observed", method: "filesystem directory wrapper" } }, async (scope) => {
      scope.setIO({
        resource_id: identity,
        resource_label: resourceLabel,
        requested_range: null,
      });
      const entries = await readDirectoryFromFs(path);
      scope.setIO({
        measurements: {
          entry_count: { evidence: "observed", method: "node:fs/promises.readdir" },
          examined_entries: { evidence: "observed", method: "node:fs/promises.readdir" },
        },
        entry_count: String(entries.length),
        examined_entries: String(entries.length),
      });
      return entries;
    });
  }

  /** Write bytes to a file without retaining the data or path in the bundle. */
  async writeFile(path: PathLike, data: string | Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    const identity = this.resourceId(path);
    const resourceLabel = this.resourceLabel(identity, options.label);
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    return this.run({ kind: "file_write", label: options.label ?? "file_write", classification: { evidence: "observed", method: "filesystem write wrapper" } }, async (scope) => {
      scope.setIO({
        resource_id: identity,
        resource_label: resourceLabel,
        requested_range: null,
      });
      await writeFileToFs(path, body);
      scope.setIO({
        measurements: {
          written_bytes: { evidence: "observed", method: "node:fs/promises.writeFile" },
          content_sha256: { evidence: "derived", method: "sha256-of-written-bytes" },
        },
        written_bytes: String(body.byteLength),
        content_sha256: sha256(body),
      });
    });
  }

  /** @internal */
  bindObservation(span: MutableSpan, observationId: string | null): void {
    const normalized = optionalText(observationId, "observation_id");
    if (span.observation_id !== null && this.observationToSpan.get(span.observation_id) === span.id) this.observationToSpan.delete(span.observation_id);
    if (normalized === null) {
      span.observation_id = null;
      return;
    }
    const previous = this.observationToSpan.get(normalized);
    if (previous !== undefined && previous !== span.id) {
      this.limitations.add("duplicate observation bindings were omitted");
      span.observation_id = null;
      return;
    }
    span.observation_id = normalized;
    this.observationToSpan.set(normalized, span.id);
  }

  /** @internal */
  setIO(span: MutableSpan, value: OperationIOInput | OperationIO | null): void {
    if (value === null) {
      span.io = null;
      return;
    }
    const prior = span.io ?? defaultIO(this.opaque("unknown"), OPAQUE_RESOURCE_LABEL);
    const incoming = normalizeIO(value, prior.resource_id, prior.resource_label, prior.measurements);
    const raw = value as Partial<OperationIO>;
    const has = (key: keyof OperationIO): boolean => Object.prototype.hasOwnProperty.call(raw, key);
    const merged: OperationIO = {
      measurements: incoming.measurements,
      resource_id: has("resource_id") ? incoming.resource_id : prior.resource_id,
      resource_label: has("resource_label") ? incoming.resource_label : prior.resource_label,
      requested_range: has("requested_range") ? incoming.requested_range : prior.requested_range,
      read_bytes: has("read_bytes") ? incoming.read_bytes : prior.read_bytes,
      returned_bytes: has("returned_bytes") ? incoming.returned_bytes : prior.returned_bytes,
      written_bytes: has("written_bytes") ? incoming.written_bytes : prior.written_bytes,
      inserted_bytes: has("inserted_bytes") ? incoming.inserted_bytes : prior.inserted_bytes,
      deleted_bytes: has("deleted_bytes") ? incoming.deleted_bytes : prior.deleted_bytes,
      entry_count: has("entry_count") ? incoming.entry_count : prior.entry_count,
      examined_entries: has("examined_entries") ? incoming.examined_entries : prior.examined_entries,
      content_sha256: has("content_sha256") ? incoming.content_sha256 : prior.content_sha256,
    };
    for (const key of OPERATION_IO_MEASURES) {
      if (merged.measurements[key].evidence === "unknown") {
        merged[key] = null;
      } else if (merged[key] === null) {
        merged.measurements[key] = { evidence: "unknown", method: UNKNOWN_IO_METHOD };
      }
    }
    if (merged.content_sha256 !== null) merged.content_sha256 = assertHash(merged.content_sha256);
    span.io = merged;
  }

  /** @internal */
  allowMutation(span: OperationSpan): boolean {
    if (span.status === "running") return true;
    this.limitations.add("metadata updates after scope completion were ignored");
    return false;
  }

  /** @internal */
  addLink(scope: OperationScope, kind: OperationLink["kind"], target?: string | OperationScope | OperationLinkInput | null): OperationLink | null {
    const from = scope.retainedOperationId;
    if (from === null) return null;
    let options: OperationLinkInput;
    if (typeof target === "string") {
      options = kind === "produces_context" || kind === "consumes_context"
        ? { context_revision_id: target }
        : { to_operation_id: target };
    } else if (target instanceof OperationScope) {
      options = { to_operation_id: target.retainedOperationId };
    } else {
      options = target ?? {};
    }
    const to = options.to_operation_id ?? null;
    const nonEmpty = (value: unknown) => typeof value === "string" && value.length > 0;
    if (((kind === "depends_on" || kind === "delegates") && (to === null || to === from || !this.spanById.has(to))) ||
      (kind === "produces_context" && !nonEmpty(options.context_revision_id)) ||
      (kind === "consumes_context" && (!nonEmpty(options.context_revision_id) || !nonEmpty(options.request_id) || !nonEmpty(options.occurrence_id)))) {
      this.limitations.add("invalid operation link was not retained");
      return null;
    }
    const sourceRefs = this.linkSourceRefs(from, options.source_refs);
    const link: OperationLink = {
      source_refs: sourceRefs,
      from_operation_id: from,
      kind,
      to_operation_id: kind === "depends_on" || kind === "delegates" ? to : null,
      context_revision_id: kind === "depends_on" || kind === "delegates" ? null : options.context_revision_id ?? null,
      request_id: kind === "consumes_context" ? options.request_id ?? null : null,
      occurrence_id: kind === "consumes_context" ? options.occurrence_id ?? null : null,
      evidence: options.evidence ?? "declared",
      method: assertNonEmpty(options.method ?? "scope.link", "link method"),
    };
    const key = JSON.stringify(link);
    const existing = this.linkByKey.get(key);
    if (existing !== undefined) return clone(existing);
    if (this.links.length >= this.max_links) {
      this.droppedLinks++;
      this.limitations.add(`link cap reached at max_links=${this.max_links}`);
      return null;
    }
    this.links.push(link);
    this.linkByKey.set(key, link);
    return clone(link);
  }

  private linkSourceRefs(from: string, provided?: SourceRef[]): SourceRef[] {
    const fallback = this.spanById.get(from)?.source_refs ?? [{ source_id: this.artifact.id, record: `span:${from}` }];
    if (provided === undefined) return clone(fallback);
    const valid = Array.isArray(provided) && provided.length > 0 && provided.every((ref) =>
      ref !== null && typeof ref === "object" &&
      typeof ref.source_id === "string" && ref.source_id.length > 0 &&
      typeof ref.record === "string" && ref.record.length > 0 &&
      ref.source_id === this.artifact.id,
    );
    if (!valid) {
      this.limitations.add("unresolved link provenance was replaced with local recorder provenance");
      return clone(fallback);
    }
    return clone(provided);
  }

  private begin(spec: OperationRunSpec): { span: MutableSpan; scope: OperationScope } {
    if (!spec || typeof spec !== "object") throw new TypeError("operation spec must be an object");
    if (!(OPERATION_KINDS as readonly string[]).includes(spec.kind)) throw new TypeError("operation kind is invalid");
    const parent = this.resolveParent(spec);
    const id = `operation:${randomUUID()}`;
    const sequence = this.nextSequence++;
    const retained = this.spans.length < this.max_spans;
    if (!retained) {
      this.dropped += 1;
      this.limitations.add(`span cap reached at max_spans=${this.max_spans}`);
    }
    const scope = new OperationScope(this, id, null, parent.id);
    const now = new Date().toISOString();
    const startedMonotonic = process.hrtime.bigint();
    const initialIO = !retained || spec.io === undefined || spec.io === null
      ? null
      : normalizeIO(spec.io, this.opaque("unknown"), OPAQUE_RESOURCE_LABEL);
    if (initialIO !== null && initialIO.content_sha256 !== null) assertHash(initialIO.content_sha256);
    const initialObservation = !retained || spec.observation_id === undefined ? null : optionalText(spec.observation_id, "observation_id");
    const span: MutableSpan = {
      id,
      parent_id: parent.id,
      parentage: parent.parentage,
      stream_id: this.namespace,
      sequence,
      kind: spec.kind,
      label: spec.label === undefined ? spec.kind : assertNonEmpty(spec.label, "operation label"),
      classification: classification(spec.classification, RECORDER_METHOD),
      status: "running",
      started_at: now,
      ended_at: null,
      duration_ns: null,
      timing: initialTiming(),
      agent_id: optionalText(spec.agent_id ?? spec.agent, "agent_id"),
      requesting_model: optionalText(spec.requesting_model, "requesting_model"),
      executing_model: optionalText(spec.executing_model ?? spec.model, "executing_model"),
      observation_id: null,
      source_refs: [{ source_id: this.artifact.id, record: `span:${id}` }],
      io: initialIO,
      routing: normalizeRouting(spec.routing),
      started_monotonic_ns: startedMonotonic,
      ended_monotonic_ns: null,
    };
    if (retained) {
      this.spans.push(span);
      this.spanById.set(id, span);
      const retainedScope = new OperationScope(this, id, span, parent.id);
      // Apply the observation index after retaining the span. Duplicate IDs are
      // omitted by bindObservation so a malformed producer cannot invalidate a
      // successful workload's snapshot.
      if (initialObservation !== null) this.bindObservation(span, initialObservation);
      return { span, scope: retainedScope };
    }
    // Keep the callback fully functional. Its transient scope has no exportable identity.
    return { span, scope };
  }

  private finish(span: MutableSpan, status: "ok" | "error"): void {
    if (span.status !== "running") return;
    span.status = status;
    const endedMonotonic = process.hrtime.bigint();
    span.ended_monotonic_ns = endedMonotonic;
    // Wall-clock timestamps are display metadata; clamp clock rollback so
    // they cannot contradict the monotonic elapsed measurement.
    const startedMs = span.started_at === null ? 0 : Date.parse(span.started_at);
    span.ended_at = new Date(Math.max(Date.now(), startedMs)).toISOString();
    span.duration_ns = (endedMonotonic - span.started_monotonic_ns).toString(10);
    span.timing = {
      started_at: clone(span.timing.started_at),
      ended_at: { evidence: "observed", method: "Date.now" },
      duration_ns: { evidence: "observed", method: "process.hrtime.bigint", clock: "monotonic" },
    };
  }

  private resolveParent(spec: OperationRunSpec): ResolvedParent {
    const hasExplicit = Object.prototype.hasOwnProperty.call(spec, "parent") ||
      Object.prototype.hasOwnProperty.call(spec, "parent_id") ||
      Object.prototype.hasOwnProperty.call(spec, "parent_operation_id");
    if (hasExplicit) {
      const candidate = spec.parent !== undefined
        ? spec.parent
        : spec.parent_id !== undefined
          ? spec.parent_id
          : spec.parent_operation_id;
      const id = candidate instanceof OperationScope ? candidate.retainedOperationId : candidate;
      if (typeof id === "string" && this.spanById.has(id)) {
        return { id, parentage: { evidence: "declared", method: "explicit-parent" } };
      }
      if (candidate !== undefined && candidate !== null) {
        this.limitations.add("an explicit parent was unavailable and was omitted");
      }
      return { id: null, parentage: null };
    }
    const current = this.storage.getStore();
    if (current !== undefined) {
      const id = current.retainedOperationId ?? current.fallbackParentId;
      if (id !== null && this.spanById.has(id)) {
        return { id, parentage: { evidence: "observed", method: "runtime-scope" } };
      }
    }
    return { id: null, parentage: null };
  }

  private materialize(span: MutableSpan, now: bigint): OperationSpan {
    const end = span.ended_monotonic_ns ?? now;
    const elapsed = end >= span.started_monotonic_ns ? end - span.started_monotonic_ns : 0n;
    return {
      id: span.id,
      parent_id: span.parent_id,
      parentage: span.parentage === null ? null : clone(span.parentage),
      sequence: span.sequence,
      kind: span.kind,
      label: span.label,
      classification: clone(span.classification),
      status: span.status,
      started_at: span.started_at,
      ended_at: span.ended_at,
      duration_ns: elapsed.toString(10),
      timing: {
        started_at: clone(span.timing.started_at),
        ended_at: span.ended_at === null
          ? { evidence: "unknown", method: "not-ended" }
          : clone(span.timing.ended_at),
        duration_ns: clone(span.timing.duration_ns),
      },
      agent_id: span.agent_id,
      requesting_model: span.requesting_model,
      executing_model: span.executing_model,
      observation_id: span.observation_id,
      source_refs: clone(span.source_refs),
      io: span.io === null ? null : clone(span.io),
      routing: span.routing === null ? null : clone(span.routing),
      stream_id: span.stream_id,
    };
  }

  private opaque(resource: string): string {
    return createHmac("sha256", this.resourceKey)
      .update(this.namespace, "utf8")
      .update("\0", "utf8")
      .update(resource, "utf8")
      .digest("hex");
  }

  private resourceId(path: PathLike): string {
    return `hmac-sha256:${this.opaque(pathIdentity(path))}`;
  }

  private resourceLabel(resourceId: string, label: string | undefined): string {
    return label === undefined ? `${OPAQUE_RESOURCE_LABEL}:${resourceId.slice(-16)}` : assertNonEmpty(label, "resource label");
  }
}
