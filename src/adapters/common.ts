import { createHash } from "node:crypto";
import type {
  AdapterCapability,
  Attributes,
  CoverageIssue,
  EvidenceBundle,
  Harness,
  ImportOptions,
  Observation,
  RecordedCost,
  Source,
  SourceRef,
  Usage,
} from "../types.js";

export interface InputRecord {
  value: Record<string, unknown>;
  line: number;
}

export interface ParseResult {
  records: InputRecord[];
  issues: CoverageIssue[];
}

export const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const hashNativeId = (value: string): string => hash(value).slice(0, 32);

const LINEAGE_PARENT_HASH = "flAImegraph.lineage.parent_id_hash";
const LINEAGE_PARENT_HASHES = "flAImegraph.lineage.parent_id_hashes";
const LINEAGE_PARENT_OBSERVATION = "flAImegraph.lineage.parent_observation_id";
const LINEAGE_NATIVE_HASHES = "flAImegraph.lineage.native_id_hashes";

/**
 * Canonicalize JSON-like adapter values for duplicate/conflict comparisons.
 * Native records are JSON, but keeping this helper tolerant of bigint makes it
 * safe for callers that construct synthetic records in tests.
 */
export function stableJson(value: unknown): string {
  const canonicalize = (entry: unknown): unknown => {
    if (typeof entry === "bigint") return `${entry.toString()}n`;
    if (Array.isArray(entry)) return entry.map((item) => canonicalize(item));
    if (isRecord(entry)) {
      return Object.fromEntries(
        Object.keys(entry)
          .sort()
          .filter((key) => entry[key] !== undefined)
          .map((key) => [key, canonicalize(entry[key])]),
      );
    }
    return entry;
  };
  return JSON.stringify(canonicalize(value)) ?? "undefined";
}

export function parseJsonInput(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { records: [], issues: [{ code: "empty_input", message: "Input contains no records.", severity: "error" }] };
  }

  // A native export is sometimes one JSON object/array and sometimes JSONL.
  // Try the complete document first so pretty-printed JSON is accepted.
  try {
    const value: unknown = JSON.parse(trimmed);
    if (Array.isArray(value)) {
      const records: InputRecord[] = [];
      const issues: CoverageIssue[] = [];
      value.forEach((entry, index) => {
        if (isRecord(entry)) records.push({ value: entry, line: index + 1 });
        else issues.push({ code: "invalid_record", message: `Record ${index + 1} is not a JSON object.`, severity: "error" });
      });
      return { records, issues };
    }
    if (isRecord(value)) return { records: [{ value, line: 1 }], issues: [] };
    return { records: [], issues: [{ code: "invalid_record", message: "JSON input must contain an object or array of objects.", severity: "error" }] };
  } catch {
    // Fall through to JSONL. Parse errors are retained with line references.
  }

  const records: InputRecord[] = [];
  const issues: CoverageIssue[] = [];
  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = index + 1;
    const text = rawLine.trim();
    if (!text) continue;
    try {
      const value: unknown = JSON.parse(text);
      if (isRecord(value)) records.push({ value, line });
      else issues.push({ code: "invalid_record", message: `JSONL line ${line} is not an object.`, severity: "error" });
    } catch (error) {
      issues.push({ code: "jsonl_parse_error", message: `Could not parse JSONL line ${line}: ${error instanceof Error ? error.message : "invalid JSON"}.`, severity: "error" });
    }
  }
  if (records.length === 0 && issues.length === 0) {
    issues.push({ code: "empty_input", message: "Input contains no records.", severity: "error" });
  }
  return { records, issues };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = stringValue(value);
    if (result !== undefined) return result;
  }
  return undefined;
}

