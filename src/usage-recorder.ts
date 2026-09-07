import type {
  UsageAccountingScope,
  UsageBundle,
  UsageCountBasis,
  UsageCoverage,
  UsageDimensionFact,
  UsageDimensions,
  UsageEvidence,
  UsageMeasurement,
  UsageMeasurementScope,
  UsageMeter,
  UsageMeterOverlap,
  UsageObservation,
  UsageScalar,
  UsageSource,
  UsageSourceRef,
  UsageStatus,
  UsageTimestamp,
} from "./usage-types.js";
import { normalizeUsageQuantity, normalizeUsageTimestamp } from "./usage-import.js";

export type RecorderValue = string | number | bigint | boolean | null;

export interface UsageRequestDescriptor {
  provider?: RecorderValue;
  product?: RecorderValue;
  service?: RecorderValue;
  api_operation?: RecorderValue;
  model?: RecorderValue;
  requested_model?: RecorderValue;
  service_tier?: RecorderValue;
  requested_tier?: RecorderValue;
  reasoning?: RecorderValue | { effort?: RecorderValue; mode?: RecorderValue; [key: string]: unknown };
  reasoning_effort?: RecorderValue;
  region?: RecorderValue;
  requested_region?: RecorderValue;
  cache_ttl?: RecorderValue;
  cache_write_ttl?: RecorderValue;
  prompt_cache_retention?: RecorderValue;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageResponseDescriptor extends UsageRequestDescriptor {
  actual_model?: RecorderValue;
  response_model?: RecorderValue;
  actual_provider?: RecorderValue;
  applied_tier?: RecorderValue;
  actual_tier?: RecorderValue;
  actual_reasoning?: RecorderValue;
  actual_region?: RecorderValue;
  model_version?: RecorderValue;
}

export interface ExplicitUsageMeasurement {
  value: RecorderValue;
  unit?: string;
  description?: string;
  subset_of?: string | null;
  overlap?: UsageMeterOverlap;
  evidence?: UsageEvidence;
  method?: string;
  source_refs?: UsageSourceRef[];
  count_basis?: UsageCountBasis;
  aggregation?: "delta" | "cumulative" | "unknown";
  scope?: UsageMeasurementScope;
}

export type UsageMeasurementInput = RecorderValue | ExplicitUsageMeasurement;

export interface UsageEventInput {
  id?: string;
  subject?: string;
  operation_id?: string | null;
  parent_id?: string | null;
  agent_id?: string | null;
  session_id?: string | null;
  work_item_id?: string | null;
  task_id?: string | null;
  status?: UsageStatus;
  accounting_scope?: UsageAccountingScope;
  event_at?: string | number | bigint | null;
  started_at?: string | number | bigint | null;
  ended_at?: string | number | bigint | null;
  collected_at?: string | number | bigint | null;
  dimensions?: UsageDimensions;
  request?: UsageRequestDescriptor;
  response?: UsageResponseDescriptor;
  measurements?: Record<string, UsageMeasurementInput>;
  meters?: Record<string, Partial<UsageMeter>>;
  /** Accepted for ergonomic wrappers but deliberately ignored. */
  raw?: unknown;
  [key: string]: unknown;
}

export interface UsageModelCallInput extends UsageEventInput {
  request?: UsageRequestDescriptor;
  response?: UsageResponseDescriptor;
  usage?: Record<string, UsageMeasurementInput>;
}

export interface UsageToolCallInput extends UsageEventInput {
  name?: string;
  tool?: string;
  result?: unknown;
  error?: unknown;
}

export interface UsageRecorderOptions {
  dataset_id: string;
  source_id?: string;
  harness?: string;
  format?: string;
  version?: string;
  description?: string;
  max_observations?: number;
  max_measurements_per_observation?: number;
  default_agent_id?: string;
  default_session_id?: string;
  default_work_item_id?: string;
  default_task_id?: string;
  collected_at?: string | number | bigint;
}

export interface UsageCallHandle {
  readonly id: string;
  end(response?: UsageResponseDescriptor | UsageEventInput): UsageObservation | null;
  fail(error?: unknown, response?: UsageResponseDescriptor | UsageEventInput): UsageObservation | null;
}

const CANONICAL_METERS: Record<string, UsageMeter> = {
  input_tokens: { id: "input_tokens", unit: "tokens", description: "Inclusive provider input tokens", subset_of: null, overlap: "disjoint" },
  output_tokens: { id: "output_tokens", unit: "tokens", description: "Provider output tokens", subset_of: null, overlap: "disjoint" },
  cache_read_input_tokens: { id: "cache_read_input_tokens", unit: "tokens", description: "Input tokens reported as cache reads", subset_of: "input_tokens", overlap: "subset" },
  cache_write_input_tokens: { id: "cache_write_input_tokens", unit: "tokens", description: "Input tokens reported as cache writes", subset_of: "input_tokens", overlap: "subset" },
  reasoning_output_tokens: { id: "reasoning_output_tokens", unit: "tokens", description: "Output tokens reported as reasoning", subset_of: "output_tokens", overlap: "subset" },
  tool_calls: { id: "tool_calls", unit: "calls", description: "Tool or search calls", subset_of: null, overlap: "disjoint" },
  duration_ns: { id: "duration_ns", unit: "ns", description: "Observed duration in nanoseconds", subset_of: null, overlap: "disjoint" },
};

const SAFE_CONTEXT_KEYS = /^(?:max_(?:input|output)_tokens|top_p|temperature|seed|timeout_ms|cache_ttl|service_tier|reasoning_effort)$/iu;
const RESERVED_INPUT_KEYS = /(?:^|_)(?:prompt|completion|content|messages?|text|body|header|authorization|auth|credential(?:s)?|access_token|bearer|api_key|secret|password|private_key|raw|result|input|output)(?:$|_)/u;

function isReservedInputKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").toLowerCase();
  if (/^(?:max_(?:input|output)_tokens|top_p|temperature|seed|timeout_ms|cache_ttl|service_tier|reasoning_effort)$/u.test(normalized) || SAFE_CONTEXT_KEYS.test(key)) return false;
  return RESERVED_INPUT_KEYS.test(normalized);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): UsageScalar | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/** Keep recorder output schema-valid while retaining unsafe integers as unknown. */
