import {
  USAGE_SCHEMA_VERSION,
  type UsageAccountingScope,
  type UsageAggregation,
  type UsageBundle,
  type UsageCountBasis,
  type UsageCoverage,
  type UsageDecimal,
  type UsageDimensionFact,
  type UsageDimensions,
  type UsageEvidence,
  type UsageGrouping,
  type UsageIssue,
  type UsageMeasurement,
  type UsageMeter,
  type UsageMeterCoverage,
  type UsageMeterOverlap,
  type UsageMeterTotal,
  type UsageObservation,
  type UsageReport,
  type UsageReportGroup,
  type UsageReportObservation,
  type UsageReportOptions,
  type UsageScalar,
  type UsageSource,
  type UsageSourceRef,
  type UsageStatus,
  type UsageTimestamp,
} from "./usage-types.js";

export * from "./usage-types.js";

const EVIDENCE = ["observed", "declared", "derived", "estimated", "unknown"] as const;
const ACCOUNTING_SCOPES = ["direct", "aggregate", "snapshot", "unknown"] as const;
const STATUSES = ["running", "ok", "error", "cancelled", "unknown"] as const;
const COUNT_BASES = ["provider_native", "consumed", "billable", "allocated", "unknown"] as const;
const AGGREGATIONS = ["delta", "cumulative", "unknown"] as const;
const MEASUREMENT_SCOPES = ["event", "interval", "snapshot", "aggregate", "unknown"] as const;
const METER_OVERLAPS = ["disjoint", "subset", "overlap", "unknown"] as const;
const GROUPINGS = ["model", "work_item", "task", "agent", "scope", "operation", "session"] as const;

export class UsageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function fail(code: string, message: string): never {
  throw new UsageError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("USAGE_SCHEMA_INVALID", "Expected an object");
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("USAGE_SCHEMA_INVALID", `${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail("USAGE_SCHEMA_INVALID", `${path} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, path);
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("USAGE_SCHEMA_INVALID", `${path} must be a boolean`);
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("USAGE_SCHEMA_INVALID", `${path} must be a nonnegative safe integer`);
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail("USAGE_SCHEMA_INVALID", `${path} has an invalid value`);
  return value as T;
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("USAGE_SCHEMA_INVALID", `${path}.${key} is not defined by the usage contract`);
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

const compareStrings = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Stable JSON for exact replay and canonical report validation. */
export function canonicalUsage(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalUsage).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => compareStrings(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalUsage(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const NONNEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

interface ParsedDecimal { sign: 1 | -1; digits: string; scale: number }

function parseDecimal(value: string): ParsedDecimal {
  if (!DECIMAL_PATTERN.test(value)) fail("USAGE_DECIMAL_INVALID", `Invalid exact decimal ${JSON.stringify(value)}`);
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return { sign: negative && digits !== "0" ? -1 : 1, digits, scale: fraction.length };
}

/** Returns a canonical exact decimal without redundant zeroes. */
export function normalizeDecimal(value: string): UsageDecimal {
  const parsed = parseDecimal(value);
  const wholeLength = parsed.digits.length - parsed.scale;
  let whole = wholeLength > 0 ? parsed.digits.slice(0, wholeLength) : "0";
  let fraction = parsed.scale > 0 ? parsed.digits.slice(Math.max(0, wholeLength)) : "";
  whole = whole.replace(/^0+(?=\d)/, "") || "0";
  fraction = fraction.replace(/0+$/, "");
  const result = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return parsed.sign < 0 ? `-${result}` : result;
}

export function isDecimal(value: unknown): value is UsageDecimal {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

export function isNonNegativeDecimal(value: unknown): value is UsageDecimal {
  return typeof value === "string" && NONNEGATIVE_DECIMAL_PATTERN.test(value);
}

export function decimalCompare(a: string, b: string): -1 | 0 | 1 {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
  const scale = Math.max(left.scale, right.scale);
  const leftDigits = BigInt(left.digits) * 10n ** BigInt(scale - left.scale);
  const rightDigits = BigInt(right.digits) * 10n ** BigInt(scale - right.scale);
  const result = leftDigits < rightDigits ? -1 : leftDigits > rightDigits ? 1 : 0;
  return (left.sign === 1 ? result : -result) as -1 | 0 | 1;
}

export function decimalAdd(a: string, b: string): UsageDecimal {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const scale = Math.max(left.scale, right.scale);
  const leftValue = BigInt(left.sign) * BigInt(left.digits) * 10n ** BigInt(scale - left.scale);
  const rightValue = BigInt(right.sign) * BigInt(right.digits) * 10n ** BigInt(scale - right.scale);
  const sum = leftValue + rightValue;
  const negative = sum < 0n;
  const unsigned = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
  const wholeLength = Math.max(1, unsigned.length - scale);
  const raw = scale === 0 ? unsigned : `${unsigned.slice(0, wholeLength)}.${unsigned.slice(wholeLength)}`;
  return normalizeDecimal(`${negative ? "-" : ""}${raw}`);
}

export function decimalSum(values: readonly string[]): UsageDecimal {
  return values.reduce((total, value) => decimalAdd(total, value), "0");
}

// Short aliases are useful to browser consumers that prefer verb-like names.
export const addDecimals = decimalAdd;
export const compareDecimals = decimalCompare;

function timestampParts(value: string): { base: string; fraction: string } {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) fail("USAGE_TIME_INVALID", `Timestamp must be UTC RFC 3339 with Z: ${value}`);
  const base = match[1]!;
  const fraction = match[2] ?? "";
  const [date, time] = base.split("T");
  const [yearText, monthText, dayText] = date!.split("-");
  const [hourText, minuteText, secondText] = time!.split(":");
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]! || hour > 23 || minute > 59 || second > 59) {
    fail("USAGE_TIME_INVALID", `Timestamp has an invalid calendar value: ${value}`);
  }
  return { base, fraction };
}

function compareTimestamps(a: string, b: string): number {
  const left = timestampParts(a), right = timestampParts(b);
  const base = compareStrings(left.base, right.base);
  if (base !== 0) return base;
  const scale = Math.max(left.fraction.length, right.fraction.length);
  return compareStrings(left.fraction.padEnd(scale, "0"), right.fraction.padEnd(scale, "0"));
}

function validateSourceRef(value: unknown, path: string): UsageSourceRef {
  const item = record(value);
  assertKeys(item, ["source_id", "record"], path);
  return { source_id: string(item.source_id, `${path}.source_id`), record: string(item.record, `${path}.record`) };
}

function validateSourceRefs(value: unknown, path: string): UsageSourceRef[] {
  return array(value, path).map((item, index) => validateSourceRef(item, `${path}[${index}]`));
}

function validateSource(value: unknown, path: string): UsageSource {
  const item = record(value);
  assertKeys(item, ["id", "harness", "format", "version", "sha256", "coverage", "description"], path);
  const result: UsageSource = {
    id: string(item.id, `${path}.id`), harness: string(item.harness, `${path}.harness`), format: string(item.format, `${path}.format`),
    coverage: enumValue(item.coverage, ["complete", "partial", "unknown"] as const, `${path}.coverage`),
  };
  const version = optionalString(item.version, `${path}.version`); if (version !== undefined) result.version = version;
  const sha = optionalString(item.sha256, `${path}.sha256`); if (sha !== undefined) {
    if (!/^[A-Fa-f0-9]{64}$/.test(sha)) fail("USAGE_SCHEMA_INVALID", `${path}.sha256 must be a SHA-256 hex digest`);
    result.sha256 = sha;
  }
  const description = optionalString(item.description, `${path}.description`); if (description !== undefined) result.description = description;
  return result;
}

function validateTimestamp(value: unknown, path: string): UsageTimestamp {
  const item = record(value);
  assertKeys(item, ["value", "evidence", "method", "source_refs"], path);
  const timestamp = item.value === null ? null : string(item.value, `${path}.value`);
  if (timestamp !== null) timestampParts(timestamp);
  const evidence = enumValue(item.evidence, EVIDENCE, `${path}.evidence`);
  if ((timestamp === null) !== (evidence === "unknown")) fail("USAGE_TIME_EVIDENCE", `${path} must use unknown evidence exactly when value is null`);
  return { value: timestamp, evidence, method: string(item.method, `${path}.method`), source_refs: validateSourceRefs(item.source_refs, `${path}.source_refs`) };
}

function validateScalar(value: unknown, path: string): UsageScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  fail("USAGE_SCHEMA_INVALID", `${path} must be a JSON scalar`);
}

