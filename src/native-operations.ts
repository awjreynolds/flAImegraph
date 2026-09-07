import { createHash, createHmac } from "node:crypto";

import type { EvidenceBundle, Source, SourceRef } from "./types.js";
import type {
  OperationBundle,
  OperationClassification,
  OperationIO,
  OperationKind,
  OperationLink,
  OperationSpan,
} from "./operation-types.js";
import {
  asRecord,
  firstString,
  isRecord,
  parseJsonInput,
  quantity,
  stableJson,
} from "./adapters/common.js";

/** The native transcripts for which the operation importer has a contract. */
export type NativeOperationHarness = "codex" | "pi";

export interface NativeOperationImportOptions {
  dataset_id: string;
  namespace: string;
  source_id?: string;
  /** A caller-controlled key makes pseudonyms stable across processes. */
  resource_key?: string | Uint8Array;
  /** Optional cost evidence from the same native input; it is never inferred by time. */
  evidence?: EvidenceBundle;
}

export class NativeOperationImportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "NativeOperationImportError";
  }
}

type Phase = "call" | "result" | "model" | "agent" | "cell" | "summary";
type MeasurementKey =
  | "read_bytes"
  | "returned_bytes"
  | "written_bytes"
  | "inserted_bytes"
  | "deleted_bytes"
  | "entry_count"
  | "examined_entries"
  | "content_sha256";

const MEASUREMENT_KEYS: readonly MeasurementKey[] = [
  "read_bytes",
  "returned_bytes",
  "written_bytes",
  "inserted_bytes",
  "deleted_bytes",
  "entry_count",
  "examined_entries",
  "content_sha256",
];

const DOMAIN = "flaimegraph/native-operations/v1";
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

interface NativeEvent {
  harness: NativeOperationHarness;
  line: number;
  pointer: string;
  phase: Phase;
  native_id?: string;
  session_id: string;
  label?: string;
  kind?: OperationKind;
  classification?: OperationClassification;
  started_at?: string | null;
  ended_at?: string | null;
  status?: OperationSpan["status"];
  agent_id?: string;
  requesting_model?: string;
  executing_model?: string;
  parent_ref?: string;
  parent_method?: string;
  requester_cell_id?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_name?: string;
  result_error?: boolean;
  result_status?: unknown;
  resource_path?: string;
  usage_observation_hint?: string;
  /** Explicit native identity for an evidence join, never derived from time. */
  response_id?: string;
}

interface MutableNativeSpan {
  span: OperationSpan;
  native_key: string;
  native_id: string;
  session_id: string;
  phases: Set<Phase>;
  call_signature?: string;
  result_signature?: string;
  model_usage_signature?: string;
  resource_path?: string;
  tool_name?: string;
  requester_cell_id?: string;
  agent_id_raw?: string;
  parent_ref?: string;
  parent_method?: string;
}

function timingFact(value: string | null, method: string): OperationClassification {
  return value === null
    ? { evidence: "unknown", method: `${method}: unavailable` }
    : { evidence: "observed", method };
}

interface EvidenceLine {
  observation_id: string;
  source_id: string;
  line: number;
}

function fail(code: string, message: string): never {
  throw new NativeOperationImportError(code, message);
}

function safeParseIssue(issue: { code: string; message: string }): string {
  const line = /\bline (\d+)\b/u.exec(issue.message)?.[1];
  return line === undefined
    ? `Native input ${issue.code} was not imported.`
    : `Native input ${issue.code} at line ${line} was not imported.`;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonEmpty(value: unknown, name: string): string {
  const result = text(value);
  if (!result) fail("NATIVE_OPTIONS", `${name} must be a non-empty string`);
  return result;
}

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function token(value: unknown): string {
  return lower(value).replace(/[^a-z0-9]+/g, "");
}

function pointer(line: number, path: string): string {
  return `line:${line}/${path.replace(/^\/+|\/+$/g, "")}`;
}

function lineFromRecord(record: string): number | undefined {
  const match = /(?:^|:)line:(\d+)(?:$|[/:])/u.exec(record);
  return match ? Number(match[1]) : undefined;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function epochMilliseconds(value: unknown): string | null {
  const parsed = quantity(value);
  if (parsed.invalid || parsed.value === null) return null;
  const milliseconds = BigInt(parsed.value);
  if (milliseconds > 8_640_000_000_000_000n) return null;
  const date = new Date(Number(milliseconds));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nativeTime(...values: unknown[]): string | null {
  for (const value of values) {
    const textual = validTimestamp(value);
    if (textual) return textual;
    const epoch = epochMilliseconds(value);
    if (epoch) return epoch;
  }
  return null;
}

function status(value: unknown, fallback: OperationSpan["status"] = "unknown"): OperationSpan["status"] {
  if (value === true) return "error";
  const normalized = token(value);
  if (!normalized) return fallback;
  if (normalized.includes("cancel") || normalized.includes("abort")) return "cancelled";
  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("denied")) return "error";
  if (normalized.includes("running") || normalized.includes("start")) return "running";
  if (normalized.includes("ok") || normalized.includes("success") || normalized.includes("complete") || normalized.includes("stop")) return "ok";
  return "unknown";
}

function safeSemanticLabel(value: string | undefined, fallback: string): string {
  if (!value || value.length > 96 || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u.test(value)) return fallback;
  return value;
}

function safeToolLabel(value: string | undefined): string {
  return safeSemanticLabel(value, "tool");
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return undefined;
}

function firstId(...values: unknown[]): string | undefined {
  return firstString(...values);
}

function quantityValue(value: unknown): string | null {
  const parsed = quantity(value);
  return parsed.invalid ? null : parsed.value;
}

function byteCount(value: unknown): string | null {
  if (typeof value === "string") return String(Buffer.byteLength(value, "utf8"));
  return null;
}

function outputValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value)) return value.output ?? value.content ?? value.result ?? value.body ?? value;
  return value;
}

function explicitEntryCount(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["entry_count", "entryCount", "entries_count", "entriesCount"]) {
    if (!(key in record)) continue;
    const parsed = quantity(record[key]);
    return parsed.invalid ? null : parsed.value;
  }
  return null;
}

function payloadFingerprint(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return createHash("sha256").update(stableJson(value)).digest("hex");
  } catch {
    return null;
  }
}

function rangeFromInput(input: Record<string, unknown> | undefined): OperationIO["requested_range"] {
  if (!input) return null;
  const start = quantityValue(input.start_line ?? input.startLine ?? input.from_line ?? input.fromLine);
  const end = quantityValue(input.end_line ?? input.endLine ?? input.to_line ?? input.toLine);
  if (start !== null || end !== null) {
    const startNumber = start === null ? 1 : Number(start);
    if (!Number.isSafeInteger(startNumber) || startNumber < 1) return null;
    const endNumber = end === null ? null : Number(end);
    if (endNumber !== null && (!Number.isSafeInteger(endNumber) || endNumber < startNumber)) return null;
    return { start_line: startNumber, end_line: endNumber };
  }
  // Pi's read tool exposes offset/limit as line coordinates. Preserve only
  // the requested range; this importer never treats it as bytes actually read.
  const offset = quantityValue(input.offset);
  const limit = quantityValue(input.limit);
  if (offset === null && limit === null) return null;
  const startNumber = offset === null ? 1 : Math.max(1, Number(offset));
  if (!Number.isSafeInteger(startNumber)) return null;
  if (limit === null) return { start_line: startNumber, end_line: null };
  const limitNumber = Number(limit);
  if (!Number.isSafeInteger(limitNumber) || limitNumber < 1) return null;
  const endNumber = startNumber + limitNumber - 1;
  return Number.isSafeInteger(endNumber) ? { start_line: startNumber, end_line: endNumber } : null;
}

