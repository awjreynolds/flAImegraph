import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { validateContextBundle } from "./context.js";
import { CoreError } from "./core.js";
import {
  captureInternals,
  canonicalJson,
  type ContextMeasurementLike,
} from "./context-capture.js";
import type {
  CaptureBoundary,
  CaptureContextInput,
  ContextBlockInput,
  ContextBundle,
  ContextIssue,
  ContextMedia,
  ContextOccurrence,
  ContextOrigin,
  ContextPlacement,
  ContextRepresentation,
  ContextRole,
  HarnessFact,
  HarnessProfile,
  RequestContext,
} from "./context-types.js";
import type { Source, SourceRef } from "./types.js";

type JsonObject = Record<string, unknown>;

/** A producer annotation attaches an origin and stable identity to a JSON pointer. */
export interface ProducerSourceAnnotation {
  origin: ContextOrigin;
  label?: string;
  source_id?: string;
  origin_evidence?: "observed" | "declared" | "estimated" | "unknown";
  identity_basis?: "producer" | "content_fingerprint" | "unknown";
}

/** Alias retained for callers that prefer the shorter name. */
export type SourceAnnotation = ProducerSourceAnnotation;

/** Explicit identity and artifact inputs for the pure provider request adapters. */
export interface CaptureProviderOptions {
  dataset_id: string;
  namespace: string;
  request_id: string;
  profile: HarnessProfile;
  artifact: Source;
  profile_id?: string;
  artifact_id?: string;
  observation_id?: string | null;
  captured_at?: string | null;
  coverage?: "complete" | "partial" | "unknown";
  coverage_evidence?: "observed" | "declared" | "unknown";
  /** JSON-pointer annotations supplied by the producer, such as repository files or skills. */
  producer_annotations?: Record<string, ProducerSourceAnnotation>;
  /** Synonym for producer_annotations. If both are provided, their entries must agree. */
  source_annotations?: Record<string, ProducerSourceAnnotation>;
  /** Short alias for source_annotations. */
  annotations?: Record<string, ProducerSourceAnnotation>;
  overrides?: Record<string, HarnessFact>;
}

type ParsedProviderRequest = {
  blocks: ContextBlockInput[];
  overrides: Record<string, HarnessFact>;
  issues: ContextIssue[];
  unsupported: boolean;
};

const ROLE_VALUES = new Set(["system", "developer", "user", "assistant", "tool", "unknown"]);
const ORIGIN_VALUES = new Set([
  "system_instruction", "developer_instruction", "user_prompt", "repository_instruction", "skill",
  "repository_file", "retrieved_document", "tool_result", "tool_schema", "output_schema", "conversation_history",
  "assistant_output", "memory", "delegated_context", "attachment", "unknown",
]);
const MEDIA_VALUES = new Set(["text", "structured", "image", "audio", "video", "document", "unknown"]);
const REPRESENTATION_VALUES = new Set(["original", "excerpt", "truncated", "summary", "opaque", "reference"]);
const PLACEMENT_VALUES = new Set(["instruction", "history", "current_turn", "tool_result", "tool_definition", "attachment", "server_state", "unknown"]);
const BOUNDARY_VALUES = new Set(["client_request", "harness_context", "transcript_reconstruction", "unavailable"]);
const COVERAGE_VALUES = new Set(["complete", "partial", "unknown"]);
const COVERAGE_EVIDENCE_VALUES = new Set(["observed", "declared", "unknown"]);
const ANNOTATION_EVIDENCE_VALUES = new Set(["observed", "declared", "estimated", "unknown"]);
const IDENTITY_BASIS_VALUES = new Set(["producer", "content_fingerprint", "unknown"]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(code: string, message: string, details?: unknown): CoreError {
  return new CoreError(code, message, details);
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw error("CONTEXT_CAPTURE_INVALID_STRING", `${label} must be a non-empty string`);
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw error("CONTEXT_CAPTURE_INVALID_SHAPE", `${label} must be an array`);
}

function assertObject(value: unknown, label: string): asserts value is JsonObject {
  if (!isObject(value)) throw error("CONTEXT_CAPTURE_INVALID_SHAPE", `${label} must be an object`);
}

function sourceRef(artifact: Source, record: string): SourceRef {
  return { source_id: artifact.id, record };
}

function sourceRefList(ref: SourceRef): SourceRef[] {
  return [ref];
}

function mapOfArtifacts(artifacts: Source[]): Map<string, Source> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

function assertAllowed(value: unknown, allowed: Set<string>, label: string): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) throw error("CONTEXT_CAPTURE_INVALID_AXIS", `${label} is invalid`);
}