function validateDimensionFact(value: unknown, path: string): UsageDimensionFact {
  const item = record(value);
  assertKeys(item, ["value", "evidence", "method", "source_refs"], path);
  const factValue = validateScalar(item.value, `${path}.value`);
  const evidence = enumValue(item.evidence, EVIDENCE, `${path}.evidence`);
  if ((factValue === null) !== (evidence === "unknown")) fail("USAGE_DIMENSION_EVIDENCE", `${path} must use unknown evidence exactly when value is null`);
  return { value: factValue, evidence, method: string(item.method, `${path}.method`), source_refs: validateSourceRefs(item.source_refs, `${path}.source_refs`) };
}

const KNOWN_DIMENSIONS = [
  "requested_provider", "actual_provider", "provider", "service", "product", "api_operation",
  "requested_model", "actual_model", "model", "requested_tier", "actual_tier", "tier",
  "requested_reasoning", "actual_reasoning", "reasoning", "requested_region", "actual_region", "region",
  "cache_ttl", "cache_behavior", "deployment", "sku",
] as const;

function validateDimensions(value: unknown, path: string): UsageDimensions {
  const item = record(value);
  const allowed = [...KNOWN_DIMENSIONS, "extensions"];
  assertKeys(item, allowed, path);
  const result: UsageDimensions = {};
  for (const key of KNOWN_DIMENSIONS) if (item[key] !== undefined) result[key] = validateDimensionFact(item[key], `${path}.${key}`);
  if (item.extensions !== undefined) {
    const extensions = record(item.extensions);
    const validated: Record<string, UsageDimensionFact> = {};
    for (const [key, fact] of Object.entries(extensions)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*(?:[.:/][A-Za-z0-9_.:/-]+)+$/.test(key)) fail("USAGE_DIMENSION_NAMESPACE", `${path}.extensions.${key} must be namespaced`);
      if (/(?:^|[.:/_-])(amount|cost|currency|price|rate)(?:$|[.:/_-])/iu.test(key)) fail("USAGE_PRICING_FIELD", `${path}.extensions.${key} is a pricing field and cannot be part of usage evidence`);
      validated[key] = validateDimensionFact(fact, `${path}.extensions.${key}`);
    }
    result.extensions = validated;
  }
  return result;
}