function classifyTool(name: string | undefined): { kind: OperationKind; label: string; resourceLabel: string } {
  const normalized = lower(name);
  const exact = new Map<string, { kind: OperationKind; label: string; resourceLabel: string }>([
    ["read", { kind: "file_read", label: "read", resourceLabel: "file" }],
    ["read_file", { kind: "file_read", label: "read", resourceLabel: "file" }],
    ["file_read", { kind: "file_read", label: "read", resourceLabel: "file" }],
    ["open_file", { kind: "file_read", label: "read", resourceLabel: "file" }],
    ["write", { kind: "file_write", label: "write", resourceLabel: "file" }],
    ["write_file", { kind: "file_write", label: "write", resourceLabel: "file" }],
    ["file_write", { kind: "file_write", label: "write", resourceLabel: "file" }],
    ["edit", { kind: "file_write", label: "edit", resourceLabel: "file" }],
    ["edit_file", { kind: "file_write", label: "edit", resourceLabel: "file" }],
    ["apply_patch", { kind: "file_write", label: "edit", resourceLabel: "file" }],
    ["list", { kind: "directory_read", label: "list", resourceLabel: "directory" }],
    ["list_dir", { kind: "directory_read", label: "list", resourceLabel: "directory" }],
    ["directory_read", { kind: "directory_read", label: "list", resourceLabel: "directory" }],
    ["ls", { kind: "directory_read", label: "list", resourceLabel: "directory" }],
    ["search", { kind: "search", label: "search", resourceLabel: "search" }],
    ["grep", { kind: "search", label: "search", resourceLabel: "search" }],
    ["rg", { kind: "search", label: "search", resourceLabel: "search" }],
    ["ripgrep", { kind: "search", label: "search", resourceLabel: "search" }],
    ["find", { kind: "search", label: "search", resourceLabel: "search" }],
    ["file_search", { kind: "search", label: "search", resourceLabel: "search" }],
    ["test", { kind: "test", label: "test", resourceLabel: "test" }],
    ["run_test", { kind: "test", label: "test", resourceLabel: "test" }],
    ["run_tests", { kind: "test", label: "test", resourceLabel: "test" }],
    ["test_run", { kind: "test", label: "test", resourceLabel: "test" }],
    ["bash", { kind: "command", label: "command", resourceLabel: "command" }],
    ["shell", { kind: "command", label: "command", resourceLabel: "command" }],
    ["exec", { kind: "command", label: "command", resourceLabel: "command" }],
    ["local_shell", { kind: "command", label: "command", resourceLabel: "command" }],
    ["local-shell", { kind: "command", label: "command", resourceLabel: "command" }],
  ]);
  return exact.get(normalized) ?? { kind: "tool", label: safeToolLabel(name), resourceLabel: "tool" };
}

function inputRecord(event: NativeEvent): Record<string, unknown> | undefined {
  return parseObject(event.tool_input);
}

function resourcePathFor(event: NativeEvent, input: Record<string, unknown> | undefined): string | undefined {
  if (event.kind === "command" || event.kind === "tool") return undefined;
  return firstString(event.resource_path, input?.path, input?.file, input?.filename, input?.file_path, input?.filePath, input?.root, input?.directory);
}

function sourceDigest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function makeSource(harness: NativeOperationHarness, input: string, options: NativeOperationImportOptions): Source {
  const digest = sourceDigest(input);
  return {
    id: options.source_id ?? `native-operations:${harness}:${digest.slice(0, 16)}`,
    harness,
    format: harness === "codex" ? "codex-native-operations-jsonl" : "pi-native-operations-jsonl",
    version: "0.3.0",
    sha256: digest,
    coverage: "partial",
    description: "Metadata-only native operation import; command, argument, path and result bodies are omitted.",
  };
}

function measurement(value: string | null, method: string): OperationClassification {
  return value === null
    ? { evidence: "unknown", method: `${method}: unavailable` }
    : { evidence: "observed", method };
}

function measurements(values: Partial<Record<MeasurementKey, string | null>>, method: string, derived: readonly MeasurementKey[] = []): OperationIO["measurements"] {
  const derivedSet = new Set(derived);
  const result = Object.fromEntries(MEASUREMENT_KEYS.map((key) => {
    const value = values[key] ?? null;
    if (value === null) return [key, measurement(null, method)];
    return [key, { evidence: derivedSet.has(key) ? "derived" : "observed", method }];
  }));
  // OperationIO.measurements is intentionally a keyed map in v0.3. Keep the
  // cast local so this importer remains source-compatible with the pre-map
  // development snapshot while the schema is being finalized.
  return result as OperationIO["measurements"];
}

function ioFor(
  event: NativeEvent,
  resourceId: (raw: string | undefined) => string,
  existing?: OperationIO | null,
): OperationIO | null {
  if (!event.kind || !["file_read", "file_write", "directory_read", "search", "test"].includes(event.kind)) return existing ?? null;
  const input = inputRecord(event);
  const path = resourcePathFor(event, input);
  const read = existing?.read_bytes ?? null;
  const resultValue = event.phase === "result" && !event.result_error ? outputValue(event.tool_output) : undefined;
  // The captured result body is a representation; its UTF-8 length is a
  // derived fact, not a producer-reported byte count.
  const returned = existing?.returned_bytes ?? (resultValue !== undefined ? byteCount(resultValue) : null);
  // Request arguments describe intent. Native rollout records do not prove
  // that a write reached the backing filesystem, so these stay unavailable.
  const written = existing?.written_bytes ?? null;
  const inserted = existing?.inserted_bytes ?? null;
  const deleted = existing?.deleted_bytes ?? null;
  // Arbitrary result arrays may contain content blocks or messages. Only an
  // explicitly named native entry-count field is a directory measurement.
  const entryCount = existing?.entry_count ?? (event.phase === "result" && !event.result_error && event.kind === "directory_read" ? explicitEntryCount(resultValue) : null);
  const examined = existing?.examined_entries ?? null;
  // A request-supplied hash does not prove the executed write/edit or the
  // backing revision observed by the tool.
  const contentSha = existing?.content_sha256 ?? null;
  const known = path !== undefined || event.phase === "result" || written !== null || inserted !== null || deleted !== null || entryCount !== null || contentSha !== null;
  return {
    measurements: measurements({ read_bytes: read, returned_bytes: returned, written_bytes: written, inserted_bytes: inserted, deleted_bytes: deleted, entry_count: entryCount, examined_entries: examined, content_sha256: contentSha }, known ? "native structured tool fields" : "native tool fields", ["returned_bytes"]),
    resource_id: resourceId(path),
    resource_label: event.kind === "file_write" ? "file" : event.kind === "file_read" ? "file" : event.kind === "directory_read" ? "directory" : event.kind === "search" ? "search" : "test",
    requested_range: event.kind === "file_read" ? rangeFromInput(input) : existing?.requested_range ?? null,
    read_bytes: read,
    returned_bytes: returned,
    written_bytes: written,
    inserted_bytes: inserted,
    deleted_bytes: deleted,
    entry_count: entryCount,
    examined_entries: examined,
    content_sha256: contentSha,
  };
}

