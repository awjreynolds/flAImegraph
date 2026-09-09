import { decimalCompare } from "./usage.js";
import type {
  UsageAccountingScope,
  UsageBundle,
  UsageCountBasis,
  UsageCoverage,
  UsageDecimal,
  UsageDimensionFact,
  UsageDimensions,
  UsageEvidence,
  UsageMeasurement,
  UsageMeasurementScope,
  UsageMeter,
  UsageMeterOverlap,
  UsageObservation,
  UsageScalar,
  UsageIssue,
  UsageSource,
  UsageSourceRef,
  UsageStatus,
  UsageTimestamp,
} from "./usage-types.js";

/** Formats accepted by the usage-only importer. */
export type UsageImportFormat =
  | "codex"
  | "codex-exec"
  | "claude"
  | "claude-transcript"
  | "pi"
  | "openai"
  | "anthropic"
  | "gemini"
  | "otel"
  | "otlp"
  | "usage"
  | "legacy"
  | "legacy-evidence"
  | (string & {});

export interface UsageImportOptions {
  format: UsageImportFormat;
  dataset_id: string;
  source_id?: string;
  source_format?: string;
  source_harness?: string;
  version?: string;
  source_description?: string;
  work_item_id?: string;
  agent_id?: string;
  session_id?: string;
  task_id?: string;
  collected_at?: string | number | bigint;
}

export interface LegacyEvidenceImportOptions extends Partial<Omit<UsageImportOptions, "format">> {
  format?: "legacy" | "legacy-evidence";
}

type JsonObject = Record<string, unknown>;
type RecordWithPath = { value: JsonObject; record: string; line?: number };
type ParseIssue = { line: number; message: string };
type ParsedRecords = RecordWithPath[] & { malformed: ParseIssue[] };

const CANONICAL_METERS: Record<string, UsageMeter> = {
  input_tokens: meter("input_tokens", "tokens", "Inclusive provider input tokens", null, "disjoint"),
  output_tokens: meter("output_tokens", "tokens", "Provider output tokens", null, "disjoint"),
  cache_read_input_tokens: meter("cache_read_input_tokens", "tokens", "Input tokens reported as cache reads", "input_tokens", "subset"),
  cache_write_input_tokens: meter("cache_write_input_tokens", "tokens", "Input tokens reported as cache writes", "input_tokens", "subset"),
  reasoning_output_tokens: meter("reasoning_output_tokens", "tokens", "Output tokens reported as reasoning", "output_tokens", "subset"),
  tool_calls: meter("tool_calls", "calls", "Provider or harness tool/search calls", null, "disjoint"),
  duration_ns: meter("duration_ns", "ns", "Observed duration in nanoseconds", null, "disjoint"),
};

function meter(id: string, unit: string, description: string, subset_of: string | null, overlap: UsageMeterOverlap): UsageMeter {
  return { id, unit, description, subset_of, overlap };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const result = stringValue(value);
    if (result !== null) return result;
  }
  return null;
}

function scalar(value: unknown): UsageScalar | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  // Programmatic producers may supply BigInt counters for exactness.  They
  // are normalized into measurements later, but still need a stable source
  // digest before that happens because JSON.stringify rejects BigInt values.
  if (typeof value === "bigint") return `${value.toString()}n`;
  return JSON.stringify(value) ?? "null";
}

/** A small synchronous SHA-256 implementation keeps importing browser-safe. */
function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const words = new Uint32Array(64);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const value = words[index - 15]!;
      const s0 = rotr(value, 7) ^ rotr(value, 18) ^ (value >>> 3);
      const previous = words[index - 2]!;
      const s1 = rotr(previous, 17) ^ rotr(previous, 19) ^ (previous >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = hash[0]!; let b = hash[1]!; let c = hash[2]!; let d = hash[3]!;
    let e = hash[4]!; let f = hash[5]!; let g = hash[6]!; let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0; hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0; hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0; hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0; hash[7] = (hash[7]! + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 80) || "unknown";
}

function stableId(namespace: string, identity: string): string {
  return `${sanitize(namespace)}:${sha256(`${namespace}\0${identity}`).slice(0, 32)}`;
}

/** Stable producer identity is independent of the artifact digest used for provenance. */
function observationId(options: { dataset_id: string }, format: string, identity: string, provider?: string | null, sourceId?: string, sourceScoped = false): string {
  const providerPart = provider === undefined || provider === null ? "" : `:${sanitize(provider)}`;
  const namespace = sourceScoped ? `usage-source:${sourceId ?? "unknown"}:${format}${providerPart}` : `usage:${options.dataset_id}:${format}${providerPart}`;
  return stableId(namespace, identity);
}

/** Expand a finite fractional Number into a schema-valid decimal spelling. */
function numberDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100_000) return null;
  const digits = `${whole}${fraction}`;
  const decimalPosition = whole.length + exponent;
  let result: string;
  if (decimalPosition <= 0) result = `0.${"0".repeat(-decimalPosition)}${digits}`;
  else if (decimalPosition >= digits.length) result = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  else result = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  // String(Number) never emits leading zeroes, but normalize the whole part
  // so the helper remains safe if its input handling changes later.
  return result.replace(/^0+(?=\d)/u, "") || "0";
}

function quantity(value: unknown): string | null {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || (Number.isInteger(value) && !Number.isSafeInteger(value))) return null;
    return Number.isInteger(value) ? String(value) : numberDecimal(value);
  }
  if (typeof value !== "string") return null;
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) ? value : null;
}

/** Normalize one producer quantity without exposing pricing or rate logic. */
export function normalizeUsageQuantity(value: unknown): string | null {
  return quantity(value);
}

function sourceRef(sourceId: string, record: string): UsageSourceRef {
  return { source_id: sourceId, record };
}

function method(path: string): string {
  // Record coordinates belong in source_refs.  Keeping line numbers out of
  // the method makes an exact JSONL replay semantically equal even when the
  // same record is appended at a different line offset.
  const stablePath = path.replace(/^(?:line|index|document):\d+(?=\/|$)/u, "");
  return `native ${stablePath || path}`;
}

function timestampParts(value: string): RegExpExecArray | null {
  return /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
}

function normalizeRfc3339(value: string): string | null {
  const match = timestampParts(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  if (!year || !month || !day || !hour || !minute || !second || !zone) return null;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  if (monthNumber < 1 || monthNumber > 12 || hourNumber > 23 || minuteNumber > 59 || secondNumber > 59) return null;
  const leapYear = yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1] ?? 0;
  if (dayNumber < 1 || dayNumber > daysInMonth) return null;
  let offset = 0;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offset = (offsetHour * 60 + offsetMinute) * 60 * 1000;
  }
  // Date.UTC treats years 0..99 as 1900..1999, so construct the base with a
  // parsed ISO string after validating every calendar component above.
  const base = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const parsed = Date.parse(base);
  if (!Number.isFinite(parsed)) return null;
  const baseDate = new Date(parsed);
  if (baseDate.getUTCFullYear() !== yearNumber || baseDate.getUTCMonth() + 1 !== monthNumber ||
    baseDate.getUTCDate() !== dayNumber || baseDate.getUTCHours() !== hourNumber ||
    baseDate.getUTCMinutes() !== minuteNumber || baseDate.getUTCSeconds() !== secondNumber) return null;
  const utc = zone === "Z" ? parsed : zone[0] === "+" ? parsed - offset : parsed + offset;
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19)}${fraction === undefined ? "" : `.${fraction}`}Z`;
}

function unixNanos(value: unknown): string | null {
  let nanos: bigint;
  try {
    if (typeof value === "bigint") nanos = value;
    else if (typeof value === "number" && Number.isSafeInteger(value)) nanos = BigInt(value);
    else if (typeof value === "string" && /^\d+$/u.test(value)) nanos = BigInt(value);
    else return null;
  } catch { return null; }
  if (nanos < 0n) return null;
  const millis = nanos / 1_000_000n;
  const rest = nanos % 1_000_000_000n;
  const date = new Date(Number(millis));
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19)}.${rest.toString().padStart(9, "0")}Z`;
}

/** Convert known source timestamp forms to UTC without truncating fractional digits. */
export function normalizeUsageTimestamp(value: unknown): string | null {
  if (typeof value === "string") return normalizeRfc3339(value) ?? unixNanos(value);
  if (typeof value === "number" || typeof value === "bigint") return unixNanos(value);
  if (isObject(value)) return normalizeUsageTimestamp(value.timeUnixNano ?? value.timestamp ?? value.value);
  return null;
}

function usageTimestamp(value: unknown, evidence: UsageEvidence, sourceId: string, record: string, label: string): UsageTimestamp | null {
  const normalized = normalizeUsageTimestamp(value);
  if (normalized === null) return value === null || value === undefined ? null : { value: null, evidence: "unknown", method: `${label} timestamp unavailable`, source_refs: [sourceRef(sourceId, record)] };
  return { value: normalized, evidence, method: `${label} timestamp`, source_refs: [sourceRef(sourceId, record)] };
}

function fact(value: unknown, evidence: UsageEvidence, sourceId: string, record: string, path: string): UsageDimensionFact | undefined {
  const valueAsScalar = scalar(value);
  if (valueAsScalar === undefined) return undefined;
  return { value: valueAsScalar, evidence: valueAsScalar === null ? "unknown" : evidence, method: method(path), source_refs: [sourceRef(sourceId, record)] };
}

function setIf(dimensions: UsageDimensions, key: keyof UsageDimensions, value: unknown, sourceId: string, record: string, path: string, evidence: UsageEvidence = "observed"): void {
  if (key === "extensions") return;
  const result = fact(value, evidence, sourceId, record, path);
  if (result !== undefined) (dimensions as Record<string, unknown>)[key] = result;
}

function setExtension(dimensions: UsageDimensions, key: string, value: unknown, sourceId: string, record: string, path: string, evidence: UsageEvidence = "observed"): void {
  if (!key.includes(".") || sensitiveKey(key) || /(?:^|[.:/_-])(amount|cost|currency|price|rate)(?:$|[.:/_-])/iu.test(key)) return;
  const result = fact(value, evidence, sourceId, record, path);
  if (result === undefined) return;
  dimensions.extensions = { ...(dimensions.extensions ?? {}), [key]: result };
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").toLowerCase();
  return /(?:^|_)(?:prompt|completion|content|messages?|body|header|authorization|auth|credential(?:s)?|access_token|bearer|api_key|secret|password|private_key|raw|result)(?:$|_)/u.test(normalized);
}