function validateMeasurement(value: unknown, path: string): UsageMeasurement {
  const item = record(value);
  assertKeys(item, ["value", "evidence", "method", "source_refs", "count_basis", "aggregation", "scope"], path);
  const quantity = item.value === null ? null : string(item.value, `${path}.value`);
  if (quantity !== null && !isNonNegativeDecimal(quantity)) fail("USAGE_QUANTITY_INVALID", `${path}.value must be a nonnegative exact decimal string`);
  const evidence = enumValue(item.evidence, EVIDENCE, `${path}.evidence`);
  if ((quantity === null) !== (evidence === "unknown")) fail("USAGE_MEASUREMENT_EVIDENCE", `${path} must use unknown evidence exactly when value is null`);
  return {
    value: quantity,
    evidence,
    method: string(item.method, `${path}.method`),
    source_refs: validateSourceRefs(item.source_refs, `${path}.source_refs`),
    count_basis: enumValue(item.count_basis, COUNT_BASES, `${path}.count_basis`),
    aggregation: enumValue(item.aggregation, AGGREGATIONS, `${path}.aggregation`),
    scope: enumValue(item.scope, MEASUREMENT_SCOPES, `${path}.scope`),
  };
}

function validateMeter(value: unknown, path: string): UsageMeter {
  const item = record(value);
  assertKeys(item, ["id", "unit", "description", "subset_of", "overlap"], path);
  return {
    id: string(item.id, `${path}.id`), unit: string(item.unit, `${path}.unit`), description: string(item.description, `${path}.description`),
    subset_of: nullableString(item.subset_of, `${path}.subset_of`), overlap: enumValue(item.overlap, METER_OVERLAPS, `${path}.overlap`),
  };
}

function validateIssue(value: unknown, path: string): UsageIssue {
  const item = record(value);
  assertKeys(item, ["code", "message", "severity", "observation_id", "meter_id", "source_id"], path);
  const result: UsageIssue = { code: string(item.code, `${path}.code`), message: string(item.message, `${path}.message`), severity: enumValue(item.severity, ["info", "warning", "error"] as const, `${path}.severity`) };
  for (const key of ["observation_id", "meter_id", "source_id"] as const) {
    const itemValue = optionalString(item[key], `${path}.${key}`); if (itemValue !== undefined) result[key] = itemValue;
  }
  return result;
}

function validateCoverage(value: unknown, path: string): UsageCoverage {
  const item = record(value);
  assertKeys(item, ["boundary", "complete", "dropped_observations", "dropped_by_source", "limitations"], path);
  const limitations = array(item.limitations, `${path}.limitations`).map((entry, index) => string(entry, `${path}.limitations[${index}]`));
  const coverage = {
    boundary: enumValue(item.boundary, ["instrumented", "native_transcript", "mixed", "unknown"] as const, `${path}.boundary`),
    complete: boolean(item.complete, `${path}.complete`), dropped_observations: integer(item.dropped_observations, `${path}.dropped_observations`), limitations,
  };
  if (coverage.complete && coverage.dropped_observations > 0) fail("USAGE_COVERAGE", "Complete usage coverage cannot contain dropped observations");
  if (item.dropped_by_source === undefined) return coverage;
  const dropped_by_source = Object.fromEntries(Object.entries(record(item.dropped_by_source)).map(([key, value]) => [string(key, `${path}.dropped_by_source key`), integer(value, `${path}.dropped_by_source.${key}`)]));
  const sum = Object.values(dropped_by_source).reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || sum !== coverage.dropped_observations) fail("USAGE_COVERAGE", "Source loss counters must sum to dropped_observations");
  return { ...coverage, dropped_by_source };
}

function validateObservation(value: unknown, path: string): UsageObservation {
  const item = record(value);
  assertKeys(item, ["id", "source_refs", "subject", "accounting_scope", "operation_id", "parent_id", "agent_id", "session_id", "work_item_id", "task_id", "status", "event_at", "started_at", "ended_at", "collected_at", "measurements", "dimensions"], path);
  const measurementsRecord = record(item.measurements);
  const measurements: Record<string, UsageMeasurement> = {};
  for (const [meterId, measurement] of Object.entries(measurementsRecord)) measurements[meterId] = validateMeasurement(measurement, `${path}.measurements.${meterId}`);
  const result: UsageObservation = {
    id: string(item.id, `${path}.id`), source_refs: validateSourceRefs(item.source_refs, `${path}.source_refs`), subject: item.subject === null ? null : string(item.subject, `${path}.subject`),
    accounting_scope: enumValue(item.accounting_scope, ACCOUNTING_SCOPES, `${path}.accounting_scope`),
    operation_id: nullableString(item.operation_id, `${path}.operation_id`), parent_id: nullableString(item.parent_id, `${path}.parent_id`),
    agent_id: nullableString(item.agent_id, `${path}.agent_id`), session_id: nullableString(item.session_id, `${path}.session_id`),
    work_item_id: nullableString(item.work_item_id, `${path}.work_item_id`), task_id: nullableString(item.task_id, `${path}.task_id`),
    status: enumValue(item.status, STATUSES, `${path}.status`), event_at: item.event_at === null ? null : validateTimestamp(item.event_at, `${path}.event_at`),
    started_at: item.started_at === null ? null : validateTimestamp(item.started_at, `${path}.started_at`), ended_at: item.ended_at === null ? null : validateTimestamp(item.ended_at, `${path}.ended_at`),
    collected_at: item.collected_at === null ? null : validateTimestamp(item.collected_at, `${path}.collected_at`), measurements, dimensions: validateDimensions(item.dimensions, `${path}.dimensions`),
  };
  if (result.status === "running" && result.ended_at !== null) fail("USAGE_TIME_INVALID", `${path}.running observation cannot have ended_at`);
  const startedAt = result.started_at, endedAt = result.ended_at;
  if (startedAt !== null && endedAt !== null && startedAt.value !== null && endedAt.value !== null && compareTimestamps(endedAt.value, startedAt.value) < 0) fail("USAGE_TIME_INVALID", `${path}.ended_at precedes started_at`);
  return result;
}