function measurementValue(value: unknown, meterId: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`measurement ${meterId} must be a finite non-negative quantity`);
    // The caller supplied a Number whose integer precision is already lost;
    // preserve the observation as unknown instead of inventing a counter.
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  } else if (typeof value === "bigint") {
    if (value < 0n) throw new TypeError(`measurement ${meterId} must be non-negative`);
  } else if (typeof value !== "string") {
    throw new TypeError(`measurement ${meterId} must be a non-negative decimal string, number or bigint`);
  }
  const normalized = normalizeUsageQuantity(value);
  if (normalized === null) throw new TypeError(`measurement ${meterId} must be a canonical non-negative decimal`);
  return normalized;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const result = text(value);
    if (result !== null) return result;
  }
  return null;
}

const EVENT_INPUT_KEYS = new Set([
  "id", "subject", "operation_id", "parent_id", "agent_id", "session_id", "work_item_id", "task_id",
  "status", "accounting_scope", "event_at", "started_at", "ended_at", "collected_at", "dimensions",
  "measurements", "meters",
]);

function nowTimestamp(): string {
  return new Date().toISOString();
}

function responseUpdate(value: UsageResponseDescriptor | UsageEventInput | undefined): UsageEventInput {
  if (value === undefined) return {};
  if (isObject(value) && Object.keys(value).some((key) => EVENT_INPUT_KEYS.has(key))) return value as UsageEventInput;
  const descriptor = value as UsageResponseDescriptor & { usage?: Record<string, UsageMeasurementInput> };
  return {
    response: descriptor,
    ...(isObject(descriptor.usage) ? { measurements: descriptor.usage } : {}),
  };
}

function sourceRef(sourceId: string, record: string): UsageSourceRef {
  return { source_id: sourceId, record };
}

function timestamp(value: unknown, sourceId: string, record: string, label: string): UsageTimestamp | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeUsageTimestamp(value);
  return { value: normalized, evidence: normalized === null ? "unknown" : "observed", method: `${label} supplied to recorder`, source_refs: [sourceRef(sourceId, record)] };
}

