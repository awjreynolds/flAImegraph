import { createHash } from "node:crypto";

import { validateHarnessProfile } from "./context.js";
import { CoreError } from "./core.js";
import { CONTEXT_ORIGINS, type HarnessFact, type HarnessProfile } from "./context-types.js";
import type { Source, SourceRef } from "./types.js";

/** Input accepted by the pure Harness Profile constructor. */
export interface HarnessProfileInput {
  harness: string;
  harness_version?: string | HarnessFact;
  model?: string | HarnessFact;
  provider?: string | HarnessFact;
  name?: string;
  profile_version?: string;
  artifacts?: Source[];
  instruction_sources?: HarnessProfile["instruction_sources"];
  tools?: HarnessProfile["tools"];
  policies?: Partial<HarnessProfile["policies"]>;
  context_capabilities?: HarnessProfile["context_capabilities"];
  model_settings?: Record<string, HarnessFact>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Canonical JSON used for local IDs. Object keys use JavaScript's UTF-16 code
 * unit order, arrays retain their order, and strings are never normalized.
 */
export function canonicalJson(value: unknown): string {
  const visit = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map((entry) => visit(entry)).join(",")}]`;
    if (isObject(item)) {
      const keys = Object.keys(item).sort(compareCodeUnits);
      return `{${keys
        .filter((key) => item[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${visit(item[key])}`)
        .join(",")}}`;
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      throw new CoreError("CONTEXT_CAPTURE_INVALID_NUMBER", "context identity cannot contain a non-finite number");
    }
    if (typeof item === "bigint") {
      throw new CoreError("CONTEXT_CAPTURE_INVALID_JSON", "context identity cannot contain a bigint");
    }
    const encoded = JSON.stringify(item);
    return encoded === undefined ? "null" : encoded;
  };
  return visit(value);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_STRING", `${label} must be a non-empty string`);
  }
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && value !== null) nonEmpty(value, label);
}

function asHarnessFact(value: string | HarnessFact | undefined): HarnessFact {
  if (value === undefined) return { value: null, evidence: "unknown", source_refs: [] };
  if (typeof value === "string") {
    nonEmpty(value, "profile fact");
    return { value, evidence: "declared", source_refs: [] };
  }
  if (!isObject(value)) throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "profile facts must be strings or HarnessFact values");
  const fact = clone(value as HarnessFact);
  if (fact.value === null && fact.evidence !== "unknown") {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "a null profile fact must have unknown evidence");
  }
  if (fact.value !== null && fact.evidence === "unknown") {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "a known profile fact cannot have unknown evidence");
  }
  if (!Array.isArray(fact.source_refs)) {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "profile fact source_refs must be an array");
  }
  return fact;
}

function unknownFact(): HarnessFact {
  return { value: null, evidence: "unknown", source_refs: [] };
}

function sourceSemantic(source: Source): JsonObject {
  return {
    id: source.id,
    harness: source.harness,
    format: source.format,
    ...(source.version === undefined ? {} : { version: source.version }),
    ...(source.sha256 === undefined ? {} : { sha256: source.sha256 }),
    coverage: source.coverage,
    ...(source.description === undefined ? {} : { description: source.description }),
  };
}

function validateSource(source: unknown, label: string): Source {
  if (!isObject(source)) throw new CoreError("CONTEXT_CAPTURE_INVALID_ARTIFACT", `${label} must be an object`);
  nonEmpty(source.id, `${label}.id`);
  nonEmpty(source.harness, `${label}.harness`);
  nonEmpty(source.format, `${label}.format`);
  if (source.version !== undefined) nonEmpty(source.version, `${label}.version`);
  if (source.sha256 !== undefined && (typeof source.sha256 !== "string" || !/^[A-Fa-f0-9]{64}$/.test(source.sha256))) {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_ARTIFACT", `${label}.sha256 must be a SHA-256 hex digest`);
  }
  if (source.coverage !== "complete" && source.coverage !== "partial" && source.coverage !== "unknown") {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_ARTIFACT", `${label}.coverage is invalid`);
  }
  if (source.description !== undefined && typeof source.description !== "string") {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_ARTIFACT", `${label}.description must be a string`);
  }
  return clone(source as unknown as Source);
}