function validateSubsetSemantics(bundle: UsageBundle): void {
  const meters = new Map(bundle.meters.map(meter => [meter.id, meter]));
  for (const meter of bundle.meters) {
    if (meter.subset_of !== null && !meters.has(meter.subset_of)) fail("USAGE_METER_SUBSET", `Meter ${meter.id} references unknown subset parent ${meter.subset_of}`);
    if (meter.subset_of === meter.id) fail("USAGE_METER_SUBSET", `Meter ${meter.id} cannot be a subset of itself`);
    if (meter.overlap === "subset" && meter.subset_of === null) fail("USAGE_METER_SUBSET", `Meter ${meter.id} declares subset overlap without subset_of`);
  }
  for (const meter of bundle.meters) {
    const chain = new Set<string>(); let current: UsageMeter | undefined = meter;
    while (current?.subset_of !== null && current?.subset_of !== undefined) {
      if (chain.has(current.id)) fail("USAGE_METER_CYCLE", `Meter subset cycle at ${current.id}`);
      chain.add(current.id); current = meters.get(current.subset_of);
    }
  }
  const valuesComparable = (left: UsageMeasurement, right: UsageMeasurement) => left.value !== null && right.value !== null && left.evidence === right.evidence && left.count_basis === right.count_basis && left.aggregation === right.aggregation && left.scope === right.scope;
  for (const observation of bundle.observations) {
    for (const [childId, childMeasurement] of Object.entries(observation.measurements)) {
      const childMeter = meters.get(childId)!;
      if (childMeter.subset_of !== null) {
        const parentMeasurement = observation.measurements[childMeter.subset_of];
        if (parentMeasurement && valuesComparable(childMeasurement, parentMeasurement) && decimalCompare(childMeasurement.value!, parentMeasurement.value!) > 0) fail("USAGE_METER_SUBSET", `Meter ${childId} exceeds its declared subset parent ${childMeter.subset_of} in observation ${observation.id}`);
      }
    }
    const output = observation.measurements.output_tokens;
    const reasoning = observation.measurements.reasoning_output_tokens;
    if (output && reasoning && valuesComparable(reasoning, output) && decimalCompare(reasoning.value!, output.value!) > 0) fail("USAGE_METER_SUBSET", `Reasoning output exceeds output in observation ${observation.id}`);
  }
}

