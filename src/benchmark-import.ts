import type {
  BenchmarkConditions,
  BenchmarkInput,
  BenchmarkModelConfig,
  BenchmarkQuality,
  BenchmarkSample,
  EfficiencyEvidence,
  EfficiencyQuantity,
} from "./efficiency-types.js";
import { captureSource } from "./usage-import.js";

/** Scalar values accepted by an Inspect scorer selection rule. */
export type InspectScoreValue = string | number | boolean;

export type InspectThresholdOperator = "gte" | "gt" | "lte" | "lt" | "eq";

export interface InspectScoreThreshold {
  value: string | number;
  operator?: InspectThresholdOperator;
}

/** Options that make the benchmark comparison boundary explicit. */
export interface InspectBenchmarkImportOptions {
  benchmark_id?: string;
  role: BenchmarkInput["role"];
  scorer: string;
  accepted_values?: readonly InspectScoreValue[];
  /** Alias accepted for callers that prefer the shorter spelling. */
  acceptedValues?: readonly InspectScoreValue[];
  score_threshold?: string | number | InspectScoreThreshold;
  /** Alias accepted for callers that prefer the shorter spelling. */
  threshold?: string | number | InspectScoreThreshold;
  threshold_operator?: InspectThresholdOperator;
  workload_id: string;
  scope_revision: string;
  acceptance_version: string;
  task_class?: string;
  acceptance_criteria_id?: string;
  evaluation?: BenchmarkInput["evaluation"];
  harness?: string;
  harness_version?: string;
  tools_version?: string;
  cache?: string;
  context_policy?: string;
  routing_policy?: string;
  conditions_other?: Record<string, string>;
  model?: string;
  model_version?: string;
  reasoning?: string;
  tier?: string;
  provider?: string;
  source_id?: string;
  /** An opaque dataset label used only when deriving a source descriptor. */
  dataset_id?: string;
}

export interface InspectBenchmarkImportResult {
  benchmark: BenchmarkInput;
  /** Import coverage and missing-condition notes that BenchmarkInput cannot carry. */
  limitations: string[];
}

type JsonObject = Record<string, unknown>;
type JsonScalar = string | number | boolean | null;

interface Decimal {
  sign: 1 | -1;
  digits: bigint;
  scale: number;
}

const COUNTERS: ReadonlyArray<{ source: string; meter: string }> = [
  { source: "input_tokens", meter: "input_tokens" },
  { source: "input_tokens_cache_read", meter: "cache_read_input_tokens" },
  { source: "input_tokens_cache_write", meter: "cache_write_input_tokens" },
  { source: "output_tokens", meter: "output_tokens" },
  { source: "reasoning_tokens", meter: "reasoning_output_tokens" },
];

const AUXILIARY_COUNTERS: ReadonlyArray<{ source: string; meter: string }> = COUNTERS.map(({ source, meter }) => ({
  source,
  meter: `auxiliary_${meter}`,
}));

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseInput(input: unknown): JsonObject {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      if (!isObject(parsed)) throw new TypeError("Inspect JSON log must contain an object");
      return parsed;
    } catch (error) {
      if (error instanceof TypeError && /must contain/u.test(error.message)) throw error;
      throw new TypeError("Inspect JSON log could not be parsed; convert .eval logs with `inspect log convert --to json` first");
    }
  }
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) {
    throw new TypeError("Inspect .eval binary logs are unsupported; convert them with `inspect log convert --to json` before importing");
  }
  if (!isObject(input)) throw new TypeError("Inspect JSON log must contain an object");
  return input;
}

function scalar(value: unknown): value is JsonScalar {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function canonicalScalar(value: InspectScoreValue): string {
  return JSON.stringify(value);
}

function decimal(value: string | number): Decimal | null {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(text);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100_000) return null;
  const rawDigits = `${whole}${fraction}`.replace(/^0+(?=\d)/u, "") || "0";
  const scale = fraction.length - exponent;
  if (scale < 0) return { sign, digits: BigInt(rawDigits) * 10n ** BigInt(-scale), scale: 0 };
  if (scale > 100_000) return null;
  return { sign: rawDigits === "0" ? 1 : sign, digits: BigInt(rawDigits), scale };
}

function compareDecimal(left: Decimal, right: Decimal): -1 | 0 | 1 {
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
  const scale = Math.max(left.scale, right.scale);
  const l = left.digits * 10n ** BigInt(scale - left.scale);
  const r = right.digits * 10n ** BigInt(scale - right.scale);
  const result = l < r ? -1 : l > r ? 1 : 0;
  return (left.sign === 1 ? result : -result) as -1 | 0 | 1;
}