function mergeArtifacts(profileArtifacts: Source[], artifact: Source): Source[] {
  const map = new Map<string, Source>();
  for (const candidate of [...profileArtifacts, artifact]) {
    const existing = map.get(candidate.id);
    if (existing !== undefined && canonicalJson(sourceSemantic(existing)) !== canonicalJson(sourceSemantic(candidate))) {
      throw new CoreError("CONTEXT_ARTIFACT_CONFLICT", `artifact ${candidate.id} differs between profile and capture`);
    }
    map.set(candidate.id, existing ?? candidate);
  }
  return [...map.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
}

function sourceRefKey(ref: SourceRef): string {
  return `${ref.source_id}\u0000${ref.record}`;
}

function normalizeRefs(
  refs: unknown,
  fallback: SourceRef,
  artifacts: Map<string, Source>,
  label: string,
): SourceRef[] {
  if (refs !== undefined && !Array.isArray(refs)) {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_REFERENCE", `${label} must be an array`);
  }
  const result = new Map<string, SourceRef>();
  const values = refs === undefined ? [] : refs;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isObject(value)) throw new CoreError("CONTEXT_CAPTURE_INVALID_REFERENCE", `${label}[${index}] must be an object`);
    nonEmpty(value.source_id, `${label}[${index}].source_id`);
    nonEmpty(value.record, `${label}[${index}].record`);
    if (!artifacts.has(value.source_id)) {
      throw new CoreError("CONTEXT_ARTIFACT_REFERENCE_MISSING", `${label}[${index}] references missing artifact ${value.source_id}`);
    }
    const ref = { source_id: value.source_id, record: value.record };
    result.set(sourceRefKey(ref), ref);
  }
  if (!artifacts.has(fallback.source_id)) {
    throw new CoreError("CONTEXT_ARTIFACT_REFERENCE_MISSING", `${label} references missing artifact ${fallback.source_id}`);
  }
  result.set(sourceRefKey(fallback), fallback);
  return [...result.values()].sort((left, right) => {
    return compareCodeUnits(left.source_id, right.source_id) || compareCodeUnits(left.record, right.record);
  });
}

const MEASUREMENT_EVIDENCE = new Set(["observed", "derived", "estimated", "counterfactual", "unavailable"]);
const MEASUREMENT_UNITS = new Set(["tokens", "utf8_bytes", "unicode_scalars", "items"]);

function normalizeMeasurement(
  value: unknown,
  expectedUnit: "tokens" | "utf8_bytes",
  fallback: SourceRef,
  artifacts: Map<string, Source>,
  label: string,
): ContextMeasurementLike {
  if (!isObject(value)) throw new CoreError("CONTEXT_CAPTURE_INVALID_MEASUREMENT", `${label} must be an object`);
  if (!MEASUREMENT_UNITS.has(String(value.unit)) || value.unit !== expectedUnit) {
    throw new CoreError("CONTEXT_MEASUREMENT_UNIT_MISMATCH", `${label}.unit must be ${expectedUnit}`);
  }
  if (!MEASUREMENT_EVIDENCE.has(String(value.evidence))) {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_MEASUREMENT", `${label}.evidence is invalid`);
  }
  nonEmpty(value.method, `${label}.method`);
  if (value.value !== null && (typeof value.value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.value))) {
    throw new CoreError("CONTEXT_MEASUREMENT_INVALID", `${label}.value must be a canonical non-negative integer string or null`);
  }
  if (value.value === null && value.evidence !== "unavailable") {
    throw new CoreError("CONTEXT_MEASUREMENT_UNKNOWN_INCOHERENT", `${label} null value must be unavailable`);
  }
  if (value.value !== null && value.evidence === "unavailable") {
    throw new CoreError("CONTEXT_MEASUREMENT_UNKNOWN_INCOHERENT", `${label} unavailable evidence must have a null value`);
  }
  return {
    value: value.value as string | null,
    unit: expectedUnit,
    evidence: value.evidence as ContextMeasurementLike["evidence"],
    method: value.method,
    source_refs: normalizeRefs(value.source_refs, fallback, artifacts, `${label}.source_refs`),
  };
}

type ContextMeasurementLike = {
  value: string | null;
  unit: "tokens" | "utf8_bytes";
  evidence: "observed" | "derived" | "estimated" | "counterfactual" | "unavailable";
  method: string;
  source_refs: SourceRef[];
};

function unavailableMeasurement(unit: "tokens" | "utf8_bytes"): ContextMeasurementLike {
  return { value: null, unit, evidence: "unavailable", method: "not-captured-v1", source_refs: [] };
}