function randomOpaqueId(prefix: string, sequence: number): string {
  const cryptoObject = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const random = cryptoObject?.randomUUID?.();
  return `${prefix}:${random ?? `${Date.now().toString(36)}-${sequence.toString(36)}`}`;
}

type MeterDefinitionInput = Partial<UsageMeter> | ExplicitUsageMeasurement | undefined;

function meterInputField(input: MeterDefinitionInput, field: "id" | "unit" | "description" | "subset_of" | "overlap"): unknown {
  if (!isObject(input)) return undefined;
  return input[field];
}

/** Resolve meter metadata from the existing registry, an input definition and
 * an explicit measurement descriptor without silently changing semantics. */
function meterFor(id: string, ...inputs: MeterDefinitionInput[]): UsageMeter {
  const canonical = CANONICAL_METERS[id];
  const defaults: UsageMeter = canonical ? { ...canonical } : {
    id,
    unit: id.includes("token") ? "tokens" : "count",
    description: `Explicit ${id} measurement`,
    subset_of: null,
    overlap: "unknown",
  };
  const explicit: Partial<Pick<UsageMeter, "unit" | "description" | "subset_of" | "overlap">> = {};
  const fields = ["unit", "description", "subset_of", "overlap"] as const;
  for (const input of inputs) {
    if (!input) continue;
    const inputId = meterInputField(input, "id");
    if (inputId !== undefined && inputId !== id) throw new TypeError(`meter ${id} definition has a conflicting id`);
    for (const field of fields) {
      const value = meterInputField(input, field);
      if (value === undefined) continue;
      if (field === "unit" || field === "description") {
        if (typeof value !== "string" || value.length === 0) throw new TypeError(`meter ${id} ${field} must be a non-empty string`);
      } else if (field === "subset_of") {
        if (value !== null && typeof value !== "string") throw new TypeError(`meter ${id} subset_of must be a string or null`);
      } else if (value !== "disjoint" && value !== "subset" && value !== "overlap" && value !== "unknown") {
        throw new TypeError(`meter ${id} overlap is invalid`);
      }
      const prior = explicit[field];
      if (prior !== undefined && prior !== value) throw new TypeError(`meter ${id} has conflicting ${field} definitions`);
      if (canonical && canonical[field] !== value) throw new TypeError(`meter ${id} cannot override canonical ${field}`);
      if (field === "unit" || field === "description") explicit[field] = value as string;
      else if (field === "subset_of") explicit[field] = value as string | null;
      else explicit[field] = value as UsageMeterOverlap;
    }
  }
  const result: UsageMeter = {
    ...defaults,
    ...(explicit.unit !== undefined ? { unit: explicit.unit } : {}),
    ...(explicit.description !== undefined ? { description: explicit.description } : {}),
    ...(explicit.subset_of !== undefined ? { subset_of: explicit.subset_of } : {}),
    ...(explicit.overlap !== undefined ? { overlap: explicit.overlap } : {}),
  };
  if (result.overlap === "subset" && result.subset_of === null) throw new TypeError(`meter ${id} subset overlap requires subset_of`);
  return result;
}