/** Validate transport shape, provenance links, exact quantities and temporal semantics. */
export function validateUsageBundle(value: unknown): UsageBundle {
  const item = record(value);
  assertKeys(item, ["schema_version", "dataset_id", "sources", "meters", "observations", "coverage", "issues"], "bundle");
  if (item.schema_version !== USAGE_SCHEMA_VERSION) fail("USAGE_SCHEMA_VERSION", `Expected usage schema ${USAGE_SCHEMA_VERSION}`);
  const sources = array(item.sources, "bundle.sources").map((source, index) => validateSource(source, `bundle.sources[${index}]`));
  const sourceIds = new Set<string>();
  for (const source of sources) if (!sourceIds.add(source.id)) fail("USAGE_DUPLICATE", `Duplicate source identity ${source.id}`);
  const meters = array(item.meters, "bundle.meters").map((meter, index) => validateMeter(meter, `bundle.meters[${index}]`));
  const meterIds = new Set<string>();
  for (const meter of meters) if (!meterIds.add(meter.id)) fail("USAGE_DUPLICATE", `Duplicate meter identity ${meter.id}`);
  const observations = array(item.observations, "bundle.observations").map((observation, index) => validateObservation(observation, `bundle.observations[${index}]`));
  const observationIds = new Set<string>();
  for (const observation of observations) {
    if (!observationIds.add(observation.id)) fail("USAGE_DUPLICATE", `Duplicate observation identity ${observation.id}`);
    if (observation.source_refs.length === 0) fail("USAGE_PROVENANCE", `Observation ${observation.id} needs at least one source reference`);
    for (const ref of observation.source_refs) if (!sourceIds.has(ref.source_id)) fail("USAGE_PROVENANCE", `Observation ${observation.id} references unknown source ${ref.source_id}`);
    for (const time of [observation.event_at, observation.started_at, observation.ended_at, observation.collected_at]) if (time) for (const ref of time.source_refs) if (!sourceIds.has(ref.source_id)) fail("USAGE_PROVENANCE", `Observation ${observation.id} timestamp references unknown source ${ref.source_id}`);
    for (const measurement of Object.values(observation.measurements)) for (const ref of measurement.source_refs) if (!sourceIds.has(ref.source_id)) fail("USAGE_PROVENANCE", `Observation ${observation.id} measurement references unknown source ${ref.source_id}`);
    for (const fact of dimensionFacts(observation.dimensions)) for (const ref of fact.source_refs) if (!sourceIds.has(ref.source_id)) fail("USAGE_PROVENANCE", `Observation ${observation.id} dimension references unknown source ${ref.source_id}`);
    for (const meterId of Object.keys(observation.measurements)) if (!meterIds.has(meterId)) fail("USAGE_METER_UNKNOWN", `Observation ${observation.id} references unknown meter ${meterId}`);
  }
  for (const observation of observations) {
    if (observation.parent_id === observation.id) fail("USAGE_PARENT", `Observation ${observation.id} cannot parent itself`);
  }
  const coverage = item.coverage === undefined ? undefined : validateCoverage(item.coverage, "bundle.coverage");
  for (const sourceId of Object.keys(coverage?.dropped_by_source ?? {})) if (!sources.some(source => source.id === sourceId)) fail("USAGE_COVERAGE", `Loss counter references missing source ${sourceId}`);
  if (coverage?.complete && sources.some(source => source.coverage !== "complete")) fail("USAGE_COVERAGE", "Complete usage coverage requires complete supporting sources");
  const issues = item.issues === undefined ? undefined : array(item.issues, "bundle.issues").map((issue, index) => validateIssue(issue, `bundle.issues[${index}]`));
  if (issues) for (const issue of issues) {
    if (issue.observation_id !== undefined && !observationIds.has(issue.observation_id)) fail("USAGE_ISSUE", `Issue references unknown observation ${issue.observation_id}`);
    if (issue.meter_id !== undefined && !meterIds.has(issue.meter_id)) fail("USAGE_ISSUE", `Issue references unknown meter ${issue.meter_id}`);
    if (issue.source_id !== undefined && !sourceIds.has(issue.source_id)) fail("USAGE_ISSUE", `Issue references unknown source ${issue.source_id}`);
  }
  const bundle: UsageBundle = { schema_version: USAGE_SCHEMA_VERSION, dataset_id: string(item.dataset_id, "bundle.dataset_id"), sources, meters, observations };
  if (coverage !== undefined) bundle.coverage = coverage;
  if (issues !== undefined) bundle.issues = issues;
  validateSubsetSemantics(bundle);
  // A missing parent can describe a partial capture. It never becomes a fake
  // parent in a report; recorded cycles are still rejected.
  for (const observation of observations) {
    const active = new Set<string>(); let current: UsageObservation | undefined = observation;
    while (current?.parent_id !== null && current?.parent_id !== undefined) {
      if (active.has(current.id)) fail("USAGE_PARENT_CYCLE", `Observation parent cycle at ${current.id}`);
      active.add(current.id); current = observations.find(candidate => candidate.id === current!.parent_id);
    }
  }
  return clone(bundle);
}

function dimensionFacts(dimensions: UsageDimensions): UsageDimensionFact[] {
  const facts: UsageDimensionFact[] = [];
  for (const key of Object.keys(dimensions)) {
    const value = dimensions[key as keyof UsageDimensions];
    if (key === "extensions") {
      facts.push(...Object.values(value as Record<string, UsageDimensionFact>));
    } else if (value) facts.push(value as UsageDimensionFact);
  }
  return facts;
}

function withoutProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutProvenance);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (key !== "source_refs") result[key] = withoutProvenance(item);
    return result;
  }
  return value;
}

function mergeProvenance<T>(left: T, right: T): T {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length ? left.map((item, index) => mergeProvenance(item, right[index])) as T : clone(left);
  if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(left as Record<string, unknown>), ...Object.keys(right as Record<string, unknown>)]);
    for (const key of keys) {
      const a = (left as Record<string, unknown>)[key], b = (right as Record<string, unknown>)[key];
      if (key === "source_refs" && Array.isArray(a) && Array.isArray(b)) {
        const refs = new Map<string, UsageSourceRef>();
        for (const ref of [...a, ...b] as UsageSourceRef[]) refs.set(`${ref.source_id}\u0000${ref.record}`, ref);
        result[key] = [...refs.values()].sort((x, y) => compareStrings(`${x.source_id}\u0000${x.record}`, `${y.source_id}\u0000${y.record}`));
      } else if (a !== undefined && b !== undefined) result[key] = mergeProvenance(a, b);
      else result[key] = clone(a ?? b);
    }
    return result as T;
  }
  return clone(left);
}