function pathValue(record: JsonObject, paths: string[][]): { value: unknown; path: string } | null {
  for (const path of paths) {
    let current: unknown = record;
    let valid = true;
    for (const key of path) {
      if (!isObject(current) || !(key in current)) { valid = false; break; }
      current = current[key];
    }
    if (valid && current !== undefined) return { value: current, path: `/${path.join("/")}` };
  }
  return null;
}

function addDimensionSet(dimensions: UsageDimensions, record: JsonObject, sourceId: string, recordRef: string, prefix = "", rootModel: "unknown" | "requested" | "actual" = "unknown"): void {
  const requested = asObject(record.request) ?? asObject(record.input) ?? asObject(record.request_descriptor);
  const response = asObject(record.response) ?? asObject(record.output) ?? asObject(record.response_descriptor);
  const requestSource = requested ?? record;
  const responseSource = response ?? record;
  const pairedRequestResponse = requested !== null;
  const requestPrefix = requested ? `${prefix}/request` : prefix || "/";
  const responsePrefix = response ? `${prefix}/response` : prefix || "/";
  const requestedModel = requested
    ? pathValue(requestSource, [["model"], ["model_name"], ["requested_model"], ["modelId"]])
    : rootModel === "requested" ? pathValue(record, [["requested_model"], ["model"], ["model_name"], ["modelId"]]) : null;
  const responseModel = pathValue(responseSource, pairedRequestResponse || response || rootModel === "actual" ? [["response_model"], ["responseModel"], ["actual_model"], ["model_version"], ["modelVersion"], ["model"]] : [["response_model"], ["responseModel"], ["actual_model"], ["model_version"], ["modelVersion"]]);
  const requestedProvider = requested ? pathValue(requestSource, [["provider"], ["provider_name"]]) : null;
  const responseProvider = response ? pathValue(responseSource, [["provider"], ["provider_name"]]) : null;
  const requestedTier = requested ? pathValue(requestSource, [["service_tier"], ["serviceTier"], ["requested_tier"], ["tier"]]) : null;
  const responseTier = pairedRequestResponse || response ? pathValue(responseSource, [["applied_service_tier"], ["appliedTier"], ["actual_tier"], ["response_service_tier"], ["service_tier"], ["serviceTier"]]) : pathValue(responseSource, [["applied_service_tier"], ["appliedTier"], ["actual_tier"], ["response_service_tier"]]);
  const requestedReasoning = requested ? pathValue(requestSource, [["reasoning", "effort"], ["reasoning_effort"], ["reasoningEffort"], ["thinking", "type"], ["thinking", "effort"]]) : null;
  const responseReasoning = pairedRequestResponse || response ? pathValue(responseSource, [["reasoning", "mode"], ["reasoning_mode"], ["thinking", "type"], ["thoughts"]]) : pathValue(responseSource, [["reasoning_mode"], ["actual_reasoning"]]);
  const requestedRegion = requested ? pathValue(requestSource, [["region"], ["requested_region"], ["location"]]) : null;
  const responseRegion = pairedRequestResponse || response ? pathValue(responseSource, [["region"], ["actual_region"], ["response_region"], ["location"]]) : pathValue(responseSource, [["actual_region"], ["response_region"]]);
  const cacheTtl = requested ? pathValue(requestSource, [["cache_ttl"], ["cache_ttl_seconds"], ["prompt_cache_retention"], ["cache_control", "ttl"], ["cache_control", "type"]]) : null;
  const service = pathValue(record, [["service"], ["service_name"], ["api_name"], ["gen_ai", "operation", "name"]]);
  const product = pathValue(record, [["product"], ["product_name"], ["service", "name"]]);
  const apiOperation = pathValue(record, [["operation"], ["operation_name"], ["api_operation"], ["gen_ai", "operation", "name"]]);
  setIf(dimensions, "requested_model", requestedModel?.value, sourceId, recordRef, `${requestPrefix}${requestedModel?.path ?? "/model"}`);
  setIf(dimensions, "actual_model", responseModel?.value, sourceId, recordRef, `${responsePrefix}${responseModel?.path ?? "/model"}`);
  if (requestedModel === null && responseModel === null) {
    const genericModel = pathValue(record, [["model"], ["model_name"], ["model_id"], ["modelId"]]);
    setIf(dimensions, "model", genericModel?.value, sourceId, recordRef, `${prefix}${genericModel?.path ?? "/model"}`);
  }
  setIf(dimensions, "requested_provider", requestedProvider?.value, sourceId, recordRef, `${requestPrefix}${requestedProvider?.path ?? "/provider"}`);
  setIf(dimensions, "actual_provider", responseProvider?.value, sourceId, recordRef, `${responsePrefix}${responseProvider?.path ?? "/provider"}`);
  if (requestedProvider === null && responseProvider === null) setIf(dimensions, "provider", record.provider ?? record.provider_name, sourceId, recordRef, `${prefix}/provider`);
  setIf(dimensions, "requested_tier", requestedTier?.value, sourceId, recordRef, `${requestPrefix}${requestedTier?.path ?? "/service_tier"}`);
  setIf(dimensions, "actual_tier", responseTier?.value, sourceId, recordRef, `${responsePrefix}${responseTier?.path ?? "/service_tier"}`);
  if (requestedTier === null && responseTier === null) setIf(dimensions, "tier", record.tier, sourceId, recordRef, `${prefix}/tier`);
  setIf(dimensions, "requested_reasoning", requestedReasoning?.value, sourceId, recordRef, `${requestPrefix}${requestedReasoning?.path ?? "/reasoning"}`);
  setIf(dimensions, "actual_reasoning", responseReasoning?.value, sourceId, recordRef, `${responsePrefix}${responseReasoning?.path ?? "/reasoning"}`);
  if (requestedReasoning === null && responseReasoning === null) setIf(dimensions, "reasoning", record.reasoning_mode, sourceId, recordRef, `${prefix}/reasoning_mode`);
  setIf(dimensions, "requested_region", requestedRegion?.value, sourceId, recordRef, `${requestPrefix}${requestedRegion?.path ?? "/region"}`);
  setIf(dimensions, "actual_region", responseRegion?.value, sourceId, recordRef, `${responsePrefix}${responseRegion?.path ?? "/region"}`);
  if (requestedRegion === null && responseRegion === null) setIf(dimensions, "region", record.region, sourceId, recordRef, `${prefix}/region`);
  setIf(dimensions, "cache_ttl", cacheTtl?.value, sourceId, recordRef, `${requestPrefix}${cacheTtl?.path ?? "/cache_ttl"}`);
  setIf(dimensions, "service", service?.value, sourceId, recordRef, `${prefix}${service?.path ?? "/service"}`);
  setIf(dimensions, "product", product?.value, sourceId, recordRef, `${prefix}${product?.path ?? "/product"}`);
  setIf(dimensions, "api_operation", apiOperation?.value, sourceId, recordRef, `${prefix}${apiOperation?.path ?? "/operation"}`);
  for (const [key, value] of Object.entries(record)) {
    if (!key.includes(".") || ["prompt", "completion", "input", "output"].includes(key)) continue;
    const valueAsScalar = scalar(value);
    if (valueAsScalar !== undefined) setExtension(dimensions, key, valueAsScalar, sourceId, recordRef, `${prefix}/${key}`);
  }
}

function parseJsonRecords(input: unknown): ParsedRecords {
  const malformed: ParseIssue[] = [];
  if (typeof input !== "string") {
    const records = Array.isArray(input)
      ? input.flatMap((item, index) => isObject(item) ? [{ value: item, record: `index:${index}`, line: index + 1 }] : (malformed.push({ line: index + 1, message: "non-object JSON record omitted" }), []))
      : isObject(input) ? [{ value: input, record: "document:1", line: 1 }] : [];
    if (!Array.isArray(input) && !isObject(input)) malformed.push({ line: 1, message: "JSON document is not an object" });
    return Object.assign(records, { malformed });
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) return Object.assign([], { malformed });
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const records = parsed.flatMap((item, index) => isObject(item) ? [{ value: item, record: `index:${index}`, line: index + 1 }] : (malformed.push({ line: index + 1, message: "non-object JSON record omitted" }), []));
      return Object.assign(records, { malformed });
    }
    if (isObject(parsed)) return Object.assign([{ value: parsed, record: "document:1", line: 1 }], { malformed });
    malformed.push({ line: 1, message: "JSON document is not an object" });
    return Object.assign([], { malformed });
  } catch { /* JSONL below. */ }
  const records = input.split(/\r?\n/u).flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    try {
      const parsed: unknown = JSON.parse(line);
      if (isObject(parsed)) return [{ value: parsed, record: `line:${index + 1}`, line: index + 1 }];
      malformed.push({ line: index + 1, message: "non-object JSONL record omitted" });
      return [];
    } catch { malformed.push({ line: index + 1, message: "malformed JSONL record omitted" }); return []; }
  });
  return Object.assign(records, { malformed });
}

function inputRecordRef(item: RecordWithPath, path = ""): string {
  return path ? `${item.record}${path}` : item.record;
}

function pickUsage(record: JsonObject): { value: JsonObject; path: string } | null {
  return pathValue(record, [["usage"], ["token_usage"], ["tokenUsage"], ["usageMetadata"], ["usage_metadata"], ["metrics"], ["tokens"]]) as { value: JsonObject; path: string } | null;
}

function contextKey(record: JsonObject): string | null {
  return firstString(record.response_id, record.responseId, record.request_id, record.requestId, record.turn_id, record.turnId, record.id, record.span_id, record.spanId);
}

