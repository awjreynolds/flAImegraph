import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Ajv, type ErrorObject } from "ajv";

import { importEvidence } from "./adapters/index.js";
import { CoreError, reconcileEvidence, validateEvidence } from "./core.js";
import type {
  EvidenceBundle,
  ImportOptions,
  Observation,
  Source,
} from "./types.js";
import type {
  CaptureDescriptor,
  CaptureHarness,
  CaptureImportOptions,
  CaptureOptions,
  CaptureState,
  CaptureCursor,
} from "./capture-types.js";

const SCHEMA_VERSION = "0.2.0" as const;
const NATIVE_ID_HASH = "native_id_hash";
const LINEAGE_NATIVE_HASHES = "flAImegraph.lineage.native_id_hashes";
const LINEAGE_PARENT_HASHES = "flAImegraph.lineage.parent_id_hashes";
const LINEAGE_PARENT_OBSERVATION = "flAImegraph.lineage.parent_observation_id";

type JsonObject = Record<string, unknown>;

interface FramedInput {
  bytes: Buffer;
  sha256: string;
  record_count: string;
}

const stateSchema = JSON.parse(readFileSync(new URL("../spec/0.2/schemas/capture-state.schema.json", import.meta.url), "utf8")) as JsonObject;
const stateValidator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false }).compile(stateSchema);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Reflect.ownKeys(value as object)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[child]);
    }
    Object.freeze(value);
  }
  return value;
}

function fail(code: string, message: string, details?: unknown): never {
  throw new CoreError(code, message, details);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("CAPTURE_INVALID_OPTIONS", `${label} must be a non-empty string`);
  }
  return value;
}

function counter(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail("CAPTURE_STATE_INVALID", `${label} must be a canonical non-negative integer string`);
  }
  return value;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareCounters(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function schemaMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).slice(0, 3).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ") || "schema validation failed";
}

/** Parse and hash complete physical JSONL frames before invoking a permissive adapter. */
function inspectJsonl(input: string): FramedInput {
  if (typeof input !== "string") fail("CAPTURE_INVALID_INPUT", "capture input must be a string");
  const bytes = Buffer.from(input, "utf8");
  if (bytes.length === 0) fail("CAPTURE_EMPTY_INPUT", "capture input contains no JSONL frames");

  let records = 0;
  for (const [index, rawLine] of input.split("\n").entries()) {
    const line = index + 1;
    const text = rawLine.trim();
    if (text.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const code = index === input.split("\n").length - 1 && !input.endsWith("\n")
        ? "CAPTURE_INCOMPLETE_TAIL"
        : "CAPTURE_MALFORMED_JSONL";
      fail(code, `JSONL frame ${line} is incomplete or malformed`, error);
    }
    if (!isObject(value)) {
      fail("CAPTURE_INVALID_FRAME", `JSONL frame ${line} must be a JSON object`);
    }
    records += 1;
  }
  if (records === 0) fail("CAPTURE_EMPTY_INPUT", "capture input contains no JSONL frames");
  return { bytes, sha256: sha256(bytes), record_count: String(records) };
}