/** Replay-safe immutable merge. Duplicate IDs must match exactly apart from merged provenance. */
export function reconcileUsageBundles(inputs: UsageBundle[]): UsageBundle {
  if (!Array.isArray(inputs) || inputs.length === 0) fail("USAGE_MERGE", "At least one usage bundle is required");
  const bundles = inputs.map(validateUsageBundle);
  const dataset = bundles[0]!.dataset_id;
  if (bundles.some(bundle => bundle.dataset_id !== dataset)) fail("USAGE_DATASET", "Usage datasets differ");
  const mergeImmutable = <T extends { id: string }>(items: T[], label: string): T[] => {
    const byId = new Map<string, T>();
    for (const item of items) {
      const old = byId.get(item.id);
      if (!old) byId.set(item.id, clone(item));
      else if (canonicalUsage(withoutProvenance(old)) !== canonicalUsage(withoutProvenance(item))) fail("USAGE_CONFLICT", `Conflicting immutable ${label} identity ${item.id}`);
      else byId.set(item.id, mergeProvenance(old, item));
    }
    return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id));
  };
  const sources = mergeImmutable(bundles.flatMap(bundle => bundle.sources), "source");
  const meters = mergeImmutable(bundles.flatMap(bundle => bundle.meters), "meter");
  const observations = mergeImmutable(bundles.flatMap(bundle => bundle.observations), "observation");
  const boundaries = new Set(bundles.map(bundle => bundle.coverage?.boundary ?? "unknown"));
  const coveragePresent = bundles.some(bundle => bundle.coverage !== undefined);
  const losses = new Map<string, number>();
  for (const bundle of bundles) {
    const dropped = bundle.coverage?.dropped_observations ?? 0;
    let counters = bundle.coverage?.dropped_by_source;
    if (!counters && dropped > 0) {
      if (bundle.sources.length !== 1) fail("USAGE_COVERAGE", "Merging a capture with losses from multiple sources requires dropped_by_source counters");
      counters = { [bundle.sources[0]!.id]: dropped };
    }
    for (const [id, count] of Object.entries(counters ?? {})) losses.set(id, Math.max(losses.get(id) ?? 0, count));
  }
  const droppedTotal = [...losses.values()].reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(droppedTotal)) fail("USAGE_COVERAGE", "Merged loss count exceeds the safe integer range");
  const coverage = coveragePresent ? {
    boundary: boundaries.size === 1 ? bundles[0]!.coverage?.boundary ?? "unknown" : "mixed" as const,
    complete: bundles.every(bundle => bundle.coverage?.complete ?? false),
    dropped_observations: droppedTotal,
    ...(losses.size ? { dropped_by_source: Object.fromEntries([...losses.entries()].sort(([a], [b]) => compareStrings(a, b))) } : {}),
    limitations: [...new Set(bundles.flatMap(bundle => bundle.coverage?.limitations ?? []))].sort(compareStrings),
  } : undefined;
  const issues = bundles.some(bundle => bundle.issues !== undefined) ? [...new Map(bundles.flatMap(bundle => bundle.issues ?? []).map(issue => [canonicalUsage(issue), issue])).values()].sort((a, b) => compareStrings(canonicalUsage(a), canonicalUsage(b))) : undefined;
  const result: UsageBundle = { schema_version: USAGE_SCHEMA_VERSION, dataset_id: dataset, sources, meters, observations };
  if (coverage) result.coverage = coverage;
  if (issues) result.issues = issues;
  return validateUsageBundle(result);
}

function factText(fact: UsageDimensionFact | undefined): string | null {
  if (!fact || fact.value === null) return null;
  return typeof fact.value === "string" ? fact.value : String(fact.value);
}

function groupValue(observation: UsageObservation, group: UsageGrouping): string | null {
  switch (group) {
    case "model": return factText(observation.dimensions.actual_model) ?? factText(observation.dimensions.model) ?? factText(observation.dimensions.requested_model);
    case "work_item": return observation.work_item_id;
    case "task": return observation.task_id ?? observation.work_item_id;
    case "agent": return observation.agent_id;
    case "scope": return observation.accounting_scope;
    case "operation": return observation.operation_id;
    case "session": return observation.session_id;
  }
}

/**
 * A quantity is additive only when it is a direct delta at a known event or
 * interval grain. Cumulative, aggregate, snapshot and unknown-grain values
 * remain evidence but are excluded from totals.
 */
export function isAdditiveUsageMeasurement(observation: UsageObservation, measurement: UsageMeasurement): boolean {
  return observation.accounting_scope === "direct" && measurement.aggregation === "delta" && (measurement.scope === "event" || measurement.scope === "interval");
}

function emptyCoverage(): UsageMeterCoverage {
  return { total_observations: 0, additive_observations: 0, excluded_observations: 0, known_observations: 0, unknown_observations: 0, observed_observations: 0, estimated_observations: 0, declared_observations: 0, derived_observations: 0, unknown_observation_ids: [], excluded_observation_ids: [] };
}