export function nested(record: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function firstNested(record: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    const value = nested(record, ...path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export interface QuantityResult {
  value: string | null;
  invalid: boolean;
}

/** Convert only exact, nonnegative integer quantities; unsafe JS numbers are rejected. */
export function quantity(value: unknown): QuantityResult {
  if (value === null || value === undefined) return { value: null, invalid: false };
  if (typeof value === "string") {
    return /^(?:0|[1-9]\d*)$/.test(value)
      ? { value, invalid: false }
      : { value: null, invalid: true };
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0
      ? { value: String(value), invalid: false }
      : { value: null, invalid: true };
  }
  if (typeof value === "bigint" && value >= 0n) return { value: value.toString(), invalid: false };
  return { value: null, invalid: true };
}

export function addQuantities(...values: Array<string | null | undefined>): string | null {
  let total = 0n;
  for (const value of values) {
    // An inclusive total assembled from exclusive native buckets is unknown
    // when any required bucket is missing. Treating null as zero makes a
    // missing cache or fresh-input component look like known free usage.
    if (value === null || value === undefined) return null;
    total += BigInt(value);
  }
  return total.toString();
}

export function usageFromFields(
  raw: Record<string, unknown> | undefined,
  fields: {
    input: string[];
    output: string[];
    cacheRead: string[];
    cacheWrite: string[];
    reasoning: string[];
    unclassified?: string[];
  },
  issues: CoverageIssue[],
  issueContext: string,
): Usage | null {
  if (!raw) return null;
  const read = (names: string[]): string | null => {
    for (const name of names) {
      if (!(name in raw)) continue;
      const result = quantity(raw[name]);
      if (result.invalid) {
        issues.push({ code: "invalid_quantity", message: `${issueContext} has an invalid token quantity for ${name}.`, severity: "error" });
        return null;
      }
      return result.value;
    }
    return null;
  };
  const input = read(fields.input);
  const output = read(fields.output);
  const cacheRead = read(fields.cacheRead);
  const cacheWrite = read(fields.cacheWrite);
  const reasoning = read(fields.reasoning);
  const unclassified = fields.unclassified ? read(fields.unclassified) : null;
  if (input === null && output === null && cacheRead === null && cacheWrite === null && reasoning === null && unclassified === null) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    reasoning_output_tokens: reasoning,
    ...(unclassified !== null ? { unclassified_tokens: unclassified } : {}),
  };
}

export function inclusiveInputUsage(
  raw: Record<string, unknown> | undefined,
  fields: Omit<Parameters<typeof usageFromFields>[1], "input"> & { input: string[] },
  issues: CoverageIssue[],
  issueContext: string,
): Usage | null {
  const usage = usageFromFields(raw, fields, issues, issueContext);
  if (!usage) return null;
  return {
    ...usage,
    input_tokens: addQuantities(usage.input_tokens, usage.cache_read_input_tokens, usage.cache_write_input_tokens),
  };
}

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Convert an OTLP epoch-nanosecond value to a schema-valid UTC timestamp. */
export function epochNanosecondsToTimestamp(value: unknown): string | undefined {
  const parsed = quantity(value);
  if (parsed.invalid || parsed.value === null) return undefined;
  const nanoseconds = BigInt(parsed.value);
  const seconds = nanoseconds / 1_000_000_000n;
  const remainder = nanoseconds % 1_000_000_000n;
  // Date supports millisecond precision and has a finite range. Seconds from
  // valid OTLP timestamps are far below Number's unsafe integer boundary.
  const milliseconds = seconds * 1_000n;
  const maxDateMilliseconds = 8_640_000_000_000_000n;
  if (milliseconds > maxDateMilliseconds || milliseconds < -maxDateMilliseconds) return undefined;
  const date = new Date(Number(milliseconds));
  if (!Number.isFinite(date.getTime())) return undefined;
  const base = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const fraction = remainder.toString().padStart(9, "0").replace(/0+$/, "");
  const timestamp = fraction.length > 0 ? base.replace(/Z$/, `.${fraction}Z`) : base;
  return /^\d{4}-/.test(timestamp) ? timestamp : undefined;
}

/**
 * Preserve a textual RFC3339 time when valid, otherwise normalize OTLP's
 * epoch-nanosecond representation. Invalid native values are omitted and
 * surfaced as an explicit issue by the caller.
 */
export function normalizeTimestamp(
  textual: unknown,
  epochNanoseconds: unknown,
  issues: CoverageIssue[],
  context: string,
): string | undefined {
  if (textual !== undefined && textual !== null) {
    if (typeof textual === "string" && RFC3339_RE.test(textual) && Number.isFinite(Date.parse(textual))) return textual;
    issues.push({ code: "invalid_timestamp", message: `${context} has an invalid RFC3339 timestamp; native time is retained only in adapter attributes.`, severity: "warning" });
  }
  if (epochNanoseconds !== undefined && epochNanoseconds !== null) {
    const normalized = epochNanosecondsToTimestamp(epochNanoseconds);
    if (normalized) return normalized;
    issues.push({ code: "invalid_otlp_timestamp", message: `${context} has an invalid or unsafe epoch-nanosecond timestamp; normalized time is unavailable.`, severity: "warning" });
  }
  return undefined;
}

export function makeSource(
  harness: Harness,
  format: string,
  input: string,
  options: ImportOptions | undefined,
  description: string,
  version?: string,
): Source {
  const digest = hash(input);
  return {
    id: options?.source_id ?? `${harness}:${digest.slice(0, 16)}`,
    harness,
    format,
    ...(version || options?.version ? { version: options?.version ?? version } : {}),
    sha256: digest,
    coverage: "partial",
    description,
  };
}

export function makeBundle(
  harness: Harness,
  format: string,
  input: string,
  options: ImportOptions | undefined,
  description: string,
  version?: string,
): EvidenceBundle {
  const source = makeSource(harness, format, input, options, description, version);
  const datasetSeed = `${harness}\0${source.id}\0${input}`;
  return {
    schema_version: "0.1.0",
    dataset_id: options?.dataset_id ?? `dataset:${hash(datasetSeed).slice(0, 24)}`,
    sources: [source],
    observations: [],
    relationships: [],
    issues: [],
  };
}

export function sourceRef(sourceId: string, record: string): SourceRef {
  return { source_id: sourceId, record };
}

export function observationId(harness: Harness, sourceId: string, identity: string): string {
  return `${harness}:observation:${hash(`${sourceId}\0${identity}`).slice(0, 32)}`;
}

export function nativeIdentity(record: Record<string, unknown>, fallback: string): string {
  return firstString(
    record.response_id,
    record.responseId,
    record.id,
    record.call_id,
    record.callId,
    record.span_id,
    record.spanId,
  ) ?? fallback;
}

export function attachNativeIdentity(attributes: Attributes | undefined, nativeId: string): Attributes {
  return {
    ...(attributes ?? {}),
    native_id_hash: hashNativeId(nativeId),
    [LINEAGE_NATIVE_HASHES]: hashNativeId(nativeId),
  };
}

export function addPartialCoverageIssue(bundle: EvidenceBundle, message: string, code = "partial_source_coverage"): void {
  bundle.issues.push({ code, message, severity: "info", source_id: bundle.sources[0]?.id });
}

export function finalizeBundle(bundle: EvidenceBundle, options?: ImportOptions): EvidenceBundle {
  const aliases = new Map<string, Set<string>>();
  for (const observation of bundle.observations) {
    const attributes = observation.attributes ?? {};
    const hashes = [
      attributes.native_id_hash,
      attributes[LINEAGE_NATIVE_HASHES],
    ].flatMap((value) => typeof value === "string" ? value.split(",") : []);
    for (const alias of hashes) {
      const observations = aliases.get(alias) ?? new Set<string>();
      observations.add(observation.id);
      aliases.set(alias, observations);
    }
  }

  for (const observation of bundle.observations) {
    const attributes = observation.attributes ?? {};
    const explicitParent = attributes[LINEAGE_PARENT_OBSERVATION];
    const parentHashes = attributes[LINEAGE_PARENT_HASHES];
    if (observation.parent_id === undefined && typeof explicitParent === "string" && explicitParent.length > 0) {
      if (explicitParent === observation.id) {
        bundle.issues.push({
          code: "lineage_parent_cycle",
          message: `Native parent lineage for observation ${observation.id} would create a self-parent cycle; it remains hashed in adapter attributes.`,
          severity: "warning",
          source_id: bundle.sources[0]?.id,
          observation_id: observation.id,
        });
      } else if (bundle.observations.some((candidate) => candidate.id === explicitParent)) {
        observation.parent_id = explicitParent;
      } else if (typeof parentHashes !== "string" || parentHashes.length === 0) {
        bundle.issues.push({
          code: "lineage_parent_unresolved",
          message: `Native parent lineage for observation ${observation.id} does not match a normalized observation; it remains hashed in adapter attributes.`,
          severity: "warning",
          source_id: bundle.sources[0]?.id,
          observation_id: observation.id,
        });
      }
    }
    if (observation.parent_id !== undefined || typeof parentHashes !== "string" || parentHashes.length === 0) continue;

    const targets = new Set<string>();
    for (const parentHash of parentHashes.split(",")) {
      for (const target of aliases.get(parentHash) ?? []) targets.add(target);
    }
    if (targets.size === 1) {
      const target = [...targets][0] as string;
      if (target !== observation.id) {
        observation.parent_id = target;
        continue;
      }
    }
    const code = targets.size > 1 ? "lineage_parent_ambiguous" : targets.size === 1 ? "lineage_parent_cycle" : "lineage_parent_unresolved";
    const detail = targets.size > 1
      ? "matches multiple normalized observations"
      : targets.size === 1
        ? "would create a self-parent cycle"
        : "does not match a normalized observation";
    bundle.issues.push({
      code,
      message: `Native parent lineage for observation ${observation.id} ${detail}; it remains hashed in adapter attributes.`,
      severity: "warning",
      source_id: bundle.sources[0]?.id,
      observation_id: observation.id,
    });
  }

  for (const observation of bundle.observations) {
    if (options?.agent_id) observation.agent_id = options.agent_id;
    if (options?.work_item_id) observation.work_item_id = options.work_item_id;
  }
  return bundle;
}

export function addObservationIssue(bundle: EvidenceBundle, issue: CoverageIssue, observationId?: string): void {
  bundle.issues.push({ ...issue, ...(observationId ? { observation_id: observationId } : {}) });
}

export function addModelObservation(args: {
  bundle: EvidenceBundle;
  harness: Harness;
  line: number;
  identity: string;
  operation: string;
  usage: Usage | null;
  sourceRecord: string;
  status?: Observation["status"];
  accountingScope?: Observation["accounting_scope"];
  timestamp?: string;
  endTime?: string;
  agentId?: string;
  sessionId?: string;
  turnId?: string;
  parentId?: string;
  traceId?: string;
  spanId?: string;
  provider?: string;
  model?: string;
  modelIdentity?: Observation["model_identity"];
  subjectId?: string;
  grain?: Observation["grain"];
  countBasis?: Observation["count_basis"];
  product?: string;
  workItemId?: string;
  attributes?: Attributes;
  recordedCost?: RecordedCost;
}): Observation {
  const sourceId = args.bundle.sources[0]?.id ?? "source";
  const id = observationId(args.harness, sourceId, args.identity);
  const attributes = attachNativeIdentity(args.attributes, args.identity);
  if (args.parentId) {
    // Parent IDs supplied by native adapters are usually native IDs, not
    // normalized observation IDs. Keep the native relationship hashed until
    // all observations exist, then resolve it only on an unambiguous match.
    const localParent = args.bundle.observations.some((candidate) => candidate.id === args.parentId);
    const looksLikeLocalId = args.parentId.startsWith(`${args.harness}:observation:`);
    if (localParent || looksLikeLocalId) {
      attributes[LINEAGE_PARENT_OBSERVATION] = args.parentId;
    } else {
      const candidateIds = [
        args.parentId,
        `response:${args.parentId}`,
        `message:${args.parentId}`,
        `tool:${args.parentId}`,
        `span:${args.parentId}`,
        `step:${args.parentId}`,
        `activity:${args.parentId}`,
        `usage:${args.parentId}`,
        `model-usage:${args.parentId}`,
        `aggregate:${args.parentId}`,
        `subagent:${args.parentId}`,
      ];
      attributes[LINEAGE_PARENT_HASH] = hashNativeId(args.parentId);
      attributes[LINEAGE_PARENT_HASHES] = candidateIds.map(hashNativeId).join(",");
    }
  }
  const observation: Observation = {
    id,
    source_refs: [sourceRef(sourceId, `${args.sourceRecord}:line:${args.line}`)],
    kind: "model",
    operation: args.operation,
    status: args.status ?? "ok",
    accounting_scope: args.accountingScope ?? "direct",
    usage: args.usage,
    ...(args.recordedCost ? { recorded_cost: args.recordedCost } : {}),
    ...(args.timestamp ? { timestamp: args.timestamp } : {}),
    ...(args.endTime ? { end_time: args.endTime } : {}),
    ...(args.agentId ? { agent_id: args.agentId } : {}),
    ...(args.sessionId ? { session_id: args.sessionId } : {}),
    ...(args.turnId ? { turn_id: args.turnId } : {}),
    ...(args.traceId ? { trace_id: args.traceId } : {}),
    ...(args.spanId ? { span_id: args.spanId } : {}),
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.modelIdentity ? { model_identity: args.modelIdentity } : {}),
    ...(args.subjectId ? { subject_id: args.subjectId } : {}),
    ...(args.grain ? { grain: args.grain } : {}),
    ...(args.countBasis ? { count_basis: args.countBasis } : {}),
    ...(args.product ? { product: args.product } : {}),
    ...(args.workItemId ? { work_item_id: args.workItemId } : {}),
    ...(attributes[LINEAGE_PARENT_OBSERVATION] && args.bundle.observations.some((candidate) => candidate.id === attributes[LINEAGE_PARENT_OBSERVATION])
      ? { parent_id: attributes[LINEAGE_PARENT_OBSERVATION] as string }
      : {}),
    attributes,
  };
  args.bundle.observations.push(observation);
  if (args.usage) {
    const input = args.usage.input_tokens === null ? null : BigInt(args.usage.input_tokens);
    const cacheRead = args.usage.cache_read_input_tokens === null ? 0n : BigInt(args.usage.cache_read_input_tokens);
    const cacheWrite = args.usage.cache_write_input_tokens === null ? 0n : BigInt(args.usage.cache_write_input_tokens);
    if (input !== null && cacheRead + cacheWrite > input) args.bundle.issues.push({ code: "invalid_usage_partition", message: `Observation ${id} has cache subsets larger than inclusive input.`, severity: "error", source_id: sourceId, observation_id: id });
    const output = args.usage.output_tokens === null ? null : BigInt(args.usage.output_tokens);
    const reasoning = args.usage.reasoning_output_tokens === null ? 0n : BigInt(args.usage.reasoning_output_tokens);
    if (output !== null && reasoning > output) args.bundle.issues.push({ code: "invalid_usage_partition", message: `Observation ${id} has reasoning larger than inclusive output.`, severity: "error", source_id: sourceId, observation_id: id });
  }
  return observation;
}

export function addToolObservation(args: {
  bundle: EvidenceBundle;
  harness: Harness;
  line: number;
  identity: string;
  operation: string;
  usage: Usage | null;
  sourceRecord: string;
  status?: Observation["status"];
  accountingScope?: Observation["accounting_scope"];
  timestamp?: string;
  endTime?: string;
  agentId?: string;
  sessionId?: string;
  turnId?: string;
  parentId?: string;
  subjectId?: string;
  grain?: Observation["grain"];
  countBasis?: Observation["count_basis"];
  product?: string;
  workItemId?: string;
  attributes?: Attributes;
}): Observation {
  const model = addModelObservation({ ...args, accountingScope: args.accountingScope ?? "unknown" });
  model.kind = "tool";
  return model;
}

export function addActivityObservation(args: {
  bundle: EvidenceBundle;
  harness: Harness;
  line: number;
  identity: string;
  operation: string;
  sourceRecord: string;
  status?: Observation["status"];
  accountingScope?: Observation["accounting_scope"];
  timestamp?: string;
  endTime?: string;
  agentId?: string;
  sessionId?: string;
  turnId?: string;
  parentId?: string;
  product?: string;
  workItemId?: string;
  attributes?: Attributes;
}): Observation {
  const model = addModelObservation({ ...args, usage: null });
  model.kind = "activity";
  return model;
}

export function inferStatus(value: unknown): Observation["status"] {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text.includes("cancel")) return "cancelled";
  if (text.includes("error") || text.includes("fail")) return "error";
  return "ok";
}

