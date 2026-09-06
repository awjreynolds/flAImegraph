import { readFileSync } from "node:fs";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import { CoreError, validateEvidence } from "./core.js";
import type { EvidenceBundle, Observation, Source, SourceRef } from "./types.js";
import type {
  ContextBundle,
  ContextIssue,
  ContextMeasurement,
  ContextOccurrence,
  ContextRevision,
  ContextSource,
  ContextTransformation,
  HarnessFact,
  HarnessProfile,
  RequestContext,
} from "./context-types.js";

const CONTEXT_SCHEMA_VERSION = "0.2.0" as const;
const EVIDENCE_SCHEMA_VERSION = "0.1.0" as const;

type JsonObject = Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false });

function loadSchema(name: string): JsonObject {
  try {
    const url = new URL(`../spec/0.2/schemas/${name}.schema.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")) as JsonObject;
  } catch (error) {
    throw new CoreError("CONTEXT_SCHEMA_UNAVAILABLE", `Unable to load the ${name} context schema`, error);
  }
}

const harnessProfileValidator = ajv.compile(loadSchema("harness-profile"));
const contextBundleValidator = ajv.compile(loadSchema("context"));

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "schema validation failed";
  return errors
    .slice(0, 3)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new CoreError("CONTEXT_INVALID_STRING", `${label} must not be empty`);
}

function assertSourceRefs(refs: SourceRef[], artifacts: Map<string, Source>, label: string): void {
  for (const [index, sourceRef] of refs.entries()) {
    assertNonEmpty(sourceRef.source_id, `${label}[${index}].source_id`);
    assertNonEmpty(sourceRef.record, `${label}[${index}].record`);
    if (!artifacts.has(sourceRef.source_id)) {
      throw new CoreError(
        "CONTEXT_ARTIFACT_REFERENCE_MISSING",
        `${label}[${index}] references missing artifact ${sourceRef.source_id}`,
      );
    }
  }
}

function assertEvidenceSourceRefs(
  evidence: "observed" | "declared" | "estimated" | "derived" | "counterfactual" | "unknown" | "unavailable",
  refs: SourceRef[],
  label: string,
): void {
  if (evidence === "observed" && refs.length === 0) {
    throw new CoreError("CONTEXT_PROVENANCE_MISSING", `${label} observed evidence must have a source reference`);
  }
}

function assertHarnessFact(fact: HarnessFact, artifacts: Map<string, Source>, label: string): void {
  if (typeof fact.value === "string") assertNonEmpty(fact.value, `${label}.value`);
  if (typeof fact.value === "number" && !Number.isFinite(fact.value)) {
    throw new CoreError("CONTEXT_INVALID_NUMBER", `${label} number must be finite`);
  }
  if (fact.value === null && fact.evidence !== "unknown") {
    throw new CoreError("CONTEXT_UNKNOWN_INCOHERENT", `${label} with a null value must have unknown evidence`);
  }
  if (fact.value !== null && fact.evidence === "unknown") {
    throw new CoreError("CONTEXT_UNKNOWN_INCOHERENT", `${label} with a value cannot have unknown evidence`);
  }
  assertEvidenceSourceRefs(fact.evidence, fact.source_refs, label);
  assertSourceRefs(fact.source_refs, artifacts, `${label}.source_refs`);
}

function validateProfileSemantics(profile: HarnessProfile, artifactRegistry?: Map<string, Source>): HarnessProfile {
  if (profile.schema_version !== CONTEXT_SCHEMA_VERSION) {
    throw new CoreError("CONTEXT_UNSUPPORTED_SCHEMA_VERSION", "harness profile schema version must be 0.2.0");
  }
  const ownArtifacts = new Map<string, Source>();
  for (const artifact of profile.artifacts) {
    assertNonEmpty(artifact.id, "profile.artifacts.id");
    if (ownArtifacts.has(artifact.id)) {
      throw new CoreError("CONTEXT_ARTIFACT_CONFLICT", `duplicate profile artifact id ${artifact.id}`);
    }
    ownArtifacts.set(artifact.id, artifact);
  }
  const artifacts = artifactRegistry ?? ownArtifacts;

  for (const [key, fact] of Object.entries(profile.model.settings)) {
    assertNonEmpty(key, "profile.model.settings key");
    assertHarnessFact(fact, artifacts, `profile.model.settings.${key}`);
  }
  assertHarnessFact(profile.harness_version, artifacts, "profile.harness_version");
  assertHarnessFact(profile.model.provider, artifacts, "profile.model.provider");
  assertHarnessFact(profile.model.name, artifacts, "profile.model.name");
  for (const [index, instruction] of profile.instruction_sources.entries()) {
    assertEvidenceSourceRefs(instruction.evidence, instruction.source_refs, `profile.instruction_sources[${index}]`);
    assertSourceRefs(instruction.source_refs, artifacts, `profile.instruction_sources[${index}].source_refs`);
    if (instruction.origin === "unknown" && instruction.evidence !== "unknown") {
      throw new CoreError(
        "CONTEXT_UNKNOWN_INCOHERENT",
        `profile.instruction_sources[${index}] unknown origin must have unknown evidence`,
      );
    }
  }
  const toolIds = new Set<string>();
  for (const [index, tool] of profile.tools.entries()) {
    if (toolIds.has(tool.id)) throw new CoreError("CONTEXT_ID_DUPLICATE", `duplicate profile tool id ${tool.id}`);
    toolIds.add(tool.id);
    assertEvidenceSourceRefs(tool.evidence, tool.source_refs, `profile.tools[${index}]`);
    assertSourceRefs(tool.source_refs, artifacts, `profile.tools[${index}].source_refs`);
    if (tool.definition_sha256 === null) {
      if (tool.definition_evidence !== "unknown" || tool.definition_method !== null) {
        throw new CoreError(
          "CONTEXT_UNKNOWN_INCOHERENT",
          `profile.tools[${index}] unavailable definition must have unknown evidence and null method`,
        );
      }
    } else {
      if (tool.definition_evidence === "unknown" || tool.definition_method === null) {
        throw new CoreError(
          "CONTEXT_UNKNOWN_INCOHERENT",
          `profile.tools[${index}] known definition must declare evidence and method`,
        );
      }
      assertNonEmpty(tool.definition_method, `profile.tools[${index}].definition_method`);
    }
  }
  for (const [index, capability] of profile.context_capabilities.entries()) {
    assertEvidenceSourceRefs(capability.evidence, capability.source_refs, `profile.context_capabilities[${index}]`);
    assertSourceRefs(capability.source_refs, artifacts, `profile.context_capabilities[${index}].source_refs`);
    if ((capability.capture === "unknown") !== (capability.evidence === "unknown")) {
      throw new CoreError(
        "CONTEXT_UNKNOWN_INCOHERENT",
        `profile.context_capabilities[${index}] unknown capture must have unknown evidence`,
      );
    }
    if (capability.origin === "unknown" && capability.evidence !== "unknown") {
      throw new CoreError(
        "CONTEXT_UNKNOWN_INCOHERENT",
        `profile.context_capabilities[${index}] unknown origin must have unknown evidence`,
      );
    }
  }
  for (const policy of ["assembly", "truncation", "compaction", "caching"] as const) {
    assertHarnessFact(profile.policies[policy], artifacts, `profile.policies.${policy}`);
  }
  return cloneJson(profile);
}

const NON_NEGATIVE_INTEGER_RE = /^(0|[1-9][0-9]*)$/;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const key of Object.keys(value).sort(compareText)) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function stableJson(value: unknown): string {
  const result = JSON.stringify(canonicalize(value));
  if (result === undefined) throw new CoreError("CONTEXT_INVALID_JSON", "context value is not JSON serializable");
  return result;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function indexUnique<T extends { id: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    assertNonEmpty(item.id, `${label}.id`);
    if (result.has(item.id)) throw new CoreError("CONTEXT_ID_DUPLICATE", `duplicate ${label} id ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function indexArtifacts(items: Source[], label: string): Map<string, Source> {
  return indexUnique(items, label);
}

function assertDateTime(value: string, label: string): void {
  const match = DATE_TIME_RE.exec(value);
  if (!match) throw new CoreError("CONTEXT_INVALID_DATE", `${label} must be an RFC3339 date-time`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    throw new CoreError("CONTEXT_INVALID_DATE", `${label} is not a real calendar date`);
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new CoreError("CONTEXT_INVALID_DATE", `${label} has an invalid time`);
  }
  const timezone = match[8] as string;
  if (timezone !== "Z") {
    const offsetHour = Number(timezone.slice(1, 3));
    const offsetMinute = Number(timezone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new CoreError("CONTEXT_INVALID_DATE", `${label} has an invalid timezone offset`);
    }
  }
  if (!Number.isFinite(Date.parse(value))) throw new CoreError("CONTEXT_INVALID_DATE", `${label} is invalid`);
}

function assertUniqueValues(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertNonEmpty(value, label);
    if (seen.has(value)) throw new CoreError("CONTEXT_ID_DUPLICATE", `duplicate ${label} ${value}`);
    seen.add(value);
  }
}

function validateMeasurement(
  measurement: ContextMeasurement,
  expectedUnit: ContextMeasurement["unit"],
  artifacts: Map<string, Source>,
  label: string,
): void {
  if (measurement.unit !== expectedUnit) {
    throw new CoreError(
      "CONTEXT_MEASUREMENT_UNIT_MISMATCH",
      `${label}.unit must be ${expectedUnit}, got ${measurement.unit}`,
    );
  }
  if (measurement.value === null) {
    if (measurement.evidence !== "unavailable") {
      throw new CoreError("CONTEXT_MEASUREMENT_UNKNOWN_INCOHERENT", `${label} null value must be unavailable`);
    }
  } else {
    if (!NON_NEGATIVE_INTEGER_RE.test(measurement.value)) {
      throw new CoreError("CONTEXT_MEASUREMENT_INVALID", `${label}.value must be a canonical non-negative integer string`);
    }
    if (measurement.evidence === "unavailable") {
      throw new CoreError("CONTEXT_MEASUREMENT_UNKNOWN_INCOHERENT", `${label} unavailable evidence must have a null value`);
    }
    if (measurement.source_refs.length === 0) {
      throw new CoreError("CONTEXT_PROVENANCE_MISSING", `${label} known measurement must have a source reference`);
    }
  }
  assertNonEmpty(measurement.method, `${label}.method`);
  assertEvidenceSourceRefs(measurement.evidence, measurement.source_refs, label);
  assertSourceRefs(measurement.source_refs, artifacts, `${label}.source_refs`);
}

function validateTreatment(
  treatment: ContextOccurrence["treatment"],
  artifacts: Map<string, Source>,
  label: string,
): void {
  if ((treatment.value === "unknown") !== (treatment.evidence === "unknown")) {
    throw new CoreError("CONTEXT_UNKNOWN_INCOHERENT", `${label} unknown treatment must have unknown evidence`);
  }
  assertNonEmpty(treatment.method, `${label}.method`);
  assertEvidenceSourceRefs(treatment.evidence, treatment.source_refs, label);
  assertSourceRefs(treatment.source_refs, artifacts, `${label}.source_refs`);
}

function validateRevisionSemantics(
  revision: ContextRevision,
  sources: Map<string, ContextSource>,
  artifacts: Map<string, Source>,
): void {
  if (!sources.has(revision.source_id)) {
    throw new CoreError("CONTEXT_SOURCE_REFERENCE_MISSING", `revision ${revision.id} references missing source ${revision.source_id}`);
  }
  validateMeasurement(revision.tokens, "tokens", artifacts, `revision ${revision.id}.tokens`);
  validateMeasurement(revision.bytes, "utf8_bytes", artifacts, `revision ${revision.id}.bytes`);
  if (revision.content_sha256 === null) {
    if (revision.fingerprint_evidence !== "unknown" || revision.fingerprint_method !== null) {
      throw new CoreError(
        "CONTEXT_FINGERPRINT_UNKNOWN_INCOHERENT",
        `revision ${revision.id} unknown fingerprint must have unknown evidence and null method`,
      );
    }
  } else {
    if (revision.fingerprint_evidence === "unknown" || revision.fingerprint_method === null) {
      throw new CoreError(
        "CONTEXT_FINGERPRINT_UNKNOWN_INCOHERENT",
        `revision ${revision.id} known fingerprint must have evidence and method`,
      );
    }
    assertNonEmpty(revision.fingerprint_method, `revision ${revision.id}.fingerprint_method`);
  }
  assertEvidenceSourceRefs(revision.fingerprint_evidence, revision.source_refs, `revision ${revision.id}.fingerprint`);
  assertSourceRefs(revision.source_refs, artifacts, `revision ${revision.id}.source_refs`);
  assertSourceRefs(revision.tokens.source_refs, artifacts, `revision ${revision.id}.tokens.source_refs`);
  assertSourceRefs(revision.bytes.source_refs, artifacts, `revision ${revision.id}.bytes.source_refs`);
}

function assertObservationLink(
  observationId: string | null,
  observationById: Map<string, Observation> | undefined,
  requestId: string,
): void {
  if (observationId === null || observationById === undefined) return;
  const observation = observationById.get(observationId);
  if (observation === undefined) {
    throw new CoreError("CONTEXT_OBSERVATION_REFERENCE_MISSING", `request ${requestId} references missing observation ${observationId}`);
  }
  if (observation.kind !== "model") {
    throw new CoreError(
      "CONTEXT_OBSERVATION_NOT_MODEL",
      `request ${requestId} must link a model observation, got ${observation.kind}`,
    );
  }
}

function assertTransformationAcyclic(transformations: ContextTransformation[]): void {
  const edges = new Map<string, Set<string>>();
  for (const transformation of transformations) {
    for (const from of transformation.from_revision_ids) {
      const outgoing = edges.get(from) ?? new Set<string>();
      for (const to of transformation.to_revision_ids) outgoing.add(to);
      edges.set(from, outgoing);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) throw new CoreError("CONTEXT_TRANSFORMATION_CYCLE", `transformation cycle includes ${node}`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) visit(next);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
}

function validateWithSchema<T>(value: unknown, validator: ValidateFunction, code: string): asserts value is T {
  try {
    if (!validator(value)) {
      throw new CoreError(code, `${code}: ${validationMessage(validator.errors)}`, validator.errors);
    }
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(code, `${code}: schema validation failed`, error);
  }
}

/** Validate and clone an immutable v0.2 Harness Profile. */
export function validateHarnessProfile(value: unknown): HarnessProfile {
  validateWithSchema<HarnessProfile>(value, harnessProfileValidator, "CONTEXT_PROFILE_SCHEMA_INVALID");
  if (!isObject(value)) throw new CoreError("CONTEXT_PROFILE_SCHEMA_INVALID", "harness profile must be an object");
  return validateProfileSemantics(value as HarnessProfile);
}

function validateBundleSemantics(input: ContextBundle, evidence?: EvidenceBundle): ContextBundle {
  if (input.schema_version !== CONTEXT_SCHEMA_VERSION) {
    throw new CoreError("CONTEXT_UNSUPPORTED_SCHEMA_VERSION", "context bundle schema version must be 0.2.0");
  }
  if (input.evidence_schema_version !== EVIDENCE_SCHEMA_VERSION) {
    throw new CoreError("CONTEXT_EVIDENCE_SCHEMA_UNSUPPORTED", "context bundle evidence schema version must be 0.1.0");
  }

  const bundleArtifacts = indexArtifacts(input.artifacts, "context artifact");
  const allArtifacts = new Map(bundleArtifacts);
  const profileMap = new Map<string, HarnessProfile>();
  for (const profile of input.profiles) {
    const ownArtifacts = indexArtifacts(profile.artifacts, `profile ${profile.id} artifact`);
    for (const artifact of ownArtifacts.values()) {
      const existing = allArtifacts.get(artifact.id);
      if (existing !== undefined && !sameJson(existing, artifact)) {
        throw new CoreError("CONTEXT_ARTIFACT_CONFLICT", `artifact ${artifact.id} has conflicting metadata`);
      }
      allArtifacts.set(artifact.id, artifact);
    }
  }
  const normalizedProfiles: HarnessProfile[] = [];
  for (const profile of input.profiles) {
    validateWithSchema<HarnessProfile>(profile, harnessProfileValidator, "CONTEXT_PROFILE_SCHEMA_INVALID");
    if (!isObject(profile)) throw new CoreError("CONTEXT_PROFILE_SCHEMA_INVALID", "harness profile must be an object");
    const normalizedProfile = validateProfileSemantics(profile, allArtifacts);
    if (profileMap.has(normalizedProfile.id)) {
      throw new CoreError("CONTEXT_ID_DUPLICATE", `duplicate harness profile id ${normalizedProfile.id}`);
    }
    profileMap.set(normalizedProfile.id, normalizedProfile);
    normalizedProfiles.push(normalizedProfile);
  }

  const sourceMap = indexUnique(input.sources, "context source");
  for (const source of input.sources) {
    if (source.origin === "unknown" && source.origin_evidence !== "unknown") {
      throw new CoreError("CONTEXT_UNKNOWN_INCOHERENT", `source ${source.id} unknown origin must have unknown evidence`);
    }
    assertEvidenceSourceRefs(source.origin_evidence, source.source_refs, `source ${source.id}`);
    assertSourceRefs(source.source_refs, allArtifacts, `source ${source.id}.source_refs`);
  }

  const revisionMap = indexUnique(input.revisions, "context revision");
  for (const revision of input.revisions) {
    validateRevisionSemantics(revision, sourceMap, allArtifacts);
  }
  for (const source of input.sources) {
    if (source.identity_basis === "producer" && source.source_refs.length === 0) {
      throw new CoreError("CONTEXT_PROVENANCE_MISSING", `source ${source.id} with producer identity must have a source reference`);
    }
    if (source.identity_basis === "content_fingerprint") {
      const hasFingerprint = input.revisions.some(
        (revision) =>
          revision.source_id === source.id &&
          revision.content_sha256 !== null &&
          revision.fingerprint_evidence !== "unknown",
      );
      if (!hasFingerprint) {
        throw new CoreError(
          "CONTEXT_FINGERPRINT_REFERENCE_MISSING",
          `source ${source.id} with content_fingerprint identity must have a known revision fingerprint`,
        );
      }
    }
  }

  let normalizedEvidence: EvidenceBundle | undefined;
  let observationsById: Map<string, Observation> | undefined;
  if (evidence !== undefined) {
    normalizedEvidence = validateEvidence(evidence);
    if (normalizedEvidence.dataset_id !== input.dataset_id) {
      throw new CoreError(
        "CONTEXT_EVIDENCE_DATASET_MISMATCH",
        `context dataset ${input.dataset_id} differs from evidence dataset ${normalizedEvidence.dataset_id}`,
      );
    }
    observationsById = new Map(normalizedEvidence.observations.map((observation) => [observation.id, observation]));
  }

  const requestMap = indexUnique(input.requests, "context request");
  const occurrenceIds = new Set<string>();
  for (const request of input.requests) {
    if (!profileMap.has(request.profile_id)) {
      throw new CoreError("CONTEXT_PROFILE_REFERENCE_MISSING", `request ${request.id} references missing profile ${request.profile_id}`);
    }
    if (request.captured_at !== null) assertDateTime(request.captured_at, `request ${request.id}.captured_at`);
    if ((request.coverage === "unknown") !== (request.coverage_evidence === "unknown")) {
      throw new CoreError("CONTEXT_UNKNOWN_INCOHERENT", `request ${request.id} coverage and coverage_evidence disagree`);
    }
    if (request.coverage === "complete" && (request.boundary === "transcript_reconstruction" || request.boundary === "unavailable")) {
      throw new CoreError(
        "CONTEXT_COMPLETENESS_INVALID",
        `request ${request.id} cannot claim complete coverage at ${request.boundary} boundary`,
      );
    }
    if (request.boundary === "unavailable" && request.occurrences.length > 0) {
      throw new CoreError(
        "CONTEXT_UNAVAILABLE_OCCURRENCES",
        `request ${request.id} with an unavailable boundary cannot contain occurrences`,
      );
    }
    assertEvidenceSourceRefs(request.coverage_evidence, request.source_refs, `request ${request.id}.coverage`);
    assertSourceRefs(request.source_refs, allArtifacts, `request ${request.id}.source_refs`);
    if (request.observation_id !== null) {
      assertObservationLink(request.observation_id, observationsById, request.id);
    }
    for (const occurrence of request.occurrences) {
      if (occurrenceIds.has(occurrence.id)) {
        throw new CoreError("CONTEXT_ID_DUPLICATE", `duplicate context occurrence id ${occurrence.id}`);
      }
      occurrenceIds.add(occurrence.id);
      if (!revisionMap.has(occurrence.revision_id)) {
        throw new CoreError(
          "CONTEXT_REVISION_REFERENCE_MISSING",
          `occurrence ${occurrence.id} references missing revision ${occurrence.revision_id}`,
        );
      }
      validateTreatment(occurrence.treatment, allArtifacts, `occurrence ${occurrence.id}.treatment`);
    }
    for (const [key, fact] of Object.entries(request.overrides)) {
      assertNonEmpty(key, `request ${request.id}.overrides key`);
      assertHarnessFact(fact, allArtifacts, `request ${request.id}.overrides.${key}`);
    }
  }

  const transformationMap = indexUnique(input.transformations, "context transformation");
  for (const transformation of input.transformations) {
    assertUniqueValues(transformation.from_revision_ids, `transformation ${transformation.id}.from_revision_ids`);
    assertUniqueValues(transformation.to_revision_ids, `transformation ${transformation.id}.to_revision_ids`);
    for (const revisionId of [...transformation.from_revision_ids, ...transformation.to_revision_ids]) {
      if (!revisionMap.has(revisionId)) {
        throw new CoreError(
          "CONTEXT_REVISION_REFERENCE_MISSING",
          `transformation ${transformation.id} references missing revision ${revisionId}`,
        );
      }
    }
    assertSourceRefs(transformation.source_refs, allArtifacts, `transformation ${transformation.id}.source_refs`);
    if (transformation.observation_id !== null && observationsById !== undefined && !observationsById.has(transformation.observation_id)) {
      throw new CoreError(
        "CONTEXT_OBSERVATION_REFERENCE_MISSING",
        `transformation ${transformation.id} references missing observation ${transformation.observation_id}`,
      );
    }
  }
  assertTransformationAcyclic(input.transformations);

  for (const [index, contextIssue] of input.issues.entries()) {
    if (contextIssue.request_id !== undefined && !requestMap.has(contextIssue.request_id)) {
      throw new CoreError("CONTEXT_REQUEST_REFERENCE_MISSING", `issue ${index} references missing request ${contextIssue.request_id}`);
    }
    if (contextIssue.source_id !== undefined && !sourceMap.has(contextIssue.source_id)) {
      throw new CoreError("CONTEXT_SOURCE_REFERENCE_MISSING", `issue ${index} references missing source ${contextIssue.source_id}`);
    }
    if (contextIssue.revision_id !== undefined && !revisionMap.has(contextIssue.revision_id)) {
      throw new CoreError("CONTEXT_REVISION_REFERENCE_MISSING", `issue ${index} references missing revision ${contextIssue.revision_id}`);
    }
  }

  return cloneJson({ ...input, profiles: normalizedProfiles });
}

/** Validate and clone a v0.2 context bundle. */
export function validateContextBundle(value: unknown, evidence?: EvidenceBundle): ContextBundle {
  validateWithSchema<ContextBundle>(value, contextBundleValidator, "CONTEXT_BUNDLE_SCHEMA_INVALID");
  if (!isObject(value)) throw new CoreError("CONTEXT_BUNDLE_SCHEMA_INVALID", "context bundle must be an object");
  return validateBundleSemantics(value as ContextBundle, evidence);
}

function withoutProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutProvenance(item));
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const key of Object.keys(value)) {
      if (key !== "source_refs") result[key] = withoutProvenance(value[key]);
    }
    return result;
  }
  return value;
}