function normalizeOptions(options: CaptureOptions): {
  harness: CaptureHarness;
  capture_namespace: string;
  dataset_id: string;
  sequence?: string;
  import_options: CaptureImportOptions;
} {
  if (!isObject(options)) fail("CAPTURE_INVALID_OPTIONS", "capture options must be an object");
  if ("source_id" in options) {
    fail("CAPTURE_INVALID_OPTIONS", "source_id is derived from the accepted artifact and cannot be supplied for capture");
  }
  const allowed = new Set(["harness", "capture_namespace", "dataset_id", "version", "work_item_id", "agent_id", "sequence"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail("CAPTURE_INVALID_OPTIONS", `unknown capture option ${key}`);
  }
  const harness = options.harness;
  if (harness !== "codex" && harness !== "pi") {
    fail("CAPTURE_UNSUPPORTED_HARNESS", `append-only capture does not support harness ${String(harness)}`);
  }
  const capture_namespace = nonEmpty(options.capture_namespace, "capture_namespace");
  const dataset_id = nonEmpty(options.dataset_id, "dataset_id");
  const sequence = options.sequence === undefined ? undefined : counter(options.sequence, "sequence");
  const import_options: CaptureImportOptions = {};
  for (const key of ["version", "work_item_id", "agent_id"] as const) {
    const value = options[key];
    if (value !== undefined) import_options[key] = nonEmpty(value, key);
  }
  return { harness, capture_namespace, dataset_id, sequence, import_options };
}

function streamOptions(options: CaptureImportOptions): CaptureImportOptions {
  const result: CaptureImportOptions = {};
  for (const key of ["version", "work_item_id", "agent_id"] as const) {
    if (options[key] !== undefined) result[key] = options[key];
  }
  return result;
}

function sameStreamOptions(left: CaptureImportOptions, right: CaptureImportOptions): boolean {
  return JSON.stringify(streamOptions(left)) === JSON.stringify(streamOptions(right));
}

function sourceFor(bundle: EvidenceBundle): Source {
  const source = bundle.sources[0];
  if (!source || typeof source.sha256 !== "string") {
    fail("CAPTURE_IMPORT_INVALID", "capture importer did not return a hashed source artifact");
  }
  return source;
}

function captureSourceId(harness: CaptureHarness, digest: string): string {
  return `${harness}:${digest.slice(0, 16).toLowerCase()}`;
}

function captureDescriptorId(harness: CaptureHarness, namespace: string, sequence: string, digest: string): string {
  return `capture:${harness}:${createHash("sha256").update(`${namespace}\0${sequence}\0${digest.toLowerCase()}`).digest("hex").slice(0, 32)}`;
}

function lineFromSourceRef(observation: Observation): string {
  const record = observation.source_refs[0]?.record ?? "";
  const match = /:line:([0-9]+)$/.exec(record);
  return match?.[1] ?? "unknown";
}

function captureObservationId(harness: CaptureHarness, namespace: string, identity: string): string {
  const digest = createHash("sha256").update(`${harness}\0${namespace}\0${identity}`).digest("hex").slice(0, 32);
  return `${harness}:capture:observation:${digest}`;
}

/** Re-key source-scoped adapter observations into one capture namespace. */
function canonicalizeBundle(bundle: EvidenceBundle, harness: CaptureHarness, namespace: string): EvidenceBundle {
  const result = clone(bundle);
  const idMap = new Map<string, string>();
  const used = new Map<string, string>();
  const fallbackOrdinals = new Map<string, number>();

  for (const observation of result.observations) {
    const attrs = observation.attributes ?? {};
    const nativeHash = typeof attrs[NATIVE_ID_HASH] === "string"
      ? attrs[NATIVE_ID_HASH]
      : typeof attrs[LINEAGE_NATIVE_HASHES] === "string"
        ? attrs[LINEAGE_NATIVE_HASHES].split(",")[0]
        : undefined;
    let identity = nativeHash;
    if (!identity) {
      const line = lineFromSourceRef(observation);
      const ordinal = fallbackOrdinals.get(line) ?? 0;
      fallbackOrdinals.set(line, ordinal + 1);
      identity = `verified-prefix-coordinate:${line}:${ordinal}`;
    }
    const id = captureObservationId(harness, namespace, identity);
    const prior = used.get(id);
    if (prior && prior !== observation.id) {
      fail("CAPTURE_ID_COLLISION", `capture identity ${identity} maps multiple observations`, { id, prior, current: observation.id });
    }
    used.set(id, observation.id);
    idMap.set(observation.id, id);
    observation.id = id;
    observation.attributes = {
      ...attrs,
      "flAImegraph.capture_namespace": namespace,
      "flAImegraph.capture_identity_basis": "native_or_verified_prefix_coordinate",
    };
  }

  for (const observation of result.observations) {
    if (observation.parent_id) observation.parent_id = idMap.get(observation.parent_id) ?? observation.parent_id;
    const attrs = observation.attributes;
    if (attrs && typeof attrs[LINEAGE_PARENT_OBSERVATION] === "string") {
      const mapped = idMap.get(attrs[LINEAGE_PARENT_OBSERVATION]);
      if (mapped) attrs[LINEAGE_PARENT_OBSERVATION] = mapped;
    }
  }
  result.relationships = result.relationships.map((relationship) => ({
    ...relationship,
    from: idMap.get(relationship.from) ?? relationship.from,
    to: idMap.get(relationship.to) ?? relationship.to,
  }));
  result.issues = result.issues.map((issue) => ({
    ...issue,
    ...(issue.observation_id && idMap.has(issue.observation_id) ? { observation_id: idMap.get(issue.observation_id) } : {}),
  }));
  return result;
}

function withoutLineage(bundle: EvidenceBundle): EvidenceBundle {
  const result = clone(bundle);
  for (const observation of result.observations) delete observation.parent_id;
  result.issues = result.issues.filter((issue) => !issue.code.startsWith("lineage_parent_"));
  return result;
}

function addLineageIssue(bundle: EvidenceBundle, observation: Observation, code: string, detail: string): void {
  bundle.issues.push({
    code,
    message: `Native parent lineage for observation ${observation.id} ${detail}; it remains hashed in adapter attributes.`,
    severity: "warning",
    source_id: observation.source_refs[0]?.source_id,
    observation_id: observation.id,
  });
}

/** Resolve native parent aliases only after all accepted snapshots have been merged. */
function resolveLineage(bundle: EvidenceBundle): EvidenceBundle {
  const result = clone(bundle);
  const observations = new Map(result.observations.map((observation) => [observation.id, observation]));
  const aliases = new Map<string, Set<string>>();
  for (const observation of result.observations) {
    const attrs = observation.attributes ?? {};
    const hashes = [attrs[NATIVE_ID_HASH], attrs[LINEAGE_NATIVE_HASHES]]
      .flatMap((value) => typeof value === "string" ? value.split(",") : []);
    for (const alias of hashes) {
      const targets = aliases.get(alias) ?? new Set<string>();
      targets.add(observation.id);
      aliases.set(alias, targets);
    }
  }

  const candidates = new Map<string, string>();
  const candidateIssues = new Map<string, { code: string; detail: string }>();
  for (const observation of result.observations) {
    const attrs = observation.attributes ?? {};
    const explicit = attrs[LINEAGE_PARENT_OBSERVATION];
    if (typeof explicit === "string" && explicit.length > 0) {
      if (observations.has(explicit)) candidates.set(observation.id, explicit);
      else if (typeof attrs[LINEAGE_PARENT_HASHES] !== "string" || attrs[LINEAGE_PARENT_HASHES].length === 0) {
        candidateIssues.set(observation.id, { code: "lineage_parent_unresolved", detail: "does not match a normalized observation" });
      }
      if (observations.has(explicit)) continue;
    }
    const parentHashes = attrs[LINEAGE_PARENT_HASHES];
    if (typeof parentHashes !== "string" || parentHashes.length === 0) continue;
    const targets = new Set<string>();
    for (const parentHash of parentHashes.split(",")) {
      for (const target of aliases.get(parentHash) ?? []) targets.add(target);
    }
    if (targets.size === 1) {
      const target = [...targets][0] as string;
      candidates.set(observation.id, target);
    } else if (targets.size > 1) {
      candidateIssues.set(observation.id, { code: "lineage_parent_ambiguous", detail: "matches multiple normalized observations" });
    } else {
      candidateIssues.set(observation.id, { code: "lineage_parent_unresolved", detail: "does not match a normalized observation" });
    }
  }

  // Parent candidates form a graph before any edge is committed. Mark every
  // node in a cyclic component so no part of a native cycle reaches core's
  // hierarchical validator as a parent_id edge.
  const visitState = new Map<string, 0 | 1 | 2>();
  const path = new Array<string>();
  const pathIndex = new Map<string, number>();
  const cyclic = new Set<string>();
  const visit = (node: string): void => {
    visitState.set(node, 1);
    pathIndex.set(node, path.length);
    path.push(node);
    const target = candidates.get(node);
    if (target !== undefined) {
      const state = visitState.get(target);
      if (state === 1) {
        const start = pathIndex.get(target);
        if (start !== undefined) {
          for (let index = start; index < path.length; index += 1) cyclic.add(path[index] as string);
        }
      } else if (state === undefined) {
        visit(target);
      }
    }
    path.pop();
    pathIndex.delete(node);
    visitState.set(node, 2);
  };
  for (const observation of result.observations) {
    if (visitState.get(observation.id) === undefined) visit(observation.id);
  }

  for (const observation of result.observations) {
    const candidate = candidates.get(observation.id);
    if (candidate !== undefined) {
      if (cyclic.has(observation.id)) addLineageIssue(result, observation, "lineage_parent_cycle", "would create a parent cycle");
      else observation.parent_id = candidate;
      continue;
    }
    const issue = candidateIssues.get(observation.id);
    if (issue) addLineageIssue(result, observation, issue.code, issue.detail);
  }
  return validateEvidence(result);
}

function descriptor(
  harness: CaptureHarness,
  namespace: string,
  sequence: string,
  frame: FramedInput,
  source: Source,
  observationCount: number,
): CaptureDescriptor {
  const id = captureDescriptorId(harness, namespace, sequence, frame.sha256);
  return {
    id,
    sequence,
    source_id: source.id,
    sha256: frame.sha256,
    prefix_bytes: String(frame.bytes.length),
    prefix_sha256: frame.sha256,
    record_count: frame.record_count,
    observation_count: String(observationCount),
  };
}

function buildState(
  harness: CaptureHarness,
  namespace: string,
  datasetId: string,
  importOptions: CaptureImportOptions,
  sequence: string,
  frame: FramedInput,
  bundle: EvidenceBundle,
  captures: CaptureDescriptor[],
): CaptureState {
  const source = sourceFor(bundle);
  const cursor: CaptureCursor = {
    sequence,
    prefix_bytes: String(frame.bytes.length),
    prefix_sha256: frame.sha256,
    record_count: frame.record_count,
  };
  const state: CaptureState = {
    schema_version: SCHEMA_VERSION,
    dataset_id: datasetId,
    capture_namespace: namespace,
    harness,
    import_options: clone(importOptions),
    cursor,
    captures: clone(captures),
    evidence: resolveLineage(bundle),
  };
  return validateCaptureState(state);
}

function importedCapture(input: string, options: ReturnType<typeof normalizeOptions>): EvidenceBundle {
  const importOptions: ImportOptions = {
    dataset_id: options.dataset_id,
    ...(options.import_options.version ? { version: options.import_options.version } : {}),
    ...(options.import_options.work_item_id ? { work_item_id: options.import_options.work_item_id } : {}),
    ...(options.import_options.agent_id ? { agent_id: options.import_options.agent_id } : {}),
  };
  const imported = importEvidence(options.harness, input, importOptions);
  const errors = imported.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    const conflictingIdentity = errors.find((issue) => issue.code === "conflicting_duplicate_usage" || issue.code === "conflicting_duplicate_entry");
    if (conflictingIdentity) {
      fail("OBSERVATION_CONFLICT", conflictingIdentity.message, conflictingIdentity);
    }
    fail("CAPTURE_IMPORT_INVALID", `capture importer reported ${errors.length} error(s)`, errors);
  }
  return withoutLineage(canonicalizeBundle(imported, options.harness, options.capture_namespace));
}

