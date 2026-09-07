import type {
  AcceptanceOutcome,
  AttemptRecord,
  BenchmarkComparison,
  BenchmarkInput,
  BenchmarkResourceDelta,
  BenchmarkSample,
  CapacitySnapshot,
  CandidatePolicy,
  CandidatePolicyScenario,
  CohortSelector,
  CohortSummary,
  EfficiencyAnalysis,
  EfficiencyEvidence,
  EfficiencyFinding,
  EfficiencyInput,
  EfficiencyOptions,
  EfficiencyQuantity,
  EfficiencyRate,
  EfficiencyScope,
  EfficiencyStatus,
  EfficiencyWorkItem,
  ExactRatio,
  RunwayDemand,
  RunwayForecast,
  RunwayOptions,
  SessionEfficiencySummary,
  TaskEfficiencySummary,
} from "./efficiency-types.js";
import { EFFICIENCY_SCHEMA_VERSION } from "./efficiency-types.js";
import type {
  UsageBundle,
  UsageEvidence,
  UsageMeasurement,
  UsageObservation,
  UsageReport,
  UsageSourceRef,
} from "./usage-types.js";
import { isAdditiveUsageMeasurement, validateUsageBundle, validateUsageReport } from "./usage.js";

type JsonObject = Record<string, unknown>;
type UsageValue = UsageReport | UsageBundle;

/** Errors from the browser-safe efficiency seams have stable machine codes. */
export class EfficiencyError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "EfficiencyError";
    this.code = code;
    this.details = details;
  }
}

const ID_RE = /^\S+$/;
const INTEGER_RE = /^(0|[1-9][0-9]*)$/;
const DECIMAL_RE = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const TERMINAL_OUTCOMES = new Set<AcceptanceOutcome["status"]>([
  "accepted",
  "failed",
  "interrupted",
  "capped",
  "cancelled",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(code: string, message: string, details?: unknown): never {
  throw new EfficiencyError(code, message, details);
}

function inputKeys(value: JsonObject, label: string, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("INVALID_EFFICIENCY_INPUT", `${label}.${key} is not defined by the efficiency input contract`);
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) fail("INVALID_ID", `${label} must be a non-empty ID`);
  return value;
}

function workItemId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail("INVALID_WORK_ITEM", `${label} must be a non-empty work item identifier`);
  return value;
}

function quantity(value: unknown, label: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_QUANTITY", `${label} must be a non-negative integer string`);
    return String(value);
  }
  if (typeof value !== "string" || !DECIMAL_RE.test(value)) {
    fail("INVALID_QUANTITY", `${label} must be a canonical non-negative decimal string`);
  }
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length ? `${whole ?? "0"}.${trimmed}` : whole ?? "0";
}

function integerQuantity(value: unknown, label: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_QUANTITY", `${label} must be a non-negative integer string`);
    return String(value);
  }
  if (typeof value !== "string" || !INTEGER_RE.test(value)) fail("INVALID_QUANTITY", `${label} must be a canonical non-negative integer string`);
  return value;
}

interface ExactDateTime {
  seconds: bigint;
  fraction: string;
}

function floorDivide(left: bigint, right: bigint): bigint {
  const quotient = left / right;
  return left % right < 0n ? quotient - 1n : quotient;
}

function civilDaysSinceEpoch(year: number, month: number, day: number): bigint {
  let adjustedYear = BigInt(year) - (month <= 2 ? 1n : 0n);
  const era = floorDivide(adjustedYear, 400n);
  const yearOfEra = adjustedYear - era * 400n;
  const monthPrime = BigInt(month) + (month > 2 ? -3n : 9n);
  const dayOfYear = (153n * monthPrime + 2n) / 5n + BigInt(day) - 1n;
  const dayOfEra = yearOfEra * 365n + yearOfEra / 4n - yearOfEra / 100n + dayOfYear;
  return era * 146097n + dayOfEra - 719468n;
}

function parseDateTime(value: unknown, label: string): ExactDateTime {
  if (typeof value !== "string") fail("INVALID_DATE", `${label} must be a valid RFC3339 date-time`);
  const match = DATE_TIME_RE.exec(value);
  if (!match) fail("INVALID_DATE", `${label} must be a valid RFC3339 date-time`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]! || hour > 23 || minute > 59 || second > 59) {
    fail("INVALID_DATE", `${label} has an invalid calendar value`);
  }
  let offsetMinutes = 0;
  const zone = match[8]!;
  if (zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) fail("INVALID_DATE", `${label} has an invalid UTC offset`);
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }
  const seconds = civilDaysSinceEpoch(year, month, day) * 86400n
    + BigInt(hour * 3600 + minute * 60 + second)
    - BigInt(offsetMinutes * 60);
  return { seconds, fraction };
}

function dateTime(value: unknown, label: string): string {
  parseDateTime(value, label);
  return value as string;
}

function compareFractions(left: string, right: string): number {
  const scale = Math.max(left.length, right.length);
  const leftPadded = left.padEnd(scale, "0");
  const rightPadded = right.padEnd(scale, "0");
  return leftPadded === rightPadded ? 0 : leftPadded < rightPadded ? -1 : 1;
}

function compareDateTimes(left: string, right: string): number {
  const leftParsed = parseDateTime(left, "timestamp");
  const rightParsed = parseDateTime(right, "timestamp");
  if (leftParsed.seconds !== rightParsed.seconds) return leftParsed.seconds < rightParsed.seconds ? -1 : 1;
  return compareFractions(leftParsed.fraction, rightParsed.fraction);
}

function exceedsDateTimeAge(now: string, observed: string, limitSeconds: bigint): boolean {
  const nowParsed = parseDateTime(now, "runway.now");
  const observedParsed = parseDateTime(observed, "capacity.observed_at");
  const seconds = nowParsed.seconds - observedParsed.seconds;
  if (seconds > limitSeconds) return true;
  if (seconds < limitSeconds) return false;
  return compareFractions(nowParsed.fraction, observedParsed.fraction) > 0;
}

function sourceRefs(value: unknown, label: string, required = false): UsageSourceRef[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail("INVALID_SOURCE_REFS", `${label} must be an array`);
  return value.map((raw, index) => {
    if (!isObject(raw)) fail("INVALID_SOURCE_REF", `${label}[${index}] must be an object`);
    return { source_id: id(raw.source_id, `${label}[${index}].source_id`), record: id(raw.record, `${label}[${index}].record`) };
  });
}

function evidence(value: unknown, label: string): EfficiencyEvidence {
  if (value === "observed" || value === "declared" || value === "derived" || value === "estimated" || value === "unknown") return value;
  fail("INVALID_EVIDENCE", `${label} has an unsupported evidence class`);
}

function status(value: unknown, label: string): AcceptanceOutcome["status"] {
  if (
    value === "planned" ||
    value === "in_progress" ||
    value === "accepted" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "capped" ||
    value === "cancelled" ||
    value === "unknown"
  ) return value;
  fail("INVALID_STATUS", `${label} has an unsupported outcome status`);
}

function ratio(numerator: string, denominator: string): ExactRatio {
  return { numerator, denominator };
}

function integerBigint(value: string, label: string): bigint {
  integerQuantity(value, label);
  return BigInt(value);
}

interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

function exactDecimal(value: string, label: string): ExactDecimal {
  const normalized = quantity(value, label);
  const [whole, fraction = ""] = normalized.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function normalizeExactDecimal(value: ExactDecimal): ExactDecimal {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function exactDecimalAdd(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return normalizeExactDecimal({
    coefficient: left.coefficient * 10n ** BigInt(scale - left.scale) + right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  });
}

function exactDecimalText(value: ExactDecimal): string {
  const normalized = normalizeExactDecimal(value);
  if (normalized.scale === 0) return normalized.coefficient.toString();
  const raw = normalized.coefficient.toString().padStart(normalized.scale + 1, "0");
  return `${raw.slice(0, -normalized.scale)}.${raw.slice(-normalized.scale)}`;
}

function exactDecimalFraction(value: ExactDecimal): ExactRatio {
  return reduceRatio(value.coefficient, 10n ** BigInt(value.scale));
}

function decimalFraction(value: string, label: string): ExactRatio {
  return exactDecimalFraction(exactDecimal(value, label));
}

function addFractions(left: ExactRatio, right: ExactRatio): ExactRatio {
  return reduceRatio(BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator), BigInt(left.denominator) * BigInt(right.denominator));
}

function add(left: bigint, right: bigint): bigint {
  return left + right;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function reduceRatio(numerator: bigint, denominator: bigint): ExactRatio {
  if (denominator <= 0n) fail("INVALID_RATIO", "ratio denominator must be positive");
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor).toString(), denominator: (denominator / divisor).toString() };
}

function ratioDifference(left: ExactRatio | null, right: ExactRatio | null): string | null {
  if (!left || !right) return null;
  const numerator = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  const denominator = BigInt(left.denominator) * BigInt(right.denominator);
  const reduced = reduceRatio(numerator, denominator);
  return `${reduced.numerator}/${reduced.denominator}`;
}