function contextKeys(record: JsonObject): string[] {
  return [record.response_id, record.responseId, record.request_id, record.requestId, record.turn_id, record.turnId, record.id, record.span_id, record.spanId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/** Resolve the caller's dataset-scoped work identifier without relabeling native evidence. */
function workItemId(options: { work_item_id?: string }, ...records: Array<JsonObject | null | undefined>): string | null {
  const values = new Set<string>();
  const candidates: JsonObject[] = [];
  for (const record of records) {
    if (!record) continue;
    candidates.push(record);
    for (const key of ["context", "metadata", "attributes", "resource", "labels"]) {
      const nested = asObject(record[key]);
      if (nested) candidates.push(nested);
    }
  }
  for (const record of candidates) {
    const value = firstString(record.work_item_id, record.workItemId, record.work_item, record.workItem, record["flAImegraph.work_item_id"], record["flAImegraph.workItemId"], record["gen_ai.work_item_id"], record["gen_ai.workItemId"]);
    if (value !== null) values.add(value);
  }
  if (values.size > 1) throw new Error("conflicting native work_item_id values cannot be reconciled");
  const native = [...values][0] ?? null;
  if (options.work_item_id !== undefined && native !== null && options.work_item_id !== native) {
    throw new Error("supplied work_item_id contradicts the native source mapping");
  }
  return native ?? options.work_item_id ?? null;
}

function rawStatus(record: JsonObject): UsageStatus {
  const value = firstString(record.status, record.stop_reason, record.stopReason, record.finishReason, record.finish_reason)?.toLowerCase();
  if (record.error !== undefined || value === "error" || value === "failed") return "error";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value === "running" || value === "in_progress") return "running";
  if (value === "ok" || value === "completed" || value === "complete" || value === "stop" || value === "end_turn" || value === "ok" || value === "1") return "ok";
  return "unknown";
}

function accountingScope(record: JsonObject, fallback: UsageAccountingScope = "direct"): UsageAccountingScope {
  const value = firstString(record.accounting_scope, record.accountingScope, record.scope);
  if (value === "aggregate" || value === "snapshot" || value === "unknown" || value === "direct") return value;
  return fallback;
}

function countBasis(record: JsonObject): UsageCountBasis {
  const value = firstString(record.count_basis, record.countBasis, record.basis);
  if (value === "consumed" || value === "billable" || value === "allocated" || value === "unknown" || value === "provider_native") return value;
  return "provider_native";
}

function meterIdForNative(format: string, provider: string | null, key: string): string {
  return `provider_${sanitize(provider ?? format)}_${sanitize(key)}`;
}

function addMeter(meters: Map<string, UsageMeter>, id: string, unit: string, description: string, subset_of: string | null = null, overlap: UsageMeterOverlap = "unknown"): void {
  if (!meters.has(id)) meters.set(id, meter(id, unit, description, subset_of, overlap));
}

function unitForKey(key: string): string {
  if (/_tokens?$|tokens?$/iu.test(key)) return "tokens";
  if (/(?:duration|latency).*ns|nanoseconds?/iu.test(key)) return "ns";
  if (/(?:duration|latency).*ms|milliseconds?/iu.test(key)) return "ms";
  if (/(?:bytes|images?|audio|video|calls?|requests?|credits?|units?)/iu.test(key)) return key.includes("token") ? "tokens" : "count";
  return "count";
}

function canonicalUsageKey(key: string): string | null {
  const normalized = key.replace(/[-.]/gu, "_").toLowerCase();
  const aliases: Record<string, string> = {
    input: "input_tokens", input_tokens: "input_tokens", prompt_tokens: "input_tokens", prompt: "input_tokens", prompttokencount: "input_tokens", inputtokens: "input_tokens",
    output: "output_tokens", output_tokens: "output_tokens", completion_tokens: "output_tokens", completion: "output_tokens", candidatestokencount: "output_tokens", outputtokens: "output_tokens", completiontokens: "output_tokens",
    cached: "cache_read_input_tokens", cached_input_tokens: "cache_read_input_tokens", cache_read: "cache_read_input_tokens", cache_read_input_tokens: "cache_read_input_tokens", cache_read_tokens: "cache_read_input_tokens", cached_content_token_count: "cache_read_input_tokens", cachedcontenttokencount: "cache_read_input_tokens", cacheread: "cache_read_input_tokens", cachereadinputtokens: "cache_read_input_tokens",
    cache_write: "cache_write_input_tokens", cache_write_input_tokens: "cache_write_input_tokens", cache_creation_input_tokens: "cache_write_input_tokens", cache_write_tokens: "cache_write_input_tokens", cachewrite: "cache_write_input_tokens", cachewriteinputtokens: "cache_write_input_tokens",
    reasoning: "reasoning_output_tokens", reasoning_output_tokens: "reasoning_output_tokens", reasoning_tokens: "reasoning_output_tokens", thoughts: "reasoning_output_tokens", thoughts_token_count: "reasoning_output_tokens", thoughtstokencount: "reasoning_output_tokens", reasoningoutputtokens: "reasoning_output_tokens",
    tool_calls: "tool_calls", tool_call_count: "tool_calls", toolcalls: "tool_calls", search_requests: "tool_calls",
    duration_ns: "duration_ns", duration_nanos: "duration_ns", duration_nanoseconds: "duration_ns", durationns: "duration_ns",
  };
  return aliases[normalized] ?? null;
}

function nativeUsageValue(usage: JsonObject, names: string[]): { present: boolean; value: unknown } {
  for (const name of names) if (name in usage) return { present: true, value: usage[name] };
  return { present: false, value: null };
}

/** Pi and Anthropic expose fresh input separately from cache subsets. */
function normalizeExclusiveInput(usage: JsonObject | null, format: string, provider: string | null, sourceId: string, recordRef: string, usagePath: string, measurements: Record<string, UsageMeasurement>, meters: Map<string, UsageMeter>, accounting: UsageAccountingScope, scope: UsageMeasurementScope, count: UsageCountBasis): JsonObject | null {
  if (!usage || (format !== "pi" && format !== "anthropic")) return usage;
  const input = nativeUsageValue(usage, ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]);
  if (!input.present) return usage;
  const read = nativeUsageValue(usage, ["cacheRead", "cache_read_input_tokens", "cacheReadInputTokens", "cache_read", "cache_read_tokens"]);
  const write = nativeUsageValue(usage, ["cacheWrite", "cache_write_input_tokens", "cacheWriteInputTokens", "cache_creation_input_tokens", "cacheWriteInputTokens", "cache_write_tokens"]);
  const rawInput = quantity(input.value);
  // Keep the native exclusive counter available under its provider namespace.
  addMeasurement(measurements, meters, meterIdForNative(format, provider, "input_exclusive"), input.value, sourceId, recordRef, `${usagePath}/input`, scope, accounting, count, "tokens", null);
  const rawRead = quantity(read.value);
  const rawWrite = quantity(write.value);
  if (!read.present || !write.present || rawInput === null || rawRead === null || rawWrite === null || !/^(?:0|[1-9]\d*)$/u.test(rawInput) || !/^(?:0|[1-9]\d*)$/u.test(rawRead) || !/^(?:0|[1-9]\d*)$/u.test(rawWrite)) {
    return { ...usage, input: null, input_tokens: null, prompt_tokens: null, inputTokens: null, promptTokens: null };
  }
  const inclusive = (BigInt(rawInput) + BigInt(rawRead) + BigInt(rawWrite)).toString();
  return { ...usage, input: inclusive, input_tokens: inclusive, prompt_tokens: inclusive, inputTokens: inclusive, promptTokens: inclusive };
}

function addMeasurement(
  measurements: Record<string, UsageMeasurement>, meters: Map<string, UsageMeter>, id: string, value: unknown, sourceId: string, recordRef: string, path: string,
  scope: UsageMeasurementScope, accounting: UsageAccountingScope, count: UsageCountBasis, unit = "count", subset: string | null = null,
): void {
  const normalized = quantity(value);
  const isKnownValue = value !== null && value !== undefined;
  const measurement: UsageMeasurement = {
    value: normalized,
    evidence: normalized === null && isKnownValue ? "unknown" : normalized === null ? "unknown" : "observed",
    method: method(path),
    source_refs: [sourceRef(sourceId, recordRef)],
    count_basis: count,
    aggregation: accounting === "snapshot" ? "cumulative" : accounting === "aggregate" ? "unknown" : "delta",
    scope,
  };
  measurements[id] = measurement;
  const definition = CANONICAL_METERS[id];
  if (definition) meters.set(id, definition);
  else addMeter(meters, id, unit, `Native ${path} measurement`, subset, subset === null ? "unknown" : "subset");
}

function addUsageMeasurements(
  measurements: Record<string, UsageMeasurement>, meters: Map<string, UsageMeter>, usage: JsonObject | null, format: string, provider: string | null,
  sourceId: string, recordRef: string, usagePath: string, accounting: UsageAccountingScope, scope: UsageMeasurementScope = accounting === "snapshot" ? "snapshot" : "event", count: UsageCountBasis = "provider_native",
): void {
  if (!usage) return;
  const seen = new Set<string>();
  const walk = (value: JsonObject, prefix: string): void => {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2");
      if ((sensitiveKey(key) && canonicalUsageKey(key) === null) || /(?:^|[.:/_-])(?:cost|price|currency|rate|amount)(?:$|[.:/_-])/iu.test(normalizedKey)) continue;
      const path = `${prefix}/${key}`;
      if (isObject(nested)) { walk(nested, path); continue; }
      const normalized = canonicalUsageKey(key);
      const numeric = quantity(nested);
      if (normalized !== null) {
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        const sourcePath = `${usagePath}${path}`;
        const conversion = normalized === "duration_ns" ? "ns" : normalized.endsWith("tokens") ? "tokens" : "count";
        addMeasurement(measurements, meters, normalized, nested, sourceId, recordRef, sourcePath, scope, accounting, count, conversion,
          normalized === "cache_read_input_tokens" || normalized === "cache_write_input_tokens" ? "input_tokens" : normalized === "reasoning_output_tokens" ? "output_tokens" : null);
        continue;
      }
      if (numeric !== null || nested === null) {
        const id = meterIdForNative(format, provider, key);
        addMeasurement(measurements, meters, id, nested, sourceId, recordRef, `${usagePath}${path}`, scope, accounting, count, unitForKey(key));
      }
    }
  };
  walk(usage, "");
}

function descriptorForRecord(record: JsonObject, format: string, sourceId: string, recordRef: string, rootModel: "unknown" | "requested" | "actual" = "unknown"): UsageDimensions {
  const dimensions: UsageDimensions = {};
  addDimensionSet(dimensions, record, sourceId, recordRef, `/${format}`, rootModel);
  return dimensions;
}

function baseObservation(input: {
  id: string; sourceId: string; recordRef: string; subject: string | null; accounting: UsageAccountingScope; operationId?: string | null; parentId?: string | null;
  agentId?: string | null; sessionId?: string | null; workItemId?: string | null; taskId?: string | null; status?: UsageStatus;
  event?: unknown; started?: unknown; ended?: unknown; collected?: unknown; measurements?: Record<string, UsageMeasurement>; dimensions?: UsageDimensions;
}): UsageObservation {
  const timestamp = (value: unknown, label: string): UsageTimestamp | null => usageTimestamp(value, "observed", input.sourceId, input.recordRef, label);
  return {
    id: input.id,
    source_refs: [sourceRef(input.sourceId, input.recordRef)],
    subject: input.subject ?? null,
    accounting_scope: input.accounting,
    operation_id: input.operationId ?? null,
    parent_id: input.parentId ?? null,
    agent_id: input.agentId ?? null,
    session_id: input.sessionId ?? null,
    work_item_id: input.workItemId ?? null,
    task_id: input.taskId ?? null,
    status: input.status ?? "unknown",
    event_at: input.event === undefined ? null : timestamp(input.event, "event"),
    started_at: input.started === undefined ? null : timestamp(input.started, "start"),
    ended_at: input.ended === undefined ? null : timestamp(input.ended, "end"),
    collected_at: input.collected === undefined ? null : timestamp(input.collected, "collection"),
    measurements: input.measurements ?? {},
    dimensions: input.dimensions ?? {},
  };
}