function meterTotal(bundle: UsageBundle, meter: UsageMeter, observations: readonly UsageObservation[]): UsageMeterTotal {
  const coverage = emptyCoverage();
  let known = "0", observed = "0", estimated = "0";
  const bases = new Set<UsageCountBasis>();
  const scopes = new Set<UsageMeasurement["scope"]>();
  for (const observation of observations) {
    const measurement = observation.measurements[meter.id];
    if (!measurement) continue;
    coverage.total_observations++;
    if (!isAdditiveUsageMeasurement(observation, measurement)) {
      coverage.excluded_observations++; coverage.excluded_observation_ids.push(observation.id); continue;
    }
    coverage.additive_observations++;
    if (measurement.count_basis !== "unknown") bases.add(measurement.count_basis);
    if (measurement.scope !== "unknown") scopes.add(measurement.scope);
    if (measurement.value === null) {
      coverage.unknown_observations++; coverage.unknown_observation_ids.push(observation.id); continue;
    }
    known = decimalAdd(known, measurement.value);
    coverage.known_observations++;
    if (measurement.evidence === "observed") { observed = decimalAdd(observed, measurement.value); coverage.observed_observations++; }
    if (measurement.evidence === "estimated") { estimated = decimalAdd(estimated, measurement.value); coverage.estimated_observations++; }
    if (measurement.evidence === "declared") coverage.declared_observations++;
    if (measurement.evidence === "derived") coverage.derived_observations++;
  }
  if (bases.size > 1) fail("USAGE_BASIS_MIXED", `Meter ${meter.id} mixes incompatible count bases: ${[...bases].sort(compareStrings).join(", ")}`);
  if (scopes.size > 1) fail("USAGE_SCOPE_MIXED", `Meter ${meter.id} mixes incompatible measurement scopes: ${[...scopes].sort(compareStrings).join(", ")}`);
  coverage.unknown_observation_ids.sort(compareStrings); coverage.excluded_observation_ids.sort(compareStrings);
  return { meter_id: meter.id, unit: meter.unit, known_total: known, observed_total: observed, estimated_total: estimated, coverage };
}

function reportGroupKey(groupBy: readonly UsageGrouping[], observation: UsageObservation): string {
  return canonicalUsage(Object.fromEntries(groupBy.map(group => [group, groupValue(observation, group)])));
}

function ancestry(observation: UsageObservation, byId: Map<string, UsageObservation>): string[] {
  const path: string[] = []; const seen = new Set<string>(); let current: UsageObservation | undefined = observation;
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id); path.push(current.id); current = current.parent_id === null ? undefined : byId.get(current.parent_id);
  }
  return path.reverse();
}

/** Build a canonical usage-only report from the selected meters and grouping. */
export function createUsageReport(input: UsageBundle, options: UsageReportOptions = {}): UsageReport {
  const bundle = validateUsageBundle(input);
  const meterById = new Map(bundle.meters.map(meter => [meter.id, meter]));
  const selectedMeterIds = options.meter_ids === undefined ? bundle.meters.map(meter => meter.id).sort(compareStrings) : [...new Set(options.meter_ids)].sort(compareStrings);
  for (const meterId of selectedMeterIds) if (!meterById.has(meterId)) fail("USAGE_REPORT_METER", `Unknown selected meter ${meterId}`);
  if (options.meter_ids !== undefined && options.meter_ids.length !== selectedMeterIds.length) fail("USAGE_REPORT_METER", "Selected meter IDs must be unique");
  const groupBy = options.group_by === undefined ? ["work_item", "task", "agent", "model", "scope"] as UsageGrouping[] : [...options.group_by];
  for (const group of groupBy) enumValue(group, GROUPINGS, "group_by");
  if (new Set(groupBy).size !== groupBy.length) fail("USAGE_REPORT_GROUP", "Grouping dimensions must be unique");
  const selectedMeters = selectedMeterIds.map(meterId => meterById.get(meterId)!);
  const observations = [...bundle.observations].sort((a, b) => compareStrings(a.id, b.id));
  const byId = new Map(observations.map(observation => [observation.id, observation]));
  const reportObservations: UsageReportObservation[] = observations.map(observation => ({ observation_id: observation.id, parent_observation_id: observation.parent_id, ancestry: ancestry(observation, byId), group_key: reportGroupKey(groupBy, observation) }));
  const grouped = new Map<string, UsageObservation[]>();
  for (const observation of observations) {
    const key = reportGroupKey(groupBy, observation); const list = grouped.get(key) ?? []; list.push(observation); grouped.set(key, list);
  }
  const groups: UsageReportGroup[] = [...grouped.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([key, groupObservations]) => ({
    key,
    dimensions: Object.fromEntries(groupBy.map(group => [group, groupValue(groupObservations[0]!, group) ?? "unknown"])),
    observation_ids: groupObservations.map(observation => observation.id).sort(compareStrings),
    meter_totals: selectedMeters.map(meter => meterTotal(bundle, meter, groupObservations)),
  }));
  return clone({ schema_version: USAGE_SCHEMA_VERSION, dataset_id: bundle.dataset_id, bundle, selected_meter_ids: selectedMeterIds, group_by: groupBy, meter_totals: selectedMeters.map(meter => meterTotal(bundle, meter, observations)), groups, observations: reportObservations });
}