function descriptorDimensions(
  request: UsageRequestDescriptor | undefined,
  response: UsageResponseDescriptor | undefined,
  dimensions: UsageDimensions | undefined,
  sourceId: string,
  record: string,
): UsageDimensions {
  const result: UsageDimensions = {};
  const knownDimensionKeys = new Set([
    "requested_provider", "actual_provider", "provider", "service", "product", "api_operation",
    "requested_model", "actual_model", "model", "requested_tier", "actual_tier", "tier",
    "requested_reasoning", "actual_reasoning", "reasoning", "requested_region", "actual_region", "region",
    "cache_ttl", "cache_behavior", "deployment", "sku",
  ]);
  const copyFact = (value: unknown, label: string): UsageDimensionFact | undefined => {
    if (!isObject(value)) return undefined;
    const scalarValue = scalar(value.value);
    if (scalarValue === undefined) return undefined;
    const evidence = scalarValue === null ? "unknown" : value.evidence === "observed" || value.evidence === "declared" || value.evidence === "derived" || value.evidence === "estimated" || value.evidence === "unknown" ? value.evidence : "observed";
    const refs = Array.isArray(value.source_refs) && value.source_refs.length > 0 ? structuredClone(value.source_refs) as UsageSourceRef[] : [sourceRef(sourceId, record)];
    return { value: scalarValue, evidence, method: typeof value.method === "string" && value.method.length > 0 ? value.method : `recorder ${label}`, source_refs: refs };
  };
  if (isObject(dimensions)) {
    for (const [key, value] of Object.entries(dimensions)) {
      if (key === "extensions") {
        if (!isObject(value)) continue;
        const extensions: NonNullable<UsageDimensions["extensions"]> = {};
        for (const [extensionKey, extensionValue] of Object.entries(value)) {
          if (!extensionKey.includes(".") || isReservedInputKey(extensionKey)) continue;
          const safeFact = copyFact(extensionValue, `extension ${extensionKey}`);
          if (safeFact) extensions[extensionKey] = safeFact;
        }
        if (Object.keys(extensions).length > 0) result.extensions = extensions;
      } else if (knownDimensionKeys.has(key) && isObject(value)) {
        // Known dimensions are copied as typed facts; their values are scalar
        // metadata and never include prompt/result payloads.
        const safeFact = copyFact(value, key);
        if (safeFact) (result as Record<string, unknown>)[key] = safeFact;
      }
    }
  }
  const makeFact = (value: unknown, label: string): UsageDimensions[keyof UsageDimensions] | undefined => {
    const scalarValue = scalar(value);
    if (scalarValue === undefined) return undefined;
    return { value: scalarValue, evidence: scalarValue === null ? "unknown" : "observed", method: `recorder ${label}`, source_refs: [sourceRef(sourceId, record)] };
  };
  const set = (key: keyof UsageDimensions, value: unknown, label: string): void => {
    const fact = makeFact(value, label);
    if (fact !== undefined) (result as Record<string, unknown>)[key] = fact;
  };
  const requestReasoning = isObject(request?.reasoning) ? request.reasoning.effort ?? request.reasoning.mode : request?.reasoning;
  const responseReasoning = isObject(response?.reasoning) ? response.reasoning.mode ?? response.reasoning.effort : response?.reasoning;
  set("requested_provider", request?.provider, "requested provider");
  set("actual_provider", response?.actual_provider ?? response?.provider, "applied provider");
  set("provider", request?.provider ?? response?.provider, "provider");
  set("service", request?.service ?? response?.service, "service");
  set("product", request?.product ?? response?.product, "product");
  set("api_operation", request?.api_operation ?? response?.api_operation, "API operation");
  set("requested_model", request?.requested_model ?? request?.model, "requested model");
  set("actual_model", response?.actual_model ?? response?.response_model ?? response?.model ?? response?.model_version, "applied model");
  set("requested_tier", request?.requested_tier ?? request?.service_tier, "requested service tier");
  set("actual_tier", response?.actual_tier ?? response?.applied_tier ?? response?.service_tier, "applied service tier");
  set("requested_reasoning", requestReasoning ?? request?.reasoning_effort, "requested reasoning");
  set("actual_reasoning", response?.actual_reasoning ?? responseReasoning, "applied reasoning");
  set("requested_region", request?.requested_region ?? request?.region, "requested region");
  set("actual_region", response?.actual_region ?? response?.region, "applied region");
  set("cache_ttl", request?.cache_ttl ?? request?.cache_write_ttl ?? request?.prompt_cache_retention, "cache write TTL");
  const context = request?.context;
  if (context) {
    const namespace = first(request.provider, response?.provider) ?? "harness";
    const existing = result.extensions ?? {};
    for (const [key, value] of Object.entries(context)) {
      if (isReservedInputKey(key)) continue;
      const fact = makeFact(value, `request context ${key}`);
      if (fact !== undefined) existing[`${namespace}.context.${key}`] = fact as UsageDimensions["extensions"] extends Record<string, infer T> | undefined ? T : never;
    }
    if (Object.keys(existing).length > 0) result.extensions = existing;
  }
  return result;
}