function assertDescriptor(value: unknown, index: number): CaptureDescriptor {
  if (!isObject(value)) fail("CAPTURE_STATE_INVALID", `captures[${index}] must be an object`);
  const descriptorValue = value as Partial<CaptureDescriptor>;
  const result = {
    id: nonEmpty(descriptorValue.id, `captures[${index}].id`),
    sequence: counter(descriptorValue.sequence, `captures[${index}].sequence`),
    source_id: nonEmpty(descriptorValue.source_id, `captures[${index}].source_id`),
    sha256: nonEmpty(descriptorValue.sha256, `captures[${index}].sha256`),
    prefix_bytes: counter(descriptorValue.prefix_bytes, `captures[${index}].prefix_bytes`),
    prefix_sha256: nonEmpty(descriptorValue.prefix_sha256, `captures[${index}].prefix_sha256`),
    record_count: counter(descriptorValue.record_count, `captures[${index}].record_count`),
    observation_count: counter(descriptorValue.observation_count, `captures[${index}].observation_count`),
  } satisfies CaptureDescriptor;
  if (!/^[A-Fa-f0-9]{64}$/.test(result.sha256) || !/^[A-Fa-f0-9]{64}$/.test(result.prefix_sha256)) {
    fail("CAPTURE_STATE_INVALID", `captures[${index}] contains an invalid SHA-256 digest`);
  }
  if (result.sha256 !== result.prefix_sha256) {
    fail("CAPTURE_STATE_INVALID", `captures[${index}] source and prefix digests differ`);
  }
  return result;
}