function compareThreshold(score: unknown, threshold: InspectScoreThreshold): boolean | null {
  if (typeof score !== "number" && typeof score !== "string") return null;
  const left = decimal(score);
  const right = decimal(threshold.value);
  if (!left || !right) return null;
  const comparison = compareDecimal(left, right);
  switch (threshold.operator ?? "gte") {
    case "gt": return comparison > 0;
    case "lte": return comparison <= 0;
    case "lt": return comparison < 0;
    case "eq": return comparison === 0;
    case "gte": return comparison >= 0;
  }
}

function normalizedThreshold(options: InspectBenchmarkImportOptions): InspectScoreThreshold | null {
  const raw = options.score_threshold ?? options.threshold;
  if (raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "string") return { value: raw, operator: options.threshold_operator ?? "gte" };
  if (!isObject(raw)) throw new TypeError("score_threshold must be a number, decimal string or object");
  const value = raw.value;
  if (typeof value !== "number" && typeof value !== "string") throw new TypeError("score_threshold.value must be numeric");
  const operator = raw.operator ?? options.threshold_operator ?? "gte";
  if (operator !== "gte" && operator !== "gt" && operator !== "lte" && operator !== "lt" && operator !== "eq") throw new TypeError("score threshold operator is invalid");
  return { value, operator };
}

function selection(options: InspectBenchmarkImportOptions): { values: readonly InspectScoreValue[] | null; threshold: InspectScoreThreshold | null } {
  const values = options.accepted_values ?? options.acceptedValues ?? null;
  const threshold = normalizedThreshold(options);
  if ((values === null) === (threshold === null)) throw new TypeError("choose exactly one of accepted_values or score_threshold");
  if (values !== null && (values.length === 0 || values.some((value) => !scalar(value) || value === null))) throw new TypeError("accepted_values must contain at least one non-null scalar value");
  if (threshold && !decimal(threshold.value)) throw new TypeError("score_threshold must be a finite decimal");
  return { values, threshold };
}

function safePart(value: unknown): string {
  const text = String(value);
  const encoded = encodeURIComponent(text).slice(0, 160);
  return encoded.length > 0 ? encoded : "unknown";
}

function sampleIdentity(sample: JsonObject): { id: string; epoch: string; taskId: string } {
  const id = sample.id === undefined || sample.id === null ? "unknown" : String(sample.id);
  const epochValue = sample.epoch;
  const epoch = typeof epochValue === "number" && Number.isSafeInteger(epochValue) ? String(epochValue) : typeof epochValue === "string" && /^\d+$/u.test(epochValue) ? epochValue : "0";
  return { id, epoch, taskId: `inspect:${safePart(id)}:epoch:${epoch}` };
}

function sourceRefs(sourceId: string, digest: string | undefined, sample?: JsonObject): Array<{ source_id: string; record: string }> {
  const refs = [{ source_id: sourceId, record: `sha256:${digest ?? "unknown"}` }];
  if (sample) {
    const identity = sampleIdentity(sample);
    refs.push({ source_id: sourceId, record: `sample:${safePart(identity.id)}:epoch:${identity.epoch}` });
    if (typeof sample.uuid === "string" && sample.uuid.length > 0) refs.push({ source_id: sourceId, record: `sample-uuid:${safePart(sample.uuid)}` });
  }
  return refs;
}

function exactNonnegative(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  return value.replace(/^0+(?=\d)/u, "");
}

function decimalString(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? String(value) : null;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return value;
  return null;
}

function secondsToNanoseconds(value: unknown): string | null {
  const text = decimalString(value);
  if (text === null) return null;
  const parsed = decimal(text);
  if (!parsed || parsed.sign < 0) return null;
  if (parsed.scale <= 9) return (parsed.digits * 10n ** BigInt(9 - parsed.scale)).toString();
  return (parsed.digits / 10n ** BigInt(parsed.scale - 9)).toString();
}

