import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import type {
  CostBasis,
  CoverageIssue,
  EvidenceBundle,
  Observation,
  RateCard,
  RateCategory,
  RateRule,
  RecordedCost,
  Relationship,
  Source,
  SourceRef,
  Usage,
  Valuation,
  ValuationOptions,
  ValuedObservation,
} from "./types.js";

const SCHEMA_VERSION = "0.1.0" as const;
const SELECTION_POLICY = "direct-only-v1" as const;
const NANO_SCALE = 1_000_000_000n;

/** Errors from the public core seams have a stable machine-readable code. */
export class CoreError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.details = details;
  }
}

type JsonObject = Record<string, unknown>;

const QUANTITY_RE = /^(0|[1-9][0-9]*)$/;
const SIGNED_INTEGER_RE = /^-?(0|[1-9][0-9]*)$/;
const DECIMAL_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const NON_NEGATIVE_DECIMAL_RE = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

function loadSchema(name: string): JsonObject {
  try {
    const url = new URL(`../spec/0.1/schemas/${name}.schema.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")) as JsonObject;
  } catch (error) {
    throw new CoreError(`SCHEMA_UNAVAILABLE`, `Unable to load the ${name} schema`, error);
  }
}

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false });
const evidenceValidator = ajv.compile(loadSchema("evidence"));
const rateCardValidator = ajv.compile(loadSchema("rate-card"));

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
  // The schemas admit only JSON values. structuredClone keeps exact strings and
  // avoids sharing mutable arrays with callers without coercing large integers.
  return structuredClone(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) result[key] = canonicalize(item);
  }
  return result;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new CoreError("INVALID_STRING", `${label} must not be empty`);
  }
}

function assertOptionalNonEmpty(value: string | undefined, label: string): void {
  if (value !== undefined) assertNonEmpty(value, label);
}

function assertQuantity(value: string, label: string): bigint {
  if (!QUANTITY_RE.test(value)) {
    throw new CoreError("INVALID_QUANTITY", `${label} must be a canonical non-negative integer string`);
  }
  return BigInt(value);
}

function assertDecimal(value: string, label: string, nonNegative = false): void {
  const pattern = nonNegative ? NON_NEGATIVE_DECIMAL_RE : DECIMAL_RE;
  if (!pattern.test(value)) {
    throw new CoreError(
      "INVALID_DECIMAL",
      `${label} must be a canonical decimal string${nonNegative ? " greater than or equal to zero" : ""}`,
    );
  }
}

function assertIntegerString(value: string, label: string): void {
  if (!SIGNED_INTEGER_RE.test(value)) {
    throw new CoreError("INVALID_INTEGER", `${label} must be a canonical integer string`);
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDate(value: string, label: string, dateOnlyAllowed: boolean): Date {
  const dateMatch = DATE_RE.exec(value);
  const dateTimeMatch = DATE_TIME_RE.exec(value);
  if (!dateMatch && !dateTimeMatch) {
    throw new CoreError("INVALID_DATE", `${label} must be an ISO date or RFC3339 date-time`);
  }

  const year = Number((dateMatch ?? dateTimeMatch)?.[1]);
  const month = Number((dateMatch ?? dateTimeMatch)?.[2]);
  const day = Number((dateMatch ?? dateTimeMatch)?.[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new CoreError("INVALID_DATE", `${label} is not a real calendar date`);
  }

  if (dateMatch) {
    if (!dateOnlyAllowed) {
      throw new CoreError("INVALID_DATE", `${label} must include a time and timezone`);
    }
    return new Date(Date.UTC(year, month - 1, day));
  }

  const match = dateTimeMatch as RegExpExecArray;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new CoreError("INVALID_DATE", `${label} has an invalid time`);
  }
  const timezone = match[8] as string;
  if (timezone !== "Z") {
    const offsetHour = Number(timezone.slice(1, 3));
    const offsetMinute = Number(timezone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new CoreError("INVALID_DATE", `${label} has an invalid timezone offset`);
    }
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new CoreError("INVALID_DATE", `${label} is not a valid date-time`);
  }
  return parsed;
}

function parseBoundary(value: string | null | undefined, label: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  return parseDate(value, label, true);
}

function cloneSource(source: Source): Source {
  return { ...source };
}

function cloneSourceRef(sourceRef: SourceRef): SourceRef {
  return { ...sourceRef };
}

function cloneUsage(usage: Usage | null): Usage | null {
  return usage ? { ...usage } : null;
}

function cloneObservation(observation: Observation): Observation {
  return {
    ...observation,
    source_refs: observation.source_refs.map(cloneSourceRef),
    usage: cloneUsage(observation.usage),
    ...(observation.recorded_cost ? { recorded_cost: { ...observation.recorded_cost } } : {}),
    ...(observation.attributes ? { attributes: { ...observation.attributes } } : {}),
  };
}

function cloneIssue(issue: CoverageIssue): CoverageIssue {
  return { ...issue };
}

function cloneEvidence(evidence: EvidenceBundle): EvidenceBundle {
  return {
    ...evidence,
    sources: evidence.sources.map(cloneSource),
    observations: evidence.observations.map(cloneObservation),
    relationships: evidence.relationships.map((relationship) => ({ ...relationship })),
    issues: evidence.issues.map(cloneIssue),
  };
}

function sourceContent(source: Source): Omit<Source, "id"> & { id?: never } {
  const { id: _id, ...content } = source;
  return content;
}

function observationContent(observation: Observation): Omit<Observation, "source_refs"> & { source_refs?: never } {
  const { source_refs: _sourceRefs, ...content } = observation;
  return content;
}

function sourceRefKey(sourceRef: SourceRef): string {
  return stableJson(sourceRef);
}

function relationshipKey(relationship: Relationship): string {
  return stableJson(relationship);
}

function issueKey(issue: CoverageIssue): string {
  return stableJson(issue);
}

function sortSourceRefs(refs: SourceRef[]): SourceRef[] {
  return [...refs].sort((left, right) => {
    const sourceOrder = compareText(left.source_id, right.source_id);
    return sourceOrder || compareText(left.record, right.record);
  });
}

function sortRelationships(relationships: Relationship[]): Relationship[] {
  return [...relationships].sort((left, right) => {
    const fromOrder = compareText(left.from, right.from);
    if (fromOrder) return fromOrder;
    const toOrder = compareText(left.to, right.to);
    return toOrder || compareText(left.kind, right.kind);
  });
}

function sortIssues(issues: CoverageIssue[]): CoverageIssue[] {
  return [...issues].sort((left, right) => compareText(issueKey(left), issueKey(right)));
}

function addIssue(issues: CoverageIssue[], issue: CoverageIssue): void {
  if (!issues.some((existing) => sameJson(existing, issue))) issues.push(issue);
}

function issue(
  code: string,
  message: string,
  severity: CoverageIssue["severity"],
  observationId?: string,
  sourceId?: string,
): CoverageIssue {
  return {
    code,
    message,
    severity,
    ...(observationId ? { observation_id: observationId } : {}),
    ...(sourceId ? { source_id: sourceId } : {}),
  };
}

function assertUsageSemantics(observation: Observation): void {
  const usage = observation.usage;
  if (usage === null) return;

  const input = usage.input_tokens === null ? undefined : assertQuantity(usage.input_tokens, `${observation.id}.usage.input_tokens`);
  const cacheRead =
    usage.cache_read_input_tokens === null
      ? undefined
      : assertQuantity(usage.cache_read_input_tokens, `${observation.id}.usage.cache_read_input_tokens`);
  const cacheWrite =
    usage.cache_write_input_tokens === null
      ? undefined
      : assertQuantity(usage.cache_write_input_tokens, `${observation.id}.usage.cache_write_input_tokens`);
  const output = usage.output_tokens === null ? undefined : assertQuantity(usage.output_tokens, `${observation.id}.usage.output_tokens`);
  const reasoning =
    usage.reasoning_output_tokens === null
      ? undefined
      : assertQuantity(usage.reasoning_output_tokens, `${observation.id}.usage.reasoning_output_tokens`);

  if (input !== undefined && (cacheRead ?? 0n) + (cacheWrite ?? 0n) > input) {
    throw new CoreError(
      "SUBSET_OVERFLOW",
      `${observation.id} cache-read plus cache-write input exceeds inclusive input_tokens`,
    );
  }
  if (output !== undefined && reasoning !== undefined && reasoning > output) {
    throw new CoreError(
      "SUBSET_OVERFLOW",
      `${observation.id} reasoning_output_tokens exceeds inclusive output_tokens`,
    );
  }

  if (usage.unclassified_tokens !== undefined && usage.unclassified_tokens !== null) {
    assertQuantity(usage.unclassified_tokens, `${observation.id}.usage.unclassified_tokens`);
  }
}

function assertAcyclic(observations: Observation[], relationships: Relationship[]): void {
  const edges = new Map<string, string[]>();
  const addEdge = (from: string, to: string): void => {
    const targets = edges.get(from) ?? [];
    targets.push(to);
    edges.set(from, targets);
  };

  for (const observation of observations) {
    if (observation.parent_id) addEdge(observation.parent_id, observation.id);
  }
  for (const relationship of relationships) {
    if (relationship.kind === "parent") {
      addEdge(relationship.from, relationship.to);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) {
      throw new CoreError("RELATIONSHIP_CYCLE", `hierarchical relationship cycle includes ${node}`);
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of edges.get(node) ?? []) visit(target);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
}

function semanticValidateEvidence(input: EvidenceBundle): EvidenceBundle {
  if (input.schema_version !== SCHEMA_VERSION) {
    throw new CoreError("UNSUPPORTED_SCHEMA_VERSION", `evidence schema version must be ${SCHEMA_VERSION}`);
  }
  assertNonEmpty(input.dataset_id, "dataset_id");

  const sourcesById = new Map<string, Source>();
  for (const source of input.sources) {
    assertNonEmpty(source.id, "source.id");
    assertNonEmpty(source.harness, `${source.id}.harness`);
    assertNonEmpty(source.format, `${source.id}.format`);
    if (source.version !== undefined) assertNonEmpty(source.version, `${source.id}.version`);
    if (source.sha256 !== undefined && !/^[A-Fa-f0-9]{64}$/.test(source.sha256)) {
      throw new CoreError("INVALID_SHA256", `${source.id}.sha256 must be 64 hexadecimal characters`);
    }
    const prior = sourcesById.get(source.id);
    if (prior && !sameJson(sourceContent(prior), sourceContent(source))) {
      throw new CoreError("SOURCE_CONFLICT", `source ${source.id} has conflicting metadata`);
    }
    sourcesById.set(source.id, source);
  }

  const observationsById = new Map<string, Observation>();
  for (const observation of input.observations) {
    assertNonEmpty(observation.id, "observation.id");
    assertNonEmpty(observation.operation, `${observation.id}.operation`);
    for (const [label, value] of [
      ["subject_id", observation.subject_id],
      ["agent_id", observation.agent_id],
      ["session_id", observation.session_id],
      ["turn_id", observation.turn_id],
      ["parent_id", observation.parent_id],
      ["trace_id", observation.trace_id],
      ["span_id", observation.span_id],
      ["provider", observation.provider],
      ["product", observation.product],
      ["model", observation.model],
      ["work_item_id", observation.work_item_id],
    ] as const) {
      assertOptionalNonEmpty(value, `${observation.id}.${label}`);
    }
    if (observation.recorded_cost) {
      assertNonEmpty(observation.recorded_cost.currency, `${observation.id}.recorded_cost.currency`);
    }
    for (const sourceRef of observation.source_refs) {
      assertNonEmpty(sourceRef.source_id, `${observation.id}.source_refs.source_id`);
      assertNonEmpty(sourceRef.record, `${observation.id}.source_refs.record`);
      if (!sourcesById.has(sourceRef.source_id)) {
        throw new CoreError(
          "REFERENCE_MISSING",
          `${observation.id} references missing source ${sourceRef.source_id}`,
        );
      }
    }
    if (observation.timestamp) parseDate(observation.timestamp, `${observation.id}.timestamp`, false);
    if (observation.end_time) parseDate(observation.end_time, `${observation.id}.end_time`, false);
    if (observation.timestamp && observation.end_time) {
      const start = parseDate(observation.timestamp, `${observation.id}.timestamp`, false);
      const end = parseDate(observation.end_time, `${observation.id}.end_time`, false);
      if (end.getTime() < start.getTime()) {
        throw new CoreError("INVALID_INTERVAL", `${observation.id} end_time precedes timestamp`);
      }
    }
    if (observation.parent_id && observation.parent_id === observation.id) {
      throw new CoreError("RELATIONSHIP_CYCLE", `${observation.id} cannot parent itself`);
    }
    assertUsageSemantics(observation);

    const prior = observationsById.get(observation.id);
    if (prior && !sameJson(observationContent(prior), observationContent(observation))) {
      throw new CoreError("OBSERVATION_CONFLICT", `observation ${observation.id} has conflicting payloads`);
    }
    observationsById.set(observation.id, observation);
  }

  for (const observation of input.observations) {
    if (observation.parent_id && !observationsById.has(observation.parent_id)) {
      throw new CoreError(
        "REFERENCE_MISSING",
        `${observation.id} references missing parent observation ${observation.parent_id}`,
      );
    }
  }

  for (const relationship of input.relationships) {
    if (!observationsById.has(relationship.from) || !observationsById.has(relationship.to)) {
      throw new CoreError(
        "REFERENCE_MISSING",
        `relationship ${relationship.kind} references an unknown observation`,
      );
    }
    if (relationship.from === relationship.to && (relationship.kind === "parent" || relationship.kind === "delegates")) {
      throw new CoreError("RELATIONSHIP_CYCLE", `relationship ${relationship.kind} cannot target itself`);
    }
  }
  for (const coverageIssue of input.issues) {
    assertNonEmpty(coverageIssue.code, "issue.code");
    assertNonEmpty(coverageIssue.message, "issue.message");
    assertOptionalNonEmpty(coverageIssue.observation_id, "issue.observation_id");
    assertOptionalNonEmpty(coverageIssue.source_id, "issue.source_id");
    if (coverageIssue.observation_id && !observationsById.has(coverageIssue.observation_id)) {
      throw new CoreError("REFERENCE_MISSING", `issue references missing observation ${coverageIssue.observation_id}`);
    }
    if (coverageIssue.source_id && !sourcesById.has(coverageIssue.source_id)) {
      throw new CoreError("REFERENCE_MISSING", `issue references missing source ${coverageIssue.source_id}`);
    }
  }
  assertAcyclic(input.observations, input.relationships);
  return cloneEvidence(input);
}

function validateWithAjv<T>(
  value: unknown,
  validator: ValidateFunction,
  code: string,
): asserts value is T {
  try {
    if (!validator(value)) {
      throw new CoreError(code, `${code}: ${validationMessage(validator.errors)}`, validator.errors);
    }
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(code, `${code}: schema validation failed`, error);
  }
}

/** Validate and clone an evidence bundle without changing its exact quantities. */
export function validateEvidence(value: unknown): EvidenceBundle {
  validateWithAjv<EvidenceBundle>(value, evidenceValidator, "EVIDENCE_SCHEMA_INVALID");
  return semanticValidateEvidence(value);
}

function validateSourceUrl(value: string): void {
  try {
    const url = new URL(value);
    if (!url.protocol) throw new Error("missing absolute scheme");
  } catch {
    throw new CoreError("INVALID_SOURCE_URL", "rate card source_url must be an absolute URL");
  }
}

function semanticValidateRateCard(input: RateCard): RateCard {
  if (input.schema_version !== SCHEMA_VERSION) {
    throw new CoreError("UNSUPPORTED_SCHEMA_VERSION", `rate card schema version must be ${SCHEMA_VERSION}`);
  }
  assertNonEmpty(input.id, "rate_card.id");
  assertNonEmpty(input.currency, "rate_card.currency");
  validateSourceUrl(input.source_url);
  parseDate(input.retrieved_at, "rate_card.retrieved_at", false);
  for (const [index, assumption] of input.assumptions.entries()) {
    assertNonEmpty(assumption, `rate_card.assumptions[${index}]`);
  }

  const ruleIds = new Set<string>();
  for (const rule of input.rules) {
    assertNonEmpty(rule.id, "rate_rule.id");
    assertNonEmpty(rule.model, `${rule.id}.model`);
    if (rule.provider !== undefined) assertNonEmpty(rule.provider, `${rule.id}.provider`);
    if (rule.product !== undefined) assertNonEmpty(rule.product, `${rule.id}.product`);
    if (ruleIds.has(rule.id)) throw new CoreError("RATE_RULE_CONFLICT", `duplicate rate rule id ${rule.id}`);
    ruleIds.add(rule.id);

    const from = parseBoundary(rule.valid_from, `${rule.id}.valid_from`);
    const to = parseBoundary(rule.valid_to, `${rule.id}.valid_to`);
    if (from && to && from.getTime() >= to.getTime()) {
      throw new CoreError("INVALID_RATE_INTERVAL", `${rule.id} valid_from must precede valid_to`);
    }
    assertQuantity(rule.unit_tokens, `${rule.id}.unit_tokens`);
    if (rule.unit_tokens === "0") {
      throw new CoreError("INVALID_RATE", `${rule.id}.unit_tokens must be positive`);
    }
    for (const category of ["input", "cache_read", "cache_write", "output"] as const) {
      const rate = rule.rates[category];
      if (rate !== null) assertDecimal(rate, `${rule.id}.rates.${category}`, true);
    }
  }
  return cloneJson(input);
}

/** Validate and clone a rate card, including dates and exact non-negative rates. */
export function validateRateCard(value: unknown): RateCard {
  validateWithAjv<RateCard>(value, rateCardValidator, "RATE_CARD_SCHEMA_INVALID");
  return semanticValidateRateCard(value);
}

function mergeSources(bundles: EvidenceBundle[]): Source[] {
  const byId = new Map<string, Source>();
  for (const bundle of bundles) {
    for (const source of bundle.sources) {
      const prior = byId.get(source.id);
      if (prior && !sameJson(sourceContent(prior), sourceContent(source))) {
        throw new CoreError("SOURCE_CONFLICT", `source ${source.id} has conflicting metadata`);
      }
      if (!prior) byId.set(source.id, cloneSource(source));
    }
  }
  return [...byId.values()].sort((left, right) => compareText(left.id, right.id));
}

function mergeObservations(bundles: EvidenceBundle[]): Observation[] {
  const byId = new Map<string, Observation>();
  for (const bundle of bundles) {
    for (const observation of bundle.observations) {
      const prior = byId.get(observation.id);
      if (!prior) {
        byId.set(observation.id, cloneObservation(observation));
        continue;
      }
      if (!sameJson(observationContent(prior), observationContent(observation))) {
        throw new CoreError("OBSERVATION_CONFLICT", `observation ${observation.id} has conflicting payloads`);
      }
      const refs = new Map<string, SourceRef>();
      for (const sourceRef of [...prior.source_refs, ...observation.source_refs]) {
        refs.set(sourceRefKey(sourceRef), cloneSourceRef(sourceRef));
      }
      prior.source_refs = sortSourceRefs([...refs.values()]);
    }
  }
  return [...byId.values()]
    .sort((left, right) => compareText(left.id, right.id))
    .map((observation) => ({ ...observation, source_refs: sortSourceRefs(observation.source_refs) }));
}

function mergeRelationships(bundles: EvidenceBundle[]): Relationship[] {
  const byKey = new Map<string, Relationship>();
  for (const bundle of bundles) {
    for (const relationship of bundle.relationships) byKey.set(relationshipKey(relationship), { ...relationship });
  }
  return sortRelationships([...byKey.values()]);
}

function mergeIssues(bundles: EvidenceBundle[]): CoverageIssue[] {
  const byKey = new Map<string, CoverageIssue>();
  for (const bundle of bundles) {
    for (const coverageIssue of bundle.issues) byKey.set(issueKey(coverageIssue), cloneIssue(coverageIssue));
  }
  return sortIssues([...byKey.values()]);
}

/** Merge replayed exports idempotently while failing on conflicting observation identities. */
export function reconcileEvidence(bundles: EvidenceBundle[]): EvidenceBundle {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    throw new CoreError("EVIDENCE_EMPTY", "at least one evidence bundle is required");
  }
  const validated = bundles.map((bundle) => validateEvidence(bundle));
  const datasetId = validated[0]?.dataset_id;
  if (!datasetId) throw new CoreError("EVIDENCE_EMPTY", "at least one evidence bundle is required");
  for (const bundle of validated) {
    if (bundle.dataset_id !== datasetId) {
      throw new CoreError("DATASET_MISMATCH", "evidence bundles must have the same dataset_id");
    }
  }

  const result: EvidenceBundle = {
    schema_version: SCHEMA_VERSION,
    dataset_id: datasetId,
    sources: mergeSources(validated),
    observations: mergeObservations(validated),
    relationships: mergeRelationships(validated),
    issues: mergeIssues(validated),
  };
  return validateEvidence(result);
}

interface DecimalParts {
  numerator: bigint;
  scale: number;
}

function parseDecimal(value: string, label: string, nonNegative = false): DecimalParts {
  assertDecimal(value, label, nonNegative);
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = fraction.length;
  const magnitude = BigInt(`${whole}${fraction}` || "0");
  return { numerator: negative ? -magnitude : magnitude, scale };
}

function tenTo(power: number): bigint {
  return 10n ** BigInt(power);
}

/** Round a rational number to the nearest integer, with ties to the even integer. */
function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new CoreError("ARITHMETIC_ERROR", "rounding denominator must be positive");
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const doubled = remainder * 2n;
  let rounded = quotient;
  if (doubled > denominator || (doubled === denominator && quotient % 2n === 1n)) rounded += 1n;
  return negative ? -rounded : rounded;
}

function recordedAmountNanos(recordedCost: RecordedCost, observationId: string): bigint {
  const parsed = parseDecimal(recordedCost.amount, `${observationId}.recorded_cost.amount`);
  return roundHalfEven(parsed.numerator * NANO_SCALE, tenTo(parsed.scale));
}

function productFromObservation(observation: Observation): string | undefined {
  if (observation.product !== undefined) return observation.product;
  const attribute = observation.attributes?.product;
  return typeof attribute === "string" ? attribute : undefined;
}

interface RateMatch {
  rule?: RateRule;
  code: string;
  reason: string;
}

function dimensionsMatch(observation: Observation, rule: RateRule): boolean {
  if (observation.model === undefined || observation.model_identity === "unknown") return false;
  if (observation.model !== rule.model) return false;
  if (rule.provider !== undefined && observation.provider !== rule.provider) return false;
  if (rule.product !== undefined && productFromObservation(observation) !== rule.product) return false;
  return true;
}

function intervalMatches(observation: Observation, rule: RateRule): boolean {
  const from = parseBoundary(rule.valid_from, `${rule.id}.valid_from`);
  const to = parseBoundary(rule.valid_to, `${rule.id}.valid_to`);
  if (!from && !to) return true;
  if (!observation.timestamp) return false;
  const timestamp = parseDate(observation.timestamp, `${observation.id}.timestamp`, false).getTime();
  if (from && timestamp < from.getTime()) return false;
  if (to && timestamp >= to.getTime()) return false;
  return true;
}

function potentialRulesForUnknownDimension(observation: Observation, rateCard: RateCard): RateRule[] {
  const observedProduct = productFromObservation(observation);
  return rateCard.rules.filter((rule) => {
    if (observation.model === undefined || observation.model_identity === "unknown" || rule.model !== observation.model) {
      return false;
    }
    if (observation.provider !== undefined && rule.provider !== undefined && rule.provider !== observation.provider) {
      return false;
    }
    if (observedProduct !== undefined && rule.product !== undefined && rule.product !== observedProduct) {
      return false;
    }
    return true;
  });
}

function matchRateRule(observation: Observation, rateCard: RateCard): RateMatch {
  if (observation.model === undefined || observation.model_identity === "unknown") {
    return { code: "MODEL_UNAVAILABLE", reason: "model identity is unavailable or explicitly unknown" };
  }

  const candidates = rateCard.rules.filter(
    (rule) => dimensionsMatch(observation, rule) && intervalMatches(observation, rule),
  );

  const potential = potentialRulesForUnknownDimension(observation, rateCard);
  const datedPotential = observation.timestamp ? potential.filter((rule) => intervalMatches(observation, rule)) : potential;
  if (observation.provider === undefined) {
    const providerValues = new Set(datedPotential.map((rule) => rule.provider).filter((value): value is string => value !== undefined));
    if (providerValues.size > 0) {
      return { code: "RATE_AMBIGUOUS", reason: "provider is unavailable while provider-specific rates exist" };
    }
  }
  if (productFromObservation(observation) === undefined) {
    const productValues = new Set(datedPotential.map((rule) => rule.product).filter((value): value is string => value !== undefined));
    if (productValues.size > 0) {
      return { code: "RATE_AMBIGUOUS", reason: "product is unavailable while product-specific rates exist" };
    }
  }
  if (observation.timestamp === undefined) {
    const bounded = potential.some((rule) => rule.valid_from != null || rule.valid_to != null);
    if (bounded) return { code: "DATE_UNAVAILABLE", reason: "observation timestamp is required for dated rates" };
  }

  if (candidates.length === 0) {
    return { code: "RATE_UNMATCHED", reason: "no rate rule uniquely matches model, provider, product and date" };
  }
  if (candidates.length > 1) {
    return { code: "RATE_AMBIGUOUS", reason: "more than one rate rule matches the observation" };
  }
  return { rule: candidates[0], code: "", reason: "" };
}

interface UsageComponents {
  freshInput: bigint;
  cacheRead: bigint;
  cacheWrite: bigint;
  output: bigint;
}

interface UsageResult {
  components?: UsageComponents;
  code?: string;
  reason?: string;
}

function usageComponents(usage: Usage | null, observationId: string): UsageResult {
  if (usage === null) {
    return { code: "USAGE_UNAVAILABLE", reason: "usage is unavailable" };
  }
  if (
    usage.input_tokens === null ||
    usage.cache_read_input_tokens === null ||
    usage.cache_write_input_tokens === null ||
    usage.output_tokens === null
  ) {
    return {
      code: "USAGE_UNAVAILABLE",
      reason: "input, cache subsets and output must all be known to derive a priced observation",
    };
  }
  const input = assertQuantity(usage.input_tokens, `${observationId}.usage.input_tokens`);
  const cacheRead = assertQuantity(usage.cache_read_input_tokens, `${observationId}.usage.cache_read_input_tokens`);
  const cacheWrite = assertQuantity(usage.cache_write_input_tokens, `${observationId}.usage.cache_write_input_tokens`);
  const output = assertQuantity(usage.output_tokens, `${observationId}.usage.output_tokens`);
  if (cacheRead + cacheWrite > input) {
    return { code: "SUBSET_OVERFLOW", reason: "cache subsets exceed inclusive input" };
  }
  if (usage.unclassified_tokens === null) {
    return { code: "UNCLASSIFIED_TOKENS", reason: "unclassified token coverage is unavailable" };
  }
  if (usage.unclassified_tokens !== undefined) {
    const unclassified = assertQuantity(usage.unclassified_tokens, `${observationId}.usage.unclassified_tokens`);
    if (unclassified > 0n) {
      return { code: "UNCLASSIFIED_TOKENS", reason: "unclassified tokens cannot be priced by the declared categories" };
    }
  }
  return {
    components: {
      freshInput: input - cacheRead - cacheWrite,
      cacheRead,
      cacheWrite,
      output,
    },
    ...(usage.unclassified_tokens === undefined
      ? {
          code: "UNCLASSIFIED_NOT_REPORTED",
          reason: "unclassified token category was not reported; derived amount covers declared categories",
        }
      : {}),
  };
}

function rateComponentsNanos(rule: RateRule, components: UsageComponents, observationId: string): bigint {
  const categoryValues: Array<[RateCategory, bigint]> = [
    ["input", components.freshInput],
    ["cache_read", components.cacheRead],
    ["cache_write", components.cacheWrite],
    ["output", components.output],
  ];
  const parsedRates = categoryValues.map(([category, quantity]) => {
    const value = rule.rates[category];
    if (value === null) return { category, quantity, rate: undefined as DecimalParts | undefined };
    return { category, quantity, rate: parseDecimal(value, `${rule.id}.rates.${category}`, true) };
  });
  for (const entry of parsedRates) {
    if (entry.quantity > 0n && entry.rate === undefined) {
      throw new CoreError(
        "RATE_UNAVAILABLE",
        `${observationId} has ${entry.quantity} ${entry.category} tokens but rule ${rule.id} has no rate`,
      );
    }
  }

  const maxScale = parsedRates.reduce((maximum, entry) => Math.max(maximum, entry.rate?.scale ?? 0), 0);
  let numerator = 0n;
  for (const entry of parsedRates) {
    if (entry.quantity === 0n || entry.rate === undefined) continue;
    numerator += entry.quantity * entry.rate.numerator * tenTo(maxScale - entry.rate.scale);
  }
  const denominator = BigInt(rule.unit_tokens) * tenTo(maxScale);
  return roundHalfEven(numerator * NANO_SCALE, denominator);
}

function ensureOptions(value: ValuationOptions): void {
  if (!isObject(value) || (value.mode !== "recorded" && value.mode !== "rate_card")) {
    throw new CoreError("INVALID_OPTIONS", "valuation mode must be recorded or rate_card");
  }
  if (value.currency !== undefined) assertNonEmpty(value.currency, "valuation currency");
  if (value.mode === "rate_card" && value.rate_card === undefined) {
    throw new CoreError("RATE_CARD_REQUIRED", "rate_card mode requires a rate_card");
  }
}

function modeBasis(recordedCosts: RecordedCost[]): CostBasis | "mixed" {
  const bases = new Set(recordedCosts.map((recordedCost) => recordedCost.basis));
  if (bases.size === 0) return "mixed";
  if (bases.size > 1) throw new CoreError("MIXED_BASIS", "recorded observations use multiple cost bases");
  return [...bases][0] as CostBasis;
}

function hashValuationInput(
  evidence: EvidenceBundle,
  options: { mode: ValuationOptions["mode"]; currency: string; rate_card?: RateCard },
): string {
  const rateCard = options.rate_card
    ? {
        ...options.rate_card,
        rules: [...options.rate_card.rules].sort((left, right) => compareText(left.id, right.id)),
      }
    : null;
  const payload = {
    algorithm: "direct-only-v1/half-even-nano/1",
    evidence,
    mode: options.mode,
    currency: options.currency,
    rate_card: rateCard,
  };
  return `val-${createHash("sha256").update(stableJson(payload)).digest("hex")}`;
}

/**
 * Derive one declared monetary valuation. Quantities remain in the evidence
 * bundle; only direct observations can produce monetary lines in v0.1.
 */
export function valueEvidence(evidence: EvidenceBundle, options: ValuationOptions): Valuation {
  ensureOptions(options);
  const normalized = reconcileEvidence([evidence]);
  const rateCard = options.mode === "rate_card" ? validateRateCard(options.rate_card) : undefined;

  const directRecordedCosts = normalized.observations
    .filter((observation) => observation.accounting_scope === "direct" && observation.recorded_cost)
    .map((observation) => observation.recorded_cost as RecordedCost);

  let currency: string;
  let basis: CostBasis | "mixed";
  if (rateCard) {
    currency = rateCard.currency;
    if (options.currency !== undefined && options.currency !== currency) {
      throw new CoreError("CURRENCY_MISMATCH", `valuation currency ${options.currency} differs from rate card ${currency}`);
    }
    basis = rateCard.basis;
  } else {
    const recordedCurrencies = new Set(directRecordedCosts.map((recordedCost) => recordedCost.currency));
    if (recordedCurrencies.size > 1) throw new CoreError("MIXED_CURRENCY", "recorded observations use multiple currencies");
    const inferredCurrency = [...recordedCurrencies][0];
    currency = options.currency ?? inferredCurrency ?? "UNKNOWN";
    if (inferredCurrency !== undefined && inferredCurrency !== currency) {
      throw new CoreError("CURRENCY_MISMATCH", `recorded currency ${inferredCurrency} differs from valuation currency ${currency}`);
    }
    basis = modeBasis(directRecordedCosts);
  }

  const issues: CoverageIssue[] = normalized.issues.map(cloneIssue);
  if (normalized.sources.length === 0) {
    addIssue(issues, issue("SOURCE_COVERAGE_UNKNOWN", "evidence declares no source capture boundary", "warning"));
  }
  for (const source of normalized.sources) {
    if (source.coverage !== "complete") {
      addIssue(
        issues,
        issue(
          source.coverage === "partial" ? "SOURCE_COVERAGE_PARTIAL" : "SOURCE_COVERAGE_UNKNOWN",
          `source ${source.id} declares ${source.coverage} capture coverage`,
          "warning",
          undefined,
          source.id,
        ),
      );
    }
  }

  const values: ValuedObservation[] = [];
  let total = 0n;
  for (const observation of normalized.observations) {
    if (observation.accounting_scope !== "direct") {
      const scope = observation.accounting_scope;
      const code = scope === "unknown" ? "ACCOUNTING_SCOPE_UNKNOWN" : "NON_DIRECT_EXCLUDED";
      addIssue(
        issues,
        issue(
          code,
          `${scope} observation is retained as evidence but excluded by ${SELECTION_POLICY}`,
          "warning",
          observation.id,
        ),
      );
      values.push({
        observation_id: observation.id,
        amount_nanos: null,
        basis: null,
        reason: `${scope} accounting scope is excluded by ${SELECTION_POLICY}`,
      });
      continue;
    }

    if (rateCard === undefined) {
      if (observation.recorded_cost === undefined) {
        addIssue(issues, issue("RECORDED_COST_UNAVAILABLE", "direct observation has no recorded cost", "warning", observation.id));
        values.push({
          observation_id: observation.id,
          amount_nanos: null,
          basis: null,
          reason: "recorded cost is unavailable",
        });
        continue;
      }
      const recordedCost = observation.recorded_cost;
      if (recordedCost.currency !== currency) {
        throw new CoreError(
          "CURRENCY_MISMATCH",
          `observation ${observation.id} currency ${recordedCost.currency} differs from valuation currency ${currency}`,
        );
      }
      const amount = recordedAmountNanos(recordedCost, observation.id);
      total += amount;
      values.push({ observation_id: observation.id, amount_nanos: amount.toString(), basis: recordedCost.basis });
      continue;
    }

    const match = matchRateRule(observation, rateCard);
    if (!match.rule) {
      addIssue(issues, issue(match.code, `${observation.id}: ${match.reason}`, "warning", observation.id));
      values.push({ observation_id: observation.id, amount_nanos: null, basis: null, reason: match.reason });
      continue;
    }

    const usage = usageComponents(observation.usage, observation.id);
    if (!usage.components) {
      addIssue(issues, issue(usage.code ?? "USAGE_UNAVAILABLE", `${observation.id}: ${usage.reason ?? "usage is unavailable"}`, "warning", observation.id));
      values.push({
        observation_id: observation.id,
        amount_nanos: null,
        basis: null,
        rate_rule_id: match.rule.id,
        reason: usage.reason,
      });
      continue;
    }

    if (usage.code === "UNCLASSIFIED_NOT_REPORTED") {
      addIssue(issues, issue(usage.code, `${observation.id}: ${usage.reason}`, "warning", observation.id));
    }

    let amount: bigint;
    try {
      amount = rateComponentsNanos(match.rule, usage.components, observation.id);
    } catch (error) {
      if (error instanceof CoreError && error.code === "RATE_UNAVAILABLE") {
        addIssue(issues, issue(error.code, error.message, "warning", observation.id));
        values.push({
          observation_id: observation.id,
          amount_nanos: null,
          basis: null,
          rate_rule_id: match.rule.id,
          reason: error.message,
        });
        continue;
      }
      throw error;
    }
    total += amount;
    values.push({
      observation_id: observation.id,
      amount_nanos: amount.toString(),
      basis: rateCard.basis,
      rate_rule_id: match.rule.id,
    });
  }

  const assumptions = rateCard
    ? [
        ...rateCard.assumptions,
        `selection policy: ${SELECTION_POLICY}`,
        "input_tokens are inclusive; cache-read and cache-write subsets are priced separately",
        "reasoning_output_tokens is a subset of output_tokens and is not charged again",
        "each observation is rounded once to nano-currency using HALF_EVEN",
        ...[...rateCard.rules].sort((left, right) => compareText(left.id, right.id)).flatMap((rule) => [
          ...(rule.valid_from == null ? [`rate rule ${rule.id} has an unbounded validity start`] : []),
          ...(rule.valid_to == null ? [`rate rule ${rule.id} has an unbounded validity end`] : []),
        ]),
      ]
    : [
        `selection policy: ${SELECTION_POLICY}`,
        "recorded monetary amounts are rounded once to nano-currency using HALF_EVEN",
      ];
  const complete = !issues.some((coverageIssue) => coverageIssue.severity !== "info") && values.every((value) => value.amount_nanos !== null);
  const orderedIssues = sortIssues(issues);
  const valuation: Valuation = {
    schema_version: SCHEMA_VERSION,
    id: hashValuationInput(normalized, { mode: options.mode, currency, ...(rateCard ? { rate_card: rateCard } : {}) }),
    dataset_id: normalized.dataset_id,
    selection_policy: SELECTION_POLICY,
    currency,
    basis,
    ...(rateCard ? { rate_card_id: rateCard.id } : {}),
    assumptions,
    observations: values,
    total_nanos: total.toString(),
    complete,
    issues: orderedIssues,
  };
  return valuation;
}
