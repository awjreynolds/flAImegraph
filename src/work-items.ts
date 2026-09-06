import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import { CoreError, validateEvidence } from "./core.js";
import type {
  CoverageIssue,
  EvidenceBundle,
  Observation,
  Source,
  Valuation,
} from "./types.js";

export const WORK_ITEM_SCHEMA_VERSION = "0.1.0" as const;

export type InformationBasis = "specification_only" | "repository_inspection" | "probe_assisted";
export type EstimateTiming = "pre_execution" | "during_execution" | "post_execution";
export type WorkOutcomeStatus =
  | "planned"
  | "in_progress"
  | "accepted"
  | "failed"
  | "interrupted"
  | "capped"
  | "cancelled"
  | "unknown";
export type AttemptStatus = WorkOutcomeStatus;

export interface WorkScope {
  revision: string;
  description: string;
  specification?: string;
  repository_revision?: string;
}

export interface WorkOutcome {
  status: WorkOutcomeStatus;
  recorded_at?: string;
  summary?: string;
}

export interface WorkAttempt {
  attempt_id: string;
  status: AttemptStatus;
  observation_ids: string[];
  started_at?: string;
  ended_at?: string;
}

export interface DecimalContextPoint {
  scale_id: string;
  scale_version: string;
  kind: "decimal";
  value: string;
}

export interface OrdinalContextPoint {
  scale_id: string;
  scale_version: string;
  kind: "ordinal";
  value: string;
}

export type ContextPointEstimate = DecimalContextPoint | OrdinalContextPoint;

export interface WorkItemEstimate {
  estimate_id: string;
  estimate_version: number;
  scope_revision: string;
  created_at: string;
  timing: EstimateTiming;
  information_basis: InformationBasis;
  estimator: string;
  confidence?: "low" | "medium" | "high" | "unknown";
  point_estimate: ContextPointEstimate | null;
  unestimated_reason?: string;
  rationale?: string;
  supersedes_estimate_id?: string;
}

export interface WorkItem {
  schema_version: typeof WORK_ITEM_SCHEMA_VERSION;
  dataset_id: string;
  work_item_id: string;
  title?: string;
  scope: WorkScope;
  /** Optional prior scope snapshots; the current scope is always available in `scope`. */
  scope_history?: WorkScope[];
  acceptance_criteria: string[];
  outcome: WorkOutcome;
  attempts: WorkAttempt[];
  estimates: WorkItemEstimate[];
}

export interface WorkItemCoverage {
  source_ids: string[];
  source_coverage: Array<Pick<Source, "id" | "coverage">>;
  issues: CoverageIssue[];
}

export type EstimateInterpretation =
  | "pre_execution_estimate"
  | "in_execution_estimate"
  | "post_execution_retrospective";
export type EstimateTemporalStatus = "verified" | "unknown";

export interface EstimateSemantics {
  estimate_id: string;
  timing: EstimateTiming;
  interpretation: EstimateInterpretation;
  /** Whether the declared timing agrees with the boundaries available at the join. */
  temporal_status: EstimateTemporalStatus;
}

/** A joined training row; it does not assert that any forecast is calibrated. */
export interface WorkItemEvidenceRecord {
  schema_version: typeof WORK_ITEM_SCHEMA_VERSION;
  dataset_id: string;
  work_item: WorkItem;
  observation_ids: string[];
  observations: Observation[];
  coverage: WorkItemCoverage;
  /** The exact valuation for this Work Item's selected observations. */
  valuation: Valuation | null;
  /** The original dataset-wide valuation supplied to the join. */
  dataset_valuation: Valuation | null;
  estimate_semantics: EstimateSemantics[];
}

type JsonObject = Record<string, unknown>;

const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const DECIMAL_RE = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const SIGNED_INTEGER_RE = /^-?(0|[1-9][0-9]*)$/;

const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });

function loadSchema(name: string): JsonObject {
  try {
    const url = new URL(`../spec/0.1/schemas/${name}.schema.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")) as JsonObject;
  } catch (error) {
    throw new CoreError("SCHEMA_UNAVAILABLE", `Unable to load the ${name} schema`, error);
  }
}

const workItemValidator = ajv.compile(loadSchema("work-item"));
const valuationValidator = ajv.compile(loadSchema("valuation"));

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

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  return "null";
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function subsetValuation(valuation: Valuation, selectedObservationIds: string[], workItemId: string): Valuation {
  const selected = new Set(selectedObservationIds);
  const observations = valuation.observations.filter((line) => selected.has(line.observation_id));
  const known = new Set(observations.map((line) => line.observation_id));
  const issues = valuation.issues.filter(
    (coverageIssue) => coverageIssue.observation_id === undefined || selected.has(coverageIssue.observation_id),
  );
  for (const observationId of selected) {
    if (!known.has(observationId)) {
      issues.push({
        code: "WORK_ITEM_VALUATION_LINE_MISSING",
        message: `valuation has no line for selected observation ${observationId}`,
        severity: "warning",
        observation_id: observationId,
      });
    }
  }
  const total = observations.reduce(
    (sum, line) => sum + (line.amount_nanos === null ? 0n : BigInt(line.amount_nanos)),
    0n,
  );
  const complete =
    selected.size === known.size &&
    observations.every((line) => line.amount_nanos !== null) &&
    !issues.some((coverageIssue) => coverageIssue.severity !== "info");
  const selectionDigest = createHash("sha256")
    .update(
      canonicalJson({
        valuation_id: valuation.id,
        dataset_id: valuation.dataset_id,
        selection_policy: valuation.selection_policy,
        currency: valuation.currency,
        basis: valuation.basis,
        rate_card_id: valuation.rate_card_id,
        assumptions: [...valuation.assumptions].sort(),
        selected_observation_ids: [...selected].sort(),
        observations: [...observations].sort((left, right) => compareCanonicalStrings(left.observation_id, right.observation_id)),
        total_nanos: total.toString(),
        complete,
        issues: [...issues].sort((left, right) => compareCanonicalStrings(canonicalJson(left), canonicalJson(right))),
      }),
    )
    .digest("hex");
  return {
    ...cloneJson(valuation),
    id: `${valuation.id}/work-item/${workItemId}/${selectionDigest}`,
    observations: cloneJson(observations),
    total_nanos: total.toString(),
    complete,
    issues: cloneJson(issues),
  };
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new CoreError("WORK_ITEM_INVALID_STRING", `${label} must not be empty`);
}

function assertDateTime(value: string, label: string): void {
  if (!DATE_TIME_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CoreError("WORK_ITEM_INVALID_DATE", `${label} must be a valid RFC3339 date-time`);
  }
}

function scopesEqual(left: WorkScope, right: WorkScope): boolean {
  return (
    left.revision === right.revision &&
    left.description === right.description &&
    left.specification === right.specification &&
    left.repository_revision === right.repository_revision
  );
}

function semanticValidateValuation(input: Valuation): Valuation {
  if (input.schema_version !== "0.1.0") {
    throw new CoreError("VALUATION_UNSUPPORTED_SCHEMA_VERSION", "valuation schema version must be 0.1.0");
  }
  assertNonEmpty(input.id, "valuation.id");
  assertNonEmpty(input.dataset_id, "valuation.dataset_id");
  assertNonEmpty(input.currency, "valuation.currency");
  if (input.selection_policy !== "direct-only-v1") {
    throw new CoreError(
      "VALUATION_SELECTION_POLICY_INVALID",
      `valuation selection policy must be direct-only-v1, got ${input.selection_policy}`,
    );
  }
  if (input.rate_card_id !== undefined) assertNonEmpty(input.rate_card_id, "valuation.rate_card_id");
  for (const [index, assumption] of input.assumptions.entries()) {
    assertNonEmpty(assumption, `valuation.assumptions[${index}]`);
  }

  const observationIds = new Set<string>();
  let total = 0n;
  let hasUnavailableAmount = false;
  for (const line of input.observations) {
    assertNonEmpty(line.observation_id, "valuation.observations.observation_id");
    if (observationIds.has(line.observation_id)) {
      throw new CoreError(
        "VALUATION_OBSERVATION_DUPLICATE",
        `valuation contains more than one line for observation ${line.observation_id}`,
      );
    }
    observationIds.add(line.observation_id);
    if (line.reason !== undefined) assertNonEmpty(line.reason, `${line.observation_id}.reason`);
    if (line.amount_nanos === null) {
      hasUnavailableAmount = true;
      if (line.basis !== null) {
        throw new CoreError(
          "VALUATION_LINE_BASIS_MISMATCH",
          `unavailable valuation line ${line.observation_id} must have a null basis`,
        );
      }
      continue;
    }
    if (!SIGNED_INTEGER_RE.test(line.amount_nanos)) {
      throw new CoreError(
        "VALUATION_AMOUNT_INVALID",
        `valuation line ${line.observation_id} amount_nanos must be a canonical signed integer string`,
      );
    }
    if (line.basis === null) {
      throw new CoreError(
        "VALUATION_LINE_BASIS_MISMATCH",
        `valued valuation line ${line.observation_id} must declare a basis`,
      );
    }
    if (input.basis === "mixed") {
      throw new CoreError(
        "VALUATION_BASIS_MISMATCH",
        `valuation line ${line.observation_id} cannot carry a known amount under mixed basis`,
      );
    }
    if (line.basis !== input.basis) {
      throw new CoreError(
        "VALUATION_BASIS_MISMATCH",
        `valuation line ${line.observation_id} basis ${line.basis} differs from ${input.basis}`,
      );
    }
    total += BigInt(line.amount_nanos);
  }

  if (!SIGNED_INTEGER_RE.test(input.total_nanos)) {
    throw new CoreError("VALUATION_TOTAL_INVALID", "valuation total_nanos must be a canonical signed integer string");
  }
  if (BigInt(input.total_nanos) !== total) {
    throw new CoreError(
      "VALUATION_TOTAL_MISMATCH",
      `valuation total_nanos ${input.total_nanos} does not equal the sum of valued lines ${total.toString()}`,
    );
  }

  for (const issue of input.issues) {
    assertNonEmpty(issue.code, "valuation.issues.code");
    assertNonEmpty(issue.message, "valuation.issues.message");
    if (issue.observation_id !== undefined && !observationIds.has(issue.observation_id)) {
      throw new CoreError(
        "VALUATION_ISSUE_REFERENCE_MISSING",
        `valuation issue references missing observation ${issue.observation_id}`,
      );
    }
  }
  if (input.complete && (hasUnavailableAmount || input.issues.some((issue) => issue.severity !== "info"))) {
    throw new CoreError(
      "VALUATION_COMPLETENESS_INVALID",
      "a complete valuation must have amounts for every line and contain no warning or error issues",
    );
  }
  return cloneJson(input);
}

function assertEstimateTimingAgainstAttemptBounds(input: WorkItem, estimate: WorkItemEstimate): void {
  if (input.attempts.length === 0) return;
  const createdAt = Date.parse(estimate.created_at);
  if (estimate.timing === "pre_execution") {
    const knownStarts = input.attempts
      .filter((attempt) => attempt.started_at !== undefined)
      .map((attempt) => Date.parse(attempt.started_at as string));
    if (knownStarts.some((start) => createdAt >= start)) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
        `pre-execution estimate ${estimate.estimate_id} was created at or after a known attempt start`,
      );
    }
    return;
  }
  if (estimate.timing === "during_execution") {
    if (input.attempts.every((attempt) => attempt.started_at !== undefined && attempt.ended_at !== undefined)) {
      const insideAttempt = input.attempts.some((attempt) => {
        const start = Date.parse(attempt.started_at as string);
        const end = Date.parse(attempt.ended_at as string);
        return createdAt >= start && createdAt <= end;
      });
      if (!insideAttempt) {
        throw new CoreError(
          "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
          `during-execution estimate ${estimate.estimate_id} falls outside every attempt interval`,
        );
      }
    }
    return;
  }
  const knownEnds = input.attempts
    .filter((attempt) => attempt.ended_at !== undefined)
    .map((attempt) => Date.parse(attempt.ended_at as string));
  if (knownEnds.some((end) => createdAt <= end)) {
    throw new CoreError(
      "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
      `post-execution estimate ${estimate.estimate_id} was created at or before a known attempt end`,
    );
  }
}

function assessEstimateTiming(
  workItem: WorkItem,
  estimate: WorkItemEstimate,
  observations: Observation[],
): EstimateTemporalStatus {
  const createdAt = Date.parse(estimate.created_at);
  if (estimate.timing === "pre_execution") {
    const knownStarts = [
      ...workItem.attempts
        .filter((attempt) => attempt.started_at !== undefined)
        .map((attempt) => Date.parse(attempt.started_at as string)),
      ...observations
        .map((observation) => observation.timestamp ?? observation.end_time)
        .filter((timestamp): timestamp is string => timestamp !== undefined)
        .map((timestamp) => Date.parse(timestamp)),
    ];
    if (knownStarts.some((start) => createdAt >= start)) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
        `pre-execution estimate ${estimate.estimate_id} was created at or after known linked execution evidence`,
      );
    }
    if (workItem.attempts.length === 0 || !workItem.attempts.every((attempt) => attempt.started_at !== undefined)) {
      return "unknown";
    }
    const firstStart = Math.min(...workItem.attempts.map((attempt) => Date.parse(attempt.started_at as string)));
    if (createdAt >= firstStart) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
        `pre-execution estimate ${estimate.estimate_id} was created at or after the first attempt started`,
      );
    }
    return "verified";
  }
  if (estimate.timing === "during_execution") {
    if (
      workItem.attempts.length === 0 ||
      !workItem.attempts.every((attempt) => attempt.started_at !== undefined && attempt.ended_at !== undefined)
    ) {
      return "unknown";
    }
    const insideAttempt = workItem.attempts.some((attempt) => {
      const start = Date.parse(attempt.started_at as string);
      const end = Date.parse(attempt.ended_at as string);
      return createdAt >= start && createdAt <= end;
    });
    if (!insideAttempt) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
        `during-execution estimate ${estimate.estimate_id} falls outside every attempt interval`,
      );
    }
    return "verified";
  }

  if (workItem.attempts.length === 0) return "unknown";
  const attemptEndTimes = workItem.attempts
    .filter((attempt) => attempt.ended_at !== undefined)
    .map((attempt) => Date.parse(attempt.ended_at as string));
  const attemptEndsKnown = attemptEndTimes.length === workItem.attempts.length;
  const observationTimes = observations.map((observation) => observation.end_time ?? observation.timestamp);
  const observationEndsKnown = observations.length > 0 && observationTimes.every((timestamp) => timestamp !== undefined);
  const knownEnds = [
    ...attemptEndTimes,
    ...observationTimes
      .filter((timestamp): timestamp is string => timestamp !== undefined)
      .map((timestamp) => Date.parse(timestamp)),
  ];
  if (knownEnds.some((end) => createdAt <= end)) {
    throw new CoreError(
      "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
      `post-execution estimate ${estimate.estimate_id} was created at or before known linked execution evidence ended`,
    );
  }
  if (!attemptEndsKnown && !observationEndsKnown) return "unknown";
  const boundaries = [
    ...(attemptEndsKnown ? attemptEndTimes : []),
    ...(observationEndsKnown ? observationTimes.map((timestamp) => Date.parse(timestamp as string)) : []),
  ];
  const lastEnd = Math.max(...boundaries);
  if (createdAt <= lastEnd) {
    throw new CoreError(
      "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
      `post-execution estimate ${estimate.estimate_id} was created at or before linked execution ended`,
    );
  }
  return "verified";
}

function semanticValidateWorkItem(input: WorkItem): WorkItem {
  if (input.schema_version !== WORK_ITEM_SCHEMA_VERSION) {
    throw new CoreError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `work item schema version must be ${WORK_ITEM_SCHEMA_VERSION}`,
    );
  }
  assertNonEmpty(input.dataset_id, "dataset_id");
  assertNonEmpty(input.work_item_id, "work_item_id");
  assertNonEmpty(input.scope.revision, "scope.revision");
  assertNonEmpty(input.scope.description, "scope.description");
  if (input.scope.specification !== undefined) assertNonEmpty(input.scope.specification, "scope.specification");
  if (input.scope.repository_revision !== undefined) {
    assertNonEmpty(input.scope.repository_revision, "scope.repository_revision");
  }
  if (input.title !== undefined) assertNonEmpty(input.title, "title");

  for (const [index, criterion] of input.acceptance_criteria.entries()) {
    assertNonEmpty(criterion, `acceptance_criteria[${index}]`);
  }
  if (input.outcome.recorded_at !== undefined) assertDateTime(input.outcome.recorded_at, "outcome.recorded_at");
  if (input.outcome.summary !== undefined) assertNonEmpty(input.outcome.summary, "outcome.summary");

  const attemptIds = new Set<string>();
  const referencedObservationIds = new Set<string>();
  for (const attempt of input.attempts) {
    assertNonEmpty(attempt.attempt_id, "attempt.attempt_id");
    if (attemptIds.has(attempt.attempt_id)) {
      throw new CoreError("WORK_ITEM_ATTEMPT_CONFLICT", `duplicate attempt id ${attempt.attempt_id}`);
    }
    attemptIds.add(attempt.attempt_id);
    if (attempt.started_at !== undefined) assertDateTime(attempt.started_at, `${attempt.attempt_id}.started_at`);
    if (attempt.ended_at !== undefined) assertDateTime(attempt.ended_at, `${attempt.attempt_id}.ended_at`);
    if (attempt.started_at && attempt.ended_at && Date.parse(attempt.ended_at) < Date.parse(attempt.started_at)) {
      throw new CoreError("WORK_ITEM_INVALID_INTERVAL", `${attempt.attempt_id} ended before it started`);
    }
    for (const observationId of attempt.observation_ids) {
      assertNonEmpty(observationId, `${attempt.attempt_id}.observation_ids`);
      if (referencedObservationIds.has(observationId)) {
        throw new CoreError(
          "WORK_ITEM_OBSERVATION_DUPLICATE",
          `observation ${observationId} is referenced by more than one attempt`,
        );
      }
      referencedObservationIds.add(observationId);
    }
  }

  const scopesByRevision = new Map<string, WorkScope>([[input.scope.revision, input.scope]]);
  const scopeHistoryRevisions = new Set<string>();
  for (const historicalScope of input.scope_history ?? []) {
    assertNonEmpty(historicalScope.revision, "scope_history.revision");
    assertNonEmpty(historicalScope.description, `${historicalScope.revision}.description`);
    if (historicalScope.specification !== undefined) {
      assertNonEmpty(historicalScope.specification, `${historicalScope.revision}.specification`);
    }
    if (historicalScope.repository_revision !== undefined) {
      assertNonEmpty(historicalScope.repository_revision, `${historicalScope.revision}.repository_revision`);
    }
    if (scopeHistoryRevisions.has(historicalScope.revision)) {
      throw new CoreError(
        "WORK_ITEM_SCOPE_CONFLICT",
        `duplicate historical scope revision ${historicalScope.revision}`,
      );
    }
    scopeHistoryRevisions.add(historicalScope.revision);
    const existing = scopesByRevision.get(historicalScope.revision);
    if (existing !== undefined && !scopesEqual(existing, historicalScope)) {
      throw new CoreError(
        "WORK_ITEM_SCOPE_CONFLICT",
        `historical scope ${historicalScope.revision} differs from the current scope snapshot`,
      );
    }
    scopesByRevision.set(historicalScope.revision, historicalScope);
  }

  const estimateIds = new Set<string>();
  const estimateVersions = new Set<number>();
  for (const estimate of input.estimates) {
    assertNonEmpty(estimate.estimate_id, "estimate.estimate_id");
    if (estimateIds.has(estimate.estimate_id)) {
      throw new CoreError("WORK_ITEM_ESTIMATE_CONFLICT", `duplicate estimate id ${estimate.estimate_id}`);
    }
    estimateIds.add(estimate.estimate_id);
    if (estimateVersions.has(estimate.estimate_version)) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_CONFLICT",
        `duplicate estimate version ${estimate.estimate_version}`,
      );
    }
    estimateVersions.add(estimate.estimate_version);
    if (!scopesByRevision.has(estimate.scope_revision)) {
      throw new CoreError(
        "WORK_ITEM_SCOPE_MISMATCH",
        `estimate ${estimate.estimate_id} references unknown scope ${estimate.scope_revision}`,
      );
    }
    assertDateTime(estimate.created_at, `${estimate.estimate_id}.created_at`);
    assertEstimateTimingAgainstAttemptBounds(input, estimate);
    assertNonEmpty(estimate.estimator, `${estimate.estimate_id}.estimator`);
    if (estimate.rationale !== undefined) assertNonEmpty(estimate.rationale, `${estimate.estimate_id}.rationale`);
    if (estimate.point_estimate === null) {
      if (estimate.unestimated_reason === undefined) {
        throw new CoreError(
          "WORK_ITEM_ESTIMATE_UNEXPLAINED",
          `estimate ${estimate.estimate_id} must explain an unavailable point estimate`,
        );
      }
      assertNonEmpty(estimate.unestimated_reason, `${estimate.estimate_id}.unestimated_reason`);
    } else {
      if (estimate.unestimated_reason !== undefined) {
        throw new CoreError(
          "WORK_ITEM_ESTIMATE_CONFLICT",
          `estimate ${estimate.estimate_id} cannot explain a point estimate as unavailable`,
        );
      }
      assertNonEmpty(estimate.point_estimate.scale_id, `${estimate.estimate_id}.point_estimate.scale_id`);
      assertNonEmpty(estimate.point_estimate.scale_version, `${estimate.estimate_id}.point_estimate.scale_version`);
      assertNonEmpty(estimate.point_estimate.value, `${estimate.estimate_id}.point_estimate.value`);
      if (estimate.point_estimate.kind === "decimal" && !DECIMAL_RE.test(estimate.point_estimate.value)) {
        throw new CoreError(
          "WORK_ITEM_POINT_INVALID",
          `estimate ${estimate.estimate_id} decimal point must be a canonical non-negative decimal string`,
        );
      }
    }
  }

  const estimatesByVersion = new Map(input.estimates.map((estimate) => [estimate.estimate_version, estimate]));
  const estimatesById = new Map(input.estimates.map((estimate) => [estimate.estimate_id, estimate]));
  for (const estimate of input.estimates) {
    const predecessor = estimatesByVersion.get(estimate.estimate_version - 1);
    if (estimate.estimate_version === 1) {
      if (estimate.supersedes_estimate_id !== undefined) {
        throw new CoreError(
          "WORK_ITEM_ESTIMATE_ORDER",
          `estimate ${estimate.estimate_id} version 1 cannot supersede another estimate`,
        );
      }
      continue;
    }
    if (predecessor === undefined) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_REFERENCE_MISSING",
        `estimate ${estimate.estimate_id} version ${estimate.estimate_version} must have version ${estimate.estimate_version - 1}`,
      );
    }
    if (estimate.supersedes_estimate_id === undefined) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_REFERENCE_MISSING",
        `estimate ${estimate.estimate_id} version ${estimate.estimate_version} must supersede ${predecessor.estimate_id}`,
      );
    }
    if (estimate.supersedes_estimate_id === estimate.estimate_id) {
      throw new CoreError("WORK_ITEM_ESTIMATE_CONFLICT", `estimate ${estimate.estimate_id} cannot supersede itself`);
    }
    const superseded = estimatesById.get(estimate.supersedes_estimate_id);
    if (superseded === undefined) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_REFERENCE_MISSING",
        `estimate ${estimate.estimate_id} supersedes missing estimate ${estimate.supersedes_estimate_id}`,
      );
    }
    if (superseded.estimate_id !== predecessor.estimate_id) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_ORDER",
        `estimate ${estimate.estimate_id} must supersede immediately preceding estimate ${predecessor.estimate_id}`,
      );
    }
    if (Date.parse(estimate.created_at) < Date.parse(predecessor.created_at)) {
      throw new CoreError(
        "WORK_ITEM_ESTIMATE_ORDER",
        `estimate ${estimate.estimate_id} was created before ${predecessor.estimate_id}`,
      );
    }
  }

  return cloneJson(input);
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

/** Validate and clone a versioned Work Item sidecar. */
export function validateWorkItem(value: unknown): WorkItem {
  validateWithSchema<WorkItem>(value, workItemValidator, "WORK_ITEM_SCHEMA_INVALID");
  if (!isObject(value)) throw new CoreError("WORK_ITEM_SCHEMA_INVALID", "work item must be an object");
  return semanticValidateWorkItem(value as WorkItem);
}

/** Validate and clone a Valuation, including amount, basis, reference, and total invariants. */
export function validateValuation(value: unknown): Valuation {
  validateWithSchema<Valuation>(value, valuationValidator, "VALUATION_SCHEMA_INVALID");
  if (!isObject(value)) throw new CoreError("VALUATION_SCHEMA_INVALID", "valuation must be an object");
  return semanticValidateValuation(value as Valuation);
}

/** Build a validated, detached Work Item record from JSON-compatible input. */
export function buildWorkItemRecord(value: unknown): WorkItem {
  return validateWorkItem(value);
}

function interpretationFor(timing: EstimateTiming): EstimateInterpretation {
  if (timing === "pre_execution") return "pre_execution_estimate";
  if (timing === "during_execution") return "in_execution_estimate";
  return "post_execution_retrospective";
}

/**
 * Join a Work Item sidecar to selected evidence without changing either input.
 * The resulting row keeps coverage and estimate timing explicit; it makes no
 * claim that a point estimate is a calibrated forecast.
 */
export function joinWorkItemEvidence(
  value: unknown,
  evidence: EvidenceBundle,
  valuation: Valuation | null = null,
): WorkItemEvidenceRecord {
  const workItem = validateWorkItem(value);
  const normalizedEvidence = validateEvidence(evidence);
  if (workItem.dataset_id !== normalizedEvidence.dataset_id) {
    throw new CoreError(
      "WORK_ITEM_DATASET_MISMATCH",
      `work item dataset ${workItem.dataset_id} differs from evidence dataset ${normalizedEvidence.dataset_id}`,
    );
  }

  const observationsById = new Map(normalizedEvidence.observations.map((observation) => [observation.id, observation]));
  const selectedObservationIds = workItem.attempts.flatMap((attempt) => attempt.observation_ids);
  const selectedObservations: Observation[] = [];
  for (const observationId of selectedObservationIds) {
    const observation = observationsById.get(observationId);
    if (!observation) {
      throw new CoreError(
        "WORK_ITEM_OBSERVATION_MISSING",
        `work item ${workItem.work_item_id} references missing observation ${observationId}`,
      );
    }
    if (observation.work_item_id !== undefined && observation.work_item_id !== workItem.work_item_id) {
      throw new CoreError(
        "WORK_ITEM_OBSERVATION_MISMATCH",
        `observation ${observationId} belongs to work item ${observation.work_item_id}`,
      );
    }
    selectedObservations.push(cloneJson(observation));
  }

  let normalizedValuation: Valuation | null = null;
  let datasetValuation: Valuation | null = null;
  if (valuation !== null) {
    if (valuation.dataset_id !== normalizedEvidence.dataset_id) {
      throw new CoreError(
        "WORK_ITEM_VALUATION_DATASET_MISMATCH",
        `valuation dataset ${valuation.dataset_id} differs from evidence dataset ${normalizedEvidence.dataset_id}`,
      );
    }
    const validatedValuation = validateValuation(valuation);
    const evidenceSourceIds = new Set(normalizedEvidence.sources.map((source) => source.id));
    for (const valuedObservation of validatedValuation.observations) {
      if (!observationsById.has(valuedObservation.observation_id)) {
        throw new CoreError(
          "WORK_ITEM_VALUATION_REFERENCE_MISSING",
          `valuation references missing observation ${valuedObservation.observation_id}`,
        );
      }
    }
    for (const issue of validatedValuation.issues) {
      if (issue.source_id !== undefined && !evidenceSourceIds.has(issue.source_id)) {
        throw new CoreError(
          "VALUATION_ISSUE_REFERENCE_MISSING",
          `valuation issue references missing source ${issue.source_id}`,
        );
      }
    }
    datasetValuation = validatedValuation;
    normalizedValuation = subsetValuation(validatedValuation, selectedObservationIds, workItem.work_item_id);
  }

  const sourceIds = [...new Set(selectedObservations.flatMap((observation) => observation.source_refs.map((ref) => ref.source_id)))].sort();
  const sourceCoverage = normalizedEvidence.sources
    .filter((source) => sourceIds.includes(source.id))
    .map((source) => ({ id: source.id, coverage: source.coverage }));

  return {
    schema_version: WORK_ITEM_SCHEMA_VERSION,
    dataset_id: normalizedEvidence.dataset_id,
    work_item: workItem,
    observation_ids: [...selectedObservationIds],
    observations: selectedObservations,
    coverage: {
      source_ids: sourceIds,
      source_coverage: sourceCoverage,
      issues: cloneJson(normalizedEvidence.issues),
    },
    valuation: normalizedValuation,
    dataset_valuation: datasetValuation,
    estimate_semantics: workItem.estimates.map((estimate) => ({
      estimate_id: estimate.estimate_id,
      timing: estimate.timing,
      interpretation: interpretationFor(estimate.timing),
      temporal_status: assessEstimateTiming(workItem, estimate, selectedObservations),
    })),
  };
}