function normalizeOptions(options: UsageImportOptions): Required<Pick<UsageImportOptions, "format" | "dataset_id">> & UsageImportOptions {
  if (!isObject(options) || typeof options.dataset_id !== "string" || options.dataset_id.length === 0) throw new TypeError("usage import dataset_id must be a non-empty string");
  if (typeof options.format !== "string" || options.format.length === 0) throw new TypeError("usage import format must be a non-empty string");
  if (options.work_item_id !== undefined && (typeof options.work_item_id !== "string" || options.work_item_id.length === 0)) throw new TypeError("usage import work_item_id must be a non-empty string");
  return options as Required<Pick<UsageImportOptions, "format" | "dataset_id">> & UsageImportOptions;
}

function makeSource(input: unknown, options: UsageImportOptions, harness: string, format: string, records: number, malformed = 0): UsageSource {
  const sourceId = options.source_id ?? `source-${sha256(typeof input === "string" ? input : canonicalJson(input)).slice(0, 24)}`;
  return {
    id: sourceId,
    harness: options.source_harness ?? harness,
    format: options.source_format ?? format,
    ...(options.version ? { version: options.version } : {}),
    sha256: sha256(typeof input === "string" ? input : canonicalJson(input)),
    coverage: malformed > 0 ? "partial" : records > 0 ? "complete" : "unknown",
    description: options.source_description ?? `Usage-only ${format} source; ${records} accepted record${records === 1 ? "" : "s"}.`,
  };
}

function emptyBundle(input: unknown, options: UsageImportOptions, harness: string, format = options.format): UsageBundle & { meters: UsageMeter[] } {
  const records = parseJsonRecords(input);
  const source = makeSource(input, options, harness, format, records.length, records.malformed.length);
  const issues: UsageIssue[] = records.malformed.map((item) => ({ code: "MALFORMED_JSON_RECORD", message: item.message, severity: "warning", source_id: source.id }));
  const coverage: UsageCoverage = {
    boundary: "native_transcript",
    complete: false,
    dropped_observations: records.malformed.length,
    ...(records.malformed.length > 0 ? { dropped_by_source: { [source.id]: records.malformed.length } } : {}),
    limitations: ["Importer coverage is limited to the supplied native/export records; hidden retries and provider-side work remain unknown.", ...(records.malformed.length > 0 ? [`${records.malformed.length} malformed JSON record(s) were omitted.`] : [])],
  };
  return {
    schema_version: "0.4.0",
    dataset_id: options.dataset_id,
    sources: [source],
    meters: [],
    observations: [],
    coverage,
    ...(issues.length > 0 ? { issues } : {}),
  };
}

function dedupeObservations(observations: UsageObservation[]): UsageObservation[] {
  const byId = new Map<string, UsageObservation>();
  for (const observation of observations) {
    const previous = byId.get(observation.id);
    if (!previous) { byId.set(observation.id, observation); continue; }
    const stripRefs = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripRefs);
      if (isObject(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source_refs").map(([key, item]) => [key, stripRefs(item)]));
      return value;
    };
    if (canonicalJson(stripRefs(previous)) !== canonicalJson(stripRefs(observation))) {
      throw new Error(`Conflicting usage observations share stable ID ${observation.id}`);
    }
    const mergeRefs = (left: unknown, right: unknown): unknown => {
      if (Array.isArray(left) && Array.isArray(right)) {
        const refs = [...left, ...right].filter(isObject);
        const unique = new Map(refs.map((ref) => [canonicalJson(ref), ref]));
        return [...unique.values()];
      }
      if (isObject(left) && isObject(right)) {
        const result: JsonObject = { ...left };
        for (const [key, value] of Object.entries(right)) result[key] = key === "source_refs" ? mergeRefs(result[key], value) : mergeRefs(result[key], value);
        return result;
      }
      return left ?? right;
    };
    byId.set(observation.id, mergeRefs(previous, observation) as UsageObservation);
  }
  return [...byId.values()];
}

function remapParents(observations: UsageObservation[], nativeIds: Map<string, string>): void {
  for (const observation of observations) {
    if (observation.parent_id !== null) observation.parent_id = nativeIds.get(observation.parent_id) ?? observation.parent_id;
  }
}