/** Validate and detach a persisted capture state before it is used as input. */
export function validateCaptureState(value: unknown): CaptureState {
  if (!isObject(value)) fail("CAPTURE_STATE_INVALID", "capture state must be an object");
  if (!stateValidator(value)) fail("CAPTURE_STATE_SCHEMA_INVALID", schemaMessage(stateValidator.errors), stateValidator.errors);
  const raw = clone(value) as Partial<CaptureState>;
  if (raw.schema_version !== SCHEMA_VERSION) fail("CAPTURE_STATE_INVALID", "capture state schema version must be 0.2.0");
  const dataset_id = nonEmpty(raw.dataset_id, "dataset_id");
  const capture_namespace = nonEmpty(raw.capture_namespace, "capture_namespace");
  if (raw.harness !== "codex" && raw.harness !== "pi") fail("CAPTURE_STATE_INVALID", "capture state harness must be codex or pi");
  if (!isObject(raw.import_options)) fail("CAPTURE_STATE_INVALID", "capture state import_options must be an object");
  const import_options: CaptureImportOptions = {};
  for (const key of ["version", "work_item_id", "agent_id"] as const) {
    const item = raw.import_options[key];
    if (item !== undefined) import_options[key] = nonEmpty(item, `import_options.${key}`);
  }
  if (!isObject(raw.cursor)) fail("CAPTURE_STATE_INVALID", "capture state cursor must be an object");
  const cursor: CaptureCursor = {
    sequence: counter(raw.cursor.sequence, "cursor.sequence"),
    prefix_bytes: counter(raw.cursor.prefix_bytes, "cursor.prefix_bytes"),
    prefix_sha256: nonEmpty(raw.cursor.prefix_sha256, "cursor.prefix_sha256"),
    record_count: counter(raw.cursor.record_count, "cursor.record_count"),
  };
  if (!/^[A-Fa-f0-9]{64}$/.test(cursor.prefix_sha256)) fail("CAPTURE_STATE_INVALID", "cursor.prefix_sha256 must be SHA-256");
  if (!Array.isArray(raw.captures) || raw.captures.length === 0) fail("CAPTURE_STATE_INVALID", "capture state must contain captures");
  const captures = raw.captures.map(assertDescriptor);
  const descriptorIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (let index = 1; index < captures.length; index += 1) {
    if (compareCounters(captures[index - 1]!.sequence, captures[index]!.sequence) >= 0) {
      fail("CAPTURE_STATE_INVALID", "capture descriptor sequences must increase strictly");
    }
    if (compareCounters(captures[index - 1]!.prefix_bytes, captures[index]!.prefix_bytes) > 0) {
      fail("CAPTURE_STATE_INVALID", "capture descriptor prefix_bytes must be nondecreasing");
    }
    if (compareCounters(captures[index - 1]!.record_count, captures[index]!.record_count) > 0) {
      fail("CAPTURE_STATE_INVALID", "capture descriptor record_count must be nondecreasing");
    }
  }
  for (const [index, capture] of captures.entries()) {
    const expectedId = captureDescriptorId(raw.harness, capture_namespace, capture.sequence, capture.sha256);
    if (capture.id !== expectedId) {
      fail("CAPTURE_STATE_INVALID", `captures[${index}].id must equal its derived descriptor ID`);
    }
    if (descriptorIds.has(capture.id)) {
      fail("CAPTURE_STATE_INVALID", `captures[${index}] duplicates a descriptor ID`);
    }
    descriptorIds.add(capture.id);
    if (sourceIds.has(capture.source_id)) {
      fail("CAPTURE_STATE_INVALID", `captures[${index}] duplicates a source ID`);
    }
    sourceIds.add(capture.source_id);
  }
  const last = captures[captures.length - 1] as CaptureDescriptor;
  if (last.sequence !== cursor.sequence || last.prefix_bytes !== cursor.prefix_bytes || last.prefix_sha256 !== cursor.prefix_sha256 || last.record_count !== cursor.record_count) {
    fail("CAPTURE_STATE_INVALID", "cursor must match the last capture descriptor");
  }
  if (!isObject(raw.evidence)) fail("CAPTURE_STATE_INVALID", "capture state evidence must be an evidence bundle");
  const evidence = validateEvidence(raw.evidence);
  if (evidence.dataset_id !== dataset_id) fail("CAPTURE_STATE_INVALID", "capture state and evidence dataset IDs differ");
  for (const capture of captures) {
    const source = evidence.sources.find((item) => item.id === capture.source_id);
    if (!source) fail("CAPTURE_STATE_INVALID", `capture ${capture.id} references missing source ${capture.source_id}`);
    if (source.id !== captureSourceId(raw.harness, capture.sha256)) {
      fail("CAPTURE_STATE_INVALID", `capture ${capture.id} source ID is not derived from its artifact digest`);
    }
    if (source.sha256 !== capture.sha256) fail("CAPTURE_STATE_INVALID", `capture ${capture.id} digest differs from its source artifact`);
  }
  return deepFreeze({
    schema_version: SCHEMA_VERSION,
    dataset_id,
    capture_namespace,
    harness: raw.harness,
    import_options,
    cursor,
    captures,
    evidence,
  });
}