function signedDifference(left: ExactRatio | null, right: ExactRatio | null): string | null {
  if (!left || !right) return null;
  const numerator = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  const denominator = BigInt(left.denominator) * BigInt(right.denominator);
  if (numerator % denominator === 0n) return (numerator / denominator).toString();
  const sign = numerator < 0n ? "-" : "";
  const reduced = reduceRatio(numerator < 0n ? -numerator : numerator, denominator);
  return `${sign}${reduced.numerator}/${reduced.denominator}`;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function uniqueRefs(...refs: UsageSourceRef[][]): UsageSourceRef[] {
  const seen = new Set<string>();
  const result: UsageSourceRef[] = [];
  for (const list of refs) {
    for (const ref of list) {
      const key = `${ref.source_id}\u0000${ref.record}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...ref });
    }
  }
  return result.sort((a, b) => compareText(`${a.source_id}/${a.record}`, `${b.source_id}/${b.record}`));
}

function isUsageReport(value: JsonObject): boolean {
  return isObject(value.bundle) && Array.isArray(value.groups) && Array.isArray(value.observations);
}

function validateUsage(value: unknown): UsageValue {
  if (!isObject(value)) fail("INVALID_USAGE", "usage must be a UsageReport or UsageBundle object");
  if (isUsageReport(value)) {
    return clone(validateUsageReport(value));
  }
  return clone(validateUsageBundle(value));
}

function normalizeAcceptance(value: unknown, label: string): AcceptanceOutcome {
  if (!isObject(value)) fail("INVALID_ACCEPTANCE", `${label} must be an object`);
  inputKeys(value, label, ["status", "accepted", "version", "evidence", "recorded_at", "quality_passed", "source_refs"]);
  const result: AcceptanceOutcome = {
    status: status(value.status, `${label}.status`),
    evidence: evidence(value.evidence, `${label}.evidence`),
  };
  if (value.version !== undefined) result.version = id(value.version, `${label}.version`);
  if (value.recorded_at !== undefined) result.recorded_at = dateTime(value.recorded_at, `${label}.recorded_at`);
  if (value.quality_passed !== undefined && value.quality_passed !== null && typeof value.quality_passed !== "boolean") {
    fail("INVALID_ACCEPTANCE", `${label}.quality_passed must be boolean or null`);
  }
  if (value.quality_passed !== undefined) result.quality_passed = value.quality_passed as boolean | null;
  const refs = sourceRefs(value.source_refs, `${label}.source_refs`);
  if (refs.length) result.source_refs = refs;
  return result;
}

function normalizeScope(value: unknown, label: string): EfficiencyScope {
  if (!isObject(value)) fail("INVALID_SCOPE", `${label} must be an object`);
  inputKeys(value, label, ["revision", "version", "description", "acceptance_criteria"]);
  const result: EfficiencyScope = { revision: id(value.revision, `${label}.revision`) };
  if (value.version !== undefined) result.version = id(value.version, `${label}.version`);
  if (value.description !== undefined) {
    if (typeof value.description !== "string" || value.description.trim() === "") fail("INVALID_SCOPE", `${label}.description must be non-empty`);
    result.description = value.description;
  }
  if (value.acceptance_criteria !== undefined) {
    if (!Array.isArray(value.acceptance_criteria) || value.acceptance_criteria.some((item) => typeof item !== "string" || item.trim() === "")) {
      fail("INVALID_SCOPE", `${label}.acceptance_criteria must contain non-empty strings`);
    }
    result.acceptance_criteria = [...value.acceptance_criteria] as string[];
  }
  return result;
}

function normalizeAttempt(value: unknown, label: string): AttemptRecord {
  if (!isObject(value)) fail("INVALID_ATTEMPT", `${label} must be an object`);
  inputKeys(value, label, ["attempt_id", "observation_ids", "status", "kind", "retry_of", "escalated_from", "source_refs"]);
  const result: AttemptRecord = {
    attempt_id: id(value.attempt_id, `${label}.attempt_id`),
    status: status(value.status, `${label}.status`),
  };
  if (value.observation_ids !== undefined) {
    if (!Array.isArray(value.observation_ids)) fail("INVALID_ATTEMPT", `${label}.observation_ids must be an array`);
    result.observation_ids = value.observation_ids.map((item, index) => id(item, `${label}.observation_ids[${index}]`));
  }
  if (value.kind !== undefined) {
    if (!["initial", "retry", "escalation", "review", "rework", "delegation", "unknown"].includes(String(value.kind))) fail("INVALID_ATTEMPT", `${label}.kind is unsupported`);
    result.kind = value.kind as AttemptRecord["kind"];
  }
  if (value.retry_of !== undefined) result.retry_of = id(value.retry_of, `${label}.retry_of`);
  if (value.escalated_from !== undefined) result.escalated_from = id(value.escalated_from, `${label}.escalated_from`);
  const refs = sourceRefs(value.source_refs, `${label}.source_refs`);
  if (refs.length) result.source_refs = refs;
  return result;
}

function normalizeWorkItem(value: unknown, label: string): EfficiencyWorkItem {
  if (!isObject(value)) fail("INVALID_WORK_ITEM", `${label} must be an object`);
  inputKeys(value, label, ["work_item_id", "task_id", "scope", "acceptance", "outcome", "attempts", "classification", "source_refs"]);
  const acceptanceValue = value.acceptance ?? value.outcome;
  if (acceptanceValue === undefined) fail("INVALID_WORK_ITEM", `${label} requires an acceptance outcome`);
  const acceptanceObject = isObject(acceptanceValue) ? { ...acceptanceValue } : acceptanceValue;
  if (isObject(acceptanceObject)) {
    if (acceptanceObject.status === undefined && typeof acceptanceObject.accepted === "boolean") acceptanceObject.status = acceptanceObject.accepted ? "accepted" : "failed";
    if (acceptanceObject.evidence === undefined) acceptanceObject.evidence = "declared";
  }
  const result: EfficiencyWorkItem = {
    work_item_id: workItemId(value.work_item_id, `${label}.work_item_id`),
    scope: normalizeScope(value.scope, `${label}.scope`),
    acceptance: normalizeAcceptance(acceptanceObject, `${label}.acceptance`),
  };
  if (value.task_id !== undefined) result.task_id = id(value.task_id, `${label}.task_id`);
  if (value.attempts !== undefined) {
    if (!Array.isArray(value.attempts)) fail("INVALID_WORK_ITEM", `${label}.attempts must be an array`);
    result.attempts = value.attempts.map((item, index) => normalizeAttempt(item, `${label}.attempts[${index}]`));
  }
  if (value.classification !== undefined) {
    if (!isObject(value.classification)) fail("INVALID_CLASSIFICATION", `${label}.classification must be an object`);
    inputKeys(value.classification, `${label}.classification`, ["value", "evidence", "method", "source_refs"]);
    const classification: EfficiencyWorkItem["classification"] = {
      value: id(value.classification.value, `${label}.classification.value`),
      evidence: evidence(value.classification.evidence, `${label}.classification.evidence`),
    };
    if (value.classification.method !== undefined) classification.method = id(value.classification.method, `${label}.classification.method`);
    const refs = sourceRefs(value.classification.source_refs, `${label}.classification.source_refs`);
    if (refs.length) classification.source_refs = refs;
    result.classification = classification;
  }
  const refs = sourceRefs(value.source_refs, `${label}.source_refs`);
  if (refs.length) result.source_refs = refs;
  return result;
}

function normalizeQuantity(value: unknown, label: string): EfficiencyQuantity {
  if (!isObject(value)) fail("INVALID_EFFICIENCY_QUANTITY", `${label} must be an object`);
  inputKeys(value, label, ["meter_id", "unit", "quantity", "evidence", "source_refs"]);
  const result: EfficiencyQuantity = {
    meter_id: id(value.meter_id, `${label}.meter_id`),
    unit: id(value.unit, `${label}.unit`),
    quantity: quantity(value.quantity, `${label}.quantity`),
    evidence: evidence(value.evidence, `${label}.evidence`),
  };
  const refs = sourceRefs(value.source_refs, `${label}.source_refs`);
  if (refs.length) result.source_refs = refs;
  return result;
}

function normalizeBenchmark(value: unknown, label: string): BenchmarkInput {
  if (!isObject(value)) fail("INVALID_BENCHMARK", `${label} must be an object`);
  inputKeys(value, label, ["benchmark_id", "role", "cohort", "conditions", "model_config", "evaluation", "samples", "analysis_overhead", "provenance"]);
  if (!isObject(value.cohort) || !isObject(value.conditions) || !isObject(value.model_config)) fail("INVALID_BENCHMARK", `${label} requires cohort, conditions and model_config`);
  const cohort = value.cohort;
  const conditions = value.conditions;
  const model = value.model_config;
  inputKeys(cohort, `${label}.cohort`, ["workload_id", "task_class", "scope_revision", "acceptance_version", "acceptance_criteria_id"]);
  inputKeys(conditions, `${label}.conditions`, ["harness", "harness_version", "tools_version", "cache", "context_policy", "routing_policy", "other"]);
  inputKeys(model, `${label}.model_config`, ["model", "model_version", "reasoning", "tier", "provider"]);
  const role = value.role;
  const evaluation = value.evaluation;
  if (role !== "baseline" && role !== "candidate" && role !== "control") fail("INVALID_BENCHMARK", `${label}.role is unsupported`);
  if (evaluation !== "held_out" && evaluation !== "controlled" && evaluation !== "historical" && evaluation !== "declared") fail("INVALID_BENCHMARK", `${label}.evaluation is unsupported`);
  if (typeof value.samples === "undefined" || !Array.isArray(value.samples)) fail("INVALID_BENCHMARK", `${label}.samples must be an array`);
  const result: BenchmarkInput = {
    benchmark_id: id(value.benchmark_id, `${label}.benchmark_id`),
    role,
    cohort: {
      workload_id: id(cohort.workload_id, `${label}.cohort.workload_id`),
      scope_revision: id(cohort.scope_revision, `${label}.cohort.scope_revision`),
      acceptance_version: id(cohort.acceptance_version, `${label}.cohort.acceptance_version`),
    },
    conditions: { harness: id(conditions.harness, `${label}.conditions.harness`) },
    model_config: { model: id(model.model, `${label}.model_config.model`) },
    evaluation,
    samples: [],
    provenance: sourceRefs(value.provenance, `${label}.provenance`, true),
  };
  if (cohort.task_class !== undefined) result.cohort.task_class = id(cohort.task_class, `${label}.cohort.task_class`);
  if (cohort.acceptance_criteria_id !== undefined) result.cohort.acceptance_criteria_id = id(cohort.acceptance_criteria_id, `${label}.cohort.acceptance_criteria_id`);
  for (const key of ["harness_version", "tools_version", "cache", "context_policy", "routing_policy"] as const) {
    if (conditions[key] !== undefined) result.conditions[key] = id(conditions[key], `${label}.conditions.${key}`);
  }
  if (conditions.other !== undefined) {
    if (!isObject(conditions.other)) fail("INVALID_BENCHMARK", `${label}.conditions.other must be an object`);
    result.conditions.other = Object.fromEntries(Object.entries(conditions.other).map(([key, item]) => [id(key, `${label}.conditions.other key`), id(item, `${label}.conditions.other.${key}`)]));
  }
  for (const key of ["model_version", "reasoning", "tier", "provider"] as const) {
    if (model[key] !== undefined) result.model_config[key] = id(model[key], `${label}.model_config.${key}`);
  }
  result.samples = value.samples.map((raw, index) => normalizeBenchmarkSample(raw, `${label}.samples[${index}]`));
  const sampleIds = new Set<string>();
  const meterUnits = new Map<string, string>();
  for (const sample of result.samples) {
    if (sampleIds.has(sample.sample_id)) fail("DUPLICATE_BENCHMARK_SAMPLE", `${label} contains duplicate sample ${sample.sample_id}`);
    sampleIds.add(sample.sample_id);
    const sampleMeters = new Set<string>();
    for (const meter of sample.meters) {
      if (sampleMeters.has(meter.meter_id)) fail("DUPLICATE_BENCHMARK_METER", `${label}.samples.${sample.sample_id} contains duplicate meter ${meter.meter_id}`);
      sampleMeters.add(meter.meter_id);
      const priorUnit = meterUnits.get(meter.meter_id);
      if (priorUnit !== undefined && priorUnit !== meter.unit) fail("BENCHMARK_METER_UNIT", `${label} meter ${meter.meter_id} has conflicting units`);
      meterUnits.set(meter.meter_id, meter.unit);
    }
  }
  if (value.analysis_overhead !== undefined) {
    if (!Array.isArray(value.analysis_overhead)) fail("INVALID_BENCHMARK", `${label}.analysis_overhead must be an array`);
    result.analysis_overhead = value.analysis_overhead.map((item, index) => normalizeQuantity(item, `${label}.analysis_overhead[${index}]`));
    const overheadMeters = new Set<string>();
    for (const item of result.analysis_overhead) {
      if (overheadMeters.has(item.meter_id)) fail("DUPLICATE_BENCHMARK_OVERHEAD", `${label}.analysis_overhead contains duplicate meter ${item.meter_id}`);
      overheadMeters.add(item.meter_id);
      const priorUnit = meterUnits.get(item.meter_id);
      if (priorUnit !== undefined && priorUnit !== item.unit) fail("BENCHMARK_METER_UNIT", `${label} meter ${item.meter_id} has conflicting units between samples and analysis overhead`);
      meterUnits.set(item.meter_id, item.unit);
    }
  }
  return result;
}

function normalizeBenchmarkSample(value: unknown, label: string): BenchmarkSample {
  if (!isObject(value)) fail("INVALID_BENCHMARK_SAMPLE", `${label} must be an object`);
  inputKeys(value, label, ["sample_id", "task_id", "scope_revision", "acceptance_version", "accepted", "quality", "passed", "passed_score", "latency_ns", "meters", "attempts", "source_refs"]);
  if (!Array.isArray(value.meters)) fail("INVALID_BENCHMARK_SAMPLE", `${label}.meters must be an array`);
  if (value.accepted !== null && typeof value.accepted !== "boolean") fail("INVALID_BENCHMARK_SAMPLE", `${label}.accepted must be boolean or null`);
  const result: BenchmarkSample = {
    sample_id: id(value.sample_id, `${label}.sample_id`),
    task_id: id(value.task_id, `${label}.task_id`),
    accepted: value.accepted as boolean | null,
    meters: value.meters.map((item, index) => normalizeQuantity(item, `${label}.meters[${index}]`)),
    source_refs: sourceRefs(value.source_refs, `${label}.source_refs`, true),
  };
  if (value.scope_revision !== undefined) result.scope_revision = id(value.scope_revision, `${label}.scope_revision`);
  if (value.acceptance_version !== undefined) result.acceptance_version = id(value.acceptance_version, `${label}.acceptance_version`);
  if (value.latency_ns !== undefined && value.latency_ns !== null) result.latency_ns = integerQuantity(value.latency_ns, `${label}.latency_ns`);
  else if (value.latency_ns === null) result.latency_ns = null;
  if (value.attempts !== undefined) result.attempts = integerQuantity(value.attempts, `${label}.attempts`);
  if (value.quality !== undefined) {
    if (!isObject(value.quality)) fail("INVALID_BENCHMARK_SAMPLE", `${label}.quality is invalid`);
    inputKeys(value.quality, `${label}.quality`, ["passed", "evidence", "score", "source_refs"]);
    if ((value.quality.passed !== null && typeof value.quality.passed !== "boolean") || value.quality.passed === undefined) fail("INVALID_BENCHMARK_SAMPLE", `${label}.quality is invalid`);
    result.quality = { passed: value.quality.passed as boolean | null, evidence: evidence(value.quality.evidence, `${label}.quality.evidence`) };
    if (value.quality.score !== undefined && value.quality.score !== null) result.quality.score = String(value.quality.score);
    const refs = sourceRefs(value.quality.source_refs, `${label}.quality.source_refs`);
    if (refs.length) result.quality.source_refs = refs;
  }
  if (value.passed !== undefined) {
    if (value.passed !== null && typeof value.passed !== "boolean") fail("INVALID_BENCHMARK_SAMPLE", `${label}.passed must be boolean or null`);
    result.passed = value.passed as boolean | null;
    if (!result.quality) result.quality = { passed: result.passed, evidence: "declared" };
  }
  if (value.passed_score !== undefined) {
    if (value.passed_score !== null) result.passed_score = String(value.passed_score);
    if (result.quality && result.passed_score !== undefined) result.quality.score = result.passed_score;
  }
  return result;
}

function normalizeCapacity(value: unknown, label: string): CapacitySnapshot {
  if (!isObject(value)) fail("INVALID_CAPACITY", `${label} must be an object`);
  inputKeys(value, label, ["snapshot_id", "meter_id", "unit", "remaining", "scope", "scope_id", "workload_id", "observed_at", "reset_at", "evidence", "coverage", "source_refs"]);
  const scope = value.scope;
  if (scope !== "session" && scope !== "account" && scope !== "shared_pool") fail("INVALID_CAPACITY", `${label}.scope is unsupported`);
  const coverage = value.coverage;
  if (coverage !== "complete" && coverage !== "partial" && coverage !== "unknown") fail("INVALID_CAPACITY", `${label}.coverage is unsupported`);
  return {
    snapshot_id: id(value.snapshot_id, `${label}.snapshot_id`),
    meter_id: id(value.meter_id, `${label}.meter_id`),
    unit: id(value.unit, `${label}.unit`),
    remaining: value.remaining === null ? null : quantity(value.remaining, `${label}.remaining`),
    scope,
    scope_id: id(value.scope_id, `${label}.scope_id`),
    workload_id: value.workload_id === null ? null : id(value.workload_id, `${label}.workload_id`),
    observed_at: dateTime(value.observed_at, `${label}.observed_at`),
    reset_at: value.reset_at === null ? null : dateTime(value.reset_at, `${label}.reset_at`),
    evidence: evidence(value.evidence, `${label}.evidence`),
    coverage,
    source_refs: sourceRefs(value.source_refs, `${label}.source_refs`, true),
  };
}

function normalizeCandidatePolicy(value: unknown, label: string): CandidatePolicy {
  if (!isObject(value)) fail("INVALID_CANDIDATE_POLICY", `${label} must be an object`);
  inputKeys(value, label, ["policy_id", "policy_version", "benchmark_id", "analysis_overhead", "source_refs"]);
  for (const key of ["policy_id", "policy_version", "benchmark_id", "analysis_overhead", "source_refs"] as const) {
    if (key !== "analysis_overhead" && key !== "source_refs" && value[key] === undefined) fail("INVALID_CANDIDATE_POLICY", `${label}.${key} is required`);
  }
  const result: CandidatePolicy = {
    policy_id: id(value.policy_id, `${label}.policy_id`),
    policy_version: id(value.policy_version, `${label}.policy_version`),
    benchmark_id: id(value.benchmark_id, `${label}.benchmark_id`),
  };
  if (value.analysis_overhead !== undefined) {
    if (!Array.isArray(value.analysis_overhead)) fail("INVALID_CANDIDATE_POLICY", `${label}.analysis_overhead must be an array`);
    result.analysis_overhead = value.analysis_overhead.map((item, index) => normalizeQuantity(item, `${label}.analysis_overhead[${index}]`));
    const meters = new Set<string>();
    for (const item of result.analysis_overhead) {
      if (meters.has(item.meter_id)) fail("DUPLICATE_CANDIDATE_OVERHEAD", `${label}.analysis_overhead contains duplicate meter ${item.meter_id}`);
      meters.add(item.meter_id);
    }
  }
  const refs = sourceRefs(value.source_refs, `${label}.source_refs`);
  if (refs.length) result.source_refs = refs;
  return result;
}

function normalizeRunwayOptions(value: unknown, label: string): RunwayOptions {
  if (!isObject(value)) fail("INVALID_RUNWAY", `${label} must be an object`);
  inputKeys(value, label, ["now", "horizon_end", "stale_after_seconds", "allow_partial_coverage", "allow_unverified_demand"]);
  const result: RunwayOptions = {
    now: dateTime(value.now, `${label}.now`),
    horizon_end: dateTime(value.horizon_end, `${label}.horizon_end`),
  };
  if (value.stale_after_seconds !== undefined) result.stale_after_seconds = integerQuantity(value.stale_after_seconds, `${label}.stale_after_seconds`);
  for (const key of ["allow_partial_coverage", "allow_unverified_demand"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") fail("INVALID_RUNWAY", `${label}.${key} must be boolean`);
    if (value[key] !== undefined) result[key] = value[key] as boolean;
  }
  return result;
}

function normalizeEfficiencyOptions(value: unknown, label = "options"): EfficiencyOptions {
  if (value === undefined) return {};
  if (!isObject(value)) fail("INVALID_EFFICIENCY_INPUT", `${label} must be an object`);
  inputKeys(value, label, ["work_items", "cohort", "benchmarks", "candidate_policy", "capacity_snapshots", "runway"]);
  const result: EfficiencyOptions = {};
  if (value.work_items !== undefined) {
    if (!Array.isArray(value.work_items)) fail("INVALID_EFFICIENCY_INPUT", `${label}.work_items must be an array`);
    result.work_items = value.work_items.map((item, index) => normalizeWorkItem(item, `${label}.work_items[${index}]`));
    const ids = new Set<string>();
    for (const item of result.work_items) {
      if (ids.has(item.work_item_id)) fail("DUPLICATE_WORK_ITEM", `${label} contains duplicate work item ${item.work_item_id}`);
      ids.add(item.work_item_id);
    }
  }
  if (value.cohort !== undefined) result.cohort = normalizeCohort(value.cohort, `${label}.cohort`);
  if (value.benchmarks !== undefined) {
    if (!Array.isArray(value.benchmarks)) fail("INVALID_EFFICIENCY_INPUT", `${label}.benchmarks must be an array`);
    result.benchmarks = value.benchmarks.map((item, index) => normalizeBenchmark(item, `${label}.benchmarks[${index}]`));
    const ids = new Set<string>();
    for (const benchmark of result.benchmarks) {
      if (ids.has(benchmark.benchmark_id)) fail("DUPLICATE_BENCHMARK", `${label} contains duplicate benchmark ${benchmark.benchmark_id}`);
      ids.add(benchmark.benchmark_id);
    }
  }
  if (value.candidate_policy !== undefined) result.candidate_policy = normalizeCandidatePolicy(value.candidate_policy, `${label}.candidate_policy`);
  if (value.capacity_snapshots !== undefined) {
    if (!Array.isArray(value.capacity_snapshots)) fail("INVALID_EFFICIENCY_INPUT", `${label}.capacity_snapshots must be an array`);
    result.capacity_snapshots = value.capacity_snapshots.map((item, index) => normalizeCapacity(item, `${label}.capacity_snapshots[${index}]`));
    const ids = new Set<string>();
    for (const snapshot of result.capacity_snapshots) {
      if (ids.has(snapshot.snapshot_id)) fail("DUPLICATE_CAPACITY_SNAPSHOT", `${label} contains duplicate capacity snapshot ${snapshot.snapshot_id}`);
      ids.add(snapshot.snapshot_id);
    }
  }
  if (value.runway !== undefined) result.runway = normalizeRunwayOptions(value.runway, `${label}.runway`);
  return clone(result);
}

/** Validate and clone the usage plus optional efficiency-owned joins. */
export function validateEfficiencyInput(value: unknown): EfficiencyInput {
  if (!isObject(value)) fail("INVALID_EFFICIENCY_INPUT", "efficiency input must be an object");
  const wrapped = "usage" in value;
  if (wrapped) inputKeys(value, "efficiency input", ["usage", "work_items", "cohort", "benchmarks", "capacity_snapshots", "context_occurrences"]);
  const usage = wrapped ? validateUsage(value.usage) : validateUsage(value);
  const result: EfficiencyInput = { usage };
  const workItems = value.work_items;
  if (workItems !== undefined) {
    if (!Array.isArray(workItems)) fail("INVALID_EFFICIENCY_INPUT", "work_items must be an array");
    result.work_items = workItems.map((item, index) => normalizeWorkItem(item, `work_items[${index}]`));
    const ids = new Set<string>();
    for (const item of result.work_items) {
      if (ids.has(item.work_item_id)) fail("DUPLICATE_WORK_ITEM", `duplicate work item ${item.work_item_id}`);
      ids.add(item.work_item_id);
    }
  }
  if (value.cohort !== undefined) result.cohort = normalizeCohort(value.cohort, "cohort");
  if (value.benchmarks !== undefined) {
    if (!Array.isArray(value.benchmarks)) fail("INVALID_EFFICIENCY_INPUT", "benchmarks must be an array");
    result.benchmarks = value.benchmarks.map((item, index) => normalizeBenchmark(item, `benchmarks[${index}]`));
    const ids = new Set<string>();
    for (const benchmark of result.benchmarks) {
      if (ids.has(benchmark.benchmark_id)) fail("DUPLICATE_BENCHMARK", `duplicate benchmark ${benchmark.benchmark_id}`);
      ids.add(benchmark.benchmark_id);
    }
  }
  if (value.capacity_snapshots !== undefined) {
    if (!Array.isArray(value.capacity_snapshots)) fail("INVALID_EFFICIENCY_INPUT", "capacity_snapshots must be an array");
    result.capacity_snapshots = value.capacity_snapshots.map((item, index) => normalizeCapacity(item, `capacity_snapshots[${index}]`));
    const ids = new Set<string>();
    for (const snapshot of result.capacity_snapshots) {
      if (ids.has(snapshot.snapshot_id)) fail("DUPLICATE_CAPACITY_SNAPSHOT", `duplicate capacity snapshot ${snapshot.snapshot_id}`);
      ids.add(snapshot.snapshot_id);
    }
  }
  if (value.context_occurrences !== undefined) {
    if (!Array.isArray(value.context_occurrences)) fail("INVALID_EFFICIENCY_INPUT", "context_occurrences must be an array");
    result.context_occurrences = value.context_occurrences.map((item, index) => {
      if (!isObject(item)) fail("INVALID_CONTEXT_OCCURRENCE", `context_occurrences[${index}] must be an object`);
      inputKeys(item, `context_occurrences[${index}]`, ["source_id", "revision_id", "evidence", "source_refs"]);
      const occurrence: NonNullable<EfficiencyInput["context_occurrences"]>[number] = {
        source_id: id(item.source_id, `context_occurrences[${index}].source_id`),
        revision_id: id(item.revision_id, `context_occurrences[${index}].revision_id`),
      };
      if (item.evidence !== undefined) occurrence.evidence = evidence(item.evidence, `context_occurrences[${index}].evidence`);
      const refs = sourceRefs(item.source_refs, `context_occurrences[${index}].source_refs`);
      if (refs.length) occurrence.source_refs = refs;
      return occurrence;
    });
  }
  return clone(result);
}

function normalizeCohort(value: unknown, label: string): CohortSelector {
  if (!isObject(value)) fail("INVALID_COHORT", `${label} must be an object`);
  inputKeys(value, label, ["cohort_id", "task_class", "scope_revision", "acceptance_version", "work_item_ids"]);
  const result: CohortSelector = {};
  for (const key of ["cohort_id", "task_class", "scope_revision", "acceptance_version"] as const) {
    if (value[key] !== undefined) result[key] = id(value[key], `${label}.${key}`);
  }
  if (value.work_item_ids !== undefined) {
    if (!Array.isArray(value.work_item_ids)) fail("INVALID_COHORT", `${label}.work_item_ids must be an array`);
    result.work_item_ids = value.work_item_ids.map((item, index) => workItemId(item, `${label}.work_item_ids[${index}]`));
  }
  return result;
}

/** Validate a benchmark artifact independently so it can be imported by another consumer. */
export function validateBenchmarkInput(value: unknown): BenchmarkInput {
  return normalizeBenchmark(value, "benchmark");
}

function usageBundle(value: UsageValue): UsageBundle {
  return "bundle" in value ? value.bundle : value;
}

function meterDefinitions(bundle: UsageBundle): Map<string, { unit: string; description: string; subset_of: string | null }> {
  return new Map(bundle.meters.map((meter) => [meter.id, { unit: meter.unit, description: meter.description, subset_of: meter.subset_of }]));
}

function observationRefs(observation: UsageObservation): UsageSourceRef[] {
  return observation.source_refs.map((ref) => ({ ...ref }));
}

function observationBelongsTo(observation: UsageObservation, item: EfficiencyWorkItem): boolean {
  return observation.work_item_id === item.work_item_id || observation.task_id === (item.task_id ?? item.work_item_id);
}

function explicitObservationIds(item: EfficiencyWorkItem): Set<string> {
  return new Set((item.attempts ?? []).flatMap((attempt) => attempt.observation_ids ?? []));
}

function observationsFor(bundle: UsageBundle, item: EfficiencyWorkItem): UsageObservation[] {
  const ids = explicitObservationIds(item);
  const result = bundle.observations.filter((observation) => {
    if (observationBelongsTo(observation, item)) return true;
    if (!ids.has(observation.id)) return false;
    return observation.work_item_id === null && observation.task_id === null;
  });
  return result.sort((a, b) => compareText(a.id, b.id));
}

/**
 * An observation may be attributed implicitly by its work/task id or explicitly
 * by an attempt join. Either way it has one accounting owner in a selected
 * cohort. Reject ambiguous joins before per-work-item totals can double count
 * the same direct usage.
 */
function assertUniqueObservationOwnership(bundle: UsageBundle, items: EfficiencyWorkItem[]): void {
  const explicitByObservation = new Map<string, string[]>();
  for (const item of items) {
    for (const observationId of explicitObservationIds(item)) {
      const owners = explicitByObservation.get(observationId) ?? [];
      owners.push(item.work_item_id);
      explicitByObservation.set(observationId, owners);
    }
  }
  for (const [observationId, owners] of explicitByObservation) {
    const uniqueOwners = [...new Set(owners)];
    if (uniqueOwners.length > 1) {
      fail("CONFLICTING_OBSERVATION_JOIN", `observation ${observationId} is explicitly joined to multiple work items`, {
        observation_id: observationId,
        work_item_ids: uniqueOwners.sort(compareText),
      });
    }
  }

  for (const observation of bundle.observations) {
    const owners = items.filter((item) => {
      if (observationBelongsTo(observation, item)) return true;
      return explicitObservationIds(item).has(observation.id) && observation.work_item_id === null && observation.task_id === null;
    });
    const uniqueOwners = [...new Set(owners.map((item) => item.work_item_id))];
    if (uniqueOwners.length > 1) {
      fail("CONFLICTING_OBSERVATION_JOIN", `observation ${observation.id} belongs to multiple selected work items`, {
        observation_id: observation.id,
        work_item_ids: uniqueOwners.sort(compareText),
      });
    }
  }
}

interface AccumulatedTotals {
  values: Map<string, ExactDecimal>;
  evidence: Map<string, EfficiencyEvidence>;
  refs: Map<string, UsageSourceRef[]>;
  unknown: Set<string>;
  limitations: string[];
}

function evidenceRank(value: EfficiencyEvidence): number {
  return value === "observed" ? 5 : value === "declared" ? 4 : value === "derived" ? 3 : value === "estimated" ? 2 : 1;
}

function accumulateObservations(observations: UsageObservation[], defs: Map<string, { unit: string; description: string; subset_of: string | null }>): AccumulatedTotals {
  const result: AccumulatedTotals = { values: new Map(), evidence: new Map(), refs: new Map(), unknown: new Set(), limitations: [] };
  for (const observation of observations) {
    for (const [meterId, measurement] of Object.entries(observation.measurements)) {
      if (!isAdditiveUsageMeasurement(observation, measurement)) {
        result.limitations.push(`measurement ${meterId} on observation ${observation.id} is not an additive direct delta and was not added`);
        continue;
      }
      if (!defs.has(meterId)) {
        result.limitations.push(`measurement ${meterId} has no meter definition`);
      }
      const currentRefs = result.refs.get(meterId) ?? [];
      result.refs.set(meterId, uniqueRefs(currentRefs, measurement.source_refs, observationRefs(observation)));
      if (measurement.value === null) {
        result.unknown.add(meterId);
        continue;
      }
      const parsed = exactDecimal(measurement.value, `measurement ${meterId}`);
      result.values.set(meterId, exactDecimalAdd(result.values.get(meterId) ?? { coefficient: 0n, scale: 0 }, parsed));
      const oldEvidence = result.evidence.get(meterId);
      if (!oldEvidence || evidenceRank(measurement.evidence) < evidenceRank(oldEvidence)) result.evidence.set(meterId, measurement.evidence);
    }
  }
  unionElapsedIntervals(observations, result, defs);
  return result;
}

function timestampNanoseconds(timestamp: UsageObservation["started_at"]): bigint | null {
  const value = timestamp?.value;
  if (!value) return null;
  let parsed: ExactDateTime;
  try {
    parsed = parseDateTime(value, "usage timestamp");
  } catch {
    return null;
  }
  const significantFraction = parsed.fraction.replace(/0+$/, "");
  if (significantFraction.length > 9) return null;
  const fraction = significantFraction.padEnd(9, "0");
  const subsecond = BigInt(fraction || "0");
  return parsed.seconds * 1_000_000_000n + subsecond;
}

function hasSubnanosecondPrecision(timestamp: UsageObservation["started_at"]): boolean {
  const value = timestamp?.value;
  if (!value) return false;
  try {
    const parsed = parseDateTime(value, "usage timestamp");
    return parsed.fraction.replace(/0+$/, "").length > 9;
  } catch {
    return false;
  }
}

/*
 * Only these contract meter identities have an explicit wall-clock elapsed
 * meaning.  A free-text description is insufficient: audio/video duration,
 * compute time and provider-specific seconds can be additive resources even
 * when their descriptions contain "duration" or "elapsed".
 */
const WALL_CLOCK_ELAPSED_METERS = new Set([
  "elapsed_ns",
  "elapsed_seconds",
]);

function isElapsedMeter(meterId: string, _definition: { unit: string; description: string }): boolean {
  return WALL_CLOCK_ELAPSED_METERS.has(meterId);
}

function elapsedUnitScale(unit: string): { nanosPerUnit: bigint; decimalScale: number } | null {
  switch (unit.trim().toLowerCase()) {
    case "ns":
    case "nanosecond":
    case "nanoseconds":
      return { nanosPerUnit: 1n, decimalScale: 0 };
    case "us":
    case "µs":
    case "microsecond":
    case "microseconds":
      return { nanosPerUnit: 1_000n, decimalScale: 3 };
    case "ms":
    case "millisecond":
    case "milliseconds":
      return { nanosPerUnit: 1_000_000n, decimalScale: 6 };
    case "s":
    case "sec":
    case "second":
    case "seconds":
      return { nanosPerUnit: 1_000_000_000n, decimalScale: 9 };
    default:
      return null;
  }
}

function unionElapsedIntervals(observations: UsageObservation[], totals: AccumulatedTotals, defs: Map<string, { unit: string; description: string; subset_of: string | null }>): void {
  for (const [meterId, definition] of defs) {
    if (!isElapsedMeter(meterId, definition)) continue;
    const unitScale = elapsedUnitScale(definition.unit);
    if (!unitScale) {
      totals.limitations.push(`elapsed meter ${meterId} has unsupported unit ${definition.unit}; overlapping intervals were not unioned`);
      continue;
    }
    const intervals: Array<{ start: bigint; end: bigint; value: ExactDecimal; refs: UsageSourceRef[] }> = [];
    let withoutInterval: ExactDecimal = { coefficient: 0n, scale: 0 };
    let precisionUnsupported = false;
    for (const observation of observations) {
      const measurement = observation.measurements[meterId];
      if (!measurement || measurement.value === null || !isAdditiveUsageMeasurement(observation, measurement)) continue;
      if (hasSubnanosecondPrecision(observation.started_at) || hasSubnanosecondPrecision(observation.ended_at)) {
        precisionUnsupported = true;
        continue;
      }
      const start = timestampNanoseconds(observation.started_at);
      const end = timestampNanoseconds(observation.ended_at);
      const parsed = exactDecimal(measurement.value, `measurement ${meterId}`);
      if (start !== null && end !== null && end >= start) {
        intervals.push({ start, end, value: parsed, refs: uniqueRefs(measurement.source_refs, observationRefs(observation)) });
      } else {
        withoutInterval = exactDecimalAdd(withoutInterval, parsed);
      }
    }
    if (precisionUnsupported) {
      totals.limitations.push(`elapsed meter ${meterId} has timestamp precision finer than nanoseconds; overlapping intervals were not unioned`);
      continue;
    }
    if (intervals.length < 2) continue;
    intervals.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : left.end < right.end ? -1 : left.end > right.end ? 1 : 0));
    let union = 0n;
    let currentStart: bigint | null = null;
    let currentEnd: bigint | null = null;
    for (const interval of intervals) {
      if (currentStart === null || currentEnd === null) {
        currentStart = interval.start;
        currentEnd = interval.end;
      } else if (interval.start > currentEnd) {
        union += currentEnd - currentStart;
        currentStart = interval.start;
        currentEnd = interval.end;
      } else if (interval.end > currentEnd) {
        currentEnd = interval.end;
      }
    }
    if (currentStart !== null && currentEnd !== null) union += currentEnd - currentStart;
    // The interval endpoints are nanoseconds. For units backed by a power of
    // ten, the unit scale converts that integer exactly (for example,
    // 3,000,000 ns becomes 0.003 seconds).
    const unionValue: ExactDecimal = normalizeExactDecimal({ coefficient: union, scale: unitScale.decimalScale });
    totals.values.set(meterId, exactDecimalAdd(withoutInterval, unionValue));
    totals.refs.set(meterId, uniqueRefs(totals.refs.get(meterId) ?? [], ...intervals.map((interval) => interval.refs)));
    totals.limitations.push(`elapsed meter ${meterId} uses a union of overlapping observed intervals; wall-clock elapsed time is not summed across parallel spans`);
    totals.evidence.set(meterId, "derived");
  }
}

function quantitiesFromTotals(totals: AccumulatedTotals, defs: Map<string, { unit: string; description: string; subset_of: string | null }>): EfficiencyQuantity[] {
  return [...totals.values.entries()]
    .filter(([meterId]) => !totals.unknown.has(meterId))
    .map(([meterId, value]) => ({
      meter_id: meterId,
      unit: defs.get(meterId)?.unit ?? "unknown",
      quantity: exactDecimalText(value),
      evidence: totals.evidence.get(meterId) ?? "unknown",
      source_refs: totals.refs.get(meterId),
    }))
    .sort((a, b) => compareText(a.meter_id, b.meter_id));
}

function selectedWorkItems(bundle: UsageBundle, explicit: EfficiencyWorkItem[] | undefined, selector: CohortSelector): EfficiencyWorkItem[] {
  const result = new Map<string, EfficiencyWorkItem>();
  for (const item of explicit ?? []) result.set(item.work_item_id, clone(item));
  for (const observation of bundle.observations) {
    const workItemId = observation.work_item_id ?? observation.task_id;
    if (!workItemId || result.has(workItemId)) continue;
    result.set(workItemId, {
      work_item_id: workItemId,
      task_id: observation.task_id ?? workItemId,
      scope: { revision: "unknown" },
      acceptance: { status: "unknown", evidence: "unknown" },
      source_refs: observationRefs(observation),
    });
  }
  return [...result.values()]
    .filter((item) => !selector.work_item_ids || selector.work_item_ids.includes(item.work_item_id))
    .filter((item) => !selector.scope_revision || item.scope.revision === selector.scope_revision)
    .filter((item) => !selector.acceptance_version || item.acceptance.version === selector.acceptance_version)
    .filter((item) => !selector.task_class || item.classification?.value === selector.task_class)
    .sort((a, b) => compareText(a.work_item_id, b.work_item_id));
}

function terminalAccepted(outcome: AcceptanceOutcome["status"]): boolean | null {
  if (outcome === "accepted") return true;
  if (TERMINAL_OUTCOMES.has(outcome)) return false;
  return null;
}

function attemptCounts(item: EfficiencyWorkItem, observations: UsageObservation[]): { attempts: number; retries: number; escalations: number; reviews: number; reworks: number } {
  if (item.attempts) {
    return {
      attempts: item.attempts.length,
      retries: item.attempts.filter((attempt) => attempt.kind === "retry" || attempt.retry_of !== undefined).length,
      escalations: item.attempts.filter((attempt) => attempt.kind === "escalation" || attempt.escalated_from !== undefined).length,
      reviews: item.attempts.filter((attempt) => attempt.kind === "review").length,
      reworks: item.attempts.filter((attempt) => attempt.kind === "rework").length,
    };
  }
  return { attempts: observations.length, retries: 0, escalations: 0, reviews: 0, reworks: 0 };
}

function totalsToMap(values: EfficiencyQuantity[]): Map<string, EfficiencyQuantity> {
  return new Map(values.map((value) => [value.meter_id, value]));
}

function summarizeTask(item: EfficiencyWorkItem, observations: UsageObservation[], defs: Map<string, { unit: string; description: string; subset_of: string | null }>): { summary: TaskEfficiencySummary; totals: AccumulatedTotals } {
  const totals = accumulateObservations(observations, defs);
  const counts = attemptCounts(item, observations);
  const accepted = item.acceptance.evidence === "unknown" ? null : terminalAccepted(item.acceptance.status);
  const limitations = [...totals.limitations];
  const joinedObservationIds = new Set(observations.map((observation) => observation.id));
  for (const observationId of explicitObservationIds(item)) {
    if (!joinedObservationIds.has(observationId)) limitations.push(`attempt observation ${observationId} is not joined to this work item`);
  }
  if (item.scope.revision === "unknown") limitations.push("scope revision is unavailable");
  if (!item.acceptance.version) limitations.push("acceptance version is unavailable");
  if (item.acceptance.evidence === "unknown") limitations.push("acceptance outcome is unknown");
  return {
    summary: {
      work_item_id: item.work_item_id,
      task_id: item.task_id ?? item.work_item_id,
      scope_revision: item.scope.revision,
      scope_version: item.scope.version ?? null,
      acceptance_version: item.acceptance.version ?? null,
      outcome: item.acceptance.status,
      accepted,
      attempts: String(counts.attempts),
      retry_count: String(counts.retries),
      escalation_count: String(counts.escalations),
      review_attempt_count: String(counts.reviews),
      rework_attempt_count: String(counts.reworks),
      totals: quantitiesFromTotals(totals, defs),
      limitations: [...new Set(limitations)],
    },
    totals,
  };
}

function addTotals(target: Map<string, ExactDecimal>, source: AccumulatedTotals): void {
  for (const [meterId, value] of source.values) {
    if (source.unknown.has(meterId)) continue;
    target.set(meterId, exactDecimalAdd(target.get(meterId) ?? { coefficient: 0n, scale: 0 }, value));
  }
}

function finding(rule: EfficiencyFinding["rule"], statusValue: EfficiencyStatus, severity: EfficiencyFinding["severity"], message: string, extra: Partial<EfficiencyFinding> = {}): EfficiencyFinding {
  return { rule, status: statusValue, severity, message, ...extra };
}

function configurationFindings(observations: UsageObservation[]): EfficiencyFinding[] {
  const dimensions = new Map<string, { values: Set<string>; evidence: EfficiencyEvidence; refs: UsageSourceRef[] }>();
  for (const observation of observations) {
    for (const key of ["actual_model", "requested_model", "actual_tier", "requested_tier", "actual_reasoning", "requested_reasoning"] as const) {
      const fact = observation.dimensions[key];
      if (!fact || fact.value === null) continue;
      const value = String(fact.value);
      const current = dimensions.get(key) ?? { values: new Set<string>(), evidence: fact.evidence, refs: [] };
      current.values.add(value);
      if (evidenceRank(fact.evidence) < evidenceRank(current.evidence)) current.evidence = fact.evidence;
      current.refs = uniqueRefs(current.refs, fact.source_refs);
      dimensions.set(key, current);
    }
  }
  return [...dimensions.entries()].sort(([left], [right]) => compareText(left, right)).map(([key, data]) => finding(
    "model-configuration",
    data.evidence === "unknown" ? "unknown" : "measured",
    "info",
    `${key} values recorded: ${[...data.values].sort(compareText).join(", ")}`,
    { evidence: data.evidence, source_refs: data.refs },
  ));
}

function cacheFinding(totalMap: Map<string, EfficiencyQuantity>, unknown: Set<string>, refs: UsageSourceRef[]): EfficiencyFinding {
  const input = totalMap.get("input_tokens");
  const cache = totalMap.get("cache_read_input_tokens");
  if (!input || unknown.has("input_tokens") || !cache || unknown.has("cache_read_input_tokens")) {
    return finding("cache-read-ratio", "unknown", "warning", "cache read ratio is unavailable because the input-token denominator is not known", { limitations: ["A repeated value or missing counter cannot establish a cache hit."] });
  }
  const inputFraction = decimalFraction(input.quantity, "input_tokens");
  const cacheFraction = decimalFraction(cache.quantity, "cache_read_input_tokens");
  if (inputFraction.numerator === "0") return finding("cache-read-ratio", "unknown", "warning", "cache read ratio is unavailable because input tokens are zero", { limitations: ["A zero denominator has no ratio."] });
  return finding("cache-read-ratio", "measured", "info", "reported cache reads divided by reported input tokens", {
    measurement: { numerator: (BigInt(cacheFraction.numerator) * BigInt(inputFraction.denominator)).toString(), denominator: (BigInt(cacheFraction.denominator) * BigInt(inputFraction.numerator)).toString(), unit: "ratio" },
    evidence: input.evidence === "observed" && cache.evidence === "observed" ? "observed" : "derived",
    source_refs: uniqueRefs(refs, input.source_refs ?? [], cache.source_refs ?? []),
  });
}

function repeatedContextFinding(input: unknown, observations: UsageObservation[]): EfficiencyFinding | null {
  const candidate = isObject(input) ? input.context_occurrences : undefined;
  if (!Array.isArray(candidate)) return null;
  const seen = new Map<string, { count: number; refs: UsageSourceRef[]; evidence: EfficiencyEvidence }>();
  for (const item of candidate) {
    if (!isObject(item) || typeof item.source_id !== "string" || typeof item.revision_id !== "string") continue;
    const key = `${item.source_id}/${item.revision_id}`;
    const refs = sourceRefs(item.source_refs, "context_occurrence.source_refs");
    const old = seen.get(key) ?? { count: 0, refs: [], evidence: "unknown" as EfficiencyEvidence };
    old.count += 1;
    old.refs = uniqueRefs(old.refs, refs);
    if (item.evidence !== undefined) old.evidence = evidence(item.evidence, "context_occurrence.evidence");
    seen.set(key, old);
  }
  const repeated = [...seen.entries()].filter(([, value]) => value.count > 1);
  if (!repeated.length) return null;
  const measured = repeated.some(([, value]) => value.evidence !== "unknown");
  return finding("repeated-context", measured ? "measured" : "unknown", "info", `source evidence records ${repeated.length} repeated context revision(s); repetition alone does not prove a cache hit`, {
    evidence: measured ? "observed" : "unknown",
    observation_ids: observations.map((item) => item.id),
    limitations: ["Context treatment/cache status is separate from repeated occurrence evidence."],
  });
}

function benchmarkTotals(benchmark: BenchmarkInput): { samples: number; knownAccepted: number; accepted: number; totals: Map<string, { unit: string; value: ExactDecimal; evidence: EfficiencyEvidence; refs: UsageSourceRef[] }>; latency: ExactRatio | null; attempts: ExactRatio | null; attemptsTotal: bigint | null } {
  const totals = new Map<string, { unit: string; value: ExactDecimal; evidence: EfficiencyEvidence; refs: UsageSourceRef[] }>();
  let knownAccepted = 0;
  let accepted = 0;
  let latencyTotal: ExactDecimal = { coefficient: 0n, scale: 0 };
  let latencyCount = 0n;
  let attemptsTotal = 0n;
  let attemptsCount = 0n;
  for (const sample of benchmark.samples) {
    if (sample.accepted !== null) {
      knownAccepted += 1;
      if (sample.accepted) accepted += 1;
    }
    if (sample.latency_ns !== undefined && sample.latency_ns !== null) {
      latencyTotal = exactDecimalAdd(latencyTotal, exactDecimal(sample.latency_ns, `${sample.sample_id}.latency_ns`));
      latencyCount += 1n;
    }
    if (sample.attempts !== undefined) {
      attemptsTotal += integerBigint(sample.attempts, `${sample.sample_id}.attempts`);
      attemptsCount += 1n;
    }
    for (const meter of sample.meters) {
      const current = totals.get(meter.meter_id) ?? { unit: meter.unit, value: { coefficient: 0n, scale: 0 }, evidence: meter.evidence, refs: [] };
      if (current.unit !== meter.unit) continue;
      current.value = exactDecimalAdd(current.value, exactDecimal(meter.quantity, `${sample.sample_id}.${meter.meter_id}`));
      if (evidenceRank(meter.evidence) < evidenceRank(current.evidence)) current.evidence = meter.evidence;
      current.refs = uniqueRefs(current.refs, meter.source_refs ?? [], sample.source_refs);
      totals.set(meter.meter_id, current);
    }
  }
  return {
    samples: benchmark.samples.length,
    knownAccepted,
    accepted,
    totals,
    latency: latencyCount ? reduceRatio(latencyTotal.coefficient, 10n ** BigInt(latencyTotal.scale) * latencyCount) : null,
    attempts: attemptsCount ? reduceRatio(attemptsTotal, attemptsCount) : null,
    attemptsTotal: attemptsCount ? attemptsTotal : null,
  };
}

function ratesFromBenchmark(benchmark: BenchmarkInput): Map<string, { unit: string; rate: ExactRatio; evidence: EfficiencyEvidence; refs: UsageSourceRef[] }> {
  const aggregate = benchmarkTotals(benchmark);
  if (aggregate.accepted === 0) return new Map();
  const result = new Map<string, { unit: string; rate: ExactRatio; evidence: EfficiencyEvidence; refs: UsageSourceRef[] }>();
  for (const [meterId, item] of aggregate.totals) result.set(meterId, { unit: item.unit, rate: reduceRatio(item.value.coefficient, 10n ** BigInt(item.value.scale) * BigInt(aggregate.accepted)), evidence: item.evidence, refs: item.refs });
  return result;
}

/**
 * Add benchmark-only work to the comparable per-accepted resource vector.
 * analysis_overhead is a total quantity for the benchmark run, so it is
 * allocated over the accepted samples with exact rational arithmetic. A
 * benchmark with no accepted samples cannot make that allocation and remains
 * explicitly limited instead of silently omitting the overhead.
 */
function ratesWithAnalysisOverhead(
  benchmark: BenchmarkInput,
  limitations: string[],
  label: string,
  overhead: EfficiencyQuantity[] | undefined = benchmark.analysis_overhead,
): Map<string, { unit: string; rate: ExactRatio; evidence: EfficiencyEvidence; refs: UsageSourceRef[] }> {
  const result = ratesFromBenchmark(benchmark);
  if (!overhead?.length) return result;
  const accepted = benchmarkTotals(benchmark).accepted;
  if (accepted === 0) {
    limitations.push(`${label} analysis overhead cannot be allocated because the benchmark has zero accepted samples`);
    return result;
  }
  for (const item of overhead) {
    const perAccepted = decimalFraction(item.quantity, `${label} analysis overhead ${item.meter_id}`);
    const allocated = reduceRatio(BigInt(perAccepted.numerator), BigInt(perAccepted.denominator) * BigInt(accepted));
    const current = result.get(item.meter_id);
    if (!current) {
      result.set(item.meter_id, {
        unit: item.unit,
        rate: allocated,
        evidence: item.evidence === "unknown" ? "unknown" : "derived",
        refs: item.source_refs ?? [],
      });
      continue;
    }
    if (current.unit !== item.unit) {
      result.delete(item.meter_id);
      limitations.push(`${label} analysis overhead meter ${item.meter_id} has an incompatible unit`);
      continue;
    }
    current.rate = addFractions(current.rate, allocated);
    current.evidence = item.evidence === "unknown" ? "unknown" : "derived";
    current.refs = uniqueRefs(current.refs, item.source_refs ?? []);
  }
  return result;
}

function conditionDifferences(left: BenchmarkInput, right: BenchmarkInput): string[] {
  const differences: string[] = [];
  const leftRecord = left.conditions as unknown as Record<string, unknown>;
  const rightRecord = right.conditions as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])) {
    if (JSON.stringify(leftRecord[key]) !== JSON.stringify(rightRecord[key])) differences.push(`condition ${key} differs`);
  }
  if (left.model_config.reasoning !== right.model_config.reasoning) differences.push("reasoning configuration differs");
  if (left.model_config.tier !== right.model_config.tier) differences.push("tier configuration differs");
  return differences;
}

function taskPairingDifferences(left: BenchmarkInput, right: BenchmarkInput): string[] {
  const counts = (benchmark: BenchmarkInput): Map<string, number> => {
    const result = new Map<string, number>();
    for (const sample of benchmark.samples) result.set(sample.task_id, (result.get(sample.task_id) ?? 0) + 1);
    return result;
  };
  const leftTasks = counts(left);
  const rightTasks = counts(right);
  const allTaskIds = new Set([...leftTasks.keys(), ...rightTasks.keys()]);
  for (const taskId of allTaskIds) {
    if (leftTasks.get(taskId) !== rightTasks.get(taskId)) return ["sample task identity multiset differs; matched task pairing is unavailable"];
  }
  return [];
}

function undeclaredComparableConditions(left: BenchmarkInput, right: BenchmarkInput): string[] {
  const limitations: string[] = [];
  for (const key of ["harness_version", "tools_version", "cache", "context_policy", "routing_policy"] as const) {
    if (left.conditions[key] === undefined || right.conditions[key] === undefined) limitations.push(`condition ${key} is not declared for both benchmarks`);
  }
  return limitations;
}

function qualityComparisonDifferences(left: BenchmarkInput, right: BenchmarkInput): string[] {
  const limitations: string[] = [];
  const qualityVector = (benchmark: BenchmarkInput): string[] => benchmark.samples
    .map((sample) => `${sample.task_id}:${sample.quality?.passed === undefined ? "unknown" : sample.quality.passed === null ? "unknown" : sample.quality.passed ? "passed" : "failed"}`)
    .sort(compareText);
  const leftVector = qualityVector(left);
  const rightVector = qualityVector(right);
  if (JSON.stringify(leftVector) !== JSON.stringify(rightVector)) limitations.push("quality evidence differs between benchmark samples");
  if (left.samples.some((sample) => sample.accepted === true && sample.quality?.passed === false)) limitations.push("baseline accepted samples include failed quality checks");
  if (right.samples.some((sample) => sample.accepted === true && sample.quality?.passed === false)) limitations.push("candidate accepted samples include failed quality checks");
  return limitations;
}

/** Compare two declared benchmark artifacts without inventing a scalar score. */
export function compareBenchmarks(leftValue: BenchmarkInput, rightValue: BenchmarkInput): BenchmarkComparison {
  const suppliedLeft = normalizeBenchmark(leftValue, "left benchmark");
  const suppliedRight = normalizeBenchmark(rightValue, "right benchmark");
  let left: BenchmarkInput;
  let right: BenchmarkInput;
  if ((suppliedLeft.role === "baseline" || suppliedLeft.role === "control") && suppliedRight.role === "candidate") {
    left = suppliedLeft;
    right = suppliedRight;
  } else if (suppliedLeft.role === "candidate" && (suppliedRight.role === "baseline" || suppliedRight.role === "control")) {
    // Accept the convenient candidate-first call form, but retain baseline −
    // candidate semantics in the returned vector and IDs.
    left = suppliedRight;
    right = suppliedLeft;
  } else {
    fail("INVALID_BENCHMARK_ROLE", "benchmark comparison requires one baseline/control and one candidate benchmark");
  }
  const limitations: string[] = [];
  if (left.cohort.workload_id !== right.cohort.workload_id) limitations.push("workload identity differs");
  if (left.cohort.scope_revision !== right.cohort.scope_revision) limitations.push("scope revision differs");
  if (left.cohort.acceptance_version !== right.cohort.acceptance_version) limitations.push("acceptance version differs");
  if (left.cohort.task_class !== right.cohort.task_class) limitations.push("task class differs");
  if (left.cohort.acceptance_criteria_id !== right.cohort.acceptance_criteria_id) limitations.push("acceptance criteria identity differs");
  const conditionIssues = conditionDifferences(left, right);
  limitations.push(...conditionIssues);
  limitations.push(...taskPairingDifferences(left, right));
  limitations.push(...undeclaredComparableConditions(left, right));
  if (left.evaluation !== right.evaluation) limitations.push("evaluation design differs");
  limitations.push(...qualityComparisonDifferences(left, right));
  if (left.evaluation !== "held_out" && left.evaluation !== "controlled") limitations.push("baseline is not held-out or controlled");
  if (right.evaluation !== "held_out" && right.evaluation !== "controlled") limitations.push("candidate is not held-out or controlled");
  if (left.samples.some((sample) => sample.quality?.passed === null || sample.quality === undefined) || right.samples.some((sample) => sample.quality?.passed === null || sample.quality === undefined)) limitations.push("quality evidence is incomplete");
  const leftAggregate = benchmarkTotals(left);
  const rightAggregate = benchmarkTotals(right);
  if (leftAggregate.knownAccepted !== leftAggregate.samples) limitations.push("baseline acceptance outcomes are incomplete");
  if (rightAggregate.knownAccepted !== rightAggregate.samples) limitations.push("candidate acceptance outcomes are incomplete");
  const leftRates = ratesWithAnalysisOverhead(left, limitations, "baseline");
  const rightRates = ratesWithAnalysisOverhead(right, limitations, "candidate");
  const meterIds = new Set([...leftRates.keys(), ...rightRates.keys()]);
  const resourceDeltas: BenchmarkResourceDelta[] = [];
  for (const meterId of [...meterIds].sort(compareText)) {
    const baseline = leftRates.get(meterId);
    const candidate = rightRates.get(meterId);
    if (baseline && candidate && baseline.unit === candidate.unit) {
      resourceDeltas.push({ meter_id: meterId, unit: baseline.unit, delta: signedDifference(baseline.rate, candidate.rate), baseline: baseline.rate, candidate: candidate.rate, evidence: baseline.evidence === "observed" && candidate.evidence === "observed" ? "observed" : "derived" });
    } else {
      resourceDeltas.push({ meter_id: meterId, unit: baseline?.unit ?? candidate?.unit ?? "unknown", delta: null, baseline: baseline?.rate ?? null, candidate: candidate?.rate ?? null, evidence: "unknown" });
      limitations.push(`meter ${meterId} is unavailable in one cohort or has incompatible units`);
    }
  }
  const status: BenchmarkComparison["status"] = limitations.some((item) => item.includes("identity differs") || item.includes("scope revision differs") || item.includes("acceptance version differs") || item.includes("task class differs") || item.includes("task identity multiset differs"))
    ? "incompatible"
    : limitations.length
      ? "limited"
      : "validated";
  const sourceRefs = uniqueRefs(
    left.provenance,
    right.provenance,
    ...(left.analysis_overhead ?? []).map((item) => item.source_refs ?? []),
    ...(right.analysis_overhead ?? []).map((item) => item.source_refs ?? []),
    ...left.samples.map((sample) => sample.source_refs),
    ...right.samples.map((sample) => sample.source_refs),
  );
  return {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    baseline_id: left.benchmark_id,
    candidate_id: right.benchmark_id,
    status,
    evaluation: right.evaluation,
    sample_sizes: { baseline: String(leftAggregate.samples), candidate: String(rightAggregate.samples) },
    accepted_counts: { baseline: String(leftAggregate.accepted), candidate: String(rightAggregate.accepted) },
    acceptance_rate_delta: leftAggregate.knownAccepted && rightAggregate.knownAccepted
      ? ratioDifference(ratio(String(leftAggregate.accepted), String(leftAggregate.knownAccepted)), ratio(String(rightAggregate.accepted), String(rightAggregate.knownAccepted)))
      : null,
    resource_deltas: resourceDeltas,
    latency_ns: { baseline: leftAggregate.latency, candidate: rightAggregate.latency, delta: signedDifference(leftAggregate.latency, rightAggregate.latency) },
    limitations,
    source_refs: sourceRefs,
  };
}

/** Strict boundary for callers that cannot proceed with an incompatible cohort. */
export function assertComparableBenchmarks(leftValue: BenchmarkInput, rightValue: BenchmarkInput): BenchmarkComparison {
  const comparison = compareBenchmarks(leftValue, rightValue);
  if (comparison.status === "incompatible") fail("INCOMPATIBLE_BENCHMARK", "benchmark cohorts are incompatible", comparison);
  return comparison;
}

function deriveCandidatePolicy(policy: CandidatePolicy, benchmarks: BenchmarkInput[]): CandidatePolicyScenario {
  const benchmark = benchmarks.find((candidate) => candidate.benchmark_id === policy.benchmark_id);
  const refs = uniqueRefs(
    policy.source_refs ?? [],
    benchmark?.provenance ?? [],
    ...((policy.analysis_overhead ?? benchmark?.analysis_overhead ?? []).map((item) => item.source_refs ?? [])),
  );
  if (!benchmark) return { policy_id: policy.policy_id, policy_version: policy.policy_version, benchmark_id: policy.benchmark_id, status: "unknown", expected_per_accepted: [], expected_attempts_per_accepted: null, analysis_overhead: clone(policy.analysis_overhead ?? []), limitations: ["candidate policy references an unavailable benchmark"], source_refs: refs };
  const aggregate = benchmarkTotals(benchmark);
  const limitations: string[] = [];
  if (benchmark.role !== "candidate") limitations.push("candidate policy requires a benchmark with candidate role");
  if (benchmark.evaluation !== "held_out" && benchmark.evaluation !== "controlled") limitations.push("candidate scenario is derived from a historical or declared benchmark, not held-out validation");
  if (aggregate.accepted === 0) limitations.push("candidate benchmark has zero accepted samples");
  if (aggregate.knownAccepted !== aggregate.samples) limitations.push("candidate acceptance outcomes are incomplete");
  if (benchmark.samples.some((sample) => sample.quality?.passed === undefined || sample.quality?.passed === null)) limitations.push("candidate benchmark quality evidence is incomplete");
  const acceptedQualityIsPassing = benchmark.samples
    .filter((sample) => sample.accepted === true)
    .every((sample) => sample.quality?.passed === true && sample.quality.evidence !== "unknown");
  if (aggregate.accepted > 0 && !acceptedQualityIsPassing) limitations.push("accepted candidate samples lack passing quality evidence");
  const overhead = policy.analysis_overhead ?? benchmark.analysis_overhead ?? [];
  const rates = ratesWithAnalysisOverhead(benchmark, limitations, "candidate", overhead);
  const expected = new Map<string, EfficiencyRate>();
  for (const [meterId, item] of rates) expected.set(meterId, { meter_id: meterId, unit: item.unit, rate: item.rate, evidence: item.evidence, source_refs: item.refs });
  const canDerive = benchmark.role === "candidate" && aggregate.accepted > 0 && aggregate.knownAccepted === aggregate.samples && acceptedQualityIsPassing;
  return { policy_id: policy.policy_id, policy_version: policy.policy_version, benchmark_id: policy.benchmark_id, status: canDerive ? "derived" : "unknown", expected_per_accepted: [...expected.values()].sort((a, b) => compareText(a.meter_id, b.meter_id)), expected_attempts_per_accepted: aggregate.attemptsTotal !== null && aggregate.accepted > 0 ? reduceRatio(aggregate.attemptsTotal, BigInt(aggregate.accepted)) : null, analysis_overhead: clone(overhead), limitations, source_refs: refs };
}

/** Derive a candidate scenario from one validated benchmark and explicit overhead. */
export function deriveCandidatePolicyScenario(policy: CandidatePolicy, benchmark: BenchmarkInput): CandidatePolicyScenario {
  return deriveCandidatePolicy(policy, [normalizeBenchmark(benchmark, "benchmark")]);
}

function sourceUsageRefs(bundle: UsageBundle): UsageSourceRef[] {
  return uniqueRefs(...bundle.observations.map((observation) => {
    const refs = observationRefs(observation);
    for (const timestamp of [observation.event_at, observation.started_at, observation.ended_at, observation.collected_at]) if (timestamp) refs.push(...timestamp.source_refs);
    for (const measurement of Object.values(observation.measurements)) refs.push(...measurement.source_refs);
    for (const [key, fact] of Object.entries(observation.dimensions)) {
      if (key === "extensions") {
        for (const extension of Object.values(fact ?? {})) if (isObject(extension) && Array.isArray(extension.source_refs)) refs.push(...sourceRefs(extension.source_refs, "usage dimension source_refs"));
      } else if (isObject(fact) && Array.isArray(fact.source_refs)) {
        refs.push(...sourceRefs(fact.source_refs, "usage dimension source_refs"));
      }
    }
    return refs;
  }));
}

function benchmarkSourceRefs(benchmark: BenchmarkInput): UsageSourceRef[] {
  return uniqueRefs(
    benchmark.provenance,
    ...(benchmark.analysis_overhead ?? []).map((item) => item.source_refs ?? []),
    ...benchmark.samples.map((sample) => sample.source_refs),
    ...benchmark.samples.flatMap((sample) => sample.meters.map((meter) => meter.source_refs ?? [])),
    ...benchmark.samples.flatMap((sample) => sample.quality?.source_refs ? [sample.quality.source_refs] : []),
  );
}

function contextSourceRefs(input: EfficiencyInput): UsageSourceRef[] {
  return uniqueRefs(...(input.context_occurrences ?? []).map((occurrence) => occurrence.source_refs ?? []));
}

/** Analyze a UsageReport/UsageBundle with explicit outcome, benchmark and capacity joins. */
export function analyzeEfficiency(inputValue: EfficiencyInput | UsageReport | UsageBundle, options: EfficiencyOptions = {}): EfficiencyAnalysis {
  const input = validateEfficiencyInput(inputValue);
  const normalizedOptions = normalizeEfficiencyOptions(options);
  const usage = input.usage;
  const bundle = usageBundle(usage);
  const selector = { ...(input.cohort ?? {}), ...(normalizedOptions.cohort ?? {}) };
  const explicitWorkItems = normalizedOptions.work_items ?? input.work_items;
  const items = selectedWorkItems(bundle, explicitWorkItems, selector);
  assertUniqueObservationOwnership(bundle, items);
  const defs = meterDefinitions(bundle);
  const allObservations = bundle.observations;
  const taskResults = items.map((item) => summarizeTask(item, observationsFor(bundle, item), defs));
  const totals = new Map<string, ExactDecimal>();
  const evidenceByMeter = new Map<string, EfficiencyEvidence>();
  const refsByMeter = new Map<string, UsageSourceRef[]>();
  const unknownMeters = new Set<string>();
  const limitations: string[] = [];
  let acceptedCount = 0;
  let knownOutcomeCount = 0;
  let unknownOutcomeCount = 0;
  let retries = 0;
  let escalations = 0;
  let reviews = 0;
  let reworks = 0;
  for (const result of taskResults) {
    if (result.summary.accepted === true) acceptedCount += 1;
    if (result.summary.accepted === null) unknownOutcomeCount += 1;
    else knownOutcomeCount += 1;
    retries += Number(result.summary.retry_count);
    escalations += Number(result.summary.escalation_count);
    reviews += Number(result.summary.review_attempt_count);
    reworks += Number(result.summary.rework_attempt_count);
    addTotals(totals, result.totals);
    for (const meterId of result.totals.unknown) unknownMeters.add(meterId);
    for (const [meterId, evidenceValue] of result.totals.evidence) {
      const old = evidenceByMeter.get(meterId);
      if (!old || evidenceRank(evidenceValue) < evidenceRank(old)) evidenceByMeter.set(meterId, evidenceValue);
    }
    for (const [meterId, refs] of result.totals.refs) refsByMeter.set(meterId, uniqueRefs(refsByMeter.get(meterId) ?? [], refs));
    limitations.push(...result.summary.limitations);
  }
  for (const meterId of unknownMeters) limitations.push(`meter ${meterId} has at least one unknown observation in the selected cohort`);
  const totalQuantities = [...totals.entries()].filter(([meterId]) => !unknownMeters.has(meterId)).map(([meterId, value]) => ({ meter_id: meterId, unit: defs.get(meterId)?.unit ?? "unknown", quantity: exactDecimalText(value), evidence: evidenceByMeter.get(meterId) ?? "unknown", source_refs: refsByMeter.get(meterId) })).sort((a, b) => compareText(a.meter_id, b.meter_id));
  const perAccepted = acceptedCount
    ? [...totals.entries()].filter(([meterId]) => !unknownMeters.has(meterId)).map(([meterId, value]) => ({ meter_id: meterId, unit: defs.get(meterId)?.unit ?? "unknown", rate: reduceRatio(value.coefficient, 10n ** BigInt(value.scale) * BigInt(acceptedCount)), evidence: evidenceByMeter.get(meterId) ?? "unknown", source_refs: refsByMeter.get(meterId) })).sort((a, b) => compareText(a.meter_id, b.meter_id))
    : [];
  if (!acceptedCount) limitations.push("no accepted work item provides a finite per-accepted resource ratio");
  const selectorOutput: CohortSelector = clone(selector);
  const sessionAccumulated = accumulateObservations(bundle.observations, defs);
  const sessionQuantities = quantitiesFromTotals(sessionAccumulated, defs);
  const sessionSummary: SessionEfficiencySummary = {
    observation_count: String(bundle.observations.length),
    totals: sessionQuantities,
    unknown_meter_ids: [...sessionAccumulated.unknown].sort(compareText),
    limitations: [...new Set(sessionAccumulated.limitations)].sort(compareText),
  };
  limitations.push(...sessionSummary.limitations);
  for (const meterId of sessionSummary.unknown_meter_ids) limitations.push(`session meter ${meterId} has at least one unknown observation`);
  const cohort: CohortSummary = {
    selector: selectorOutput,
    task_count: String(taskResults.length),
    accepted_count: String(acceptedCount),
    known_outcome_count: String(knownOutcomeCount),
    unknown_outcome_count: String(unknownOutcomeCount),
    acceptance_rate: knownOutcomeCount ? `${acceptedCount}/${knownOutcomeCount}` : null,
    retry_count: String(retries),
    escalation_count: String(escalations),
    review_attempt_count: String(reviews),
    rework_attempt_count: String(reworks),
    totals: totalQuantities,
    per_accepted: perAccepted,
  };
  const findings: EfficiencyFinding[] = [];
  if (retries) findings.push(finding("retry-burden", "measured", "warning", `${retries} retry attempt(s) are included in accepted-work resource totals`, { evidence: "observed", work_item_ids: taskResults.filter((item) => Number(item.summary.retry_count)).map((item) => item.summary.work_item_id) }));
  else findings.push(finding("retry-burden", "unknown", "info", "retry relationships were not declared for this cohort", { limitations: ["A terminal observation alone cannot establish that provider or harness retries did not occur."] }));
  if (escalations) findings.push(finding("escalation-burden", "measured", "info", `${escalations} escalation attempt(s) are included in accepted-work resource totals`, { evidence: "observed" }));
  if (reviews || reworks) findings.push(finding("review-rework-overhead", "measured", "info", `${reviews} review and ${reworks} rework attempt(s) are included in accepted-work resource totals`, { evidence: "observed" }));
  if (unknownOutcomeCount || taskResults.length === 0) findings.push(finding("missing-acceptance", "unknown", "warning", taskResults.length === 0 ? "no Work Item acceptance outcomes were joined to this usage capture" : `${unknownOutcomeCount} work item(s) have no terminal accepted or rejected outcome`, { work_item_ids: taskResults.filter((item) => item.summary.accepted === null).map((item) => item.summary.work_item_id), limitations: ["Acceptance denominator excludes unknown outcomes; session totals remain available without a per-accepted ratio."] }));
  if (taskResults.some((item) => item.summary.scope_revision === "unknown" || !item.summary.acceptance_version)) findings.push(finding("missing-metadata", "unknown", "warning", "scope revision or acceptance version is missing for one or more joined work items", { limitations: ["Cohort comparability and model-suitability conclusions are limited without immutable scope and acceptance metadata."] }));
  const hasModelConfiguration = allObservations.some((observation) => [observation.dimensions.actual_model, observation.dimensions.requested_model, observation.dimensions.model].some((fact) => fact?.value !== null && fact?.value !== undefined));
  if (!hasModelConfiguration) findings.push(finding("missing-metadata", "unknown", "warning", "model configuration is unavailable on the selected observations", { limitations: ["A token total without requested/actual model evidence cannot establish model suitability."] }));
  const cacheTotals = taskResults.length === 0 ? sessionQuantities : totalQuantities;
  const cacheUnknown = taskResults.length === 0 ? sessionAccumulated.unknown : unknownMeters;
  findings.push(cacheFinding(new Map(cacheTotals.map((item) => [item.meter_id, item])), cacheUnknown, sourceUsageRefs(bundle)));
  const contextFinding = repeatedContextFinding(inputValue, allObservations);
  if (contextFinding) findings.push(contextFinding);
  findings.push(...configurationFindings(allObservations));
  const benchmarks = [...(input.benchmarks ?? []), ...(normalizedOptions.benchmarks ?? [])];
  const benchmarkIds = new Set<string>();
  for (const benchmark of benchmarks) {
    if (benchmarkIds.has(benchmark.benchmark_id)) fail("DUPLICATE_BENCHMARK", `duplicate benchmark ${benchmark.benchmark_id}`);
    benchmarkIds.add(benchmark.benchmark_id);
  }
  const benchmarkComparisons: BenchmarkComparison[] = [];
  const baseline = benchmarks.find((item) => item.role === "baseline");
  for (const candidate of benchmarks.filter((item) => item.role === "candidate")) {
    if (baseline) benchmarkComparisons.push(compareBenchmarks(baseline, candidate));
  }
  const candidatePolicy = normalizedOptions.candidate_policy ? deriveCandidatePolicy(normalizedOptions.candidate_policy, benchmarks) : null;
  if (candidatePolicy) findings.push(finding("candidate-policy", candidatePolicy.status === "derived" ? "candidate" : "unknown", candidatePolicy.status === "derived" ? "info" : "warning", candidatePolicy.status === "derived" ? "candidate resource demand was derived from declared benchmark samples and analysis overhead" : "candidate policy cannot be derived", { limitations: candidatePolicy.limitations, source_refs: candidatePolicy.source_refs }));
  const capacitySnapshots = [...(input.capacity_snapshots ?? []), ...(normalizedOptions.capacity_snapshots ?? [])];
  const capacityIds = new Set<string>();
  for (const snapshot of capacitySnapshots) {
    if (capacityIds.has(snapshot.snapshot_id)) fail("DUPLICATE_CAPACITY_SNAPSHOT", `duplicate capacity snapshot ${snapshot.snapshot_id}`);
    capacityIds.add(snapshot.snapshot_id);
  }
  const runway = normalizedOptions.runway && capacitySnapshots.length && acceptedCount
    ? forecastRunway(capacitySnapshots, { workload_id: selector.cohort_id ?? "cohort", scope_id: "analysis", accepted_count: String(acceptedCount), per_accepted: perAccepted }, normalizedOptions.runway)
    : normalizedOptions.runway
      ? { schema_version: EFFICIENCY_SCHEMA_VERSION, status: "unknown", accepted_work: null, limiting_snapshot_id: null, horizon_start: normalizedOptions.runway.now, horizon_end: normalizedOptions.runway.horizon_end, considered_snapshots: [], limitations: [acceptedCount ? "no capacity snapshots were supplied" : "zero accepted work prevents observed per-accepted demand"], source_refs: [] }
      : null;
  if (runway?.status !== "ready") limitations.push(...(runway?.limitations ?? []));
  const reportSourceRefs = uniqueRefs(
    sourceUsageRefs(bundle),
    ...benchmarks.map((benchmark) => benchmarkSourceRefs(benchmark)),
    ...capacitySnapshots.map((snapshot) => snapshot.source_refs),
    contextSourceRefs(input),
    candidatePolicy?.source_refs ?? [],
  );
  return validateEfficiencyReportShape({
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    dataset_id: bundle.dataset_id,
    usage_schema_version: String((usage as unknown as JsonObject).schema_version),
    input,
    options: normalizedOptions,
    session: sessionSummary,
    cohort,
    tasks: taskResults.map((result) => result.summary),
    findings,
    benchmark_comparisons: benchmarkComparisons,
    candidate_policy: candidatePolicy,
    runway,
    limitations: [...new Set(limitations)].sort(compareText),
    source_refs: reportSourceRefs,
  });
}

function reportObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) fail("INVALID_EFFICIENCY_REPORT", `${label} must be an object`);
  return value;
}

function reportKeys(value: JsonObject, label: string, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("INVALID_EFFICIENCY_REPORT", `${label}.${key} is not defined by the efficiency contract`);
}

function reportStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail("INVALID_EFFICIENCY_REPORT", `${label} must be an array of strings`);
  return [...value] as string[];
}

function reportNullableId(value: unknown, label: string): string | null {
  if (value === null) return null;
  return id(value, label);
}

function reportInteger(value: unknown, label: string): string {
  if (typeof value !== "string") fail("INVALID_EFFICIENCY_REPORT", `${label} must be a canonical non-negative integer string`);
  return integerQuantity(value, label);
}

function reportExactRatio(value: unknown, label: string, allowZeroNumerator = true): ExactRatio {
  const item = reportObject(value, label);
  reportKeys(item, label, ["numerator", "denominator"]);
  const numerator = item.numerator;
  const denominator = item.denominator;
  if (typeof numerator !== "string" || !INTEGER_RE.test(numerator) || (!allowZeroNumerator && numerator === "0")) fail("INVALID_EFFICIENCY_REPORT", `${label}.numerator must be a valid integer string`);
  if (typeof denominator !== "string" || !INTEGER_RE.test(denominator) || denominator === "0") fail("INVALID_EFFICIENCY_REPORT", `${label}.denominator must be a positive integer string`);
  return { numerator, denominator };
}

function reportSignedRatioText(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\/(?:[1-9][0-9]*))?$/.test(value)) fail("INVALID_EFFICIENCY_REPORT", `${label} must be a signed integer or reduced ratio string`);
  return value;
}

function ratioText(value: string, label: string): ExactRatio {
  const [numeratorText, denominatorText] = value.split("/");
  if (denominatorText === undefined) return { numerator: numeratorText!, denominator: "1" };
  return { numerator: numeratorText!, denominator: denominatorText };
}

function reportQuantity(value: unknown, label: string): EfficiencyQuantity {
  const item = reportObject(value, label);
  reportKeys(item, label, ["meter_id", "unit", "quantity", "evidence", "source_refs"]);
  if (typeof item.quantity !== "string") fail("INVALID_EFFICIENCY_REPORT", `${label}.quantity must be a string`);
  return normalizeQuantity(item, label);
}

function reportRate(value: unknown, label: string): EfficiencyRate {
  const item = reportObject(value, label);
  reportKeys(item, label, ["meter_id", "unit", "rate", "evidence", "source_refs"]);
  const rate = reportExactRatio(item.rate, `${label}.rate`);
  const result: EfficiencyRate = {
    meter_id: id(item.meter_id, `${label}.meter_id`),
    unit: id(item.unit, `${label}.unit`),
    rate,
    evidence: evidence(item.evidence, `${label}.evidence`),
  };
  const refs = sourceRefs(item.source_refs, `${label}.source_refs`);
  if (refs.length) result.source_refs = refs;
  return result;
}

function reportQuantities(value: unknown, label: string): EfficiencyQuantity[] {
  if (!Array.isArray(value)) fail("INVALID_EFFICIENCY_REPORT", `${label} must be an array`);
  const result = value.map((item, index) => reportQuantity(item, `${label}[${index}]`));
  const meterIds = new Set<string>();
  for (const item of result) if (meterIds.has(item.meter_id)) fail("INVALID_EFFICIENCY_REPORT", `${label} contains duplicate meter ${item.meter_id}`); else meterIds.add(item.meter_id);
  return result;
}

function reportRates(value: unknown, label: string): EfficiencyRate[] {
  if (!Array.isArray(value)) fail("INVALID_EFFICIENCY_REPORT", `${label} must be an array`);
  const result = value.map((item, index) => reportRate(item, `${label}[${index}]`));
  const meterIds = new Set<string>();
  for (const item of result) if (meterIds.has(item.meter_id)) fail("INVALID_EFFICIENCY_REPORT", `${label} contains duplicate meter ${item.meter_id}`); else meterIds.add(item.meter_id);
  return result;
}

function exactRatiosEqual(left: ExactRatio, right: ExactRatio): boolean {
  return BigInt(left.numerator) * BigInt(right.denominator) === BigInt(right.numerator) * BigInt(left.denominator);
}

function reportQuantityTotals(tasks: TaskEfficiencySummary[]): Map<string, { unit: string; value: ExactDecimal }> {
  const totals = new Map<string, { unit: string; value: ExactDecimal }>();
  for (const task of tasks) {
    for (const quantityValue of task.totals) {
      const current = totals.get(quantityValue.meter_id);
      const parsed = exactDecimal(quantityValue.quantity, `efficiency task ${task.work_item_id}.${quantityValue.meter_id}`);
      if (current && current.unit !== quantityValue.unit) fail("INVALID_EFFICIENCY_REPORT", `task totals use conflicting units for meter ${quantityValue.meter_id}`);
      totals.set(quantityValue.meter_id, { unit: quantityValue.unit, value: exactDecimalAdd(current?.value ?? { coefficient: 0n, scale: 0 }, parsed) });
    }
  }
  return totals;
}

function reportTask(value: unknown, label: string): TaskEfficiencySummary {
  const item = reportObject(value, label);
  reportKeys(item, label, ["work_item_id", "task_id", "scope_revision", "scope_version", "acceptance_version", "outcome", "accepted", "attempts", "retry_count", "escalation_count", "review_attempt_count", "rework_attempt_count", "totals", "limitations"]);
  const accepted = item.accepted;
  if (accepted !== null && typeof accepted !== "boolean") fail("INVALID_EFFICIENCY_REPORT", `${label}.accepted must be boolean or null`);
  const result: TaskEfficiencySummary = {
    work_item_id: workItemId(item.work_item_id, `${label}.work_item_id`),
    task_id: workItemId(item.task_id, `${label}.task_id`),
    scope_revision: id(item.scope_revision, `${label}.scope_revision`),
    scope_version: reportNullableId(item.scope_version, `${label}.scope_version`),
    acceptance_version: reportNullableId(item.acceptance_version, `${label}.acceptance_version`),
    outcome: status(item.outcome, `${label}.outcome`),
    accepted: accepted as boolean | null,
    attempts: reportInteger(item.attempts, `${label}.attempts`),
    retry_count: reportInteger(item.retry_count, `${label}.retry_count`),
    escalation_count: reportInteger(item.escalation_count, `${label}.escalation_count`),
    review_attempt_count: reportInteger(item.review_attempt_count, `${label}.review_attempt_count`),
    rework_attempt_count: reportInteger(item.rework_attempt_count, `${label}.rework_attempt_count`),
    totals: reportQuantities(item.totals, `${label}.totals`),
    limitations: reportStrings(item.limitations, `${label}.limitations`),
  };
  if ((result.accepted === true) !== (result.outcome === "accepted")) fail("INVALID_EFFICIENCY_REPORT", `${label}.accepted disagrees with outcome`);
  if (result.accepted === null && result.outcome !== "planned" && result.outcome !== "in_progress" && result.outcome !== "unknown") fail("INVALID_EFFICIENCY_REPORT", `${label}.accepted is null for a terminal outcome`);
  return result;
}

function reportFinding(value: unknown, label: string): EfficiencyFinding {
  const item = reportObject(value, label);
  reportKeys(item, label, ["rule", "status", "severity", "message", "work_item_ids", "observation_ids", "measurement", "evidence", "source_refs", "limitations"]);
  const rules: EfficiencyFinding["rule"][] = ["retry-burden", "escalation-burden", "review-rework-overhead", "cache-read-ratio", "repeated-context", "model-configuration", "missing-acceptance", "missing-metadata", "candidate-policy", "runway-limit"];
  const statuses: EfficiencyStatus[] = ["measured", "candidate", "unknown"];
  const severities: EfficiencyFinding["severity"][] = ["info", "warning", "error"];
  if (!rules.includes(item.rule as EfficiencyFinding["rule"]) || !statuses.includes(item.status as EfficiencyStatus) || !severities.includes(item.severity as EfficiencyFinding["severity"])) fail("INVALID_EFFICIENCY_REPORT", `${label} has an invalid rule, status or severity`);
  if (typeof item.message !== "string") fail("INVALID_EFFICIENCY_REPORT", `${label}.message must be a string`);
  const result: EfficiencyFinding = { rule: item.rule as EfficiencyFinding["rule"], status: item.status as EfficiencyStatus, severity: item.severity as EfficiencyFinding["severity"], message: item.message };
  if (item.work_item_ids !== undefined) result.work_item_ids = reportStrings(item.work_item_ids, `${label}.work_item_ids`).map((entry, index) => workItemId(entry, `${label}.work_item_ids[${index}]`));
  if (item.observation_ids !== undefined) result.observation_ids = reportStrings(item.observation_ids, `${label}.observation_ids`).map((entry, index) => id(entry, `${label}.observation_ids[${index}]`));
  if (item.measurement !== undefined) {
    const measurement = reportObject(item.measurement, `${label}.measurement`);
    reportKeys(measurement, `${label}.measurement`, ["numerator", "denominator", "unit"]);
    result.measurement = { ...reportExactRatio({ numerator: measurement.numerator, denominator: measurement.denominator }, `${label}.measurement`), unit: id(measurement.unit, `${label}.measurement.unit`) };
  }
  if (item.evidence !== undefined) result.evidence = evidence(item.evidence, `${label}.evidence`);
  if (item.source_refs !== undefined) result.source_refs = sourceRefs(item.source_refs, `${label}.source_refs`);
  if (item.limitations !== undefined) result.limitations = reportStrings(item.limitations, `${label}.limitations`);
  return result;
}

function reportSession(value: unknown): SessionEfficiencySummary {
  const item = reportObject(value, "efficiency.session");
  reportKeys(item, "efficiency.session", ["observation_count", "totals", "unknown_meter_ids", "limitations"]);
  return { observation_count: reportInteger(item.observation_count, "efficiency.session.observation_count"), totals: reportQuantities(item.totals, "efficiency.session.totals"), unknown_meter_ids: reportStrings(item.unknown_meter_ids, "efficiency.session.unknown_meter_ids").map((entry, index) => id(entry, `efficiency.session.unknown_meter_ids[${index}]`)), limitations: reportStrings(item.limitations, "efficiency.session.limitations") };
}

function reportCohort(value: unknown, tasks: TaskEfficiencySummary[]): CohortSummary {
  const item = reportObject(value, "efficiency.cohort");
  reportKeys(item, "efficiency.cohort", ["selector", "task_count", "accepted_count", "known_outcome_count", "unknown_outcome_count", "acceptance_rate", "retry_count", "escalation_count", "review_attempt_count", "rework_attempt_count", "totals", "per_accepted"]);
  const selectorObject = reportObject(item.selector, "efficiency.cohort.selector");
  reportKeys(selectorObject, "efficiency.cohort.selector", ["cohort_id", "task_class", "scope_revision", "acceptance_version", "work_item_ids"]);
  const result: CohortSummary = {
    selector: normalizeCohort(item.selector, "efficiency.cohort.selector"),
    task_count: reportInteger(item.task_count, "efficiency.cohort.task_count"),
    accepted_count: reportInteger(item.accepted_count, "efficiency.cohort.accepted_count"),
    known_outcome_count: reportInteger(item.known_outcome_count, "efficiency.cohort.known_outcome_count"),
    unknown_outcome_count: reportInteger(item.unknown_outcome_count, "efficiency.cohort.unknown_outcome_count"),
    acceptance_rate: item.acceptance_rate === null ? null : reportSignedRatioText(item.acceptance_rate, "efficiency.cohort.acceptance_rate"),
    retry_count: reportInteger(item.retry_count, "efficiency.cohort.retry_count"),
    escalation_count: reportInteger(item.escalation_count, "efficiency.cohort.escalation_count"),
    review_attempt_count: reportInteger(item.review_attempt_count, "efficiency.cohort.review_attempt_count"),
    rework_attempt_count: reportInteger(item.rework_attempt_count, "efficiency.cohort.rework_attempt_count"),
    totals: reportQuantities(item.totals, "efficiency.cohort.totals"),
    per_accepted: reportRates(item.per_accepted, "efficiency.cohort.per_accepted"),
  };
  const taskCount = BigInt(result.task_count);
  const acceptedCount = BigInt(result.accepted_count);
  const knownCount = BigInt(result.known_outcome_count);
  const unknownCount = BigInt(result.unknown_outcome_count);
  const expectedAccepted = tasks.filter((task) => task.accepted === true).length;
  const expectedKnown = tasks.filter((task) => task.accepted !== null).length;
  const expectedUnknown = tasks.length - expectedKnown;
  if (taskCount !== BigInt(tasks.length) || acceptedCount !== BigInt(expectedAccepted) || knownCount !== BigInt(expectedKnown) || unknownCount !== BigInt(expectedUnknown)) fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort outcome counts disagree with task summaries");
  if (acceptedCount > knownCount || knownCount + unknownCount !== taskCount) fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort outcome counts are inconsistent");
  if (knownCount === 0n) {
    if (result.acceptance_rate !== null) fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort acceptance_rate must be null without known outcomes");
  } else {
    const expectedRate = reduceRatio(acceptedCount, knownCount);
    if (result.acceptance_rate === null || !exactRatiosEqual(ratioText(result.acceptance_rate, "efficiency.cohort.acceptance_rate"), expectedRate)) {
      fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort acceptance_rate disagrees with outcome counts");
    }
  }
  const countFor = (key: "retry_count" | "escalation_count" | "review_attempt_count" | "rework_attempt_count") => tasks.reduce((sum, task) => sum + BigInt(task[key]), 0n);
  if (BigInt(result.retry_count) !== countFor("retry_count") || BigInt(result.escalation_count) !== countFor("escalation_count") || BigInt(result.review_attempt_count) !== countFor("review_attempt_count") || BigInt(result.rework_attempt_count) !== countFor("rework_attempt_count")) fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort attempt counts disagree with task summaries");
  const taskTotals = reportQuantityTotals(tasks);
  if (taskTotals.size !== result.totals.length) fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort totals do not cover the task totals");
  for (const total of result.totals) {
    const taskTotal = taskTotals.get(total.meter_id);
    if (!taskTotal || taskTotal.unit !== total.unit || exactDecimalText(taskTotal.value) !== total.quantity) fail("INVALID_EFFICIENCY_REPORT", `efficiency cohort total for ${total.meter_id} disagrees with task totals`);
  }
  if (acceptedCount === 0n && result.per_accepted.length !== 0) fail("INVALID_EFFICIENCY_REPORT", "efficiency cohort has per-accepted rates without accepted work");
  if (acceptedCount > 0n) {
    if (result.per_accepted.length !== result.totals.length) fail("INVALID_EFFICIENCY_REPORT", "efficiency per-accepted rates do not cover cohort totals");
    for (const rate of result.per_accepted) {
      const total = taskTotals.get(rate.meter_id);
      if (!total || total.unit !== rate.unit) fail("INVALID_EFFICIENCY_REPORT", `efficiency per-accepted rate for ${rate.meter_id} has no matching total`);
      const expected = reduceRatio(total.value.coefficient, 10n ** BigInt(total.value.scale) * acceptedCount);
      if (!exactRatiosEqual(expected, rate.rate)) fail("INVALID_EFFICIENCY_REPORT", `efficiency per-accepted rate for ${rate.meter_id} disagrees with cohort total`);
    }
  }
  return result;
}

function reportBenchmarkComparison(value: unknown, label: string): BenchmarkComparison {
  const item = reportObject(value, label);
  reportKeys(item, label, ["schema_version", "baseline_id", "candidate_id", "status", "evaluation", "sample_sizes", "accepted_counts", "acceptance_rate_delta", "resource_deltas", "latency_ns", "limitations", "source_refs"]);
  if (item.schema_version !== EFFICIENCY_SCHEMA_VERSION) fail("INVALID_EFFICIENCY_REPORT", `${label}.schema_version is unsupported`);
  const statusValues: BenchmarkComparison["status"][] = ["validated", "limited", "incompatible"];
  const evaluationValues: BenchmarkInput["evaluation"][] = ["held_out", "controlled", "historical", "declared"];
  if (!statusValues.includes(item.status as BenchmarkComparison["status"]) || !evaluationValues.includes(item.evaluation as BenchmarkInput["evaluation"])) fail("INVALID_EFFICIENCY_REPORT", `${label} has an invalid status or evaluation`);
  const sampleSizes = reportObject(item.sample_sizes, `${label}.sample_sizes`);
  const acceptedCounts = reportObject(item.accepted_counts, `${label}.accepted_counts`);
  reportKeys(sampleSizes, `${label}.sample_sizes`, ["baseline", "candidate"]);
  reportKeys(acceptedCounts, `${label}.accepted_counts`, ["baseline", "candidate"]);
  const result: BenchmarkComparison = {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    baseline_id: id(item.baseline_id, `${label}.baseline_id`),
    candidate_id: id(item.candidate_id, `${label}.candidate_id`),
    status: item.status as BenchmarkComparison["status"],
    evaluation: item.evaluation as BenchmarkInput["evaluation"],
    sample_sizes: { baseline: reportInteger(sampleSizes.baseline, `${label}.sample_sizes.baseline`), candidate: reportInteger(sampleSizes.candidate, `${label}.sample_sizes.candidate`) },
    accepted_counts: { baseline: reportInteger(acceptedCounts.baseline, `${label}.accepted_counts.baseline`), candidate: reportInteger(acceptedCounts.candidate, `${label}.accepted_counts.candidate`) },
    acceptance_rate_delta: item.acceptance_rate_delta === null ? null : reportSignedRatioText(item.acceptance_rate_delta, `${label}.acceptance_rate_delta`),
    resource_deltas: [],
    latency_ns: { baseline: null, candidate: null, delta: null },
    limitations: reportStrings(item.limitations, `${label}.limitations`),
    source_refs: sourceRefs(item.source_refs, `${label}.source_refs`, true),
  };
  if (BigInt(result.accepted_counts.baseline) > BigInt(result.sample_sizes.baseline) || BigInt(result.accepted_counts.candidate) > BigInt(result.sample_sizes.candidate)) fail("INVALID_EFFICIENCY_REPORT", `${label}.accepted_counts cannot exceed sample_sizes`);
  if (!Array.isArray(item.resource_deltas)) fail("INVALID_EFFICIENCY_REPORT", `${label}.resource_deltas must be an array`);
  const resourceMeters = new Set<string>();
  result.resource_deltas = item.resource_deltas.map((raw, index) => {
    const delta = reportObject(raw, `${label}.resource_deltas[${index}]`);
    reportKeys(delta, `${label}.resource_deltas[${index}]`, ["meter_id", "unit", "delta", "baseline", "candidate", "evidence"]);
    const meterId = id(delta.meter_id, `${label}.resource_deltas[${index}].meter_id`);
    if (resourceMeters.has(meterId)) fail("INVALID_EFFICIENCY_REPORT", `${label}.resource_deltas contains duplicate meter ${meterId}`);
    resourceMeters.add(meterId);
    const deltaEvidence = evidence(delta.evidence, `${label}.resource_deltas[${index}].evidence`);
    return { meter_id: meterId, unit: id(delta.unit, `${label}.resource_deltas[${index}].unit`), delta: delta.delta === null ? null : reportSignedRatioText(delta.delta, `${label}.resource_deltas[${index}].delta`), baseline: delta.baseline === null ? null : reportExactRatio(delta.baseline, `${label}.resource_deltas[${index}].baseline`), candidate: delta.candidate === null ? null : reportExactRatio(delta.candidate, `${label}.resource_deltas[${index}].candidate`), evidence: deltaEvidence };
  });
  const latency = reportObject(item.latency_ns, `${label}.latency_ns`);
  reportKeys(latency, `${label}.latency_ns`, ["baseline", "candidate", "delta"]);
  result.latency_ns = {
    baseline: latency.baseline === null ? null : reportExactRatio(latency.baseline, `${label}.latency_ns.baseline`),
    candidate: latency.candidate === null ? null : reportExactRatio(latency.candidate, `${label}.latency_ns.candidate`),
    delta: latency.delta === null ? null : reportSignedRatioText(latency.delta, `${label}.latency_ns.delta`),
  };
  return result;
}

function reportCandidatePolicy(value: unknown): CandidatePolicyScenario | null {
  if (value === null) return null;
  const item = reportObject(value, "efficiency.candidate_policy");
  reportKeys(item, "efficiency.candidate_policy", ["policy_id", "policy_version", "benchmark_id", "status", "expected_per_accepted", "expected_attempts_per_accepted", "analysis_overhead", "limitations", "source_refs"]);
  if (item.status !== "derived" && item.status !== "unknown") fail("INVALID_EFFICIENCY_REPORT", "efficiency.candidate_policy.status is invalid");
  return { policy_id: id(item.policy_id, "efficiency.candidate_policy.policy_id"), policy_version: id(item.policy_version, "efficiency.candidate_policy.policy_version"), benchmark_id: id(item.benchmark_id, "efficiency.candidate_policy.benchmark_id"), status: item.status, expected_per_accepted: reportRates(item.expected_per_accepted, "efficiency.candidate_policy.expected_per_accepted"), expected_attempts_per_accepted: item.expected_attempts_per_accepted === null ? null : reportExactRatio(item.expected_attempts_per_accepted, "efficiency.candidate_policy.expected_attempts_per_accepted"), analysis_overhead: reportQuantities(item.analysis_overhead, "efficiency.candidate_policy.analysis_overhead"), limitations: reportStrings(item.limitations, "efficiency.candidate_policy.limitations"), source_refs: sourceRefs(item.source_refs, "efficiency.candidate_policy.source_refs") };
}

function reportRunway(value: unknown): RunwayForecast | null {
  if (value === null) return null;
  const item = reportObject(value, "efficiency.runway");
  reportKeys(item, "efficiency.runway", ["schema_version", "status", "accepted_work", "limiting_snapshot_id", "horizon_start", "horizon_end", "considered_snapshots", "limitations", "source_refs"]);
  if (item.schema_version !== EFFICIENCY_SCHEMA_VERSION || (item.status !== "ready" && item.status !== "limited" && item.status !== "unknown")) fail("INVALID_EFFICIENCY_REPORT", "efficiency.runway has an invalid schema or status");
  const horizonStart = dateTime(item.horizon_start, "efficiency.runway.horizon_start");
  const horizonEnd = dateTime(item.horizon_end, "efficiency.runway.horizon_end");
  if (compareDateTimes(horizonEnd, horizonStart) <= 0) fail("INVALID_EFFICIENCY_REPORT", "efficiency.runway horizon is not increasing");
  if (item.accepted_work !== null) reportInteger(item.accepted_work, "efficiency.runway.accepted_work");
  return { schema_version: EFFICIENCY_SCHEMA_VERSION, status: item.status, accepted_work: item.accepted_work === null ? null : item.accepted_work as string, limiting_snapshot_id: reportNullableId(item.limiting_snapshot_id, "efficiency.runway.limiting_snapshot_id"), horizon_start: horizonStart, horizon_end: horizonEnd, considered_snapshots: reportStrings(item.considered_snapshots, "efficiency.runway.considered_snapshots").map((entry, index) => id(entry, `efficiency.runway.considered_snapshots[${index}]`)), limitations: reportStrings(item.limitations, "efficiency.runway.limitations"), source_refs: sourceRefs(item.source_refs, "efficiency.runway.source_refs") };
}

function assertReportReferences(result: EfficiencyAnalysis): void {
  const reportRefs = new Set(result.source_refs.map((ref) => `${ref.source_id}\u0000${ref.record}`));
  const check = (refs: UsageSourceRef[] | undefined, label: string): void => {
    for (const ref of refs ?? []) if (!reportRefs.has(`${ref.source_id}\u0000${ref.record}`)) fail("INVALID_EFFICIENCY_REPORT", `${label} references a source record absent from efficiency.source_refs`);
  };
  for (const quantityValue of result.session.totals) check(quantityValue.source_refs, "efficiency.session.totals");
  for (const quantityValue of result.cohort.totals) check(quantityValue.source_refs, "efficiency.cohort.totals");
  for (const rate of result.cohort.per_accepted) check(rate.source_refs, "efficiency.cohort.per_accepted");
  result.findings.forEach((item, index) => check(item.source_refs, `efficiency.findings[${index}]`));
  result.benchmark_comparisons.forEach((item, index) => check(item.source_refs, `efficiency.benchmark_comparisons[${index}]`));
  if (result.candidate_policy) {
    check(result.candidate_policy.source_refs, "efficiency.candidate_policy");
    result.candidate_policy.expected_per_accepted.forEach((rate) => check(rate.source_refs, "efficiency.candidate_policy.expected_per_accepted"));
    result.candidate_policy.analysis_overhead.forEach((quantityValue) => check(quantityValue.source_refs, "efficiency.candidate_policy.analysis_overhead"));
  }
  if (result.runway) check(result.runway.source_refs, "efficiency.runway");
}

/** Validate the derived report's complete structure and internal invariants. */
function validateEfficiencyReportShape(value: unknown): EfficiencyAnalysis {
  const item = reportObject(value, "efficiency report");
  reportKeys(item, "efficiency report", ["schema_version", "dataset_id", "usage_schema_version", "input", "options", "session", "cohort", "tasks", "findings", "benchmark_comparisons", "candidate_policy", "runway", "limitations", "source_refs"]);
  if (item.schema_version !== EFFICIENCY_SCHEMA_VERSION) fail("UNSUPPORTED_EFFICIENCY_SCHEMA", "efficiency report schema version must be 0.4.0");
  const datasetId = id(item.dataset_id, "efficiency.dataset_id");
  if (item.usage_schema_version !== "0.4.0") fail("INVALID_EFFICIENCY_REPORT", "efficiency.usage_schema_version must be 0.4.0");
  if (item.input === undefined) fail("INVALID_EFFICIENCY_REPORT", "efficiency.input is required for canonical recomputation");
  if (item.options === undefined) fail("INVALID_EFFICIENCY_REPORT", "efficiency.options is required for canonical recomputation");
  const retainedInput = validateEfficiencyInput(item.input);
  const retainedOptions = normalizeEfficiencyOptions(item.options, "efficiency.options");
  const tasksValue = item.tasks;
  if (!Array.isArray(tasksValue)) fail("INVALID_EFFICIENCY_REPORT", "efficiency.tasks must be an array");
  const tasks = tasksValue.map((task, index) => reportTask(task, `efficiency.tasks[${index}]`));
  const taskIds = new Set<string>();
  for (const task of tasks) if (taskIds.has(task.work_item_id)) fail("INVALID_EFFICIENCY_REPORT", `efficiency.tasks contains duplicate work item ${task.work_item_id}`); else taskIds.add(task.work_item_id);
  const result: EfficiencyAnalysis = {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    dataset_id: datasetId,
    usage_schema_version: "0.4.0",
    input: retainedInput,
    options: retainedOptions,
    session: reportSession(item.session),
    cohort: reportCohort(item.cohort, tasks),
    tasks,
    findings: Array.isArray(item.findings) ? item.findings.map((findingValue, index) => reportFinding(findingValue, `efficiency.findings[${index}]`)) : fail("INVALID_EFFICIENCY_REPORT", "efficiency.findings must be an array"),
    benchmark_comparisons: Array.isArray(item.benchmark_comparisons) ? item.benchmark_comparisons.map((comparison, index) => reportBenchmarkComparison(comparison, `efficiency.benchmark_comparisons[${index}]`)) : fail("INVALID_EFFICIENCY_REPORT", "efficiency.benchmark_comparisons must be an array"),
    candidate_policy: reportCandidatePolicy(item.candidate_policy),
    runway: reportRunway(item.runway),
    limitations: reportStrings(item.limitations, "efficiency.limitations"),
    source_refs: sourceRefs(item.source_refs, "efficiency.source_refs", true),
  };
  assertReportReferences(result);
  return clone(result);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * Validate a derived report and recompute it from the normalized input and
 * options retained inside the artifact. Changing a reported quantity, count,
 * finding or provenance field without changing the retained evidence is
 * rejected at this boundary.
 */
export function validateEfficiencyReport(value: unknown): EfficiencyAnalysis {
  const parsed = validateEfficiencyReportShape(value);
  const recomputed = analyzeEfficiency(parsed.input, parsed.options);
  if (stableJson(parsed) !== stableJson(recomputed)) fail("INVALID_EFFICIENCY_REPORT", "efficiency report does not match a canonical recomputation from its retained input");
  return recomputed;
}

/** Verbose aliases are kept for consumers that name their boundary validator after the artifact. */
export const validateEfficiency = validateEfficiencyInput;
export const validateEfficiencyAnalysis = validateEfficiencyReport;
export const compareBenchmarkInputs = compareBenchmarks;
export const forecastDeliveryRunway = forecastRunway;

function capacityDemandMap(demand: RunwayDemand): Map<string, EfficiencyRate> {
  return new Map(demand.per_accepted.map((item) => [item.meter_id, item]));
}

/** Forecast accepted work from declared capacity snapshots and same-unit observed demand. */
export function forecastRunway(snapshotsValue: CapacitySnapshot[], demandValue: RunwayDemand, optionsValue: RunwayOptions): RunwayForecast {
  if (!Array.isArray(snapshotsValue)) fail("INVALID_RUNWAY", "capacity snapshots must be an array");
  const snapshots = snapshotsValue.map((snapshot, index) => normalizeCapacity(snapshot, `capacity_snapshots[${index}]`));
  const snapshotIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.snapshot_id)) fail("DUPLICATE_CAPACITY_SNAPSHOT", `duplicate capacity snapshot ${snapshot.snapshot_id}`);
    snapshotIds.add(snapshot.snapshot_id);
  }
  const demand = clone(demandValue);
  integerQuantity(demand.accepted_count, "runway demand.accepted_count");
  if (BigInt(demand.accepted_count) === 0n) fail("ZERO_ACCEPTED_DEMAND", "runway demand cannot be based on zero accepted work");
  id(demand.workload_id, "runway demand.workload_id");
  id(demand.scope_id, "runway demand.scope_id");
  if (!Array.isArray(demand.per_accepted) || demand.per_accepted.length === 0) fail("UNKNOWN_DEMAND", "runway demand has no per-accepted resource meters");
  const demandMeters = new Set<string>();
  for (const item of demand.per_accepted) {
    id(item.meter_id, "runway demand meter_id");
    id(item.unit, "runway demand unit");
    if (demandMeters.has(item.meter_id)) fail("DUPLICATE_DEMAND_METER", `duplicate runway demand meter ${item.meter_id}`);
    demandMeters.add(item.meter_id);
    integerQuantity(item.rate.numerator, `runway demand ${item.meter_id}.rate.numerator`);
    integerQuantity(item.rate.denominator, `runway demand ${item.meter_id}.rate.denominator`);
    if (BigInt(item.rate.numerator) <= 0n || BigInt(item.rate.denominator) <= 0n) fail("UNKNOWN_DEMAND", `runway demand for ${item.meter_id} is zero or invalid`);
  }
  const options = { now: dateTime(optionsValue.now, "runway.now"), horizon_end: dateTime(optionsValue.horizon_end, "runway.horizon_end") };
  if (compareDateTimes(options.horizon_end, options.now) <= 0) fail("INVALID_RUNWAY_HORIZON", "runway horizon_end must be after now");
  const demandMap = capacityDemandMap(demand);
  const limitations: string[] = [];
  const eligible: Array<{ snapshot: CapacitySnapshot; work: bigint }> = [];
  let rejectedPool = false;
  let partialCoverage = false;
  let nonObservedDemand = false;
  let nonObservedCapacity = false;
  let scopeKind: CapacitySnapshot["scope"] | null = null;
  for (const snapshot of snapshots) {
    if (scopeKind === null) scopeKind = snapshot.scope;
    else if (scopeKind !== snapshot.scope) {
      limitations.push(`snapshot ${snapshot.snapshot_id} has a different capacity scope kind`);
      rejectedPool = true;
      continue;
    }
    if (snapshot.workload_id !== demand.workload_id) {
      limitations.push(`snapshot ${snapshot.snapshot_id} does not declare coverage of workload ${demand.workload_id}`);
      rejectedPool = true;
      continue;
    }
    if (snapshot.scope_id !== demand.scope_id) {
      limitations.push(`snapshot ${snapshot.snapshot_id} has a different shared scope`);
      rejectedPool = true;
      continue;
    }
    const meterDemand = demandMap.get(snapshot.meter_id);
    if (!meterDemand || meterDemand.unit !== snapshot.unit) {
      limitations.push(`snapshot ${snapshot.snapshot_id} has no same-unit observed demand for ${snapshot.meter_id}`);
      rejectedPool = true;
      continue;
    }
    const sourceBackedDerived = meterDemand.evidence === "derived" && (meterDemand.source_refs?.length ?? 0) > 0;
    const unverifiedAllowed = optionsValue.allow_unverified_demand === true && (meterDemand.evidence === "declared" || meterDemand.evidence === "estimated" || meterDemand.evidence === "derived");
    if (meterDemand.evidence === "unknown" || (!sourceBackedDerived && meterDemand.evidence !== "observed" && !unverifiedAllowed)) {
      limitations.push(`snapshot ${snapshot.snapshot_id} lacks observed or source-backed derived per-accepted demand for ${snapshot.meter_id}`);
      rejectedPool = true;
      continue;
    }
    if (meterDemand.evidence !== "observed") {
      nonObservedDemand = true;
      limitations.push(`snapshot ${snapshot.snapshot_id} uses ${meterDemand.evidence} per-accepted demand`);
    }
    if (snapshot.remaining === null || snapshot.evidence === "unknown") {
      limitations.push(`snapshot ${snapshot.snapshot_id} has unknown remaining capacity`);
      rejectedPool = true;
      continue;
    }
    if (snapshot.evidence !== "observed") {
      nonObservedCapacity = true;
      limitations.push(`snapshot ${snapshot.snapshot_id} uses ${snapshot.evidence} remaining-capacity evidence`);
    }
    if (snapshot.coverage === "unknown" || (snapshot.coverage === "partial" && !optionsValue.allow_partial_coverage)) {
      limitations.push(`snapshot ${snapshot.snapshot_id} has ${snapshot.coverage} coverage`);
      rejectedPool = true;
      continue;
    }
    if (snapshot.coverage === "partial") partialCoverage = true;
    if (compareDateTimes(snapshot.observed_at, options.now) > 0) {
      limitations.push(`snapshot ${snapshot.snapshot_id} was observed after the forecast start`);
      rejectedPool = true;
      continue;
    }
    if (optionsValue.stale_after_seconds !== undefined) {
      const staleAfter = BigInt(integerQuantity(optionsValue.stale_after_seconds, "runway.stale_after_seconds"));
      if (exceedsDateTimeAge(options.now, snapshot.observed_at, staleAfter)) {
        limitations.push(`snapshot ${snapshot.snapshot_id} is stale`);
        rejectedPool = true;
        continue;
      }
    }
    if (snapshot.reset_at === null || compareDateTimes(snapshot.reset_at, options.now) <= 0) {
      limitations.push(`snapshot ${snapshot.snapshot_id} has an unresolved or already elapsed reset window`);
      rejectedPool = true;
      continue;
    }
    if (compareDateTimes(snapshot.reset_at, options.horizon_end) <= 0) {
      limitations.push(`snapshot ${snapshot.snapshot_id} resets within the forecast horizon`);
      rejectedPool = true;
      continue;
    }
    const remainingFraction = decimalFraction(snapshot.remaining, `${snapshot.snapshot_id}.remaining`);
    const numerator = BigInt(remainingFraction.numerator) * BigInt(meterDemand.rate.denominator);
    const denominator = BigInt(remainingFraction.denominator) * BigInt(meterDemand.rate.numerator);
    if (denominator <= 0n) {
      limitations.push(`snapshot ${snapshot.snapshot_id} has zero per-accepted demand`);
      rejectedPool = true;
      continue;
    }
    eligible.push({ snapshot, work: numerator / denominator });
  }
  const refs = uniqueRefs(...eligible.map((item) => item.snapshot.source_refs));
  if (!eligible.length || (snapshots.length > 1 && rejectedPool)) return { schema_version: EFFICIENCY_SCHEMA_VERSION, status: "unknown", accepted_work: null, limiting_snapshot_id: null, horizon_start: options.now, horizon_end: options.horizon_end, considered_snapshots: snapshots.map((snapshot) => snapshot.snapshot_id), limitations: [...new Set(limitations)], source_refs: refs };
  const minimum = eligible.reduce((left, right) => (right.work < left.work ? right : left));
  const status: RunwayForecast["status"] = limitations.length || partialCoverage || nonObservedDemand || nonObservedCapacity ? "limited" : "ready";
  return { schema_version: EFFICIENCY_SCHEMA_VERSION, status, accepted_work: minimum.work.toString(), limiting_snapshot_id: minimum.snapshot.snapshot_id, horizon_start: options.now, horizon_end: options.horizon_end, considered_snapshots: snapshots.map((snapshot) => snapshot.snapshot_id), limitations: [...new Set(limitations)], source_refs: refs };
}