function codex(input: unknown, options: UsageImportOptions): UsageBundle {
  const rows = parseJsonRecords(input);
  const bundle = emptyBundle(input, options, "codex", "codex-rollout-jsonl");
  const sourceId = bundle.sources[0]!.id;
  const meters = new Map<string, UsageMeter>();
  const observations: UsageObservation[] = [];
  const nativeIds = new Map<string, string>();
  const contexts = new Map<string, JsonObject>();
  let sourceScopedFallbacks = 0;
  let sessionId = options.session_id ?? null;
  for (const item of rows) {
    const record = item.value;
    const payload = asObject(record.payload) ?? record;
    const type = firstString(record.type, payload.type)?.toLowerCase() ?? "";
    if (type === "session_meta") { sessionId = firstString(payload.session_id, payload.sessionId, payload.id) ?? sessionId; continue; }
    if (type === "turn_context" || type === "request_context") {
      for (const key of contextKeys(payload)) contexts.set(key, payload);
      continue;
    }
  }
  for (const item of rows) {
    const record = item.value;
    const payload = asObject(record.payload) ?? record;
    const type = firstString(record.type, payload.type)?.toLowerCase() ?? "";
    if (type === "session_meta" || type === "turn_context" || type === "request_context") continue;
    const usageRecord = (type === "token_usage_record" || type === "response_usage" || type === "usage_record") ? payload : record;
    if (type === "event_msg" && firstString(payload.type)?.toLowerCase() === "token_count") {
      const info = asObject(payload.info) ?? asObject(record.info) ?? {};
      const snapshots: Array<[string, JsonObject | null, UsageAccountingScope]> = [
        ["last", asObject(info.last_token_usage) ?? asObject(info.lastTokenUsage), "snapshot"],
        ["total", asObject(info.total_token_usage) ?? asObject(info.totalTokenUsage), "aggregate"],
      ];
      for (const [kind, usage, accounting] of snapshots) {
        if (!usage) continue;
        const thread = firstString(payload.thread_id, payload.threadId, record.thread_id, record.threadId) ?? sessionId ?? "unknown";
        const turn = firstString(payload.turn_id, payload.turnId, record.turn_id, record.turnId) ?? "unknown";
        const eventIdentity = firstString(
          payload.event_id, payload.eventId, record.event_id, record.eventId,
          payload.record_id, payload.recordId, record.record_id, record.recordId,
          payload.id, record.id, payload.timestamp, record.timestamp, payload.time, record.time,
        ) ?? `digest:${sha256(canonicalJson({ thread, turn, kind, usage }))}`;
        const native = `snapshot:${thread}:${turn}:${kind}:${eventIdentity}`;
        const id = observationId(options, "codex", native);
        const measurements: Record<string, UsageMeasurement> = {};
        addUsageMeasurements(measurements, meters, usage, "codex", "openai", sourceId, item.record, `${item.record}/payload/info/${kind}`, accounting, "snapshot");
        const dimensions = descriptorForRecord({ ...record, ...payload }, "codex", sourceId, item.record);
        observations.push(baseObservation({ id, sourceId, recordRef: item.record, subject: "model.token_count", accounting, operationId: native, sessionId: firstString(payload.session_id, record.session_id, sessionId), taskId: options.task_id, workItemId: workItemId(options, record, payload), event: record.timestamp ?? payload.timestamp, measurements, dimensions }));
        nativeIds.set(native, id);
      }
      continue;
    }
    const rawUsage = asObject(usageRecord.usage) ?? asObject(usageRecord.token_usage) ?? null;
    const hasUsage = rawUsage !== null;
    const hasResponse = type === "token_usage_record" || type === "response_usage" || type === "usage_record" || hasUsage;
    const nativeIdentity = firstString(usageRecord.response_id, usageRecord.responseId, usageRecord.request_id, usageRecord.requestId, usageRecord.id);
    const native = nativeIdentity ?? `line:${item.line ?? item.record}`;
    if (hasResponse) {
      const id = observationId(options, "codex", native, undefined, sourceId, nativeIdentity === null);
      if (nativeIdentity === null) sourceScopedFallbacks += 1;
      const matchingContext = contextKeys(usageRecord).map((key) => contexts.get(key)).find((value): value is JsonObject => value !== undefined);
      const combined = matchingContext
        ? { ...record, ...payload, request: matchingContext }
        : { ...record, ...payload };
      const provider = firstString(usageRecord.provider, payload.provider, record.provider) ?? "openai";
      const measurements: Record<string, UsageMeasurement> = {};
      addUsageMeasurements(measurements, meters, rawUsage, "codex", provider, sourceId, item.record, `${item.record}/payload/usage`, "direct");
      const dimensions = descriptorForRecord(combined, "codex", sourceId, item.record);
      const observation = baseObservation({ id, sourceId, recordRef: item.record, subject: "model.response", accounting: accountingScope(usageRecord), operationId: native, parentId: firstString(usageRecord.parent_id, usageRecord.parentId, usageRecord.parent_thread_id), agentId: firstString(usageRecord.agent_id, usageRecord.agentId), sessionId: firstString(usageRecord.session_id, usageRecord.sessionId, usageRecord.thread_id, usageRecord.threadId, sessionId), taskId: options.task_id, workItemId: workItemId(options, record, payload, usageRecord, matchingContext), status: rawStatus(usageRecord), event: record.timestamp ?? record.time ?? usageRecord.timestamp ?? usageRecord.time, started: usageRecord.started_at ?? usageRecord.startedAt ?? record.started_at ?? record.startedAt, ended: usageRecord.end_time ?? usageRecord.ended_at ?? usageRecord.endedAt ?? record.end_time ?? record.ended_at ?? record.endedAt, collected: options.collected_at, measurements, dimensions });
      observations.push(observation);
      nativeIds.set(native, id);
      continue;
    }
    if (type === "response_item" || type === "tool_call" || type === "tool_use" || type === "tool_result" || type === "toolresult") {
      const itemPayload = asObject(payload.item) ?? payload;
      const itemType = (firstString(itemPayload.type, payload.type, record.item_type, record.itemType, type) ?? "").toLowerCase();
      const callTypes = new Set(["function_call", "custom_tool_call", "web_search_call", "mcp_tool_call", "computer_call", "tool_search_call", "local_shell_call", "tool_call", "tool_use"]);
      const outputTypes = new Set(["function_call_output", "custom_tool_call_output", "local_shell_call_output", "tool_result", "tool_output", "toolresult"]);
      const isCall = callTypes.has(itemType);
      const isOutput = outputTypes.has(itemType);
      // Codex response_item also carries messages and reasoning items.  Their
      // IDs identify transcript artifacts, so they are not tool observations.
      if (!isCall && !isOutput) continue;
      const callId = firstString(itemPayload.call_id, itemPayload.callId, payload.call_id, payload.callId, record.call_id, record.callId);
      const outputId = firstString(itemPayload.output_id, itemPayload.outputId, itemPayload.id, payload.output_id, payload.outputId, record.output_id, record.outputId, record.id);
      const nativeId = isCall ? callId : outputId ?? callId;
      if (nativeId === null) continue;
      const native = isCall ? `tool-call:${nativeId}` : `tool-output:${nativeId}`;
      const id = observationId(options, "codex", native);
      const toolName = firstString(itemPayload.name, payload.name, record.name, itemPayload.tool_name, payload.tool_name, record.tool_name) ?? "unknown";
      const toolUsage = asObject(itemPayload.usage) ?? asObject(payload.usage) ?? asObject(record.usage);
      const measurements: Record<string, UsageMeasurement> = {};
      addUsageMeasurements(measurements, meters, toolUsage, "codex", "openai", sourceId, item.record, `${item.record}/payload/usage`, "direct");
      const parentId = isOutput && callId !== null
        ? `tool-call:${callId}`
        : firstString(itemPayload.parent_id, payload.parent_id, record.parent_id, itemPayload.response_id, payload.response_id, record.response_id);
      const status = isCall && itemType !== "local_shell_call" ? "running" : rawStatus({ ...record, ...payload, ...itemPayload });
      observations.push(baseObservation({ id, sourceId, recordRef: item.record, subject: `tool.${sanitize(toolName)}`, accounting: "direct", operationId: native, parentId, sessionId: firstString(itemPayload.session_id, payload.session_id, record.session_id, sessionId), taskId: options.task_id, workItemId: workItemId(options, record, payload, itemPayload), status, event: record.timestamp ?? payload.timestamp ?? itemPayload.timestamp, collected: options.collected_at, measurements, dimensions: descriptorForRecord({ ...record, ...payload, ...itemPayload }, "codex", sourceId, item.record) }));
      nativeIds.set(native, id);
      if (isCall) nativeIds.set(`tool-call:${nativeId}`, id);
    }
  }
  remapParents(observations, nativeIds);
  bundle.observations = dedupeObservations(observations);
  bundle.meters = [...meters.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (sourceScopedFallbacks > 0) bundle.coverage?.limitations.push(`${sourceScopedFallbacks} Codex observation(s) lacked a stable native identity and remain source-scoped.`);
  if (bundle.sources[0] && bundle.observations.length === 0 && rows.length > 0) bundle.sources[0].coverage = "partial";
  if (bundle.coverage) bundle.coverage.limitations.push("Legacy token_count snapshots are retained as non-additive evidence.");
  return bundle;
}

function pi(input: unknown, options: UsageImportOptions): UsageBundle {
  const rows = parseJsonRecords(input);
  const bundle = emptyBundle(input, options, "pi", "pi-jsonl");
  const sourceId = bundle.sources[0]!.id;
  const meters = new Map<string, UsageMeter>();
  const observations: UsageObservation[] = [];
  const nativeIds = new Map<string, string>();
  let sessionId = options.session_id ?? null;
  const entries = new Map<string, JsonObject>();
  const durableUsageEntryIds = new Set<string>();
  let sourceScopedFallbacks = 0;
  // Pi Message.timestamp is milliseconds since the Unix epoch. Generic
  // normalization accepts explicit nanoseconds for OTLP and SDK callers.
  const piTime = (value: unknown): unknown => typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) * 1_000_000n : value;
  const entryFor = (record: JsonObject): JsonObject | null => {
    if (record.type === "message_end") {
      const message = asObject(record.message);
      return message ? { ...record, id: firstString(message.responseId, message.response_id), message } : null;
    }
    return asObject(record.entry) ?? (record.type === "message" || record.kind === "message" ? record : null);
  };
  for (const item of rows) {
    const record = item.value;
    sessionId = firstString(record.sessionId, record.session_id, record.type === "session" ? record.id : null, sessionId) ?? sessionId;
    const writes = Array.isArray(record.writes) ? record.writes : [];
    for (const write of writes) {
      const object = asObject(write);
      const entry = object ? asObject(object.entry) : null;
      if (entry) { const id = firstString(entry.id, entry.entryId, entry.entry_id); if (id) entries.set(id, entry); }
      if (object && firstString(object.kind)?.toLowerCase() === "usage") {
        const row = asObject(object.row);
        const id = row ? firstString(row.entryId, row.entry_id) : null;
        if (id) durableUsageEntryIds.add(id);
      }
    }
    const entry = entryFor(record);
    if (entry) { const id = firstString(entry.id, entry.entryId, entry.entry_id); if (id) entries.set(id, entry); }
  }
  const process = (raw: JsonObject, item: RecordWithPath, accounting: UsageAccountingScope, subject = "model.response", identityOverride?: string, parentOverride?: string | null): string => {
    const message = asObject(raw.message) ?? raw;
    const usage = asObject(raw.usage) ?? asObject(message.usage) ?? asObject(raw.token_usage);
    const provider = firstString(message.provider, raw.provider);
    const nativeIdentity = identityOverride ?? firstString(raw.id, raw.usageId, raw.usage_id, raw.response_id, raw.responseId, message.id, message.responseId, message.response_id);
    const native = nativeIdentity ?? `line:${item.line ?? item.record}`;
    const sourceScoped = nativeIdentity === null || (identityOverride !== undefined && identityOverride.startsWith("totals:"));
    const id = observationId(options, "pi", native, provider, sourceId, sourceScoped);
    if (sourceScoped) sourceScopedFallbacks += 1;
    const measurements: Record<string, UsageMeasurement> = {};
    const normalizedUsage = normalizeExclusiveInput(usage, "pi", provider, sourceId, item.record, `${item.record}/usage`, measurements, meters, accounting, accounting === "snapshot" ? "snapshot" : "event", "provider_native");
    addUsageMeasurements(measurements, meters, normalizedUsage, "pi", provider, sourceId, item.record, `${item.record}/usage`, accounting, accounting === "snapshot" ? "snapshot" : "event");
    const dimensions = descriptorForRecord({ ...raw, ...message }, "pi", sourceId, item.record, "requested");
    const observation = baseObservation({ id, sourceId, recordRef: item.record, subject, accounting, operationId: native, parentId: parentOverride ?? firstString(raw.parent_id, raw.parentId, message.parent_id, message.parentId), agentId: firstString(raw.agent_id, raw.agentId, message.agent_id, message.agentId), sessionId: firstString(raw.session_id, raw.sessionId, message.session_id, message.sessionId, sessionId), taskId: options.task_id, workItemId: workItemId(options, raw, message), status: rawStatus({ ...raw, ...message }), event: piTime(raw.timestamp ?? raw.time ?? message.timestamp), started: piTime(raw.started_at ?? raw.startedAt), ended: piTime(raw.ended_at ?? raw.endedAt), collected: options.collected_at, measurements, dimensions });
    observations.push(observation);
    nativeIds.set(native, id);
    return id;
  };
  for (const item of rows) {
    const record = item.value;
    const writes = Array.isArray(record.writes) ? record.writes : [];
    for (const write of writes) {
      const object = asObject(write);
      if (!object) continue;
      const row = asObject(object.row);
      const entry = asObject(object.entry);
      const kind = firstString(object.kind)?.toLowerCase();
      const linkedEntry = row ? entries.get(firstString(row.entryId, row.entry_id) ?? "") : undefined;
      if (kind === "usage" && row) {
        workItemId(options, linkedEntry, row);
        const id = process({ ...linkedEntry, ...row, ...(linkedEntry ? { message: linkedEntry.message } : {}) }, item, "direct", "model.response", `usage:${firstString(row.id, row.usageId, row.usage_id, row.entryId) ?? `line:${item.line}`}`, firstString(row.parent_id, row.parentId));
        const entryId = firstString(row.entryId, row.entry_id);
        if (entryId) nativeIds.set(entryId, id);
      }
      if (object.totals && isObject(object.totals)) {
        workItemId(options, linkedEntry, object.totals);
        const totalIdentity = firstString(object.total_id, object.totalId, row?.total_id, row?.totalId) ?? `digest:${sha256(canonicalJson(object.totals))}`;
        process({ ...linkedEntry, ...object.totals, ...(linkedEntry ? { message: linkedEntry.message } : {}) }, item, "snapshot", "model.usage_totals", `totals:${sessionId ?? "unknown"}:${totalIdentity}`);
      }
      if (entry) {
        const message = asObject(entry.message) ?? entry;
        if (firstString(message.role)?.toLowerCase() === "assistant" && !row && !durableUsageEntryIds.has(firstString(entry.id, entry.entryId, entry.entry_id) ?? "")) process(entry, item, "direct");
      }
    }
    const entry = entryFor(record);
    if (entry) {
      const message = asObject(entry.message) ?? entry;
      const role = firstString(message.role)?.toLowerCase();
      if (role === "assistant") process(entry, item, "direct");
    }
    const type = firstString(record.type, record.kind)?.toLowerCase();
    if (type === "assistant" && !entry) process(record, item, "direct");
    if (type === "toolresult" || type === "tool_result") process(record, item, "direct", `tool.${firstString(record.tool_name, record.toolName) ?? "unknown"}`);
  }
  // Entries in both legacy history and durable transactions can contain tools.
  // A tool call is distinct from its model response and from its later result.
  for (const item of rows) {
    const record = item.value;
    const writes = Array.isArray(record.writes) ? record.writes : [];
    const toolEntries = [entryFor(record), ...writes.map(write => asObject(asObject(write)?.entry))];
    for (const entry of toolEntries) {
      if (!entry) continue;
      const message = asObject(entry.message) ?? entry;
      const content = Array.isArray(message.content) ? message.content : [];
      for (const [index, block] of content.entries()) {
        const tool = asObject(block);
        if (!tool || !["toolcall", "tool_call", "tool_use"].includes((firstString(tool.type) ?? "").toLowerCase())) continue;
        const callId = firstString(tool.id, tool.toolCallId, tool.tool_call_id);
        const entryId = firstString(entry.id, entry.entryId, entry.entry_id);
        const identity = callId ? `tool-call:${callId}` : `tool-call:${entryId ?? `${sourceId}:${item.record}`}:${index}`;
        process({ name: tool.name, timestamp: entry.timestamp ?? message.timestamp, status: "running", usage: { tool_calls: 1 } }, item, "direct", `tool.${firstString(tool.name) ?? "unknown"}`, identity, entryId);
      }
      if (["toolresult", "tool_result"].includes((firstString(message.role) ?? "").toLowerCase())) {
        const callId = firstString(message.toolCallId, message.tool_call_id);
        process({ ...message, timestamp: entry.timestamp ?? message.timestamp, status: message.isError === true ? "error" : message.isError === false ? "ok" : "unknown" }, item, "direct", "tool.result", `tool-result:${firstString(entry.id) ?? `${sourceId}:${item.record}`}`, callId ? `tool-call:${callId}` : null);
      }
    }
  }
  remapParents(observations, nativeIds);
  bundle.observations = dedupeObservations(observations);
  bundle.meters = [...meters.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (sourceScopedFallbacks > 0) bundle.coverage?.limitations.push(`${sourceScopedFallbacks} Pi observation(s) lacked a stable native identity and remain source-scoped.`);
  return bundle;
}

function otelAttributes(value: unknown): Map<string, unknown> {
  const result = new Map<string, unknown>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!isObject(item) || typeof item.key !== "string") continue;
    const raw = asObject(item.value);
    if (!raw) continue;
    const valueKey = Object.keys(raw).find((key) => ["stringValue", "intValue", "doubleValue", "boolValue", "arrayValue"].includes(key));
    if (!valueKey) continue;
    const extracted = raw[valueKey];
    if (valueKey === "arrayValue" && isObject(extracted)) result.set(item.key, extracted.values);
    else result.set(item.key, extracted);
  }
  return result;
}