/**
 * Validate one complete native JSONL snapshot and append it to a capture state.
 * The previous state is never mutated and the returned state contains no raw input bytes.
 */
export function advanceCapture(input: string, options: CaptureOptions, previous?: CaptureState): CaptureState {
  const normalized = normalizeOptions(options);
  const frame = inspectJsonl(input);

  if (!previous) {
    const sequence = normalized.sequence ?? "0";
    const imported = importedCapture(input, normalized);
    const source = sourceFor(imported);
    const first = descriptor(normalized.harness, normalized.capture_namespace, sequence, frame, source, imported.observations.length);
    return buildState(normalized.harness, normalized.capture_namespace, normalized.dataset_id, normalized.import_options, sequence, frame, imported, [first]);
  }

  const prior = validateCaptureState(previous);
  if (prior.harness !== normalized.harness || prior.capture_namespace !== normalized.capture_namespace || prior.dataset_id !== normalized.dataset_id) {
    fail("CAPTURE_CONFIGURATION_MISMATCH", "capture namespace, harness and dataset_id are immutable for a state");
  }
  if (!sameStreamOptions(prior.import_options, normalized.import_options)) {
    fail("CAPTURE_CONFIGURATION_MISMATCH", "capture import options are immutable for a state");
  }

  const explicitSequence = normalized.sequence;
  if (explicitSequence !== undefined && compareCounters(explicitSequence, prior.cursor.sequence) < 0) {
    fail("CAPTURE_SEQUENCE_REGRESSION", "capture sequence regressed relative to the persisted cursor");
  }

  const priorBytes = Number(prior.cursor.prefix_bytes);
  if (!Number.isSafeInteger(priorBytes)) fail("CAPTURE_STATE_INVALID", "cursor.prefix_bytes exceeds the local byte-index range");
  if (frame.bytes.length < priorBytes) fail("CAPTURE_PREFIX_TRUNCATED", "capture input is shorter than the persisted prefix");
  const prefixDigest = sha256(frame.bytes.subarray(0, priorBytes));
  if (prefixDigest !== prior.cursor.prefix_sha256) fail("CAPTURE_PREFIX_REWRITTEN", "capture input rewrites the persisted UTF-8 prefix");
  if (compareCounters(frame.record_count, prior.cursor.record_count) < 0) fail("CAPTURE_RECORD_COUNT_REGRESSION", "capture input contains fewer complete JSONL frames than the persisted prefix");

  if (frame.bytes.length === priorBytes && frame.sha256 === prior.cursor.prefix_sha256 && frame.record_count === prior.cursor.record_count) {
    if (explicitSequence !== undefined && compareCounters(explicitSequence, prior.cursor.sequence) < 0) {
      fail("CAPTURE_SEQUENCE_REGRESSION", "capture sequence regressed on an exact replay");
    }
    return validateCaptureState(prior);
  }

  const sequence = explicitSequence ?? (BigInt(prior.cursor.sequence) + 1n).toString();
  if (compareCounters(sequence, prior.cursor.sequence) <= 0) {
    fail("CAPTURE_SEQUENCE_REGRESSION", "capture sequence must increase when content extends");
  }
  const imported = importedCapture(input, normalized);
  const source = sourceFor(imported);
  const next = descriptor(normalized.harness, normalized.capture_namespace, sequence, frame, source, imported.observations.length);
  const merged = reconcileEvidence([withoutLineage(prior.evidence), imported]);
  return buildState(normalized.harness, normalized.capture_namespace, normalized.dataset_id, prior.import_options, sequence, frame, merged, [...prior.captures, next]);
}