function measurement(
  id: string,
  raw: UsageMeasurementInput,
  sourceId: string,
  record: string,
  meter: UsageMeter,
  defaultScope: UsageMeasurementScope,
  defaultAccounting: UsageAccountingScope,
): UsageMeasurement {
  const descriptor = isObject(raw) && "value" in raw ? raw as ExplicitUsageMeasurement : null;
  const value = measurementValue(descriptor ? descriptor.value : raw, id);
  const suppliedEvidence = descriptor?.evidence;
  const evidence = suppliedEvidence === undefined
    ? value === null ? "unknown" : "observed"
    : suppliedEvidence === "observed" || suppliedEvidence === "declared" || suppliedEvidence === "derived" || suppliedEvidence === "estimated" || suppliedEvidence === "unknown"
      ? suppliedEvidence
      : (() => { throw new TypeError(`measurement ${id} has invalid evidence`); })();
  if ((value === null) !== (evidence === "unknown")) throw new TypeError(`measurement ${id} must use unknown evidence exactly when unavailable`);
  const method = descriptor?.method ?? "recorder explicit measurement";
  if (typeof method !== "string" || method.length === 0) throw new TypeError(`measurement ${id} method must be a non-empty string`);
  return {
    value,
    evidence,
    method,
    source_refs: descriptor?.source_refs?.length ? structuredClone(descriptor.source_refs) : [sourceRef(sourceId, record)],
    count_basis: descriptor?.count_basis ?? "consumed",
    aggregation: descriptor?.aggregation ?? (defaultAccounting === "snapshot" ? "cumulative" : "delta"),
    scope: descriptor?.scope ?? defaultScope,
  };
}

function inferStatus(input: UsageEventInput): UsageStatus {
  if (input.status) return input.status;
  return "ok";
}

/**
 * Bounded, metadata-only usage recorder. It observes caller-supplied facts;
 * it never invokes a provider, computes a price, or retains prompts/results.
 */
export class UsageRecorder {
  private readonly options: Required<Pick<UsageRecorderOptions, "dataset_id" | "harness" | "format" | "max_observations" | "max_measurements_per_observation">> & UsageRecorderOptions;
  private readonly sourceId: string;
  private readonly source: UsageSource;
  private readonly meters = new Map<string, UsageMeter>();
  private readonly observations = new Map<string, UsageObservation>();
  private sequence = 0;
  private dropped = 0;
  private droppedMeasurements = 0;

  constructor(options: UsageRecorderOptions) {
    if (!options || typeof options.dataset_id !== "string" || options.dataset_id.trim().length === 0) throw new TypeError("UsageRecorder dataset_id is required");
    this.options = {
      ...options,
      dataset_id: options.dataset_id,
      harness: options.harness ?? "recorder",
      format: options.format ?? "usage-recorder",
      max_observations: options.max_observations ?? 10_000,
      max_measurements_per_observation: options.max_measurements_per_observation ?? 128,
    };
    if (!Number.isSafeInteger(this.options.max_observations) || this.options.max_observations < 1 ||
      !Number.isSafeInteger(this.options.max_measurements_per_observation) || this.options.max_measurements_per_observation < 1) {
      throw new RangeError("UsageRecorder bounds must be positive safe integers");
    }
    this.sourceId = options.source_id ?? randomOpaqueId("source", ++this.sequence);
    this.source = {
      id: this.sourceId,
      harness: this.options.harness,
      format: this.options.format,
      ...(options.version ? { version: options.version } : {}),
      coverage: "complete",
      description: options.description ?? "Metadata-only usage recorder; raw prompts and responses are omitted. Custom metadata remains caller-controlled.",
    };
    for (const [id, definition] of Object.entries(CANONICAL_METERS)) this.meters.set(id, { ...definition });
  }

  /** Source evidence retained by this recorder, including any bounded loss. */
  captureSource(): UsageSource {
    const losses: string[] = [];
    if (this.dropped > 0) losses.push(`Dropped ${this.dropped} event(s)`);
    if (this.droppedMeasurements > 0) losses.push(`omitted ${this.droppedMeasurements} measurement(s)`);
    return { ...this.source, coverage: losses.length > 0 ? "partial" : this.source.coverage, description: losses.length > 0 ? `${this.source.description ?? ""} ${losses.join(" and ")} at the configured capture bound.`.trim() : this.source.description };
  }

  private nextId(prefix = "observation"): string {
    this.sequence += 1;
    return randomOpaqueId(prefix, this.sequence);
  }