function mergeIO(old: OperationIO | null, next: OperationIO | null, preferNextResource = false): OperationIO | null {
  if (!old) return next;
  if (!next) return old;
  const field = <K extends keyof OperationIO>(key: K): OperationIO[K] => {
    const before = old[key];
    const after = next[key];
    if (before !== null && after !== null && stableJson(before) !== stableJson(after)) fail("NATIVE_OPERATION_CONFLICT", `Conflicting native measurement for ${String(key)}`);
    return before ?? after;
  };
  const mergedRequestedRange = field("requested_range");
  const mergedValues = {
    read_bytes: field("read_bytes"),
    returned_bytes: field("returned_bytes"),
    written_bytes: field("written_bytes"),
    inserted_bytes: field("inserted_bytes"),
    deleted_bytes: field("deleted_bytes"),
    entry_count: field("entry_count"),
    examined_entries: field("examined_entries"),
    content_sha256: field("content_sha256"),
  };
  const oldMeasurements = old.measurements as Record<MeasurementKey, OperationClassification>;
  const nextMeasurements = next.measurements as Record<MeasurementKey, OperationClassification>;
  const mergedMeasurements = Object.fromEntries(MEASUREMENT_KEYS.map((key) => [
    key,
    mergedValues[key] === null
      ? { evidence: "unknown", method: `${(nextMeasurements[key]?.method ?? oldMeasurements[key]?.method ?? "native measurement").replace(/: unavailable$/u, "")}: unavailable` }
      : nextMeasurements[key]?.evidence !== "unknown" ? nextMeasurements[key] : oldMeasurements[key]?.evidence !== "unknown" ? oldMeasurements[key] : { evidence: "observed", method: "native structured tool fields" },
  ])) as OperationIO["measurements"];
  const merged = {
    ...old,
    measurements: mergedMeasurements,
    resource_id: preferNextResource ? next.resource_id : old.resource_id,
    resource_label: old.resource_label,
    requested_range: mergedRequestedRange,
    ...mergedValues,
  };
  return merged;
}

class NativeOperationBuilder {
  private readonly spans: MutableNativeSpan[] = [];
  private readonly byKey = new Map<string, MutableNativeSpan>();
  private readonly byIdentity = new Map<string, MutableNativeSpan>();
  private readonly sequenceByStream = new Map<string, number>();
  private readonly links: OperationLink[] = [];
  private readonly limitations = new Set<string>();
  private readonly dropped: { count: number } = { count: 0 };
  private readonly droppedByStream = new Map<string, number>();
  private readonly evidenceLines: EvidenceLine[] = [];
  private readonly resourceKey: Buffer;
  private readonly source: Source;
  private readonly digest: string;
  private readonly datasetId: string;
  private readonly namespace: string;
  private readonly harness: NativeOperationHarness;

  constructor(harness: NativeOperationHarness, input: string, private readonly options: NativeOperationImportOptions) {
    this.harness = harness;
    this.datasetId = nonEmpty(options.dataset_id, "dataset_id");
    this.namespace = nonEmpty(options.namespace, "namespace");
    this.digest = sourceDigest(input);
    this.source = makeSource(harness, input, options);
    if (options.resource_key !== undefined && Buffer.from(options.resource_key).byteLength === 0) fail("NATIVE_OPTIONS", "resource_key must not be empty");
    this.resourceKey = options.resource_key === undefined
      ? createHash("sha256").update(`${DOMAIN}\0key\0${this.namespace}`).digest()
      : Buffer.from(options.resource_key);
    this.joinEvidence(options.evidence);
  }

  private pseudonym(domain: string, value: string): string {
    return createHmac("sha256", this.resourceKey).update(`${DOMAIN}\0${domain}\0${this.namespace}\0${value}`).digest("hex");
  }

  private resourceId(raw: string | undefined): string {
    return `resource:${this.pseudonym("resource", raw ?? "unknown")}`;
  }

  private agentId(raw: string | undefined): string | null {
    return raw ? `agent:${this.pseudonym("agent", raw)}` : null;
  }

  private streamId(session: string): string {
    return `stream:${this.pseudonym("stream", `${this.harness}\0${session}`)}`;
  }

  private opId(session: string, nativeId: string): string {
    return `operation:${this.harness}:${this.pseudonym("operation", `${session}\0${nativeId}`)}`;
  }

  private reserveSequence(stream: string): number {
    const value = this.sequenceByStream.get(stream) ?? 0;
    this.sequenceByStream.set(stream, value + 1);
    return value;
  }

  note(message: string): void {
    this.limitations.add(message);
  }

  drop(message: string, session = "loss"): void {
    this.dropped.count += 1;
    const stream = this.streamId(session);
    this.droppedByStream.set(stream, (this.droppedByStream.get(stream) ?? 0) + 1);
    this.limitations.add(message);
  }

  private parentRef(event: NativeEvent): string | undefined {
    const cellRef = event.requester_cell_id ? `${event.session_id}\0cell:${event.requester_cell_id}` : undefined;
    if (cellRef && event.parent_ref && cellRef !== event.parent_ref) {
      fail("NATIVE_OPERATION_CONFLICT", `Native requester cell and parent identity disagree for ${event.native_id ?? "unknown"}.`);
    }
    return cellRef ?? event.parent_ref;
  }

  private sourceRef(line: number, path: string): SourceRef {
    return { source_id: this.source.id, record: pointer(line, path) };
  }

  private kindFor(event: NativeEvent): { kind: OperationKind; label: string; classification: OperationClassification } {
    if (event.kind && event.label && event.classification) return { kind: event.kind, label: event.label, classification: event.classification };
    return { kind: "tool", label: safeToolLabel(event.tool_name), classification: { evidence: "unknown", method: "unrecognized native tool event" } };
  }

  private create(event: NativeEvent, nativeKey: string, nativeId: string): MutableNativeSpan {
    const classified = this.kindFor(event);
    const stream = this.streamId(event.session_id);
    const started = event.phase === "call" || event.phase === "cell" ? event.started_at ?? null : event.started_at ?? null;
    const ended = event.phase === "result" || event.phase === "summary" || event.phase === "agent" ? event.ended_at ?? null : event.ended_at ?? null;
    const state: MutableNativeSpan = {
      native_key: nativeKey,
      native_id: nativeId,
      session_id: event.session_id,
      phases: new Set([event.phase]),
      resource_path: event.resource_path,
      tool_name: event.tool_name,
      requester_cell_id: event.requester_cell_id,
      agent_id_raw: event.agent_id,
      parent_ref: this.parentRef(event),
      parent_method: event.parent_method,
      span: {
        id: this.opId(event.session_id, nativeId),
        parent_id: null,
        parentage: null,
        stream_id: stream,
        sequence: this.reserveSequence(stream),
        kind: classified.kind,
        label: classified.label,
        classification: classified.classification,
        status: event.status ?? (event.phase === "call" ? "running" : "unknown"),
        started_at: started,
        ended_at: ended,
        duration_ns: null,
        timing: {
          started_at: timingFact(started, "native envelope timestamp"),
          ended_at: timingFact(ended, "native envelope timestamp"),
          duration_ns: { evidence: "unknown", method: "native transcript does not provide monotonic elapsed duration", clock: "unknown" },
        },
        agent_id: this.agentId(event.agent_id),
        requesting_model: event.requesting_model ?? null,
        executing_model: event.executing_model ?? null,
        observation_id: null,
        source_refs: [this.sourceRef(event.line, event.pointer)],
        io: null,
        routing: null,
      },
    };
    this.spans.push(state);
    this.byKey.set(nativeKey, state);
    this.byIdentity.set(nativeKey, state);
    const signature = this.eventSignature(event);
    if (event.phase === "call") state.call_signature = signature;
    if (event.phase === "result") state.result_signature = signature;
    return state;
  }