function mergeSourceRefs(left: SourceRef[], right: SourceRef[]): SourceRef[] {
  const refs = new Map<string, SourceRef>();
  for (const ref of [...left, ...right]) refs.set(stableJson(ref), ref);
  return [...refs.values()].sort((a, b) => {
    const sourceOrder = compareText(a.source_id, b.source_id);
    return sourceOrder || compareText(a.record, b.record);
  });
}

function mergeProvenance(left: unknown, right: unknown, label: string): unknown {
  if (!sameJson(withoutProvenance(left), withoutProvenance(right))) {
    throw new CoreError("CONTEXT_ID_CONFLICT", `${label} has conflicting semantic content`);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.map((item, index) => mergeProvenance(item, right[index], `${label}[${index}]`));
  }
  if (isObject(left) && isObject(right)) {
    const result: JsonObject = {};
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length || keys.some((key) => !(key in right))) {
      throw new CoreError("CONTEXT_ID_CONFLICT", `${label} has conflicting object shape`);
    }
    for (const key of keys) {
      if (key === "source_refs") {
        result[key] = mergeSourceRefs(left[key] as SourceRef[], right[key] as SourceRef[]);
      } else {
        result[key] = mergeProvenance(left[key], right[key], `${label}.${key}`);
      }
    }
    return result;
  }
  return left;
}