function qualityFor(sample: JsonObject, options: InspectBenchmarkImportOptions, refs: Array<{ source_id: string; record: string }>, limitations: string[]): { accepted: boolean | null; quality: BenchmarkQuality; passedScore: string | null } {
  const scores = isObject(sample.scores) ? sample.scores : null;
  const rawScore = scores?.[options.scorer];
  const scoreObject = isObject(rawScore) ? rawScore : null;
  const scoreValue = scoreObject ? scoreObject.value : rawScore;
  const scoreText = scalarText(scoreValue);
  const hasError = sample.error !== undefined && sample.error !== null || Array.isArray(sample.error_retries) && sample.error_retries.length > 0;
  if (hasError) {
    limitations.push(`sample ${sampleIdentity(sample).taskId} has an Inspect error or retry; acceptance is unknown`);
    return { accepted: null, quality: { passed: null, evidence: "unknown", score: scoreText, source_refs: refs }, passedScore: scoreText };
  }
  if (scoreText === null || scoreValue === null || !scalar(scoreValue)) {
    limitations.push(`sample ${sampleIdentity(sample).taskId} has no usable score for scorer ${options.scorer}`);
    return { accepted: null, quality: { passed: null, evidence: "unknown", score: null, source_refs: refs }, passedScore: null };
  }
  const chosen = selection(options);
  const accepted = chosen.values !== null
    ? chosen.values.some((value) => canonicalScalar(value) === canonicalScalar(scoreValue as InspectScoreValue))
    : compareThreshold(scoreValue, chosen.threshold as InspectScoreThreshold);
  if (accepted === null) {
    limitations.push(`sample ${sampleIdentity(sample).taskId} score is not comparable under the selected threshold`);
    return { accepted: null, quality: { passed: null, evidence: "unknown", score: scoreText, source_refs: refs }, passedScore: scoreText };
  }
  return { accepted, quality: { passed: accepted, evidence: "derived", score: scoreText, source_refs: refs }, passedScore: scoreText };
}

function modelName(log: JsonObject, options: InspectBenchmarkImportOptions): string {
  const evalRecord = isObject(log.eval) ? log.eval : {};
  return nonEmpty(options.model ?? evalRecord.model, "model");
}

function usageEntries(sample: JsonObject, primaryModel: string): Array<{ key: string; usage: JsonObject; primary: boolean }> {
  const modelUsage = isObject(sample.model_usage) ? sample.model_usage : null;
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    const entries = Object.entries(modelUsage).filter(([, value]) => isObject(value)).map(([key, value]) => ({ key, usage: value as JsonObject, primary: false }));
    const exact = entries.filter((entry) => entry.key.toLowerCase() === primaryModel.toLowerCase());
    if (exact.length > 0) return entries.map((entry) => ({ ...entry, primary: entry.key.toLowerCase() === primaryModel.toLowerCase() }));
    if (entries.length === 1) return entries.map((entry) => ({ ...entry, primary: true }));
    return entries.map((entry) => ({ ...entry, primary: /^(?:primary|main|solver|assistant)$/iu.test(entry.key) || entry.key.toLowerCase().includes(primaryModel.toLowerCase()) }));
  }
  const roleUsage = isObject(sample.role_usage) ? sample.role_usage : null;
  if (!roleUsage) return [];
  return Object.entries(roleUsage).filter(([, value]) => isObject(value)).map(([key, value]) => ({
    key,
    usage: value as JsonObject,
    primary: /^(?:primary|main|solver|assistant|target)$/iu.test(key),
  }));
}

function addUsageMeters(sample: JsonObject, primaryModel: string, refs: Array<{ source_id: string; record: string }>, limitations: string[]): EfficiencyQuantity[] {
  const result = new Map<string, EfficiencyQuantity>();
  for (const entry of usageEntries(sample, primaryModel)) {
    const counters = entry.primary ? COUNTERS : AUXILIARY_COUNTERS;
    for (const counter of counters) {
      const value = exactNonnegative(entry.usage[counter.source]);
      if (value === null) {
        if (entry.usage[counter.source] !== undefined && entry.usage[counter.source] !== null) limitations.push(`sample ${sampleIdentity(sample).taskId} has an invalid ${counter.source} usage value`);
        continue;
      }
      const prior = result.get(counter.meter);
      if (!prior) {
        result.set(counter.meter, { meter_id: counter.meter, unit: "tokens", quantity: value, evidence: "observed", source_refs: refs });
      } else {
        const left = decimal(prior.quantity)!;
        const right = decimal(value)!;
        const scale = Math.max(left.scale, right.scale);
        const total = left.digits * 10n ** BigInt(scale - left.scale) + right.digits * 10n ** BigInt(scale - right.scale);
        prior.quantity = (total / 10n ** BigInt(scale)).toString() + (scale > 0 ? `.${(total % 10n ** BigInt(scale)).toString().padStart(scale, "0")}`.replace(/0+$/u, "") : "");
        if (prior.quantity.endsWith(".")) prior.quantity = prior.quantity.slice(0, -1);
      }
    }
  }
  return [...result.values()].sort((left, right) => left.meter_id.localeCompare(right.meter_id));
}