  private eventSignature(event: NativeEvent): string {
    return stableJson({
      phase: event.phase,
      kind: event.kind,
      label: event.label,
      tool_name: event.tool_name,
      status: event.status,
      result_error: event.result_error,
      result_status: event.result_status,
      resource_path: event.resource_path,
      parent_ref: this.parentRef(event),
      parent_method: event.parent_method,
      requester_cell_id: event.requester_cell_id,
      agent_id: event.agent_id,
      requesting_model: event.requesting_model,
      executing_model: event.executing_model,
      started_at: event.started_at,
      ended_at: event.ended_at,
      tool_input_hash: payloadFingerprint(event.tool_input),
      tool_output_hash: payloadFingerprint(event.tool_output),
    });
  }

  private assertCompatible(state: MutableNativeSpan, event: NativeEvent): void {
    const conflict = (field: string, before: string | undefined | null, incoming: string | undefined | null): void => {
      if (before !== undefined && before !== null && incoming !== undefined && incoming !== null && before !== incoming) {
        fail("NATIVE_OPERATION_CONFLICT", `Conflicting native ${field} for ${state.span.id}.`);
      }
    };
    conflict("parent identity", state.parent_ref, this.parentRef(event));
    conflict("parent method", state.parent_method, event.parent_method);
    conflict("resource path", state.resource_path, event.resource_path);
    conflict("requester cell", state.requester_cell_id, event.requester_cell_id);
    conflict("agent identity", state.agent_id_raw, event.agent_id);
    conflict("requesting model", state.span.requesting_model, event.requesting_model);
    conflict("executing model", state.span.executing_model, event.executing_model);
    if (state.tool_name && event.tool_name && state.tool_name !== event.tool_name && state.span.kind !== event.kind) {
      fail("NATIVE_OPERATION_CONFLICT", `Conflicting native tool semantics for ${state.span.id}.`);
    }
    if (state.tool_name && event.tool_name && state.span.kind !== event.kind) {
      fail("NATIVE_OPERATION_CONFLICT", `Conflicting native tool kind for ${state.span.id}.`);
    }
  }

  private mergeMetadata(state: MutableNativeSpan, event: NativeEvent): void {
    const parent = this.parentRef(event);
    state.parent_ref ??= parent;
    state.parent_method ??= event.parent_method;
    state.resource_path ??= event.resource_path;
    state.tool_name ??= event.tool_name;
    state.requester_cell_id ??= event.requester_cell_id;
    state.agent_id_raw ??= event.agent_id;
    state.span.agent_id ??= this.agentId(event.agent_id);
    state.span.requesting_model ??= event.requesting_model ?? null;
    state.span.executing_model ??= event.executing_model ?? null;
  }