function mergeEntity<T extends { id: string }>(map: Map<string, T>, entity: T, label: string): void {
  const existing = map.get(entity.id);
  if (existing === undefined) {
    map.set(entity.id, entity);
  } else {
    map.set(entity.id, mergeProvenance(existing, entity, `${label} ${entity.id}`) as T);
  }
}

function sortedEntities<T extends { id: string }>(map: Map<string, T>): T[] {
  return [...map.values()].sort((left, right) => compareText(left.id, right.id));
}

/** Reconcile replayed v0.2 context bundles. */
export function reconcileContextBundles(bundles: ContextBundle[], evidence?: EvidenceBundle): ContextBundle {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    throw new CoreError("CONTEXT_EMPTY", "at least one context bundle is required");
  }
  const normalized = bundles.map((bundle) => validateContextBundle(bundle, evidence));
  const datasetId = normalized[0]?.dataset_id;
  if (datasetId === undefined) throw new CoreError("CONTEXT_EMPTY", "at least one context bundle is required");

  const artifacts = new Map<string, Source>();
  const profiles = new Map<string, HarnessProfile>();
  const sources = new Map<string, ContextSource>();
  const revisions = new Map<string, ContextRevision>();
  const requests = new Map<string, RequestContext>();
  const transformations = new Map<string, ContextTransformation>();
  const issueMap = new Map<string, ContextIssue>();

  for (const bundle of normalized) {
    if (bundle.dataset_id !== datasetId) {
      throw new CoreError("CONTEXT_DATASET_MISMATCH", "context bundles must have the same dataset_id");
    }
    for (const artifact of bundle.artifacts) mergeEntity(artifacts, artifact, "artifact");
    for (const profile of bundle.profiles) mergeEntity(profiles, profile, "profile");
    for (const source of bundle.sources) mergeEntity(sources, source, "context source");
    for (const revision of bundle.revisions) mergeEntity(revisions, revision, "context revision");
    for (const request of bundle.requests) mergeEntity(requests, request, "context request");
    for (const transformation of bundle.transformations) mergeEntity(transformations, transformation, "context transformation");
    for (const contextIssue of bundle.issues) issueMap.set(stableJson(contextIssue), contextIssue);
  }

  const result = canonicalize({
    schema_version: CONTEXT_SCHEMA_VERSION,
    dataset_id: datasetId,
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    artifacts: sortedEntities(artifacts),
    profiles: sortedEntities(profiles),
    sources: sortedEntities(sources),
    revisions: sortedEntities(revisions),
    requests: sortedEntities(requests),
    transformations: sortedEntities(transformations),
    issues: [...issueMap.values()].sort((left, right) => compareText(stableJson(left), stableJson(right))),
  }) as ContextBundle;
  return validateContextBundle(result, evidence);
}