function validateReportShape(value: unknown): UsageReport {
  const item = record(value);
  assertKeys(item, ["schema_version", "dataset_id", "bundle", "selected_meter_ids", "group_by", "meter_totals", "groups", "observations"], "report");
  if (item.schema_version !== USAGE_SCHEMA_VERSION) fail("USAGE_REPORT_SCHEMA", `Expected usage report schema ${USAGE_SCHEMA_VERSION}`);
  const selectedMeterIds = array(item.selected_meter_ids, "report.selected_meter_ids").map((entry, index) => string(entry, `report.selected_meter_ids[${index}]`));
  const groupBy = array(item.group_by, "report.group_by").map((entry, index) => enumValue(entry, GROUPINGS, `report.group_by[${index}]`));
  const validateReportMeterTotal = (entry: unknown, path: string): UsageMeterTotal => {
    const total = record(entry); assertKeys(total, ["meter_id", "unit", "known_total", "observed_total", "estimated_total", "coverage"], path);
    const coverage = record(total.coverage); assertKeys(coverage, ["total_observations", "additive_observations", "excluded_observations", "known_observations", "unknown_observations", "observed_observations", "estimated_observations", "declared_observations", "derived_observations", "unknown_observation_ids", "excluded_observation_ids"], `${path}.coverage`);
    const ids = (entryValue: unknown, childPath: string) => array(entryValue, childPath).map((id, index) => string(id, `${childPath}[${index}]`));
    return { meter_id: string(total.meter_id, `${path}.meter_id`), unit: string(total.unit, `${path}.unit`), known_total: validateQuantity(total.known_total, `${path}.known_total`), observed_total: validateQuantity(total.observed_total, `${path}.observed_total`), estimated_total: validateQuantity(total.estimated_total, `${path}.estimated_total`), coverage: {
      total_observations: integer(coverage.total_observations, `${path}.coverage.total_observations`), additive_observations: integer(coverage.additive_observations, `${path}.coverage.additive_observations`), excluded_observations: integer(coverage.excluded_observations, `${path}.coverage.excluded_observations`), known_observations: integer(coverage.known_observations, `${path}.coverage.known_observations`), unknown_observations: integer(coverage.unknown_observations, `${path}.coverage.unknown_observations`), observed_observations: integer(coverage.observed_observations, `${path}.coverage.observed_observations`), estimated_observations: integer(coverage.estimated_observations, `${path}.coverage.estimated_observations`), declared_observations: integer(coverage.declared_observations, `${path}.coverage.declared_observations`), derived_observations: integer(coverage.derived_observations, `${path}.coverage.derived_observations`), unknown_observation_ids: ids(coverage.unknown_observation_ids, `${path}.coverage.unknown_observation_ids`), excluded_observation_ids: ids(coverage.excluded_observation_ids, `${path}.coverage.excluded_observation_ids`),
    } };
  };
  const meterTotals = array(item.meter_totals, "report.meter_totals").map((entry, index) => validateReportMeterTotal(entry, `report.meter_totals[${index}]`));
  const groups = array(item.groups, "report.groups").map((entry, index) => {
    const group = record(entry); assertKeys(group, ["key", "dimensions", "observation_ids", "meter_totals"], `report.groups[${index}]`);
    const dimensions = record(group.dimensions); const groupDimensions: Record<string, string> = {};
    for (const [key, val] of Object.entries(dimensions)) groupDimensions[string(key, `report.groups[${index}].dimensions.key`)] = string(val, `report.groups[${index}].dimensions.${key}`);
    return { key: string(group.key, `report.groups[${index}].key`), dimensions: groupDimensions, observation_ids: array(group.observation_ids, `report.groups[${index}].observation_ids`).map((id, idIndex) => string(id, `report.groups[${index}].observation_ids[${idIndex}]`)), meter_totals: array(group.meter_totals, `report.groups[${index}].meter_totals`).map((total, totalIndex) => validateReportMeterTotal(total, `report.groups[${index}].meter_totals[${totalIndex}]`)) } as UsageReportGroup;
  });
  const reportObservations = array(item.observations, "report.observations").map((entry, index) => {
    const observation = record(entry); assertKeys(observation, ["observation_id", "parent_observation_id", "ancestry", "group_key"], `report.observations[${index}]`);
    return { observation_id: string(observation.observation_id, `report.observations[${index}].observation_id`), parent_observation_id: nullableString(observation.parent_observation_id, `report.observations[${index}].parent_observation_id`), ancestry: array(observation.ancestry, `report.observations[${index}].ancestry`).map((id, idIndex) => string(id, `report.observations[${index}].ancestry[${idIndex}]`)), group_key: string(observation.group_key, `report.observations[${index}].group_key`) } as UsageReportObservation;
  });
  return { schema_version: USAGE_SCHEMA_VERSION, dataset_id: string(item.dataset_id, "report.dataset_id"), bundle: validateUsageBundle(item.bundle), selected_meter_ids: selectedMeterIds, group_by: groupBy, meter_totals: meterTotals, groups, observations: reportObservations };
}

function validateQuantity(value: unknown, path: string): UsageDecimal {
  const quantity = string(value, path); if (!isNonNegativeDecimal(quantity)) fail("USAGE_QUANTITY_INVALID", `${path} must be a nonnegative exact decimal string`); return quantity;
}

/** Recompute the report from its embedded bundle and reject every drift. */
export function validateUsageReport(value: unknown): UsageReport {
  const report = validateReportShape(value);
  const expected = createUsageReport(report.bundle, { meter_ids: report.selected_meter_ids, group_by: report.group_by });
  if (canonicalUsage(report) !== canonicalUsage(expected)) fail("USAGE_REPORT_MISMATCH", "Usage report differs from its canonical recomputation");
  return clone(expected);
}