  add(event: NativeEvent): MutableNativeSpan | null {
    if (!event.native_id) {
      this.drop(`Native ${event.phase} at ${pointer(event.line, event.pointer)} has no stable native identity; it was not imported.`);
      return null;
    }
    const nativeKey = `${event.session_id}\0${event.native_id}`;
    let state = this.byKey.get(nativeKey);
    const created = state === undefined;
    if (!state) state = this.create(event, nativeKey, event.native_id);
    if (!created && (event.phase === "model") !== (state.span.kind === "model")) fail("NATIVE_OPERATION_DUPLICATE", `Native identity ${state.span.id} conflicts across model and non-model categories`);
    const signature = this.eventSignature(event);
    // Duplicate lifecycle halves are compared against their same-phase
    // signature before cross-phase metadata reconciliation. This keeps a
    // changed duplicate classified as duplicate evidence rather than making
    // the error depend on which field happened to differ first.
    if (!created && event.phase === "call" && state.phases.has("call")) {
      if (state.call_signature !== signature) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native call operation ${state.span.id}`);
      this.note(`Exact duplicate native call operation ${state.span.id} was replayed and counted once.`);
      return state;
    }
    if (!created && event.phase === "result" && state.phases.has("result")) {
      if (state.result_signature !== signature) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native result operation ${state.span.id}`);
      this.note(`Exact duplicate native result operation ${state.span.id} was replayed and counted once.`);
      return state;
    }
    if (!created) this.assertCompatible(state, event);
    if (!created && event.phase === "call") {
      if (state.phases.has("call")) {
        if (state.call_signature !== signature) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native call operation ${state.span.id}`);
        this.note(`Exact duplicate native call operation ${state.span.id} was replayed and counted once.`);
        return state;
      }
      state.call_signature = signature;
      state.phases.add("call");
      state.span.started_at = event.started_at ?? state.span.started_at;
      if (!state.phases.has("result")) state.span.status = "running";
    } else if (!created && event.phase === "result") {
      if (state.phases.has("result")) {
        if (state.result_signature !== signature) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native result operation ${state.span.id}`);
        this.note(`Exact duplicate native result operation ${state.span.id} was replayed and counted once.`);
        return state;
      }
      state.result_signature = signature;
      state.phases.add("result");
      state.span.ended_at = event.ended_at ?? state.span.ended_at;
      state.span.status = event.status ?? status(event.result_status, event.result_error ? "error" : "ok");
    } else if (!created) {
      if (event.phase === "model" && event.tool_output !== undefined) {
        const usageSignature = payloadFingerprint(event.tool_output);
        if (state.model_usage_signature !== undefined && state.model_usage_signature !== usageSignature) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native model operation ${state.span.id}`);
        state.model_usage_signature = usageSignature ?? undefined;
      }
      if (state.phases.has(event.phase)) {
        const incomingStart = event.started_at ?? null;
        const incomingEnd = event.ended_at ?? null;
        // A Pi v4 usage row and its assistant entry can carry the same entry
        // identity while only one of them has a wall-clock timestamp. Merge
        // those explicit records; two conflicting non-null times still fail.
        if (event.phase !== "model" && event.phase !== "cell" && (state.span.started_at !== incomingStart || state.span.ended_at !== incomingEnd)) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native operation ${state.span.id}`);
        if (event.phase === "cell" && ((state.span.started_at !== null && incomingStart !== null && state.span.started_at !== incomingStart) || (state.span.ended_at !== null && incomingEnd !== null && state.span.ended_at !== incomingEnd))) fail("NATIVE_OPERATION_DUPLICATE", `Conflicting duplicate native cell operation ${state.span.id}`);
        this.note(`Exact duplicate native ${event.phase} operation ${state.span.id} was replayed and counted once.`);
        state.span.started_at ??= incomingStart;
        state.span.ended_at ??= incomingEnd;
        state.span.status = event.status ?? state.span.status;
      } else {
        state.phases.add(event.phase);
        state.span.started_at = event.started_at ?? state.span.started_at;
        state.span.ended_at = event.ended_at ?? state.span.ended_at;
        state.span.status = event.status ?? state.span.status;
      }
    }
    if (created && event.phase === "model" && event.tool_output !== undefined) state.model_usage_signature = payloadFingerprint(event.tool_output) ?? undefined;
    this.mergeMetadata(state, event);
    if (event.phase === "result" && event.result_error === true) {
      const resultStatus = status(event.result_status, "error");
      if (resultStatus !== "error" && event.result_status !== undefined && event.result_status !== null) {
        fail("NATIVE_OPERATION_CONFLICT", `Native result reports both an error flag and non-error status for ${state.span.id}.`);
      }
      state.span.status = "error";
    }
    if (event.phase === "call" && state.span.kind === "tool" && event.kind !== undefined && event.kind !== "tool") {
      state.span.kind = event.kind;
      state.span.label = event.label ?? state.span.label;
      state.span.classification = event.classification ?? state.span.classification;
    }
    const ioEvent = event.phase === "result" && state.span.kind !== "tool" && event.kind === "tool"
      ? { ...event, kind: state.span.kind, tool_name: event.tool_name ?? state.tool_name, resource_path: event.resource_path ?? state.resource_path }
      : event;
    const io = ioFor(ioEvent, (raw) => this.resourceId(raw), state.span.io);
    state.span.io = mergeIO(state.span.io, io, ioEvent.resource_path !== undefined);
    const ref = this.sourceRef(event.line, event.pointer);
    if (!state.span.source_refs.some((item) => item.source_id === ref.source_id && item.record === ref.record)) state.span.source_refs.push(ref);
    return state;
  }

  addLink(from: MutableNativeSpan, kind: OperationLink["kind"], to: MutableNativeSpan): void {
    if (from.span.id === to.span.id) {
      this.note(`Native ${kind} self-edge was ignored for ${from.span.id}.`);
      return;
    }
    const link: OperationLink = {
      source_refs: from.span.source_refs.length > 0 ? [from.span.source_refs[0]!] : [],
      from_operation_id: from.span.id,
      kind,
      to_operation_id: to.span.id,
      context_revision_id: null,
      request_id: null,
      occurrence_id: null,
      evidence: "observed",
      method: "native explicit identity edge",
    };
    if (!this.links.some((old) => stableJson(old) === stableJson(link))) this.links.push(link);
  }

  private resolveParents(): void {
    for (const state of this.spans) {
      if (!state.parent_ref) {
        if (state.span.status === "running") {
          state.span.status = "unknown";
          this.note(`Native operation ${state.span.id} has no terminal result in this snapshot; status is unknown.`);
        }
        state.span.timing = {
          started_at: timingFact(state.span.started_at, "native envelope timestamp"),
          ended_at: timingFact(state.span.ended_at, "native envelope timestamp"),
          duration_ns: state.span.timing.duration_ns,
        };
        continue;
      }
      state.span.timing = {
        started_at: timingFact(state.span.started_at, "native envelope timestamp"),
        ended_at: timingFact(state.span.ended_at, "native envelope timestamp"),
        duration_ns: state.span.timing.duration_ns,
      };
      const parentKey = state.parent_ref.includes("\0") ? state.parent_ref : `${state.session_id}\0${state.parent_ref}`;
      const parent = this.byKey.get(parentKey);
      if (!parent) {
        this.note(`Explicit native parent for ${state.span.id} was not present in this snapshot; parentage remains null.`);
      } else if (parent.span.id !== state.span.id) {
        state.span.parent_id = parent.span.id;
        state.span.parentage = { evidence: "observed", method: state.parent_method ?? "native explicit parent identity" };
      }
    }
  }

  private joinEvidence(evidence: EvidenceBundle | undefined): void {
    if (!evidence) return;
    if (evidence.dataset_id !== this.options.dataset_id) {
      this.note("Evidence dataset differs from the native operation dataset; no observation IDs were joined.");
      return;
    }
    const matchingSources = new Set<string>();
    for (const source of evidence.sources) {
      if (source.sha256 === this.digest) matchingSources.add(source.id);
    }
    if (matchingSources.size === 0) {
      this.note("Evidence has no source with the exact native input digest; no observation IDs were joined.");
      return;
    }
    for (const observation of evidence.observations) {
      if (observation.kind !== "model" || observation.accounting_scope !== "direct") continue;
      for (const ref of observation.source_refs) {
        if (!matchingSources.has(ref.source_id)) continue;
        const line = lineFromRecord(ref.record);
        if (line !== undefined) this.evidenceLines.push({ observation_id: observation.id, source_id: ref.source_id, line });
      }
    }
  }

  private attachEvidence(): void {
    if (this.evidenceLines.length === 0) return;
    const directByLine = new Map<number, Set<string>>();
    for (const row of this.evidenceLines) {
      const values = directByLine.get(row.line) ?? new Set<string>();
      values.add(row.observation_id);
      directByLine.set(row.line, values);
    }
    const used = new Set<string>();
    for (const state of this.spans) {
      if (state.span.kind !== "model") continue;
      const candidates = new Set<string>();
      for (const ref of state.span.source_refs) {
        const line = lineFromRecord(ref.record);
        if (line === undefined) continue;
        for (const id of directByLine.get(line) ?? []) candidates.add(id);
      }
      if (candidates.size === 1) {
        const observationId = [...candidates][0]!;
        if (used.has(observationId)) fail("NATIVE_OPERATION_OBSERVATION_CONFLICT", `One direct observation would bind to multiple native model operations: ${observationId}`);
        state.span.observation_id = observationId;
        used.add(observationId);
      } else if (candidates.size > 1) {
        this.note(`Native model operation ${state.span.id} has ambiguous direct evidence at its source lines; observation binding remains null.`);
      }
    }
  }

  finish(): OperationBundle {
    this.resolveParents();
    this.attachEvidence();
    this.note("Native transcripts do not establish internal shell/file operations, provider retries, or complete billing coverage.");
    return structuredClone({
      schema_version: "0.3.0",
      dataset_id: this.datasetId,
      artifacts: [this.source],
      spans: this.spans.map((state) => state.span).sort((a, b) => a.stream_id < b.stream_id ? -1 : a.stream_id > b.stream_id ? 1 : a.sequence - b.sequence),
      links: this.links,
      coverage: {
        boundary: "native_transcript",
        complete: false,
        dropped_links: 0,
        dropped_links_by_stream: {},
        dropped_spans: this.dropped.count,
        dropped_spans_by_stream: Object.fromEntries([...this.droppedByStream.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
        limitations: [...this.limitations].sort(),
      },
    });
  }

  stateFor(session: string, nativeId: string): MutableNativeSpan | undefined {
    return this.byKey.get(`${session}\0${nativeId}`);
  }
}

function eventSession(harness: NativeOperationHarness, record: Record<string, unknown>, payload?: Record<string, unknown>, fallback = "default"): string {
  const explicit = firstString(
    record.session_id,
    record.sessionId,
    payload?.session_id,
    payload?.sessionId,
    record.thread_id,
    record.threadId,
    payload?.thread_id,
    payload?.threadId,
    record.rollout_id,
    record.rolloutId,
    payload?.rollout_id,
    payload?.rolloutId,
  );
  if (explicit) return explicit;
  // `fallback` is already the stored native session identity after a
  // session_meta/header. Prefix only the sentinel used when no identity was
  // present; otherwise implicit and explicit lifecycle halves share a key.
  return fallback === "default" ? `${harness}:default` : fallback;
}

function parentIdentity(record: Record<string, unknown>, payload?: Record<string, unknown>): { value?: string; method?: string } {
  const explicit = firstId(
    record.parent_operation_id,
    record.parentOperationId,
    payload?.parent_operation_id,
    payload?.parentOperationId,
    record.parent_call_id,
    record.parentCallId,
    payload?.parent_call_id,
    payload?.parentCallId,
    record.parent_tool_call_id,
    record.parentToolCallId,
    payload?.parent_tool_call_id,
    payload?.parentToolCallId,
    record.parent_inference_id,
    record.parentInferenceId,
    payload?.parent_inference_id,
    payload?.parentInferenceId,
    record.parent_code_cell_id,
    record.parentCodeCellId,
    payload?.parent_code_cell_id,
    payload?.parentCodeCellId,
    record.parent_id,
    record.parentId,
    payload?.parent_id,
    payload?.parentId,
  );
  return explicit ? { value: explicit, method: "native explicit parent identity" } : {};
}

function modelName(record: Record<string, unknown>, payload?: Record<string, unknown>): string | undefined {
  return firstString(record.model, record.model_name, record.modelName, payload?.model, payload?.model_name, payload?.modelName);
}

function eventToolName(record: Record<string, unknown>, payload?: Record<string, unknown>): string | undefined {
  return firstString(record.tool_name, record.toolName, record.name, payload?.tool_name, payload?.toolName, payload?.name);
}

function addToolEvent(builder: NativeOperationBuilder, event: NativeEvent): void {
  const tool = classifyTool(event.tool_name);
  event.kind = tool.kind;
  event.label = tool.label;
  event.classification = { evidence: "observed", method: "native tool name/type" };
  const input = inputRecord(event);
  event.resource_path = resourcePathFor(event, input);
  builder.add(event);
}

function addModelEvent(builder: NativeOperationBuilder, event: NativeEvent): void {
  event.kind = "model";
  event.label = "model";
  event.classification = { evidence: "observed", method: "native model/inference lifecycle" };
  builder.add(event);
}

function parseLegacyCodex(builder: NativeOperationBuilder, line: number, record: Record<string, unknown>, sessionState: { value: string }): void {
  const type = lower(record.type);
  const payload = asRecord(record.payload) ?? record;
  if (type === "session_meta") {
    const session = firstId(record.session_id, record.sessionId, payload.session_id, payload.sessionId, payload.id);
    if (session) sessionState.value = session;
    return;
  }
  const session = eventSession("codex", record, payload, sessionState.value);
  const time = nativeTime(record.timestamp, record.wall_time_unix_ms, payload.timestamp, payload.wall_time_unix_ms);
  const parent = parentIdentity(record, payload);
  if (type === "response_item") {
    const item = asRecord(payload.item) ?? payload;
    const itemType = lower(item.type);
    const itemPointer = payload.item ? "payload/item" : "payload";
    if (["function_call", "custom_tool_call", "web_search_call", "mcp_tool_call", "computer_call", "tool_search_call", "local_shell_call"].includes(itemType)) {
      const callId = firstId(item.call_id, item.callId, itemType === "local_shell_call" ? item.id : undefined);
      if (!callId) {
        builder.drop(`Codex ${itemType} at ${pointer(line, itemPointer)} has no validated native call_id.`);
        return;
      }
      const name = eventToolName(item);
      const requester = firstRecord(item.requester, payload.requester);
      const requesterCell = firstId(requester?.runtime_cell_id, requester?.runtimeCellId);
      addToolEvent(builder, {
        harness: "codex", line, pointer: itemPointer, phase: "call", native_id: callId, session_id: session,
        started_at: time, ended_at: null, status: itemType === "local_shell_call" ? status(item.status, "unknown") : "running",
        tool_name: itemType === "local_shell_call" ? "local_shell" : name, tool_input: item.input ?? item.arguments ?? item.action,
        requesting_model: firstString(item.requesting_model, payload.requesting_model), requester_cell_id: requesterCell,
        parent_ref: parent.value, parent_method: parent.method,
      });
      if (itemType === "local_shell_call" && status(item.status, "unknown") !== "running") return;
      return;
    }
    if (["function_call_output", "custom_tool_call_output", "local_shell_call_output"].includes(itemType)) {
      const callId = firstId(item.call_id, item.callId);
      if (!callId) {
        builder.drop(`Codex ${itemType} at ${pointer(line, itemPointer)} has no validated native call_id.`);
        return;
      }
      addToolEvent(builder, {
        harness: "codex", line, pointer: itemPointer, phase: "result", native_id: callId, session_id: session,
        ended_at: time, tool_name: firstString(item.name), tool_output: item.output,
        result_error: item.success === false || item.is_error === true || item.isError === true,
        result_status: item.status, status: item.success === false || item.is_error === true || item.isError === true ? "error" : status(item.status, "ok"),
        parent_ref: parent.value, parent_method: parent.method,
      });
      return;
    }
    // A response item's `id` identifies the emitted output item, not the model
    // execution that produced it. Only an explicit response, inference or
    // request identity can bind this output to a model operation (for example,
    // a usage row with the same response_id); never promote the item ID into an
    // execution ID.
    if (["message", "reasoning", "agent_message"].includes(itemType)) {
      const responseId = firstId(
        item.response_id, item.responseId, item.inference_id, item.inferenceId, item.request_id, item.requestId,
        payload.response_id, payload.responseId, payload.inference_id, payload.inferenceId, payload.request_id, payload.requestId,
        record.response_id, record.responseId, record.inference_id, record.inferenceId, record.request_id, record.requestId,
      );
      if (responseId) addModelEvent(builder, { harness: "codex", line, pointer: itemPointer, phase: "model", native_id: responseId, response_id: responseId, session_id: session, started_at: null, ended_at: time, executing_model: modelName(record, payload), parent_ref: parent.value, parent_method: parent.method });
      else builder.note(`Codex response item at ${pointer(line, itemPointer)} has no explicit response identity; it was omitted from model execution capture.`);
      return;
    }
    return;
  }
  if (type === "token_usage_record" || type === "response_usage" || type === "usage_record") {
    const usage = asRecord(payload.usage) ?? asRecord(record.usage);
    const id = firstId(payload.response_id, payload.responseId, record.response_id, record.responseId, payload.id, record.id);
    if (!id) {
      builder.drop(`Codex ${type} at ${pointer(line, "payload")} has no response identity; usage was not turned into an operation.`);
      return;
    }
    addModelEvent(builder, { harness: "codex", line, pointer: "payload", phase: "model", native_id: id, response_id: id, session_id: session, executing_model: modelName(record, payload), ended_at: time, parent_ref: parent.value, parent_method: parent.method, tool_output: usage });
    return;
  }
  if (type === "event_msg" && token(payload.type) === "tokencount") {
    builder.note(`Codex token-count snapshot at ${pointer(line, "payload")} is accounting metadata, not an execution operation; it was skipped.`);
  }
  if (type === "inter_agent_communication_metadata") parseAgentEdge(builder, line, "payload", record, payload);
}

function parseAgentEdge(builder: NativeOperationBuilder, line: number, path: string, record: Record<string, unknown>, payload: Record<string, unknown>): void {
  const edge = firstRecord(payload.agent_result_observed, payload.agentResultObserved, payload.agent_thread, payload.agentThread) ?? payload;
  const child = firstId(edge.child_thread_id, edge.childThreadId, edge.agent_thread_id, edge.agentThreadId, payload.child_thread_id, payload.childThreadId, record.child_thread_id);
  const parent = firstId(edge.parent_thread_id, edge.parentThreadId, payload.parent_thread_id, payload.parentThreadId, record.parent_thread_id, record.parentThreadId);
  if (!child && !parent) return;
  const session = eventSession("codex", record, payload, `agent:${line}`);
  const time = nativeTime(record.timestamp, record.wall_time_unix_ms, payload.timestamp, payload.wall_time_unix_ms);
  const makeAgent = (id: string): MutableNativeSpan | null => builder.add({ harness: "codex", line, pointer: path, phase: "agent", native_id: `agent-thread:${id}`, session_id: session, started_at: time, ended_at: null, status: "ok", kind: "agent", label: "agent", classification: { evidence: "observed", method: "native explicit agent thread identity" }, agent_id: id });
  const childSpan = child ? makeAgent(child) : null;
  const parentSpan = parent ? makeAgent(parent) : null;
  if (childSpan && parentSpan) builder.addLink(parentSpan, "delegates", childSpan);
}

function parseCurrentCodex(builder: NativeOperationBuilder, line: number, record: Record<string, unknown>): void {
  const payload = asRecord(record.payload) ?? record;
  const kind = token(payload.type ?? payload.event_type ?? payload.eventType ?? record.type);
  const session = eventSession("codex", record, payload, "default");
  const start = nativeTime(payload.started_at, payload.startedAt, payload.start_time, payload.startTime, record.started_at, record.startedAt, record.wall_time_unix_ms);
  const end = nativeTime(payload.completed_at, payload.completedAt, payload.ended_at, payload.endedAt, payload.end_time, payload.endTime, record.completed_at, record.completedAt, record.wall_time_unix_ms);
  const parent = parentIdentity(record, payload);
  const data = firstRecord(payload.tool_call, payload.toolCall, payload.inference, payload.code_cell, payload.codeCell, payload.terminal_operation, payload.terminalOperation) ?? payload;
  if (kind.includes("agentresultobserved") || kind.includes("agentthreadstarted") || kind.includes("threadspawn")) {
    parseAgentEdge(builder, line, "payload", record, payload);
    return;
  }
  if (kind === "codecellstarted" || kind === "codecellended" || kind === "codecellstart" || kind === "codecellend") {
    const id = firstId(data.runtime_cell_id, data.runtimeCellId, data.code_cell_id, data.codeCellId, data.cell_id, data.cellId, data.id);
    if (!id) { builder.drop(`Codex ${kind} at ${pointer(line, "payload")} has no runtime cell identity.`); return; }
    builder.add({ harness: "codex", line, pointer: "payload", phase: "cell", native_id: `cell:${id}`, session_id: session, started_at: kind.includes("started") || kind.endsWith("start") ? start : null, ended_at: kind.includes("ended") || kind.endsWith("end") ? end : null, status: kind.includes("ended") || kind.endsWith("end") ? status(data.status, "ok") : "running", kind: "phase", label: "code_cell", classification: { evidence: "observed", method: "native code-cell lifecycle" }, parent_ref: parent.value, parent_method: parent.method });
    return;
  }
  if (kind === "toolcallstarted" || kind === "toolcallstart" || kind === "toolcallcompleted" || kind === "toolcallcomplete" || kind === "toolcallfailed" || kind === "toolcallended" || kind === "toolcallend") {
    const id = firstId(data.call_id, data.callId, data.tool_call_id, data.toolCallId, data.id);
    if (!id) { builder.drop(`Codex ${kind} at ${pointer(line, "payload")} has no validated native tool identity.`); return; }
    const requesterRaw = firstRecord(data.requester, payload.requester);
    const requester = firstRecord(requesterRaw?.code_cell, requesterRaw?.CodeCell, requesterRaw?.codeCell) ?? requesterRaw;
    const requesterCell = firstId(requester?.runtime_cell_id, requester?.runtimeCellId);
    const call = kind.includes("started") || kind.endsWith("start");
    addToolEvent(builder, { harness: "codex", line, pointer: "payload", phase: call ? "call" : "result", native_id: id, session_id: session, started_at: call ? start : null, ended_at: call ? null : end, tool_name: eventToolName(data), tool_input: data.input ?? data.arguments, tool_output: data.output ?? data.result, result_error: kind.includes("failed") || data.success === false || data.is_error === true, result_status: data.status, status: call ? "running" : kind.includes("failed") ? "error" : status(data.status, "ok"), requester_cell_id: requesterCell, parent_ref: parent.value, parent_method: parent.method });
    return;
  }
  if (kind === "inferencestarted" || kind === "inferencecompleted" || kind === "inferencefailed" || kind === "inferenceended") {
    const id = firstId(data.inference_id, data.inferenceId, data.response_id, data.responseId, data.request_id, data.requestId, data.id);
    if (!id) { builder.drop(`Codex ${kind} at ${pointer(line, "payload")} has no validated inference identity.`); return; }
    const started = kind === "inferencestarted";
    addModelEvent(builder, { harness: "codex", line, pointer: "payload", phase: started ? "call" : "result", native_id: id, response_id: firstId(data.response_id, data.responseId, id), session_id: session, started_at: started ? start : null, ended_at: started ? null : end, status: started ? "running" : kind === "inferencefailed" ? "error" : "ok", executing_model: modelName(data, payload), parent_ref: parent.value, parent_method: parent.method });
    return;
  }
  if (kind === "terminaloperationstarted" || kind === "terminaloperationcompleted" || kind === "terminaloperationfailed" || kind === "terminaloperationended") {
    const id = firstId(data.terminal_operation_id, data.terminalOperationId, data.operation_id, data.operationId, data.id);
    if (!id) { builder.drop(`Codex ${kind} at ${pointer(line, "payload")} has no validated terminal identity.`); return; }
    addToolEvent(builder, { harness: "codex", line, pointer: "payload", phase: kind.includes("started") ? "call" : "result", native_id: id, session_id: session, started_at: kind.includes("started") ? start : null, ended_at: kind.includes("started") ? null : end, tool_name: "shell", tool_output: data.output ?? data.result, result_error: kind.includes("failed"), status: kind.includes("started") ? "running" : kind.includes("failed") ? "error" : "ok", parent_ref: parent.value, parent_method: parent.method });
  }
}

function piMessage(builder: NativeOperationBuilder, line: number, path: string, record: Record<string, unknown>, entry: Record<string, unknown>, session: string): void {
  const message = asRecord(entry.message) ?? entry;
  const role = lower(message.role);
  const time = nativeTime(message.timestamp, message.time, entry.timestamp, record.timestamp);
  const parent = firstId(entry.parentId, entry.parent_id, message.parentId, message.parent_id);
  if (role === "assistant" || role === "model") {
    const id = firstId(entry.id, message.id, message.message_id, message.messageId);
    if (id) addModelEvent(builder, { harness: "pi", line, pointer: path, phase: "model", native_id: id, response_id: id, session_id: session, started_at: null, ended_at: time, status: "ok", executing_model: firstString(message.model), parent_ref: parent, parent_method: parent ? "native explicit message parent identity" : undefined });
    else builder.drop(`Pi assistant message at ${pointer(line, path)} has no stable native identity.`);
    const content = message.content;
    if (Array.isArray(content)) for (let index = 0; index < content.length; index += 1) {
      const item = asRecord(content[index]);
      if (!item || !["toolcall", "tool_call"].includes(token(item.type))) continue;
      const callId = firstId(item.id, item.toolCallId, item.tool_call_id);
      if (!callId) { builder.drop(`Pi tool call at ${pointer(line, `${path}/message/content/${index}`)} has no validated native call identity.`); continue; }
      addToolEvent(builder, { harness: "pi", line, pointer: `${path}/message/content/${index}`, phase: "call", native_id: callId, session_id: session, started_at: time, tool_name: firstString(item.name, item.toolName), tool_input: item.arguments ?? item.input, requesting_model: firstString(message.model), parent_ref: parent, parent_method: parent ? "native explicit message parent identity" : undefined });
    }
  } else if (role === "toolresult" || role === "tool_result" || role === "tool") {
    const callId = firstId(message.toolCallId, message.tool_call_id, entry.toolCallId, entry.tool_call_id);
    if (!callId) { builder.drop(`Pi tool result at ${pointer(line, path)} has no validated native call identity.`); return; }
    addToolEvent(builder, { harness: "pi", line, pointer: path, phase: "result", native_id: callId, session_id: session, ended_at: time, tool_name: firstString(message.toolName, message.tool_name, entry.toolName, entry.tool_name), tool_output: message.content ?? message.output ?? message.result, result_error: message.isError === true || message.is_error === true, result_status: message.status, status: message.isError === true || message.is_error === true ? "error" : status(message.status, "ok"), parent_ref: parent, parent_method: parent ? "native explicit message parent identity" : undefined });
  }
}

function parsePi(builder: NativeOperationBuilder, line: number, record: Record<string, unknown>, sessionState: { value: string }): void {
  const headerSession = firstString(record.sessionId, record.session_id);
  if (token(record.kind) === "header" || record.v === 4) { if (headerSession) sessionState.value = headerSession; return; }
  const session = headerSession ?? sessionState.value;
  const kind = token(record.kind ?? record.type);
  if (kind === "transaction") {
    const writes = Array.isArray(record.writes) ? record.writes : [];
    for (let index = 0; index < writes.length; index += 1) {
      const write = asRecord(writes[index]);
      if (!write) continue;
      const writeKind = token(write.kind);
      const entry = asRecord(write.entry);
      const row = asRecord(write.row);
      if (writeKind === "entry" && entry) piMessage(builder, line, `writes/${index}/entry`, record, entry, session);
      else if (writeKind === "usage" && row) {
        const id = firstId(row.entryId, row.entry_id, row.id);
        if (!id) { builder.drop(`Pi usage row at ${pointer(line, `writes/${index}/row`)} has no stable entry identity.`); continue; }
        addModelEvent(builder, { harness: "pi", line, pointer: `writes/${index}/row`, phase: "model", native_id: id, response_id: id, session_id: session, executing_model: firstString(row.model), ended_at: nativeTime(row.timestamp, record.timestamp) });
      }
    }
    return;
  }
  if (kind === "message" || kind === "entry") { piMessage(builder, line, "message", record, record, session); return; }
  if (kind === "tool_call" || kind === "toolcall") {
    const id = firstId(record.toolCallId, record.tool_call_id, record.id);
    if (!id) { builder.drop(`Pi tool call at ${pointer(line, "record")} has no validated native call identity.`); return; }
    addToolEvent(builder, { harness: "pi", line, pointer: "record", phase: "call", native_id: id, session_id: session, started_at: nativeTime(record.timestamp, record.time), tool_name: firstString(record.toolName, record.tool_name, record.name), tool_input: record.input ?? record.arguments, requesting_model: firstString(record.model), parent_ref: firstId(record.parentId, record.parent_id), parent_method: "native explicit parent identity" });
    return;
  }
  if (kind === "tool_result" || kind === "toolresult") {
    const id = firstId(record.toolCallId, record.tool_call_id, record.callId, record.call_id);
    if (!id) { builder.drop(`Pi tool result at ${pointer(line, "record")} has no validated native call identity.`); return; }
    addToolEvent(builder, { harness: "pi", line, pointer: "record", phase: "result", native_id: id, session_id: session, ended_at: nativeTime(record.timestamp, record.time), tool_name: firstString(record.toolName, record.tool_name, record.name), tool_output: record.content ?? record.output ?? record.result, result_error: record.isError === true || record.is_error === true, status: record.isError === true || record.is_error === true ? "error" : status(record.status, "ok") });
    return;
  }
  if (kind === "compaction" || kind === "compact") {
    const id = firstId(record.id, record.compactionId, record.compaction_id);
    if (id) builder.add({ harness: "pi", line, pointer: "record", phase: "summary", native_id: `compaction:${id}`, session_id: session, started_at: nativeTime(record.timestamp), ended_at: nativeTime(record.timestamp), status: "ok", kind: "summary", label: "compaction", classification: { evidence: "observed", method: "native compaction lifecycle" } });
  }
}

/**
 * Import Codex rollout or Pi transcript records into the v0.3 operation sidecar.
 * The importer reads only typed metadata and exact lifecycle IDs. It never
 * parses shell commands, arbitrary tool arguments, file contents or outputs.
 */
export function importNativeOperations(
  harness: NativeOperationHarness,
  input: string,
  options: NativeOperationImportOptions,
): OperationBundle {
  if (harness !== "codex" && harness !== "pi") fail("NATIVE_HARNESS", `Unsupported native operation harness ${String(harness)}`);
  if (typeof input !== "string") fail("NATIVE_INPUT", "Native operation input must be a string");
  const parsed = parseJsonInput(input);
  const builder = new NativeOperationBuilder(harness, input, options);
  for (const issue of parsed.issues) builder.drop(safeParseIssue(issue));
  if (harness === "codex") {
    const sessionState = { value: "default" };
    for (const item of parsed.records) {
      const record = item.value;
      const current = record.schema_version !== undefined || record.wall_time_unix_ms !== undefined || token(record.type) === "rawtraceevent";
      if (current) parseCurrentCodex(builder, item.line, record);
      else parseLegacyCodex(builder, item.line, record, sessionState);
    }
  } else {
    const sessionState = { value: "pi:default" };
    for (const item of parsed.records) parsePi(builder, item.line, item.value, sessionState);
  }
  return builder.finish();
}