function knownMetadata(evalRecord: JsonObject, options: InspectBenchmarkImportOptions, limitations: string[]): BenchmarkConditions {
  const metadata = isObject(evalRecord.metadata) ? evalRecord.metadata : {};
  const packages = isObject(evalRecord.packages) ? evalRecord.packages : {};
  const condition = (explicit: string | undefined, keys: string[]): string | undefined => {
    if (explicit !== undefined) return explicit;
    for (const key of keys) {
      const value = optionalText(metadata[key]) ?? optionalText(evalRecord[key]);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const harnessVersion = condition(options.harness_version, ["harness_version", "inspect_version", "inspect_ai_version"]) ?? optionalText(packages.inspect_ai) ?? optionalText(packages["inspect-ai"]);
  const result: BenchmarkConditions = { harness: options.harness ?? "inspect-ai" };
  if (harnessVersion) result.harness_version = harnessVersion;
  const toolsVersion = condition(options.tools_version, ["tools_version", "tool_version"]);
  if (toolsVersion) result.tools_version = toolsVersion;
  const cache = condition(options.cache, ["cache", "cache_policy", "prompt_cache"]);
  if (cache) result.cache = cache;
  const context = condition(options.context_policy, ["context_policy", "context"]);
  if (context) result.context_policy = context;
  const routing = condition(options.routing_policy, ["routing_policy", "routing"]);
  if (routing) result.routing_policy = routing;
  const other: Record<string, string> = { ...(options.conditions_other ?? {}) };
  const knownOther = ["deployment", "region", "sandbox", "dataset_revision", "solver", "scorer_version"];
  for (const key of knownOther) {
    const value = optionalText(metadata[key]);
    if (value !== undefined && other[key] === undefined) other[key] = value;
  }
  if (Object.keys(other).length > 0) result.other = other;
  for (const key of ["harness_version", "tools_version", "cache", "context_policy", "routing_policy"] as const) {
    if (result[key] === undefined) limitations.push(`Inspect condition ${key} was not recorded; benchmark comparison is limited`);
  }
  return result;
}

function modelConfig(log: JsonObject, options: InspectBenchmarkImportOptions): BenchmarkModelConfig {
  const evalRecord = isObject(log.eval) ? log.eval : {};
  const config = isObject(evalRecord.model_generate_config) ? evalRecord.model_generate_config : {};
  const model = modelName(log, options);
  const result: BenchmarkModelConfig = { model };
  const provider = options.provider ?? (model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined);
  if (options.model_version) result.model_version = options.model_version;
  if (options.reasoning ?? optionalText(config.reasoning)) result.reasoning = options.reasoning ?? optionalText(config.reasoning);
  if (options.tier ?? optionalText(config.service_tier) ?? optionalText(config.tier)) result.tier = options.tier ?? optionalText(config.service_tier) ?? optionalText(config.tier);
  if (provider) result.provider = provider;
  return result;
}

function sampleFromInspect(
  sample: JsonObject,
  log: JsonObject,
  options: InspectBenchmarkImportOptions,
  sourceId: string,
  digest: string | undefined,
  limitations: string[],
): BenchmarkSample {
  const identity = sampleIdentity(sample);
  const refs = sourceRefs(sourceId, digest, sample);
  const qualityResult = qualityFor(sample, options, refs, limitations);
  const meters = addUsageMeters(sample, modelName(log, options), refs, limitations);
  const latency = secondsToNanoseconds(sample.total_time);
  if (sample.total_time !== undefined && latency === null) limitations.push(`sample ${identity.taskId} has an unavailable total_time`);
  const retries = Array.isArray(sample.error_retries) ? sample.error_retries.length : exactNonnegative(sample.retries);
  const attempts = retries === null ? undefined : String(BigInt(retries) + 1n);
  const result: BenchmarkSample = {
    sample_id: `${identity.taskId}${typeof sample.uuid === "string" && sample.uuid.length > 0 ? `:run:${safePart(sample.uuid)}` : ""}`,
    task_id: identity.taskId,
    accepted: qualityResult.accepted,
    quality: qualityResult.quality,
    passed: qualityResult.accepted,
    passed_score: qualityResult.passedScore,
    meters,
    source_refs: refs,
  };
  if (options.scope_revision) result.scope_revision = options.scope_revision;
  if (options.acceptance_version) result.acceptance_version = options.acceptance_version;
  if (latency !== null) result.latency_ns = latency;
  if (attempts !== undefined) result.attempts = attempts;
  return result;
}

function aggregateUsage(log: JsonObject, primaryModel: string, sourceId: string, digest: string | undefined): EfficiencyQuantity[] {
  const stats = isObject(log.stats) ? log.stats : null;
  const modelUsage = stats && isObject(stats.model_usage) ? stats.model_usage : null;
  if (!modelUsage) return [];
  const sample: JsonObject = { model_usage: modelUsage, id: "aggregate", epoch: 0 };
  return addUsageMeters(sample, primaryModel, sourceRefs(sourceId, digest), []);
}

/** Import an Inspect AI JSON evaluation log into the pricing-free benchmark contract. */
export function importInspectBenchmarkDetailed(input: unknown, options: InspectBenchmarkImportOptions): InspectBenchmarkImportResult {
  const log = parseInput(input);
  const chosen = selection(options);
  void chosen;
  const scorer = nonEmpty(options.scorer, "scorer");
  const role = options.role;
  if (role !== "baseline" && role !== "candidate" && role !== "control") throw new TypeError("role must be baseline, candidate or control");
  const workloadId = nonEmpty(options.workload_id, "workload_id");
  const scopeRevision = nonEmpty(options.scope_revision, "scope_revision");
  const acceptanceVersion = nonEmpty(options.acceptance_version, "acceptance_version");
  const evalRecord = isObject(log.eval) ? log.eval : {};
  const benchmarkId = options.benchmark_id ?? optionalText(evalRecord.eval_id) ?? optionalText(evalRecord.run_id) ?? `inspect-${optionalText(evalRecord.task_id) ?? optionalText(evalRecord.task) ?? "benchmark"}`;
  const datasetId = options.dataset_id ?? benchmarkId;
  const source = captureSource(input, { format: "inspect-ai-json", dataset_id: datasetId, source_id: options.source_id, source_harness: options.harness ?? "inspect-ai" });
  const limitations: string[] = [];
  if (options.evaluation === undefined) limitations.push("evaluation was not declared; imported as historical");
  const evaluation = options.evaluation ?? "historical";
  const conditions = knownMetadata(evalRecord, options, limitations);
  const model = modelConfig(log, options);
  const rawSamples = Array.isArray(log.samples) ? log.samples.filter(isObject) : [];
  const samples = rawSamples.map((sample) => sampleFromInspect(sample, log, { ...options, scorer }, source.id, source.sha256, limitations));
  if (rawSamples.length === 0) limitations.push("Inspect log contains no samples; aggregate statistics are retained only as analysis overhead");
  const aggregate = rawSamples.length === 0 ? aggregateUsage(log, model.model, source.id, source.sha256) : [];
  const evalId = optionalText(evalRecord.eval_id) ?? optionalText(evalRecord.run_id) ?? benchmarkId;
  const provenance = sourceRefs(source.id, source.sha256).concat({ source_id: source.id, record: `eval:${safePart(evalId)}` });
  const benchmark: BenchmarkInput = {
    benchmark_id: benchmarkId,
    role,
    cohort: {
      workload_id: workloadId,
      scope_revision: scopeRevision,
      acceptance_version: acceptanceVersion,
      ...(options.task_class ? { task_class: options.task_class } : {}),
      ...(options.acceptance_criteria_id ? { acceptance_criteria_id: options.acceptance_criteria_id } : {}),
    },
    conditions,
    model_config: model,
    evaluation,
    samples,
    provenance,
    ...(aggregate.length > 0 ? { analysis_overhead: aggregate } : {}),
  };
  return { benchmark, limitations: [...new Set(limitations)] };
}

export function importInspectBenchmark(input: unknown, options: InspectBenchmarkImportOptions): BenchmarkInput {
  return importInspectBenchmarkDetailed(input, options).benchmark;
}

/** Copy an already normalized benchmark without touching source payloads. */
export function normalizeBenchmarkImport(value: BenchmarkInput): BenchmarkInput {
  if (!isObject(value)) throw new TypeError("benchmark input must be an object");
  return clone(value);
}