function validateAxes(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) throw new CoreError("CONTEXT_CAPTURE_INVALID_AXIS", `${label} is invalid`);
}

const origins = CONTEXT_ORIGINS as readonly string[];
const representations = ["original", "excerpt", "truncated", "summary", "opaque", "reference"] as const;
const media = ["text", "structured", "image", "audio", "video", "document", "unknown"] as const;
const roles = ["system", "developer", "user", "assistant", "tool", "unknown"] as const;
const placements = ["instruction", "history", "current_turn", "tool_result", "tool_definition", "attachment", "server_state", "unknown"] as const;
const boundaries = ["client_request", "harness_context", "transcript_reconstruction", "unavailable"] as const;
const coverages = ["complete", "partial", "unknown"] as const;
const coverageEvidence = ["observed", "declared", "unknown"] as const;

function assertDateTime(value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) {
    throw new CoreError("CONTEXT_CAPTURE_INVALID_DATE", "captured_at must be an RFC3339 date-time");
  }
}

function profileIdPayload(profile: HarnessProfile): JsonObject {
  const { id: _id, ...withoutId } = profile;
  return withoutId;
}

/**
 * Construct an immutable profile template. Optional string facts are declared
 * inputs; omitted facts and all policies remain explicitly unknown.
 */
export function createHarnessProfile(input: HarnessProfileInput): HarnessProfile {
  if (!isObject(input)) throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "profile input must be an object");
  nonEmpty(input.harness, "profile.harness");
  optionalString(input.name, "profile.name");
  optionalString(input.profile_version, "profile.profile_version");
  for (const [value, label] of [
    [input.artifacts, "profile.artifacts"],
    [input.instruction_sources, "profile.instruction_sources"],
    [input.tools, "profile.tools"],
    [input.context_capabilities, "profile.context_capabilities"],
  ] as const) {
    if (value !== undefined && !Array.isArray(value)) throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", `${label} must be an array`);
  }
  if (input.model_settings !== undefined && !isObject(input.model_settings)) throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "profile.model_settings must be an object");
  if (input.policies !== undefined && !isObject(input.policies)) throw new CoreError("CONTEXT_CAPTURE_INVALID_PROFILE", "profile.policies must be an object");
  const artifacts = (input.artifacts ?? []).map((artifact, index) => validateSource(artifact, `profile.artifacts[${index}]`));
  const profile: HarnessProfile = {
    schema_version: "0.2.0",
    id: "pending",
    name: input.name ?? `${input.harness} profile`,
    harness: input.harness,
    harness_version: asHarnessFact(input.harness_version),
    profile_version: input.profile_version ?? "0.2.0",
    model: {
      provider: asHarnessFact(input.provider),
      name: asHarnessFact(input.model),
      settings: clone(input.model_settings ?? {}),
    },
    instruction_sources: clone(input.instruction_sources ?? []),
    tools: clone(input.tools ?? []),
    policies: {
      assembly: input.policies?.assembly === undefined ? unknownFact() : clone(input.policies.assembly),
      truncation: input.policies?.truncation === undefined ? unknownFact() : clone(input.policies.truncation),
      compaction: input.policies?.compaction === undefined ? unknownFact() : clone(input.policies.compaction),
      caching: input.policies?.caching === undefined ? unknownFact() : clone(input.policies.caching),
    },
    context_capabilities: clone(input.context_capabilities ?? CONTEXT_ORIGINS.map((origin) => ({
      origin,
      capture: "unknown" as const,
      evidence: "unknown" as const,
      source_refs: [],
      note: "No capture capability has been established for this profile.",
    }))),
    artifacts,
  };
  profile.id = `harness-profile:${hashJson(profileIdPayload(profile))}`;
  return validateHarnessProfile(profile);
}

/** Internal helpers shared by the generic capture and provider adapters. */
export const captureInternals = {
  clone,
  compareCodeUnits,
  hashJson,
  mergeArtifacts,
  normalizeMeasurement,
  normalizeRefs,
  sourceRefKey,
  validateAxes,
  validateSource,
  unavailableMeasurement,
  assertDateTime,
  origins,
  representations,
  media,
  roles,
  placements,
  boundaries,
  coverages,
  coverageEvidence,
};

export type { ContextMeasurementLike };

export { captureRequestContext, captureProviderRequest } from "./request-context.js";
export type { CaptureProviderOptions, ProducerSourceAnnotation, SourceAnnotation } from "./request-context.js";