function stableWithoutRefs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWithoutRefs).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value)
      .filter((key) => key !== "source_refs" && value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableWithoutRefs(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return canonicalJson(value);
}

function mergeRefs(left: SourceRef[], right: SourceRef[]): SourceRef[] {
  const refs = new Map<string, SourceRef>();
  for (const ref of [...left, ...right]) refs.set(`${ref.source_id}\u0000${ref.record}`, ref);
  return [...refs.values()].sort((a, b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : a.record < b.record ? -1 : a.record > b.record ? 1 : 0);
}

function mergeSource(
  map: Map<string, import("./context-types.js").ContextSource>,
  source: import("./context-types.js").ContextSource,
): void {
  const existing = map.get(source.id);
  if (existing === undefined) {
    map.set(source.id, source);
    return;
  }
  if (stableWithoutRefs(existing) !== stableWithoutRefs(source)) {
    throw error("CONTEXT_SOURCE_CONFLICT", `context source ${source.id} has conflicting semantics`);
  }
  map.set(source.id, { ...existing, source_refs: mergeRefs(existing.source_refs, source.source_refs) });
}

function mergeRevision(
  map: Map<string, import("./context-types.js").ContextRevision>,
  revision: import("./context-types.js").ContextRevision,
): void {
  const existing = map.get(revision.id);
  if (existing === undefined) {
    map.set(revision.id, revision);
    return;
  }
  if (stableWithoutRefs(existing) !== stableWithoutRefs(revision)) {
    throw error("CONTEXT_REVISION_CONFLICT", `context revision ${revision.id} has conflicting semantics`);
  }
  map.set(revision.id, {
    ...existing,
    source_refs: mergeRefs(existing.source_refs, revision.source_refs),
    tokens: { ...existing.tokens, source_refs: mergeRefs(existing.tokens.source_refs, revision.tokens.source_refs) },
    bytes: { ...existing.bytes, source_refs: mergeRefs(existing.bytes.source_refs, revision.bytes.source_refs) },
  });
}

function normalizeFact(value: unknown, fallback: SourceRef, artifacts: Map<string, Source>, label: string): HarnessFact {
  assertObject(value, label);
  if (value.value !== null && typeof value.value !== "string" && typeof value.value !== "number" && typeof value.value !== "boolean") {
    throw error("CONTEXT_CAPTURE_INVALID_FACT", `${label}.value must be a string, number, boolean, or null`);
  }
  if (typeof value.value === "number" && !Number.isFinite(value.value)) throw error("CONTEXT_CAPTURE_INVALID_FACT", `${label}.value must be finite`);
  if (value.evidence !== "observed" && value.evidence !== "declared" && value.evidence !== "unknown") {
    throw error("CONTEXT_CAPTURE_INVALID_FACT", `${label}.evidence is invalid`);
  }
  if (value.value === null && value.evidence !== "unknown") throw error("CONTEXT_CAPTURE_INVALID_FACT", `${label} null value must be unknown`);
  if (value.value !== null && value.evidence === "unknown") throw error("CONTEXT_CAPTURE_INVALID_FACT", `${label} known value cannot be unknown`);
  return {
    value: value.value as HarnessFact["value"],
    evidence: value.evidence,
    source_refs: captureInternals.normalizeRefs(value.source_refs, fallback, artifacts, `${label}.source_refs`),
  };
}

function defaultCoverageEvidence(coverage: "complete" | "partial" | "unknown"): "observed" | "declared" | "unknown" {
  return coverage === "unknown" ? "unknown" : "declared";
}

function normalizeTreatment(value: unknown, fallback: SourceRef, artifacts: Map<string, Source>, label: string): ContextOccurrence["treatment"] {
  if (value === undefined) return { value: "unknown", evidence: "unknown", method: "capture-treatment-unknown-v1", source_refs: [] };
  assertObject(value, label);
  if (value.value !== "fresh" && value.value !== "cache_read" && value.value !== "cache_write" && value.value !== "mixed" && value.value !== "unknown") {
    throw error("CONTEXT_CAPTURE_INVALID_TREATMENT", `${label}.value is invalid`);
  }
  if (value.evidence !== "observed" && value.evidence !== "declared" && value.evidence !== "estimated" && value.evidence !== "unknown") {
    throw error("CONTEXT_CAPTURE_INVALID_TREATMENT", `${label}.evidence is invalid`);
  }
  nonEmpty(value.method, `${label}.method`);
  if ((value.value === "unknown") !== (value.evidence === "unknown")) throw error("CONTEXT_CAPTURE_INVALID_TREATMENT", `${label} unknown value/evidence mismatch`);
  return {
    value: value.value,
    evidence: value.evidence,
    method: value.method,
    source_refs: captureInternals.normalizeRefs(value.source_refs, fallback, artifacts, `${label}.source_refs`),
  };
}

function measurementWithRefs(measurement: ContextMeasurementLike, refs: SourceRef[]): ContextMeasurementLike {
  return { ...measurement, source_refs: mergeRefs(measurement.source_refs, refs) };
}

function deriveBytes(
  bytes: Uint8Array,
  method: string,
  fallback: SourceRef,
): ContextMeasurementLike {
  return {
    value: String(bytes.byteLength),
    unit: "utf8_bytes",
    evidence: "derived",
    method,
    source_refs: sourceRefList(fallback),
  };
}

function makeRevision(
  block: ContextBlockInput,
  artifact: Source,
  captureRecord: string,
  artifacts: Map<string, Source>,
  issues: ContextIssue[],
): { source: import("./context-types.js").ContextSource; revision: import("./context-types.js").ContextRevision; treatment: ContextOccurrence["treatment"] } {
  const label = `blocks[${block.source_id}]`;
  nonEmpty(block.source_id, `${label}.source_id`);
  assertAllowed(block.origin, ORIGIN_VALUES, `${label}.origin`);
  nonEmpty(block.label, `${label}.label`);
  assertAllowed(block.identity_basis ?? "unknown", new Set(["producer", "content_fingerprint", "unknown"]), `${label}.identity_basis`);
  assertAllowed(block.origin_evidence ?? "unknown", new Set(["observed", "declared", "estimated", "unknown"]), `${label}.origin_evidence`);
  assertAllowed(block.representation, REPRESENTATION_VALUES, `${label}.representation`);
  assertAllowed(block.media, MEDIA_VALUES, `${label}.media`);
  assertAllowed(block.role, ROLE_VALUES, `${label}.role`);
  assertAllowed(block.placement, PLACEMENT_VALUES, `${label}.placement`);
  if (block.content !== undefined && typeof block.content !== "string") throw error("CONTEXT_CAPTURE_INVALID_CONTENT", `${label}.content must be a string`);
  if (block.content_bytes !== undefined && !(block.content_bytes instanceof Uint8Array)) throw error("CONTEXT_CAPTURE_INVALID_CONTENT", `${label}.content_bytes must be Uint8Array`);
  if (block.content !== undefined && block.content_bytes !== undefined) throw error("CONTEXT_CAPTURE_CONTENT_AMBIGUOUS", `${label} cannot provide content and content_bytes together`);
  const record = block.record ?? captureRecord;
  nonEmpty(record, `${label}.record`);
  const ref = sourceRef(artifact, record);
  const raw = block.content_bytes === undefined
    ? block.content !== undefined && (block.media === "text" || block.media === "structured" || block.media === "unknown") ? Buffer.from(block.content, "utf8") : undefined
    : new Uint8Array(block.content_bytes);
  if (block.content !== undefined && raw === undefined) {
    issues.push({ code: "CONTENT_NOT_HASHED", message: `${label} carries textual metadata for ${block.media} media; no binary fingerprint was inferred`, severity: "warning", source_id: block.source_id });
  }

  let contentSha: string | null = null;
  let fingerprintEvidence: "derived" | "declared" | "unknown" = "unknown";
  let fingerprintMethod: string | null = null;
  if (raw !== undefined) {
    contentSha = requireSha256(raw);
    fingerprintEvidence = "derived";
    fingerprintMethod = block.content_bytes === undefined ? "sha256-utf8-content-v1" : "sha256-raw-bytes-v1";
    if (block.content_sha256 !== undefined && block.content_sha256 !== null) {
      nonEmpty(block.content_sha256, `${label}.content_sha256`);
      if (!/^[A-Fa-f0-9]{64}$/.test(block.content_sha256) || block.content_sha256.toLowerCase() !== contentSha) {
        throw error("CONTEXT_CAPTURE_HASH_CONFLICT", `${label}.content_sha256 does not match captured content`);
      }
    }
  } else if (block.content_sha256 !== undefined && block.content_sha256 !== null) {
    nonEmpty(block.content_sha256, `${label}.content_sha256`);
    if (!/^[A-Fa-f0-9]{64}$/.test(block.content_sha256)) throw error("CONTEXT_CAPTURE_INVALID_HASH", `${label}.content_sha256 must be a SHA-256 hex digest`);
    contentSha = block.content_sha256.toLowerCase();
    fingerprintEvidence = "declared";
    fingerprintMethod = "caller-declared-sha256-v1";
  }

  let bytes: ContextMeasurementLike;
  if (raw !== undefined) {
    const derived = deriveBytes(raw, block.content_bytes === undefined ? "utf8-byte-length-v1" : "raw-byte-length-v1", ref);
    if (block.bytes !== undefined) {
      const supplied = captureInternals.normalizeMeasurement(block.bytes, "utf8_bytes", ref, artifacts, `${label}.bytes`);
      if (supplied.value !== derived.value) throw error("CONTEXT_CAPTURE_MEASUREMENT_CONFLICT", `${label}.bytes does not match captured representation`);
      bytes = supplied;
    } else {
      bytes = derived;
    }
  } else if (block.bytes !== undefined) {
    bytes = captureInternals.normalizeMeasurement(block.bytes, "utf8_bytes", ref, artifacts, `${label}.bytes`);
  } else {
    bytes = captureInternals.unavailableMeasurement("utf8_bytes");
  }

  const tokens = block.tokens === undefined
    ? captureInternals.unavailableMeasurement("tokens")
    : captureInternals.normalizeMeasurement(block.tokens, "tokens", ref, artifacts, `${label}.tokens`);
  const revisionPayload = {
    source_id: block.source_id,
    representation: block.representation,
    media: block.media,
    content_sha256: contentSha,
    fingerprint_evidence: fingerprintEvidence,
    fingerprint_method: fingerprintMethod,
    tokens: { value: tokens.value, unit: tokens.unit, evidence: tokens.evidence, method: tokens.method },
    bytes: { value: bytes.value, unit: bytes.unit, evidence: bytes.evidence, method: bytes.method },
  };
  const revision = {
    id: `context-revision:${captureInternals.hashJson(revisionPayload)}`,
    source_id: block.source_id,
    representation: block.representation,
    media: block.media,
    content_sha256: contentSha,
    fingerprint_evidence: fingerprintEvidence,
    fingerprint_method: fingerprintMethod,
    tokens: measurementWithRefs(tokens, [ref]),
    bytes: measurementWithRefs(bytes, [ref]),
    source_refs: [ref],
  } as import("./context-types.js").ContextRevision;
  const source = {
    id: block.source_id,
    origin: block.origin,
    origin_evidence: block.origin_evidence ?? "unknown",
    label: block.label,
    identity_basis: block.identity_basis ?? "unknown",
    source_refs: [ref],
  } as import("./context-types.js").ContextSource;
  const treatment = normalizeTreatment(block.treatment, ref, artifacts, `${label}.treatment`);
  return { source, revision, treatment };
}

function requireSha256(bytes: Uint8Array): string {
  // The standard node:crypto implementation is intentionally kept behind a
  // tiny helper so raw bytes never enter a JSON identity payload.
  return createHash("sha256").update(bytes).digest("hex");
}

function mergeOverrideMaps(left: Record<string, HarnessFact>, right: Record<string, HarnessFact>): Record<string, HarnessFact> {
  const result: Record<string, HarnessFact> = {};
  for (const [key, value] of Object.entries(left)) result[key] = value;
  for (const [key, value] of Object.entries(right)) {
    const existing = result[key];
    if (existing !== undefined && stableWithoutRefs(existing) !== stableWithoutRefs(value)) {
      throw error("CONTEXT_OVERRIDE_CONFLICT", `request override ${key} has conflicting values`);
    }
    if (existing === undefined) result[key] = value;
    else result[key] = { ...existing, source_refs: mergeRefs(existing.source_refs, value.source_refs) };
  }
  return result;
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function sortIssues(issues: ContextIssue[]): ContextIssue[] {
  return [...issues].sort((left, right) => {
    const a = canonicalJson(left);
    const b = canonicalJson(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function finishBundle(bundle: ContextBundle): ContextBundle {
  try {
    return validateContextBundle(bundle);
  } catch (caught) {
    // Older consumers may load this capture module alongside the initial
    // context validator stub. Once the validator exists, all output goes
    // through it; this compatibility branch is removed by normal execution.
    if (caught instanceof CoreError && caught.code === "CONTEXT_NOT_IMPLEMENTED") return captureInternals.clone(bundle);
    throw caught;
  }
}

/**
 * Capture explicitly supplied blocks into a detached v0.2 context bundle.
 * Raw text and bytes are consumed only long enough to derive permitted fields.
 */
export function captureRequestContext(input: CaptureContextInput): ContextBundle {
  assertObject(input, "capture input");
  nonEmpty(input.dataset_id, "capture.dataset_id");
  nonEmpty(input.request_id, "capture.request_id");
  nonEmpty(input.record, "capture.record");
  assertAllowed(input.boundary, BOUNDARY_VALUES, "capture.boundary");
  assertAllowed(input.coverage, COVERAGE_VALUES, "capture.coverage");
  if (input.coverage_evidence !== undefined) assertAllowed(input.coverage_evidence, COVERAGE_EVIDENCE_VALUES, "capture.coverage_evidence");
  captureInternals.assertDateTime(input.captured_at);
  assertArray(input.blocks, "capture.blocks");
  assertObject(input.profile, "capture.profile");
  assertArray(input.profile.artifacts, "capture.profile.artifacts");
  nonEmpty(input.profile.id, "capture.profile.id");
  const profile = captureInternals.clone(input.profile as HarnessProfile);
  const artifact = captureInternals.validateSource(input.artifact, "capture.artifact");
  if (input.overrides !== undefined) assertObject(input.overrides, "capture.overrides");
  const artifacts = captureInternals.mergeArtifacts(profile.artifacts, artifact);
  const artifactMap = mapOfArtifacts(artifacts);
  const requestRef = sourceRef(artifact, input.record);
  const sourceMap = new Map<string, import("./context-types.js").ContextSource>();
  const revisionMap = new Map<string, import("./context-types.js").ContextRevision>();
  const issues: ContextIssue[] = [];
  const occurrences: ContextOccurrence[] = [];

  if (input.boundary === "unavailable" && input.blocks.length > 0) {
    throw error("CONTEXT_CAPTURE_BOUNDARY_INVALID", "an unavailable request boundary cannot contain occurrences");
  }
  let coverage = input.coverage;
  let evidence = input.coverage_evidence ?? defaultCoverageEvidence(coverage);
  if (input.boundary === "transcript_reconstruction" && coverage === "complete") {
    coverage = "partial";
    evidence = "declared";
    issues.push({ code: "TRANSCRIPT_COVERAGE_DOWNGRADED", message: "transcript reconstruction cannot claim complete client-request coverage", severity: "warning", request_id: input.request_id });
  }
  if (input.boundary === "unavailable") {
    coverage = "unknown";
    evidence = "unknown";
  }
  if ((coverage === "unknown") !== (evidence === "unknown")) {
    throw error("CONTEXT_CAPTURE_COVERAGE_INCOHERENT", "coverage and coverage_evidence must agree about unknown status");
  }

  for (let ordinal = 0; ordinal < input.blocks.length; ordinal += 1) {
    const block = input.blocks[ordinal];
    assertObject(block, `capture.blocks[${ordinal}]`);
    const made = makeRevision(block as ContextBlockInput, artifact, input.record, artifactMap, issues);
    mergeSource(sourceMap, made.source);
    mergeRevision(revisionMap, made.revision);
    const occurrencePayload = { request_id: input.request_id, ordinal, revision_id: made.revision.id };
    occurrences.push({
      id: `context-occurrence:${captureInternals.hashJson(occurrencePayload)}`,
      revision_id: made.revision.id,
      role: block.role,
      placement: block.placement,
      treatment: made.treatment,
    });
  }

  const overrides: Record<string, HarnessFact> = {};
  for (const key of Object.keys(input.overrides ?? {}).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const value = input.overrides?.[key];
    if (value === undefined) continue;
    nonEmpty(key, "capture.overrides key");
    overrides[key] = normalizeFact(value, requestRef, artifactMap, `capture.overrides.${key}`);
  }

  const request: RequestContext = {
    id: input.request_id,
    observation_id: input.observation_id ?? null,
    profile_id: profile.id,
    captured_at: input.captured_at ?? null,
    boundary: input.boundary,
    coverage,
    coverage_evidence: evidence,
    occurrences,
    overrides,
    source_refs: [requestRef],
  };
  const bundle: ContextBundle = {
    schema_version: "0.2.0",
    dataset_id: input.dataset_id,
    evidence_schema_version: "0.1.0",
    artifacts,
    profiles: [profile],
    sources: sortById([...sourceMap.values()]),
    revisions: sortById([...revisionMap.values()]),
    requests: [request],
    transformations: [],
    issues: sortIssues(issues),
  };
  return finishBundle(bundle);
}

function pointerJoin(parent: string, segment: string | number): string {
  const escaped = String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${parent}/${escaped}`;
}

function annotationFor(path: string, options: CaptureProviderOptions): ProducerSourceAnnotation | undefined {
  const maps = [options.producer_annotations, options.source_annotations, options.annotations].filter((value): value is Record<string, ProducerSourceAnnotation> => value !== undefined);
  let found: ProducerSourceAnnotation | undefined;
  let foundPath = "";
  for (const map of maps) {
    for (const [candidatePath, annotation] of Object.entries(map)) {
      if (path !== candidatePath && !path.startsWith(`${candidatePath}/`)) continue;
      if (candidatePath.length < foundPath.length) continue;
      if (found !== undefined && candidatePath === foundPath && stableWithoutRefs(found) !== stableWithoutRefs(annotation)) {
        throw error("CONTEXT_SOURCE_ANNOTATION_CONFLICT", `conflicting annotations for ${path}`);
      }
      found = annotation;
      foundPath = candidatePath;
    }
  }
  return found;
}

function validateAnnotation(value: unknown, label: string): asserts value is ProducerSourceAnnotation {
  assertObject(value, label);
  assertAllowed(value.origin, ORIGIN_VALUES, `${label}.origin`);
  if (value.label !== undefined) nonEmpty(value.label, `${label}.label`);
  if (value.source_id !== undefined) nonEmpty(value.source_id, `${label}.source_id`);
  if (value.origin_evidence !== undefined) assertAllowed(value.origin_evidence, ANNOTATION_EVIDENCE_VALUES, `${label}.origin_evidence`);
  if (value.identity_basis !== undefined) assertAllowed(value.identity_basis, IDENTITY_BASIS_VALUES, `${label}.identity_basis`);
  if (value.origin === "unknown" && value.origin_evidence !== undefined && value.origin_evidence !== "unknown") {
    throw error("CONTEXT_SOURCE_ANNOTATION_INVALID", `${label}.unknown origin must have unknown evidence`);
  }
}

function validateAnnotationMaps(options: CaptureProviderOptions): void {
  const maps: Array<[string, Record<string, ProducerSourceAnnotation> | undefined]> = [
    ["producer_annotations", options.producer_annotations],
    ["source_annotations", options.source_annotations],
    ["annotations", options.annotations],
  ];
  for (const [mapLabel, map] of maps) {
    if (map === undefined) continue;
    assertObject(map, `provider options.${mapLabel}`);
    for (const [path, annotation] of Object.entries(map)) {
      if (path !== "" && !path.startsWith("/")) throw error("CONTEXT_SOURCE_ANNOTATION_INVALID", `provider options.${mapLabel} key ${path} is not a JSON pointer`);
      validateAnnotation(annotation, `provider options.${mapLabel}.${path || "<root>"}`);
    }
  }
}

function annotationOrigin(path: string, fallback: ContextOrigin, options: CaptureProviderOptions): ProducerSourceAnnotation {
  const annotation = annotationFor(path, options);
  if (annotation !== undefined) {
    assertAllowed(annotation.origin, ORIGIN_VALUES, `annotation ${path}.origin`);
  }
  return annotation ?? { origin: fallback };
}

function providerSourceId(format: string, path: string, options: CaptureProviderOptions, annotation: ProducerSourceAnnotation | undefined): string {
  if (annotation?.source_id !== undefined) {
    nonEmpty(annotation.source_id, `annotation ${path}.source_id`);
    return annotation.source_id;
  }
  return `provider-source:${captureInternals.hashJson({ namespace: options.namespace, request_id: options.request_id, format, path })}`;
}

function providerBlock(
  format: string,
  path: string,
  options: CaptureProviderOptions,
  value: { origin: ContextOrigin; label?: string; representation?: ContextRepresentation; media?: ContextMedia; role?: ContextRole; placement?: ContextPlacement; content?: string; content_bytes?: Uint8Array; content_sha256?: string | null; tokens?: ContextBlockInput["tokens"] },
): ContextBlockInput {
  const annotation = annotationFor(path, options);
  const selected = annotation ?? { origin: value.origin };
  return {
    source_id: providerSourceId(format, path, options, annotation),
    origin: annotationOrigin(path, selected.origin, options).origin,
    origin_evidence: annotation?.origin_evidence ?? (annotation === undefined ? (value.origin === "unknown" ? "unknown" : "declared") : (annotation.origin === "unknown" ? "unknown" : "observed")),
    // When a producer deliberately reuses one source ID at several pointers,
    // use that ID as the default label so the source can merge by identity.
    label: annotation?.label ?? value.label ?? annotation?.source_id ?? `${format} ${path}`,
    identity_basis: annotation?.identity_basis ?? "producer",
    representation: value.representation ?? "original",
    media: value.media ?? "text",
    role: value.role ?? "unknown",
    placement: value.placement ?? "current_turn",
    content: value.content,
    content_bytes: value.content_bytes,
    content_sha256: value.content_sha256,
    record: path,
    tokens: value.tokens,
  };
}

function opaqueProviderBlock(format: string, path: string, options: CaptureProviderOptions, origin: ContextOrigin = "unknown", label?: string, media: ContextMedia = "structured"): ContextBlockInput {
  return providerBlock(format, path, options, { origin, label, representation: "reference", media, role: "unknown", placement: "server_state" });
}

function structuredProviderBlock(format: string, path: string, options: CaptureProviderOptions, value: unknown, origin: ContextOrigin, role: ContextRole = "unknown", placement: ContextPlacement = "current_turn", label?: string): ContextBlockInput {
  return providerBlock(format, path, options, { origin, role, placement, media: "structured", content: canonicalJson(value), label });
}

function textProviderBlock(format: string, path: string, options: CaptureProviderOptions, text: string, origin: ContextOrigin, role: ContextRole, placement: ContextPlacement, label?: string): ContextBlockInput {
  return providerBlock(format, path, options, { origin, role, placement, media: "text", content: text, label });
}

function roleOf(value: unknown): ContextRole {
  if (value === "system" || value === "developer" || value === "user" || value === "assistant" || value === "tool") return value;
  if (value === "model") return "assistant";
  return "unknown";
}

function decodeBase64(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return undefined;
  const unpadded = normalized.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return undefined;
  const padded = unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
  const bytes = Buffer.from(padded, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== unpadded) return undefined;
  return new Uint8Array(bytes);
}

function decodeDataUrl(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^data:[^,]*;base64,(.*)$/su.exec(value);
  return match === null ? undefined : decodeBase64(match[1]);
}

function dataUrlMime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^data:([^;,]*)(?:;[^,]*)?;base64,/iu.exec(value);
  return match?.[1];
}

function mediaForMime(value: unknown): ContextMedia {
  if (typeof value !== "string") return "document";
  const mime = value.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime.includes("json")) return "text";
  return "document";
}

function parseTextOrParts(
  format: string,
  path: string,
  value: unknown,
  options: CaptureProviderOptions,
  role: ContextRole,
  placement: ContextPlacement,
  fallbackOrigin: ContextOrigin,
  issues: ContextIssue[],
): ContextBlockInput[] {
  if (typeof value === "string") return [textProviderBlock(format, path, options, value, fallbackOrigin, role, placement)];
  if (Array.isArray(value)) {
    const blocks: ContextBlockInput[] = [];
    for (let index = 0; index < value.length; index += 1) blocks.push(...parseTypedPart(format, pointerJoin(path, index), value[index], options, role, placement, fallbackOrigin, issues));
    return blocks;
  }
  if (isObject(value)) return parseTypedPart(format, path, value, options, role, placement, fallbackOrigin, issues);
  issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} has unsupported content`, severity: "warning" });
  return [];
}

function parseTypedPart(
  format: string,
  path: string,
  value: unknown,
  options: CaptureProviderOptions,
  role: ContextRole,
  placement: ContextPlacement,
  fallbackOrigin: ContextOrigin,
  issues: ContextIssue[],
): ContextBlockInput[] {
  if (typeof value === "string") return [textProviderBlock(format, path, options, value, fallbackOrigin, role, placement)];
  if (!isObject(value)) {
    issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} is not an object or text block`, severity: "warning" });
    return [];
  }
  const type = typeof value.type === "string" ? value.type : undefined;
  if (type === "text" || type === "input_text" || type === "output_text") {
    unhandledKeys(value, path, ["type", "text"], issues);
    if (typeof value.text === "string") return [textProviderBlock(format, pointerJoin(path, "text"), options, value.text, fallbackOrigin, role, placement)];
  }
  if (type === "image" || type === "input_image" || type === "image_url") {
    unhandledKeys(value, path, ["type", "image_url", "imageUrl", "url", "source"], issues);
    const image = value.image_url ?? value.imageUrl ?? value.url;
    if (typeof image === "string") {
      const decoded = decodeDataUrl(image);
      if (decoded !== undefined) return [providerBlock(format, path, options, { origin: "attachment", media: mediaForMime(dataUrlMime(image) ?? "image/*"), content_bytes: decoded, role, placement })];
      return [opaqueProviderBlock(format, path, options, "attachment", "image reference", "image")];
    }
    if (isObject(image)) {
      unhandledKeys(image, pointerJoin(path, value.image_url !== undefined ? "image_url" : value.imageUrl !== undefined ? "imageUrl" : "url"), ["url", "data", "image_data", "mime_type", "mimeType"], issues);
      const nestedUrl = image.url ?? image.data ?? image.image_data;
      const decoded = decodeDataUrl(nestedUrl) ?? decodeBase64(nestedUrl);
      if (decoded !== undefined) return [providerBlock(format, path, options, { origin: "attachment", media: mediaForMime(image.mime_type ?? image.mimeType ?? dataUrlMime(nestedUrl) ?? "image/*"), content_bytes: decoded, role, placement })];
      return [opaqueProviderBlock(format, path, options, "attachment", "image reference", "image")];
    }
    const source = isObject(value.source) ? value.source : value;
    if (isObject(value.source)) unhandledKeys(value.source, pointerJoin(path, "source"), ["type", "data", "image_data", "media_type"], issues);
    const decoded = isObject(source) ? decodeBase64(source.data ?? source.image_data) : undefined;
    if (decoded !== undefined) return [providerBlock(format, path, options, { origin: "attachment", media: "image", content_bytes: decoded, role, placement })];
  }
  if (type === "input_audio" || type === "audio") {
    unhandledKeys(value, path, ["type", "input_audio", "data"], issues);
    const audio = isObject(value.input_audio) ? value.input_audio : value;
    if (isObject(value.input_audio)) unhandledKeys(value.input_audio, pointerJoin(path, "input_audio"), ["data"], issues);
    const decoded = isObject(audio) ? (decodeDataUrl(audio.data) ?? decodeBase64(audio.data)) : undefined;
    if (decoded !== undefined) return [providerBlock(format, path, options, { origin: "attachment", media: "audio", content_bytes: decoded, role, placement })];
    return [opaqueProviderBlock(format, path, options, "attachment", "audio reference", "audio")];
  }
  if (type === "input_video" || type === "video") {
    unhandledKeys(value, path, ["type"], issues);
    return [opaqueProviderBlock(format, path, options, "attachment", "video reference", "video")];
  }
  if (type === "document" || type === "input_file" || type === "file") {
    unhandledKeys(value, path, ["type", "source", "data", "file_data", "file_id", "file_url"], issues);
    const source = isObject(value.source) ? value.source : value;
    if (isObject(value.source)) unhandledKeys(value.source, pointerJoin(path, "source"), ["type", "data", "file_data", "url", "media_type"], issues);
    const encoded = isObject(source) ? source.data ?? source.file_data : undefined;
    const decoded = decodeDataUrl(encoded) ?? decodeBase64(encoded);
    if (decoded !== undefined) return [providerBlock(format, path, options, { origin: "attachment", media: "document", content_bytes: decoded, role, placement })];
    return [opaqueProviderBlock(format, path, options, "attachment", "document reference", "document")];
  }
  if (type === "file_data" || type === "inline_data" || value.inlineData !== undefined || value.fileData !== undefined) {
    unhandledKeys(value, path, ["type", "inlineData", "inline_data", "fileData", "file_data"], issues);
    const inline = isObject(value.inlineData) ? value.inlineData : isObject(value.inline_data) ? value.inline_data : undefined;
    if (inline !== undefined) {
      unhandledKeys(inline, pointerJoin(path, value.inlineData !== undefined ? "inlineData" : "inline_data"), ["data", "mimeType", "mime_type"], issues);
      const decoded = decodeDataUrl(inline.data) ?? decodeBase64(inline.data);
      if (decoded !== undefined) return [providerBlock(format, path, options, { origin: "attachment", media: mediaForMime(inline.mimeType ?? inline.mime_type), content_bytes: decoded, role, placement })];
    }
    if (isObject(value.fileData)) unhandledKeys(value.fileData, pointerJoin(path, "fileData"), ["fileUri", "mimeType"], issues);
    return [opaqueProviderBlock(format, path, options, "attachment", "file reference", "document")];
  }
  if (type === "tool_use" || type === "tool_result" || type === "function_call" || type === "function_call_output" || type === "functionResponse" || type === "functionCall") {
    return [structuredProviderBlock(format, path, options, value, type === "tool_result" || type === "function_call_output" || type === "functionResponse" ? "tool_result" : "assistant_output", type === "tool_result" || type === "function_call_output" || type === "functionResponse" ? "tool" : role, type === "tool_result" || type === "function_call_output" || type === "functionResponse" ? "tool_result" : placement)];
  }
  if (value.functionCall !== undefined || value.functionResponse !== undefined || value.executableCode !== undefined || value.codeExecutionResult !== undefined || value.thoughtSignature !== undefined) {
    const toolResult = value.functionResponse !== undefined || value.codeExecutionResult !== undefined;
    return [structuredProviderBlock(format, path, options, value, toolResult ? "tool_result" : "assistant_output", toolResult ? "tool" : role, toolResult ? "tool_result" : placement)];
  }
  if (type === "thinking" || type === "redacted_thinking" || type === "reasoning") return [structuredProviderBlock(format, path, options, value, "assistant_output", "assistant", placement)];
  if (value.text !== undefined && typeof value.text === "string") {
    unhandledKeys(value, path, ["text"], issues);
    return [textProviderBlock(format, pointerJoin(path, "text"), options, value.text, fallbackOrigin, role, placement)];
  }
  issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} has unsupported content type ${type ?? "unknown"}`, severity: "warning" });
  return [structuredProviderBlock(format, path, options, value, "unknown", role, placement)];
}

function overrideFact(options: CaptureProviderOptions, path: string, value: unknown): HarnessFact | undefined {
  if (value === undefined || typeof value === "object" || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  return { value, evidence: "observed", source_refs: [{ source_id: options.artifact.id, record: path }] };
}

function unhandledKeys(input: JsonObject, path: string, handled: string[], issues: ContextIssue[]): void {
  for (const key of Object.keys(input)) if (!handled.includes(key)) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${pointerJoin(path, key)} is not represented by this adapter`, severity: "warning" });
}

function collectScalarOverrides(options: CaptureProviderOptions, input: JsonObject, paths: Array<[string, string]>, issues: ContextIssue[]): Record<string, HarnessFact> {
  const result: Record<string, HarnessFact> = {};
  for (const [key, path] of paths) {
    const fact = overrideFact(options, path, input[key]);
    if (fact !== undefined) result[key] = fact;
    else if (input[key] !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} cannot be represented as a scalar request setting`, severity: "warning" });
  }
  return result;
}

function parseOpenAI(input: JsonObject, options: CaptureProviderOptions): ParsedProviderRequest {
  const format = "openai-responses";
  const blocks: ContextBlockInput[] = [];
  const issues: ContextIssue[] = [];
  const known = new Set(["model", "instructions", "input", "tools", "text", "response_format", "previous_response_id", "conversation", "temperature", "max_output_tokens", "top_p", "reasoning", "stream", "store", "service_tier", "truncation", "parallel_tool_calls", "tool_choice", "prompt_cache_retention"]);
  for (const key of Object.keys(input)) if (!known.has(key)) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `/${key} is not parsed by the OpenAI Responses adapter`, severity: "warning" });
  if (typeof input.instructions === "string" || Array.isArray(input.instructions)) blocks.push(...parseTextOrParts(format, "/instructions", input.instructions, options, "system", "instruction", "system_instruction", issues));
  else if (input.instructions !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/instructions has unsupported shape", severity: "warning" });
  if (input.input !== undefined) {
    if (typeof input.input === "string") blocks.push(textProviderBlock(format, "/input", options, input.input, "user_prompt", "user", "current_turn"));
    else if (Array.isArray(input.input)) {
      for (let index = 0; index < input.input.length; index += 1) {
        const path = pointerJoin("/input", index);
        const item = input.input[index];
        if (typeof item === "string") blocks.push(textProviderBlock(format, path, options, item, "user_prompt", "user", "current_turn"));
        else if (isObject(item)) {
          const role = roleOf(item.role ?? (item.type === "function_call_output" ? "tool" : item.type === "function_call" ? "assistant" : "user"));
          const origin = annotationOrigin(path, "unknown", options).origin;
          if (item.content !== undefined) unhandledKeys(item, path, ["role", "content", "type"], issues);
          if (role === "unknown") issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path}/role is not represented`, severity: "warning" });
          blocks.push(...parseTextOrParts(format, item.content !== undefined ? pointerJoin(path, "content") : path, item.content ?? item, options, role, role === "tool" ? "tool_result" : "current_turn", origin, issues));
        } else issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} is not an object or text`, severity: "warning" });
      }
    } else issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/input has unsupported shape", severity: "warning" });
  }
  if (Array.isArray(input.tools)) for (let index = 0; index < input.tools.length; index += 1) blocks.push(structuredProviderBlock(format, pointerJoin("/tools", index), options, input.tools[index], "tool_schema", "unknown", "tool_definition"));
  else if (input.tools !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/tools has unsupported shape", severity: "warning" });
  if (isObject(input.text) && input.text.format !== undefined) blocks.push(structuredProviderBlock(format, "/text/format", options, input.text.format, "output_schema", "unknown", "instruction"));
  else if (input.text !== undefined && !isObject(input.text)) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/text has unsupported shape", severity: "warning" });
  if (input.response_format !== undefined) blocks.push(structuredProviderBlock(format, "/response_format", options, input.response_format, "output_schema", "unknown", "instruction"));
  if (input.previous_response_id !== undefined) blocks.push(opaqueProviderBlock(format, "/previous_response_id", options, "delegated_context", "previous response reference"));
  if (input.conversation !== undefined) blocks.push(opaqueProviderBlock(format, "/conversation", options, "conversation_history", "conversation reference"));
  const overrides = collectScalarOverrides(options, input, [["model", "/model"], ["temperature", "/temperature"], ["max_output_tokens", "/max_output_tokens"], ["top_p", "/top_p"], ["stream", "/stream"], ["store", "/store"], ["service_tier", "/service_tier"], ["truncation", "/truncation"], ["tool_choice", "/tool_choice"], ["parallel_tool_calls", "/parallel_tool_calls"], ["prompt_cache_retention", "/prompt_cache_retention"]], issues);
  if (isObject(input.text)) {
    unhandledKeys(input.text, "/text", ["format", "verbosity"], issues);
    for (const [key, fact] of Object.entries(collectScalarOverrides(options, input.text, [["verbosity", "/text/verbosity"]], issues))) overrides[`text.${key}`] = fact;
  }
  if (isObject(input.reasoning)) {
    unhandledKeys(input.reasoning, "/reasoning", ["effort", "summary"], issues);
    for (const [key, fact] of Object.entries(collectScalarOverrides(options, input.reasoning, [["effort", "/reasoning/effort"], ["summary", "/reasoning/summary"]], issues))) overrides[`reasoning.${key}`] = fact;
  } else if (input.reasoning !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/reasoning has unsupported shape", severity: "warning" });
  return { blocks, overrides, issues, unsupported: issues.length > 0 };
}

function parseAnthropic(input: JsonObject, options: CaptureProviderOptions): ParsedProviderRequest {
  const format = "anthropic-messages";
  const blocks: ContextBlockInput[] = [];
  const issues: ContextIssue[] = [];
  const known = new Set(["model", "system", "messages", "max_tokens", "max_tokens_to_sample", "temperature", "top_p", "top_k", "stream", "tools", "tool_choice", "output_config", "response_format", "container", "context_management", "service_tier", "thinking"]);
  for (const key of Object.keys(input)) if (!known.has(key)) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `/${key} is not parsed by the Anthropic Messages adapter`, severity: "warning" });
  if (input.system !== undefined) blocks.push(...parseTextOrParts(format, "/system", input.system, options, "system", "instruction", "system_instruction", issues));
  if (Array.isArray(input.messages)) for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index];
    const path = pointerJoin("/messages", index);
    if (!isObject(message)) { issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} is not an object`, severity: "warning" }); continue; }
    const role = roleOf(message.role);
    unhandledKeys(message, path, ["role", "content"], issues);
    if (role === "unknown") issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path}/role is not represented`, severity: "warning" });
    blocks.push(...parseTextOrParts(format, pointerJoin(path, "content"), message.content, options, role, role === "tool" ? "tool_result" : "current_turn", "unknown", issues));
  } else if (input.messages !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/messages has unsupported shape", severity: "warning" });
  if (Array.isArray(input.tools)) for (let index = 0; index < input.tools.length; index += 1) blocks.push(structuredProviderBlock(format, pointerJoin("/tools", index), options, input.tools[index], "tool_schema", "unknown", "tool_definition"));
  else if (input.tools !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/tools has unsupported shape", severity: "warning" });
  if (isObject(input.output_config) && input.output_config.format !== undefined) blocks.push(structuredProviderBlock(format, "/output_config/format", options, input.output_config.format, "output_schema", "unknown", "instruction"));
  else if (input.output_config !== undefined && !isObject(input.output_config)) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/output_config has unsupported shape", severity: "warning" });
  if (input.response_format !== undefined) blocks.push(structuredProviderBlock(format, "/response_format", options, input.response_format, "output_schema", "unknown", "instruction"));
  if (input.container !== undefined) blocks.push(opaqueProviderBlock(format, "/container", options, "memory", "container server state reference"));
  if (input.context_management !== undefined) blocks.push(opaqueProviderBlock(format, "/context_management", options, "memory", "context management server state reference"));
  const overrides = collectScalarOverrides(options, input, [["model", "/model"], ["max_tokens", "/max_tokens"], ["max_tokens_to_sample", "/max_tokens_to_sample"], ["temperature", "/temperature"], ["top_p", "/top_p"], ["top_k", "/top_k"], ["stream", "/stream"], ["service_tier", "/service_tier"], ["tool_choice", "/tool_choice"]], issues);
  if (isObject(input.output_config)) {
    unhandledKeys(input.output_config, "/output_config", ["format", "effort"], issues);
    for (const [key, fact] of Object.entries(collectScalarOverrides(options, input.output_config, [["effort", "/output_config/effort"]], issues))) overrides[`output_config.${key}`] = fact;
  }
  if (isObject(input.thinking)) {
    unhandledKeys(input.thinking, "/thinking", ["type", "budget_tokens"], issues);
    for (const [key, fact] of Object.entries(collectScalarOverrides(options, input.thinking, [["type", "/thinking/type"], ["budget_tokens", "/thinking/budget_tokens"]], issues))) overrides[`thinking.${key}`] = fact;
  } else if (input.thinking !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/thinking has unsupported shape", severity: "warning" });
  return { blocks, overrides, issues, unsupported: issues.length > 0 };
}

function parseGemini(input: JsonObject, options: CaptureProviderOptions): ParsedProviderRequest {
  const format = "gemini-content";
  const blocks: ContextBlockInput[] = [];
  const issues: ContextIssue[] = [];
  const known = new Set(["model", "contents", "systemInstruction", "system_instruction", "tools", "generationConfig", "cachedContent"]);
  for (const key of Object.keys(input)) if (!known.has(key)) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `/${key} is not parsed by the Gemini Content adapter`, severity: "warning" });
  const systemKey = input.systemInstruction !== undefined ? "systemInstruction" : "system_instruction";
  const system = input[systemKey];
  if (input.systemInstruction !== undefined && input.system_instruction !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/system_instruction conflicts with the also-present /systemInstruction alias", severity: "warning" });
  if (system !== undefined) {
    if (isObject(system) && Array.isArray(system.parts)) {
      unhandledKeys(system, `/${systemKey}`, ["parts", "role"], issues);
      blocks.push(...parseTextOrParts(format, `/${systemKey}/parts`, system.parts, options, "system", "instruction", "system_instruction", issues));
    } else blocks.push(...parseTextOrParts(format, `/${systemKey}`, system, options, "system", "instruction", "system_instruction", issues));
  }
  if (Array.isArray(input.contents)) for (let index = 0; index < input.contents.length; index += 1) {
    const content = input.contents[index];
    const path = pointerJoin("/contents", index);
    if (!isObject(content)) { issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path} is not an object`, severity: "warning" }); continue; }
    const role = roleOf(content.role);
    unhandledKeys(content, path, ["role", "parts"], issues);
    if (role === "unknown") issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path}/role is not represented`, severity: "warning" });
    if (!Array.isArray(content.parts)) { issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: `${path}/parts is not an array`, severity: "warning" }); continue; }
    blocks.push(...parseTextOrParts(format, pointerJoin(path, "parts"), content.parts, options, role, role === "tool" ? "tool_result" : "current_turn", "unknown", issues));
  } else if (input.contents !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/contents has unsupported shape", severity: "warning" });
  if (Array.isArray(input.tools)) for (let index = 0; index < input.tools.length; index += 1) blocks.push(structuredProviderBlock(format, pointerJoin("/tools", index), options, input.tools[index], "tool_schema", "unknown", "tool_definition"));
  else if (input.tools !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/tools has unsupported shape", severity: "warning" });
  if (isObject(input.generationConfig)) {
    if (input.generationConfig.responseSchema !== undefined) blocks.push(structuredProviderBlock(format, "/generationConfig/responseSchema", options, input.generationConfig.responseSchema, "output_schema", "unknown", "instruction"));
    if (input.generationConfig.responseJsonSchema !== undefined) blocks.push(structuredProviderBlock(format, "/generationConfig/responseJsonSchema", options, input.generationConfig.responseJsonSchema, "output_schema", "unknown", "instruction"));
  } else if (input.generationConfig !== undefined) issues.push({ code: "UNSUPPORTED_PROVIDER_FIELD", message: "/generationConfig has unsupported shape", severity: "warning" });
  if (input.cachedContent !== undefined) blocks.push(opaqueProviderBlock(format, "/cachedContent", options, "memory", "cached content server state reference"));
  const overrides = collectScalarOverrides(options, input, [["model", "/model"]], issues);
  if (isObject(input.generationConfig)) {
    const settings = ["temperature", "topP", "topK", "maxOutputTokens", "candidateCount", "seed", "responseMimeType"];
    unhandledKeys(input.generationConfig, "/generationConfig", [...settings, "responseSchema", "responseJsonSchema"], issues);
    for (const [key, fact] of Object.entries(collectScalarOverrides(options, input.generationConfig, settings.map(key => [key, `/generationConfig/${key}`]), issues))) overrides[`generationConfig.${key}`] = fact;
  }
  return { blocks, overrides, issues, unsupported: issues.length > 0 };
}

/**
 * Adapt explicitly supplied OpenAI Responses, Anthropic Messages, or Gemini
 * Content JSON into the same raw-free capture boundary as generic blocks.
 */
export function captureProviderRequest(format: string, input: unknown, options: CaptureProviderOptions): ContextBundle {
  nonEmpty(format, "provider format");
  assertObject(input, "provider request");
  assertObject(options, "provider options");
  nonEmpty(options.dataset_id, "provider options.dataset_id");
  nonEmpty(options.namespace, "provider options.namespace");
  nonEmpty(options.request_id, "provider options.request_id");
  assertObject(options.profile, "provider options.profile");
  assertArray(options.profile.artifacts, "provider options.profile.artifacts");
  nonEmpty(options.profile.id, "provider options.profile.id");
  validateAnnotationMaps(options);
  const profile = captureInternals.clone(options.profile);
  const artifact = captureInternals.validateSource(options.artifact, "provider options.artifact");
  if (options.profile_id !== undefined && options.profile_id !== profile.id) throw error("CONTEXT_PROFILE_REFERENCE_MISMATCH", "provider profile_id does not match profile.id");
  if (options.artifact_id !== undefined && options.artifact_id !== artifact.id) throw error("CONTEXT_ARTIFACT_REFERENCE_MISMATCH", "provider artifact_id does not match artifact.id");
  const normalizedFormat = format.toLowerCase();
  const canonicalFormat = normalizedFormat === "openai" || normalizedFormat === "openai_responses" || normalizedFormat === "openai.responses"
    ? "openai-responses"
    : normalizedFormat === "anthropic" || normalizedFormat === "anthropic_messages" || normalizedFormat === "anthropic.messages"
      ? "anthropic-messages"
      : normalizedFormat === "gemini" || normalizedFormat === "gemini_content" || normalizedFormat === "gemini_generate_content" || normalizedFormat === "google-gemini"
        ? "gemini-content"
        : normalizedFormat;
  let parsed: ParsedProviderRequest;
  if (canonicalFormat === "openai-responses") parsed = parseOpenAI(input, { ...options, profile, artifact });
  else if (canonicalFormat === "anthropic-messages") parsed = parseAnthropic(input, { ...options, profile, artifact });
  else if (canonicalFormat === "gemini-content") parsed = parseGemini(input, { ...options, profile, artifact });
  else throw error("CONTEXT_PROVIDER_FORMAT_UNSUPPORTED", `unsupported provider request format ${format}`);
  const coverage = options.coverage ?? (parsed.unsupported ? "partial" : "complete");
  const coverageEvidence = options.coverage_evidence ?? (coverage === "unknown" ? "unknown" : "observed");
  const bundle = captureRequestContext({
    dataset_id: options.dataset_id,
    request_id: options.request_id,
    observation_id: options.observation_id,
    captured_at: options.captured_at,
    profile,
    boundary: "client_request",
    coverage: parsed.unsupported && coverage === "complete" ? "partial" : coverage,
    coverage_evidence: parsed.unsupported && coverage === "complete" ? "observed" : coverageEvidence,
    artifact,
    record: "/",
    blocks: parsed.blocks,
    overrides: mergeOverrideMaps(options.overrides ?? {}, parsed.overrides),
  });
  const request = bundle.requests[0];
  if (request === undefined) throw error("CONTEXT_CAPTURE_INTERNAL", "provider capture did not create a request");
  const withIssues: ContextBundle = {
    ...bundle,
    issues: sortIssues([...bundle.issues, ...parsed.issues.map((issue) => ({ ...issue, request_id: issue.request_id ?? request.id }))]),
  };
  return finishBundle(withIssues);
}