function otelValueToScalar(value: unknown): UsageScalar | undefined {
  if (Array.isArray(value)) return value.map((entry) => scalar(entry)).filter((entry): entry is string | number | boolean | null => entry !== undefined).join(",");
  return scalar(value);
}

function otlp(input: unknown, options: UsageImportOptions): UsageBundle {
  const rows = parseJsonRecords(input);
  const bundle = emptyBundle(input, options, "otel", "otlp-json");
  const sourceId = bundle.sources[0]!.id;
  const meters = new Map<string, UsageMeter>();
  const observations: UsageObservation[] = [];
  const nativeIds = new Map<string, string>();
  let sourceScopedFallbacks = 0;
  const addSpan = (span: JsonObject, resource: Map<string, unknown>, scope: JsonObject | null): void => {
    const attrs = otelAttributes(span.attributes);
    const resourceFacts = Object.fromEntries([...resource.entries()].map(([key, value]) => [key, value]));
    const flat: JsonObject = { ...resourceFacts };
    for (const [key, value] of attrs) flat[key] = value;
    const nativeIdentity = firstString(flat["flAImegraph.observation_id"], flat["gen_ai.response.id"], span.spanId);
    const native = nativeIdentity ?? `span:${observations.length}`;
    const provider = firstString(flat["gen_ai.provider.name"], flat["gen_ai.system"], flat.provider);
    const id = observationId(options, "otel", native, provider, sourceId, nativeIdentity === null);
    if (nativeIdentity === null) sourceScopedFallbacks += 1;
    const measurements: Record<string, UsageMeasurement> = {};
    const usage: JsonObject = {};
    for (const [key, value] of attrs) {
      const match = /^(?:gen_ai\.usage|flAImegraph\.usage)\.(.+)$/u.exec(key);
      if (match) usage[match[1]!] = value;
      else if (/\.usage\./u.test(key) || /^provider\..+\./u.test(key)) {
        const meterKey = key.split(".").at(-1) ?? key;
        const providerKey = provider && key.startsWith(`provider.${provider}.`) ? key.slice(`provider.${provider}.`.length) : key;
        const meterId = canonicalUsageKey(meterKey) ?? meterIdForNative("otel", provider, providerKey.replace(/\./gu, "_"));
        addMeasurement(measurements, meters, meterId, value, sourceId, `span:${span.spanId ?? native}`, `/${key}`, "event", accountingScope(flat, "direct"), countBasis(flat), unitForKey(meterKey), canonicalUsageKey(meterKey) === "cache_read_input_tokens" || canonicalUsageKey(meterKey) === "cache_write_input_tokens" ? "input_tokens" : canonicalUsageKey(meterKey) === "reasoning_output_tokens" ? "output_tokens" : null);
      }
    }
    addUsageMeasurements(measurements, meters, usage, "otel", provider, sourceId, `span:${span.spanId ?? native}`, "/attributes", accountingScope(flat, "direct"), "event", countBasis(flat));
    const dimensions: UsageDimensions = {};
    const dimensionRecord: JsonObject = {};
    for (const [key, value] of Object.entries(flat)) {
      if (key.startsWith("gen_ai.")) {
        const short = key.slice("gen_ai.".length).replace(/\./gu, "_");
        dimensionRecord[short] = value;
      } else if (!key.includes("usage") && !key.startsWith("provider.")) {
        dimensionRecord[key] = value;
      }
      if (key.startsWith("provider.") && !key.includes("usage")) setExtension(dimensions, key, otelValueToScalar(value), sourceId, `span:${span.spanId ?? native}`, `/${key}`);
    }
    addDimensionSet(dimensions, { ...dimensionRecord, model: flat["gen_ai.request.model"], response_model: flat["gen_ai.response.model"], provider, service: flat["service.name"], operation: flat["gen_ai.operation.name"], service_tier: flat["gen_ai.request.service_tier"], applied_service_tier: flat["gen_ai.response.service_tier"], region: flat["cloud.region"] ?? flat["gen_ai.request.region"] }, sourceId, `span:${span.spanId ?? native}`, "/attributes");
    const parentNative = firstString(span.parentSpanId, flat["flAImegraph.parent_observation_id"]);
    const accounting = accountingScope(flat, firstString(flat["flAImegraph.accounting_scope"]) === "snapshot" ? "snapshot" : "direct");
    const observation = baseObservation({ id, sourceId, recordRef: `span:${span.spanId ?? native}`, subject: firstString(flat["flAImegraph.subject"], flat["gen_ai.operation.name"], span.name) ?? "activity", accounting, operationId: firstString(flat["flAImegraph.operation"], span.spanId, span.name), parentId: parentNative, agentId: firstString(flat["flAImegraph.agent_id"]), sessionId: firstString(flat["flAImegraph.session_id"], flat["gen_ai.conversation.id"]), taskId: options.task_id, workItemId: workItemId(options, flat), status: rawStatus({ status: firstString(flat["flAImegraph.status"], flat["otel.status_code"]) }), event: flat["gen_ai.event.timestamp"] ?? span.startTimeUnixNano, started: span.startTimeUnixNano, ended: span.endTimeUnixNano, collected: options.collected_at, measurements, dimensions });
    if (span.startTimeUnixNano !== undefined && span.endTimeUnixNano !== undefined) {
      const start = quantity(span.startTimeUnixNano); const end = quantity(span.endTimeUnixNano);
      if (start !== null && end !== null) addMeasurement(observation.measurements, meters, "duration_ns", String(BigInt(end) - BigInt(start)), sourceId, `span:${span.spanId ?? native}`, "/duration", "interval", accounting, "provider_native", "ns");
    }
    observations.push(observation);
    nativeIds.set(native, id);
    if (typeof span.spanId === "string" && span.spanId.length > 0) nativeIds.set(span.spanId, id);
  };
  const documents = rows.length > 0 ? rows.map((row) => row.value) : [];
  const spans = (document: JsonObject): void => {
    const resources = Array.isArray(document.resourceSpans) ? document.resourceSpans : [];
    for (const resourceSpan of resources) {
      if (!isObject(resourceSpan)) continue;
      const resource = otelAttributes(asObject(resourceSpan.resource)?.attributes);
      const scopes = Array.isArray(resourceSpan.scopeSpans) ? resourceSpan.scopeSpans : [];
      for (const scope of scopes) {
        if (!isObject(scope)) continue;
        const scopeAttrs = asObject(scope.scope);
        const list = Array.isArray(scope.spans) ? scope.spans : [];
        for (const span of list) if (isObject(span)) addSpan(span, resource, scopeAttrs);
      }
    }
    const metrics = Array.isArray(document.resourceMetrics) ? document.resourceMetrics : [];
    for (const resourceMetric of metrics) {
      if (!isObject(resourceMetric)) continue;
      const resource = otelAttributes(asObject(resourceMetric.resource)?.attributes);
      const scopes = Array.isArray(resourceMetric.scopeMetrics) ? resourceMetric.scopeMetrics : [];
      for (const scope of scopes) {
        if (!isObject(scope)) continue;
        const metricList = Array.isArray(scope.metrics) ? scope.metrics : [];
        for (const metric of metricList) {
          if (!isObject(metric)) continue;
          const metricName = firstString(metric.name) ?? "unknown";
          for (const field of ["sum", "gauge", "histogram"]) {
            const container = asObject(metric[field]);
            const points = container && Array.isArray(container.dataPoints) ? container.dataPoints : [];
            const metricProvider = firstString(resource.get("gen_ai.provider.name"), resource.get("service.name"));
            const metricResourceFacts = Object.fromEntries(resource.entries());
            for (const [pointIndex, point] of points.entries()) {
              if (!isObject(point)) continue;
              const value = point.asInt ?? point.asDouble ?? point.value;
              const dimensions: UsageDimensions = {};
              const attrs = otelAttributes(point.attributes);
              const pointAttrs = canonicalJson(Object.fromEntries([...attrs.entries()].sort(([left], [right]) => left.localeCompare(right))));
              const pointIdentity = firstString(point.id, point.dataPointId, point.data_point_id) ?? (pointAttrs === "{}" ? `ordinal:${pointIndex}` : pointAttrs);
              const pointHasStableIdentity = firstString(point.id, point.dataPointId, point.data_point_id, point.timeUnixNano, point.startTimeUnixNano) !== null || pointAttrs !== "{}";
              const metricNative = `metric:${metricName}:${field}:${firstString(point.timeUnixNano, point.startTimeUnixNano) ?? "unknown"}:${pointIdentity}`;
              const id = observationId(options, "otel", metricNative, metricProvider, sourceId, !pointHasStableIdentity);
              if (!pointHasStableIdentity) sourceScopedFallbacks += 1;
              for (const [key, raw] of attrs) if (key.includes(".")) setExtension(dimensions, key, otelValueToScalar(raw), sourceId, `metric:${metricName}`, `/attributes/${key}`);
              const measurements: Record<string, UsageMeasurement> = {};
              const rawTemporality = container?.aggregationTemporality;
              const temporalityValue = rawTemporality === undefined || rawTemporality === null ? null : String(rawTemporality).toUpperCase();
              const temporality = temporalityValue === "DELTA" ? "1" : temporalityValue === "CUMULATIVE" ? "2" : temporalityValue;
              // OpenTelemetry AggregationTemporality is DELTA=1 and
              // CUMULATIVE=2. Delta points are additive intervals while
              // cumulative points remain visible as non-additive snapshots.
              const metricAccounting: UsageAccountingScope = field === "sum" && temporality === "1"
                ? "direct"
                : field === "sum" && temporality === "2" ? "snapshot" : "aggregate";
              const metricScope: UsageMeasurementScope = metricAccounting === "direct" ? "interval" : metricAccounting === "snapshot" ? "snapshot" : "aggregate";
              const meterId = meterIdForNative("otel", firstString(resource.get("gen_ai.provider.name"), resource.get("service.name")), metricName);
              addMeasurement(measurements, meters, meterId, value, sourceId, `metric:${metricName}`, `/value`, metricScope, metricAccounting, "provider_native", unitForKey(metricName));
              observations.push(baseObservation({ id, sourceId, recordRef: `metric:${metricName}`, subject: `metric.${sanitize(metricName)}`, accounting: metricAccounting, operationId: metricName, sessionId: options.session_id, taskId: options.task_id, workItemId: workItemId(options, metricResourceFacts, Object.fromEntries(attrs)), event: point.timeUnixNano, started: point.startTimeUnixNano, collected: options.collected_at, measurements, dimensions }));
            }
          }
        }
      }
    }
  };
  for (const document of documents) spans(document);
  remapParents(observations, nativeIds);
  bundle.observations = dedupeObservations(observations);
  bundle.meters = [...meters.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (sourceScopedFallbacks > 0) bundle.coverage?.limitations.push(`${sourceScopedFallbacks} OTLP observation(s) lacked a stable native identity and remain source-scoped.`);
  return bundle;
}

function legacy(input: unknown, options: LegacyEvidenceImportOptions = {}): UsageBundle {
  if (!isObject(input)) throw new TypeError("legacy evidence must be an object");
  const datasetId = options.dataset_id ?? (typeof input.dataset_id === "string" ? input.dataset_id : "legacy");
  const legacySources = Array.isArray(input.sources) ? input.sources.filter(isObject) : [];
  const sourceId = options.source_id ?? firstString(legacySources[0]?.id) ?? `legacy-${sha256(canonicalJson(input)).slice(0, 24)}`;
  const sources: UsageSource[] = legacySources.length > 0 ? legacySources.map((source) => ({
    id: firstString(source.id) ?? sourceId,
    harness: firstString(source.harness) ?? "legacy",
    format: firstString(source.format) ?? "evidence",
    ...(firstString(source.version) ? { version: firstString(source.version) as string } : {}),
    ...(firstString(source.sha256) ? { sha256: firstString(source.sha256) as string } : {}),
    coverage: source.coverage === "complete" || source.coverage === "partial" ? source.coverage : "unknown",
    description: `${firstString(source.description) ?? "Legacy EvidenceBundle source"}; recorded monetary fields are preserved only by the source reference and omitted from usage.`,
  })) : [{ id: sourceId, harness: "legacy", format: "evidence", coverage: "unknown", description: "Legacy EvidenceBundle source; recorded monetary fields are preserved only by the source reference and omitted from usage." }];
  if (!sources.some((source) => source.id === sourceId)) sources.push({ id: sourceId, harness: "legacy", format: "evidence", coverage: "unknown", description: "Legacy EvidenceBundle source; recorded monetary fields are preserved only by the source reference and omitted from usage." });
  const meters = new Map<string, UsageMeter>();
  const observations: UsageObservation[] = [];
  const legacyRows = Array.isArray(input.observations) ? input.observations.filter(isObject) : [];
  for (const row of legacyRows) {
    const rowId = firstString(row.id) ?? `row:${observations.length}`;
    const id = observationId({ dataset_id: datasetId }, "legacy", rowId);
    const refs = Array.isArray(row.source_refs) ? row.source_refs.filter(isObject) : [];
    const ref = firstString(refs[0]?.record) ?? `observation:${rowId}`;
    const rowSourceId = firstString(refs[0]?.source_id) ?? sourceId;
    const usage = asObject(row.usage);
    const measurements: Record<string, UsageMeasurement> = {};
    addUsageMeasurements(measurements, meters, usage, "legacy", firstString(row.provider), rowSourceId, ref, `${ref}/usage`, accountingScope(row));
    const dimensions: UsageDimensions = {};
    if (row.model_identity === "response") setIf(dimensions, "actual_model", row.model, rowSourceId, ref, `${ref}/model`);
    else if (row.model_identity === "setting") setIf(dimensions, "requested_model", row.model, rowSourceId, ref, `${ref}/model`);
    else setIf(dimensions, "model", row.model, rowSourceId, ref, `${ref}/model`);
    setIf(dimensions, "provider", row.provider, rowSourceId, ref, `${ref}/provider`);
    setIf(dimensions, "product", row.product, rowSourceId, ref, `${ref}/product`);
    setExtension(dimensions, "legacy.operation", row.operation, rowSourceId, ref, `${ref}/operation`);
    const parentNative = firstString(row.parent_id);
    observations.push(baseObservation({ id, sourceId: rowSourceId, recordRef: ref, subject: firstString(row.operation) ?? (row.kind === "tool" ? "tool" : row.kind === "activity" ? "activity" : "model.response"), accounting: accountingScope(row), operationId: firstString(row.operation), parentId: parentNative === null ? null : observationId({ dataset_id: datasetId }, "legacy", parentNative), agentId: firstString(row.agent_id) ?? options.agent_id, sessionId: firstString(row.session_id) ?? options.session_id, taskId: firstString(row.task_id) ?? options.task_id, workItemId: workItemId(options, row), status: rawStatus(row), event: row.timestamp, started: asObject(row.attributes)?.["flAImegraph.timing.started_at"] ?? asObject(row.attributes)?.["flAImegraph.otel.start_time_unix_nano"], ended: row.end_time, collected: options.collected_at, measurements, dimensions }));
  }
  const byLegacy = new Map(legacyRows.map((row, index) => [firstString(row.id) ?? `row:${index}`, observations[index]!]));
  for (const relationship of Array.isArray(input.relationships) ? input.relationships.filter(isObject) : []) {
    if (relationship.kind !== "parent") continue;
    const child = byLegacy.get(firstString(relationship.to) ?? "");
    const parent = byLegacy.get(firstString(relationship.from) ?? "");
    if (child && parent) child.parent_id = parent.id;
  }
  return { schema_version: "0.4.0", dataset_id: datasetId, sources, meters: [...meters.values()].sort((left, right) => left.id.localeCompare(right.id)), observations: dedupeObservations(observations), coverage: { boundary: "mixed", complete: false, dropped_observations: 0, limitations: ["Legacy EvidenceBundle was migrated without recorded monetary fields; historical capture completeness remains source-defined."] } };
}

/** Convert a public legacy 0.1 EvidenceBundle without loading its pricing core. */
export function fromLegacyEvidence(input: unknown, options: LegacyEvidenceImportOptions = {}): UsageBundle {
  return legacy(input, options);
}

/** Return source evidence for an input without retaining the raw document. */
export function captureSource(input: unknown, options: UsageImportOptions): UsageSource {
  const normalized = normalizeOptions(options);
  const rows = parseJsonRecords(input);
  return makeSource(input, normalized, normalized.source_harness ?? normalized.format, normalized.source_format ?? normalized.format, rows.length, rows.malformed.length);
}

/** Import native JSON/JSONL or OTLP usage into the pricing-free 0.4 bundle. */
export function importUsage(input: unknown, options: UsageImportOptions): UsageBundle {
  const normalized = normalizeOptions(options);
  const format = normalized.format.toLowerCase();
  if (format === "legacy" || format === "legacy-evidence") return fromLegacyEvidence(input, { ...normalized, format: format as "legacy" | "legacy-evidence" });
  if (format === "codex") return codex(input, normalized);
  if (format === "codex-exec") return codexExec(input, normalized);
  if (format === "claude" || format === "claude-transcript") return claude(input, normalized);
  if (format === "pi") return pi(input, normalized);
  if (format === "otel" || format === "otlp" || format === "opentelemetry") return otlp(input, normalized);
  if (format === "openai" || format === "anthropic" || format === "gemini" || format === "provider" || format === "usage") return provider(input, normalized);
  return provider(input, normalized);
}

/** The public exec stream reports turn totals, not individual provider receipts. */
function codexExec(input: unknown, options: UsageImportOptions): UsageBundle {
  const rows = parseJsonRecords(input);
  const bundle = emptyBundle(input, options, "codex", "codex-exec-jsonl");
  const sourceId = bundle.sources[0]!.id;
  const meters = new Map<string, UsageMeter>();
  let session: string | null = options.session_id ?? null;
  for (const item of rows) {
    const record = item.value;
    if (record.type === "thread.started") session = firstString(record.thread_id, session);
    if (!["turn.completed", "turn.failed", "error"].includes(String(record.type))) continue;
    const measures: Record<string, UsageMeasurement> = {};
    if (record.type === "turn.completed") addUsageMeasurements(measures, meters, asObject(record.usage), "codex", null, sourceId, item.record, "/usage", "aggregate", "aggregate");
    bundle.observations.push(baseObservation({ id: observationId(options, "codex-exec", item.record, null, sourceId, true), sourceId, recordRef: item.record, subject: record.type === "turn.completed" ? "model.turn_total" : "harness.error", accounting: "aggregate", sessionId: session, workItemId: options.work_item_id, agentId: options.agent_id, taskId: options.task_id, collected: options.collected_at, status: record.type === "turn.completed" ? "ok" : "error", measurements: measures }));
  }
  bundle.meters = [...meters.values()].sort((a, b) => a.id.localeCompare(b.id));
  bundle.coverage!.limitations.push("Codex exec stdout provides turn totals without provider response identities. These are aggregate checks, excluded from direct response totals; use a native rollout for response-level profiling.", "Exec event identities are source-scoped; overlapping captures cannot establish cross-file receipt deduplication. Tool item details are not imported by this surface.");
  if (!bundle.observations.length && rows.length) bundle.sources[0]!.coverage = "partial";
  return bundle;
}

/** Claude SDK envelopes repeat response receipts once per content block. */
function claude(input: unknown, options: UsageImportOptions): UsageBundle {
  const rows = parseJsonRecords(input);
  const bundle = emptyBundle(input, options, "claude-code", options.format === "claude-transcript" ? "claude-transcript-jsonl" : "claude-stream-json");
  const sourceId = bundle.sources[0]!.id;
  const meters = new Map<string, UsageMeter>();
  const observations: UsageObservation[] = [];
  const responses = new Map<string, UsageObservation>();
  let resultCount = 0, partialCount = 0;
  const identify = (identity: string) => observationId(options, "claude", identity, "anthropic");
  const usageKeys = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
  const measurements = (raw: unknown, item: RecordWithPath, accounting: UsageAccountingScope) => {
    const native = asObject(raw);
    const selected = native ? Object.fromEntries(usageKeys.filter(key => Object.hasOwn(native, key)).map(key => [key, native[key]])) : null;
    const result: Record<string, UsageMeasurement> = {};
    const scope = accounting === "aggregate" ? "aggregate" : "event";
    const normalized = normalizeExclusiveInput(selected, "anthropic", "anthropic", sourceId, item.record, "/message/usage", result, meters, accounting, scope, "provider_native");
    addUsageMeasurements(result, meters, normalized, "anthropic", "anthropic", sourceId, item.record, "/message/usage", accounting, scope);
    return result;
  };
  for (const item of rows) {
    const record = item.value;
    const message = asObject(record.message);
    const session = firstString(record.session_id, record.sessionId, options.session_id);
    const parentTool = firstString(record.parent_tool_use_id);
    const associations = { sessionId: session, workItemId: workItemId(options, record), taskId: options.task_id, agentId: options.agent_id, collected: options.collected_at };
    if (record.type === "system" && record.subtype === "api_retry") {
      const native = firstString(record.uuid) ?? `${sourceId}:${item.record}`;
      observations.push(baseObservation({ ...associations, id: identify(`retry:${native}`), sourceId, recordRef: item.record, subject: "harness.retry", accounting: "unknown", status: "error" }));
      continue;
    }
    if (record.type === "stream_event") { partialCount += 1; continue; }
    if (record.type === "result") {
      resultCount += 1;
      const native = firstString(record.uuid) ?? `${sourceId}:${item.record}`;
      observations.push(baseObservation({ ...associations, id: identify(`result:${native}`), sourceId, recordRef: item.record, subject: "model.query_total", accounting: "aggregate", operationId: native, status: record.is_error === true ? "error" : record.is_error === false ? "ok" : "unknown", event: record.timestamp, measurements: measurements(record.usage, item, "aggregate") }));
      continue;
    }
    if (!message || !["assistant", "user"].includes(String(record.type))) continue;
    let response: UsageObservation | undefined;
    if (record.type === "assistant") {
      const native = firstString(message.id);
      const identity = native ?? `envelope:${firstString(record.uuid) ?? `${sourceId}:${item.record}`}`;
      const id = identify(`response:${identity}`);
      const synthetic = message.model === "<synthetic>";
      if (synthetic) bundle.coverage!.limitations.push("A synthetic harness error message is not a provider receipt; its placeholder usage is omitted.");
      response = baseObservation({ ...associations, id, sourceId, recordRef: item.record, subject: synthetic ? "harness.error" : "model.response", accounting: "direct", operationId: identity, parentId: parentTool ? identify(`tool-call:${parentTool}`) : null, status: record.error ? "error" : ["end_turn", "tool_use", "max_tokens", "stop_sequence"].includes(String(message.stop_reason)) ? "ok" : "unknown", measurements: synthetic ? {} : measurements(message.usage, item, "direct"), dimensions: descriptorForRecord({ response: { model: synthetic ? undefined : message.model, provider: "anthropic" } }, "claude", sourceId, item.record, "actual") });
      if (!native) bundle.coverage!.limitations.push("An assistant envelope lacks a provider response ID; cross-envelope deduplication is unavailable.");
      const previous = responses.get(id);
      if (previous) {
        if (previous.dimensions.actual_model?.value !== response.dimensions.actual_model?.value || previous.session_id !== response.session_id || previous.parent_id !== response.parent_id) throw new Error(`Conflicting Claude response identity ${id}`);
        previous.source_refs.push(...response.source_refs);
        for (const [key, incoming] of Object.entries(response.measurements)) {
          const current = previous.measurements[key];
          if (!current || current.value === null || incoming.value !== null && decimalCompare(incoming.value, current.value) > 0) previous.measurements[key] = incoming;
          else if (incoming.value === current.value) current.source_refs.push(...incoming.source_refs);
        }
        if (response.status !== "unknown") previous.status = response.status;
        response = previous;
      } else { responses.set(id, response); observations.push(response); }
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const [index, block] of content.entries()) {
      const tool = asObject(block);
      if (!tool) continue;
      if (tool.type === "tool_use") {
        const native = firstString(tool.id) ?? `${sourceId}:${item.record}:${index}`;
        const counters: Record<string, UsageMeasurement> = {};
        addMeasurement(counters, meters, "tool_calls", 1, sourceId, item.record, "/message/content/tool_use", "event", "direct", "consumed");
        observations.push(baseObservation({ ...associations, id: identify(`tool-call:${native}`), sourceId, recordRef: item.record, subject: `tool.${firstString(tool.name) ?? "unknown"}`, accounting: "direct", operationId: native, parentId: response?.id ?? null, status: "running", measurements: counters }));
      } else if (tool.type === "tool_result") {
        const native = firstString(tool.tool_use_id);
        observations.push(baseObservation({ ...associations, id: identify(`tool-result:${native ?? `${sourceId}:${item.record}:${index}`}`), sourceId, recordRef: item.record, subject: "tool.result", accounting: "direct", operationId: native, parentId: native ? identify(`tool-call:${native}`) : null, status: tool.is_error === true ? "error" : "ok" }));
      }
    }
  }
  bundle.observations = dedupeObservations(observations);
  bundle.meters = [...meters.values()].sort((a, b) => a.id.localeCompare(b.id));
  bundle.coverage!.limitations.push("Claude response usage is deduplicated by provider message ID; repeated counters retain their highest reported value. Query result aggregates are separate non-additive checks, not additional response consumption.", "SDK messages do not establish action start/end timestamps, complete hidden retry accounting or complete subagent coverage.");
  if (!resultCount) bundle.coverage!.limitations.push("No final query result was observed; the supplied stream may be interrupted or a transcript export.");
  if (partialCount) bundle.coverage!.limitations.push(`${partialCount} partial streaming envelopes were not promoted to settled response receipts.`);
  if (options.format === "claude-transcript") bundle.coverage!.limitations.push("Claude internal transcript byte shape is not a stable public contract; only recognized assistant/user messages are imported.");
  if (!bundle.observations.length && rows.length) bundle.sources[0]!.coverage = "partial";
  return bundle;
}

function provider(input: unknown, options: UsageImportOptions): UsageBundle {
  const format = options.format.toLowerCase();
  const rows = parseJsonRecords(input);
  const bundle = emptyBundle(input, options, format, `${format}-request-response`);
  const sourceId = bundle.sources[0]!.id;
  const meters = new Map<string, UsageMeter>();
  const observations: UsageObservation[] = [];
  const pending = new Map<string, JsonObject>();
  const nativeIds = new Map<string, string>();
  let sourceScopedFallbacks = 0;
  const consume = (record: JsonObject, item: RecordWithPath, request: JsonObject | null, response: JsonObject | null): void => {
    const combined: JsonObject = { ...record, ...(request ? { request } : {}), ...(response ? { response } : {}) };
    const rawResponse = response ?? record;
    const usage = asObject(rawResponse.usage) ?? asObject(rawResponse.usageMetadata) ?? asObject(rawResponse.usage_metadata) ?? asObject(record.usage);
    const providerName = firstString(rawResponse.provider, record.provider) ?? (format === "openai" ? "openai" : format === "anthropic" ? "anthropic" : format === "gemini" ? "google" : null);
    const nativeIdentity = firstString(rawResponse.id, rawResponse.response_id, rawResponse.responseId, record.id, record.request_id, record.requestId);
    const native = nativeIdentity ?? `line:${item.line ?? item.record}`;
    const id = observationId(options, format, native, providerName, sourceId, nativeIdentity === null);
    if (nativeIdentity === null) sourceScopedFallbacks += 1;
    const measurements: Record<string, UsageMeasurement> = {};
    const accounting = accountingScope(record);
    const normalizedUsage = normalizeExclusiveInput(usage, format, providerName, sourceId, item.record, `${item.record}/usage`, measurements, meters, accounting, "event", "provider_native");
    addUsageMeasurements(measurements, meters, normalizedUsage, format, providerName, sourceId, item.record, `${item.record}/usage`, accounting);
    const dimensions = descriptorForRecord(combined, format, sourceId, item.record);
    observations.push(baseObservation({ id, sourceId, recordRef: item.record, subject: "model.response", accounting: accountingScope(record), operationId: native, parentId: firstString(rawResponse.parent_id, rawResponse.parentId, record.parent_id), sessionId: firstString(rawResponse.session_id, rawResponse.sessionId, record.session_id, record.sessionId, options.session_id), agentId: firstString(record.agent_id, record.agentId) ?? options.agent_id, taskId: options.task_id, workItemId: workItemId(options, record, request, response, rawResponse), status: rawStatus(rawResponse), event: rawResponse.timestamp ?? rawResponse.created_at ?? rawResponse.createdAt ?? record.timestamp, started: rawResponse.started_at ?? record.started_at, ended: rawResponse.ended_at ?? rawResponse.completed_at ?? rawResponse.completedAt ?? record.ended_at, collected: options.collected_at, measurements, dimensions }));
    nativeIds.set(native, id);
  };
  for (const item of rows) {
    const record = item.value;
    const type = firstString(record.type, record.kind)?.toLowerCase() ?? "";
    const request = asObject(record.request) ?? (type === "request" ? record : null);
    const response = asObject(record.response) ?? (type === "response" || type === "completion" || type === "result" ? record : null);
    const key = firstString(record.request_id, record.requestId, record.response_id, record.responseId, record.id);
    if (request && !response && key) { pending.set(key, request); continue; }
    const matchingRequest = request ?? (key ? pending.get(key) ?? null : null);
    const bareResponse = !request && !response && (asObject(record.usage) !== null || asObject(record.usageMetadata) !== null || asObject(record.usage_metadata) !== null) ? record : null;
    if (response || bareResponse !== null) consume(record, item, matchingRequest, response ?? bareResponse);
    else if (request && !key) consume(record, item, request, null);
  }
  remapParents(observations, nativeIds);
  bundle.observations = dedupeObservations(observations);
  bundle.meters = [...meters.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (sourceScopedFallbacks > 0) bundle.coverage?.limitations.push(`${sourceScopedFallbacks} ${format} observation(s) lacked a stable native identity and remain source-scoped.`);
  return bundle;
}