  private accept(input: UsageEventInput, subject: string, defaultAccounting: UsageAccountingScope): UsageObservation | null {
    const id = input.id ?? this.nextId("observation");
    const prior = this.observations.get(id);
    if (!prior && this.observations.size >= this.options.max_observations) { this.dropped += 1; return null; }
    const record = `observation:${id}`;
    const accounting = input.accounting_scope ?? defaultAccounting;
    const requestedMeasurements = input.measurements ?? input.usage ?? {};
    const measurementEntries = Object.entries(requestedMeasurements).slice(0, this.options.max_measurements_per_observation);
    if (Object.keys(requestedMeasurements).length > measurementEntries.length) this.droppedMeasurements += Object.keys(requestedMeasurements).length - measurementEntries.length;
    const measurements: Record<string, UsageMeasurement> = {};
    for (const [meterId, raw] of measurementEntries) {
      const descriptor = isObject(raw) && "value" in raw ? raw as unknown as ExplicitUsageMeasurement : undefined;
      const definition = meterFor(meterId, this.meters.get(meterId), input.meters?.[meterId], descriptor);
      this.meters.set(meterId, definition);
      measurements[meterId] = measurement(meterId, raw, this.sourceId, record, definition, accounting === "snapshot" ? "snapshot" : "event", accounting);
    }
    const observation: UsageObservation = {
      id,
      source_refs: [sourceRef(this.sourceId, record)],
      subject,
      accounting_scope: accounting,
      operation_id: input.operation_id ?? id,
      parent_id: input.parent_id ?? null,
      agent_id: input.agent_id ?? this.options.default_agent_id ?? null,
      session_id: input.session_id ?? this.options.default_session_id ?? null,
      work_item_id: input.work_item_id ?? this.options.default_work_item_id ?? null,
      task_id: input.task_id ?? this.options.default_task_id ?? null,
      status: inferStatus(input),
      event_at: timestamp(input.event_at, this.sourceId, record, "event"),
      started_at: timestamp(input.started_at, this.sourceId, record, "start"),
      ended_at: timestamp(input.ended_at, this.sourceId, record, "end"),
      collected_at: timestamp(input.collected_at ?? this.options.collected_at, this.sourceId, record, "collection"),
      measurements,
      dimensions: descriptorDimensions(input.request, input.response, input.dimensions, this.sourceId, record),
    };
    this.observations.set(id, observation);
    return structuredClone(observation);
  }

  /** Record a metadata-only lifecycle/activity event. */
  recordEvent(input: UsageEventInput): string | null {
    return this.accept(input, input.subject ?? "activity", input.accounting_scope ?? "direct")?.id ?? null;
  }

  /** Record one model request/response boundary and caller-measured meters. */
  recordModelCall(input: UsageModelCallInput): UsageObservation {
    const observation = this.accept(input, "model.response", "direct");
    if (!observation) throw new RangeError("UsageRecorder observation bound reached");
    return observation;
  }

  /** Record one tool call; `result` and `error` are intentionally discarded. */
  recordToolCall(input: UsageToolCallInput): UsageObservation {
    const name = first(input.name, input.tool) ?? "unknown";
    const observation = this.accept(input, `tool.${name}`, "direct");
    if (!observation) throw new RangeError("UsageRecorder observation bound reached");
    return observation;
  }

  /** Add or replace one explicit meter on an already retained observation. */
  recordMeasurement(observationId: string, meterId: string, raw: UsageMeasurementInput, definition?: Partial<UsageMeter>): boolean {
    const observation = this.observations.get(observationId);
    if (!observation) return false;
    if (!(meterId in observation.measurements) && Object.keys(observation.measurements).length >= this.options.max_measurements_per_observation) { this.droppedMeasurements += 1; return false; }
    const descriptor = isObject(raw) && "value" in raw ? raw as ExplicitUsageMeasurement : undefined;
    const meter = meterFor(meterId, this.meters.get(meterId), definition, descriptor);
    this.meters.set(meterId, meter);
    observation.measurements[meterId] = measurement(meterId, raw, this.sourceId, `observation:${observationId}`, meter, observation.accounting_scope === "snapshot" ? "snapshot" : "event", observation.accounting_scope);
    return true;
  }