export function recordedCost(
  raw: Record<string, unknown> | undefined,
  basis: RecordedCost["basis"],
  defaultCurrency = "USD",
  issues?: CoverageIssue[],
  issueContext = "native cost",
): RecordedCost | undefined {
  if (!raw) return undefined;
  const nestedCost = asRecord(raw.cost) ?? asRecord(raw.recorded_cost) ?? asRecord(raw.recordedCost);
  const cost = nestedCost ?? raw;
  const amountValue = typeof raw.cost === "string" || typeof raw.cost === "number"
    ? raw.cost
    : firstNested(cost, [["total"], ["amount"], ["total_cost"], ["totalCost"]]);
  if (amountValue === undefined || amountValue === null) return undefined;
  let amount: string;
  if (typeof amountValue === "string") {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amountValue)) {
      issues?.push({ code: "invalid_cost_format", message: `${issueContext} has a non-canonical decimal amount and is unavailable.`, severity: "warning" });
      return undefined;
    }
    amount = amountValue;
  } else if (typeof amountValue === "number" && Number.isFinite(amountValue)) {
    const text = String(amountValue);
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) {
      issues?.push({ code: "numeric_cost_unavailable", message: `${issueContext} is not representable as a canonical decimal and is unavailable.`, severity: "warning" });
      return undefined;
    }
    const sign = match[1] ?? "";
    const whole = match[2] ?? "0";
    const fraction = match[3] ?? "";
    const exponent = Number(match[4] ?? "0");
    const digits = `${whole}${fraction}`;
    const decimalPosition = whole.length + exponent;
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100_000) {
      issues?.push({ code: "numeric_cost_unavailable", message: `${issueContext} has an unsupported exponent and is unavailable.`, severity: "warning" });
      return undefined;
    }
    if (decimalPosition <= 0) amount = `${sign}0.${"0".repeat(-decimalPosition)}${digits}`;
    else if (decimalPosition >= digits.length) amount = `${sign}${digits}${"0".repeat(decimalPosition - digits.length)}`;
    else amount = `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
    // JSON numbers have already passed through IEEE-754 parsing. The decimal
    // spelling is schema-valid, but its source precision is not independently
    // exact, so retain an explicit warning instead of presenting certainty.
    issues?.push({ code: "numeric_cost_precision", message: `${issueContext} was supplied as a JSON number; canonical decimal ${amount} is retained with a source-precision warning.`, severity: "warning" });
  } else return undefined;
  const currency = firstString(cost.currency, cost.currency_code, cost.currencyCode) ?? defaultCurrency;
  return { amount, currency, basis };
}

export const capability = (
  harness: Harness,
  formats: string[],
  testedVersions: string[],
  usage: string,
  lineage: string,
  limitations: string[],
): AdapterCapability => ({ harness, formats, tested_versions: testedVersions, usage, lineage, limitations });