  /** Begin a caller-managed model scope that can be closed after an asynchronous provider call. */
  startModelCall(input: UsageModelCallInput): UsageCallHandle {
    const startedAt = input.started_at ?? nowTimestamp();
    const initial = this.recordModelCall({ ...input, status: input.status ?? "running", started_at: startedAt, event_at: input.event_at ?? startedAt });
    let closed = false;
    return {
      id: initial.id,
      end: (response) => {
        if (closed) return null;
        closed = true;
        return this.update(initial.id, { ...responseUpdate(response), status: "ok", ended_at: nowTimestamp() });
      },
      fail: (error, response) => {
        if (closed) return null;
        closed = true;
        return this.update(initial.id, { ...responseUpdate(response), status: "error", ended_at: nowTimestamp(), error });
      },
    };
  }

  /** Alias for callers that use `begin` for async model scopes. */
  beginModelCall(input: UsageModelCallInput): UsageCallHandle {
    return this.startModelCall(input);
  }

  /** Execute a callback inside a bounded model scope without retaining its return value. */
  async withModelCall<T>(input: UsageModelCallInput, callback: () => T | Promise<T>): Promise<T> {
    const scope = this.startModelCall(input);
    try {
      const result = await callback();
      scope.end();
      return result;
    } catch (error) {
      scope.fail(error);
      throw error;
    }
  }

  async runModelCall<T>(input: UsageModelCallInput, callback: () => T | Promise<T>): Promise<T> {
    return this.withModelCall(input, callback);
  }

  private update(id: string, input: UsageEventInput): UsageObservation | null {
    const prior = this.observations.get(id);
    if (!prior) return null;
    const mergedMeasurements = input.measurements === undefined
      ? prior.measurements
      : { ...prior.measurements, ...input.measurements };
    const merged: UsageEventInput = {
      ...input,
      id,
      operation_id: input.operation_id ?? prior.operation_id,
      parent_id: input.parent_id ?? prior.parent_id,
      agent_id: input.agent_id ?? prior.agent_id,
      session_id: input.session_id ?? prior.session_id,
      work_item_id: input.work_item_id ?? prior.work_item_id,
      task_id: input.task_id ?? prior.task_id,
      request: input.request,
      response: input.response,
      dimensions: input.dimensions ?? prior.dimensions,
      measurements: mergedMeasurements,
      event_at: input.event_at ?? prior.event_at?.value,
      started_at: input.started_at ?? prior.started_at?.value,
      ended_at: input.ended_at ?? prior.ended_at?.value,
      collected_at: input.collected_at ?? prior.collected_at?.value,
    };
    const next = this.accept(merged, prior.subject ?? "activity", prior.accounting_scope);
    if (!next) return null;
    if (next.started_at === null) next.started_at = prior.started_at;
    if (next.ended_at === null) next.ended_at = prior.ended_at;
    if (next.event_at === null) next.event_at = prior.event_at;
    if (Object.keys(next.measurements).length === 0) next.measurements = prior.measurements;
    this.observations.set(id, next);
    return structuredClone(next);
  }

  /** Immutable deep snapshot suitable for a report/export consumer. */
  snapshot(): UsageBundle {
    const coverage: UsageCoverage = {
      boundary: "instrumented",
      complete: this.dropped === 0 && this.droppedMeasurements === 0,
      dropped_observations: this.dropped,
      ...(this.dropped > 0 ? { dropped_by_source: { [this.sourceId]: this.dropped } } : {}),
      limitations: ["Recorder retains caller-supplied usage metadata only; provider-side work and raw prompts/responses are unknown."],
    };
    if (this.dropped > 0 || this.droppedMeasurements > 0) coverage.limitations.push("Configured capture bounds dropped one or more events or measurements.");
    if (this.droppedMeasurements > 0) coverage.limitations.push(`${this.droppedMeasurements} measurement(s) were omitted after the per-observation measurement bound.`);
    return structuredClone({
      schema_version: "0.4.0" as const,
      dataset_id: this.options.dataset_id,
      sources: [this.captureSource()],
      meters: [...this.meters.values()].sort((left, right) => left.id.localeCompare(right.id)),
      observations: [...this.observations.values()].map((observation) => structuredClone(observation)),
      coverage,
    });
  }
}

export function createUsageRecorder(options: UsageRecorderOptions): UsageRecorder {
  return new UsageRecorder(options);
}
