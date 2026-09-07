/**
 * Produce the bounded v0.2 real-work dogfood artifacts.
 *
 * This file deliberately reads exactly two Codex rollout logs. It projects
 * only allowlisted metadata and counters into the checked-in JSONL streams;
 * prompts, messages, tool arguments/results, paths and reasoning are never
 * copied to an output artifact.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  advanceCapture,
  createContextReport,
  createHarnessProfile,
  importEvidence,
  joinWorkItemEvidence,
  reconstructNativeContext,
  validateCaptureState,
  validateContextReport,
  validateEvidence,
  validateHarnessProfile,
  validateWorkItem,
  valueEvidence,
} from "../src/pricing.js";
import type {
  CaptureState,
  ContextBundle,
  HarnessProfile,
} from "../src/pricing.js";
import type { EvidenceBundle, Valuation } from "../src/types.js";
import type { WorkItem, WorkItemEvidenceRecord } from "../src/work-items.js";

const DATASET_ID = "context-producer-proof-v02";
const WORK_ITEM_ID = "context-producer-proof";
const CUTOFF = "2026-09-06T21:03:01.300Z";
const ROOT_START = "2026-09-06T19:51:07.000Z";
const PRODUCER_START = "2026-09-06T20:46:09.000Z";
const PRODUCER_REPORTED_END = "2026-09-06T20:56:13.000Z";
const CLI_VERSION = "0.153.4";
const SESSION_ROOT = join(homedir(), ".codex", "sessions", "2026", "09", "06");
const ROOT_LOG = join(SESSION_ROOT, "rollout-2026-09-06T16-24-23-01a07752-1695-7810-885b-5eb1116b919e.jsonl");
const PRODUCER_LOG = join(SESSION_ROOT, "rollout-2026-09-06T21-45-33-01a07878-1e54-7d20-b427-708c0b34b5dd.jsonl");
const OUTPUT_DIR = new URL("../examples/dogfood/v02/", import.meta.url);
const WORK_ITEM_PATH = new URL("../examples/work-items/context-producer-proof.json", import.meta.url);
let currentPhase = "initialization";

type JsonObject = Record<string, unknown>;
type RawRecord = { type: string; timestamp: string; ordinal: number; payload: JsonObject };
type CounterValue = number | string;
type StreamAlias = "root-accounting" | "independent-producer";

interface StreamSpec {
  alias: StreamAlias;
  sourcePath: string;
  start: string;
  captureNamespace: string;
  agentId?: string;
  workItemId?: string;
  attemptStart?: string;
  attemptEnd?: string;
}

interface DirectSummary {
  count: number;
  category_sums: {
    input_tokens: string | null;
    output_tokens: string | null;
    cache_read_input_tokens: string | null;
    cache_write_input_tokens: string | null;
    reasoning_output_tokens: string | null;
    native_total_tokens: string | null;
  };
  accounting_scope_counts: { direct: number; snapshot: number; aggregate: number; unknown: number };
  model_counts: Record<string, number>;
  source_ids: string[];
}

interface StreamResult {
  spec: StreamSpec;
  raw: RawRecord[];
  sanitized: string;
  sanitizedRows: RawRecord[];
  state: CaptureState;
  prefixState: CaptureState;
  replayState: CaptureState;
  oneShot: EvidenceBundle;
  direct: DirectSummary;
  oneShotDirect: DirectSummary;
  valuation: Valuation;
  oneShotValuation: Valuation;
  context: ContextBundle;
  profile: HarnessProfile;
  workItemRecord?: WorkItemEvidenceRecord;
  report?: ReturnType<typeof createContextReport>;
  reportAttempt: JsonObject;
  directIds: string[];
  selectedUsageCount: number;
  excludedUsageCount: number;
  duplicateResponseIds: number;
  firstSelectedUsageTimestamp: string | null;
  lastSelectedUsageTimestamp: string | null;
  selectedTokenCountRows: number;
  selectedCompactionRows: number;
  rawPrefixRows: number;
  rawPrefixSha256: string;
  artifactSizes: Record<string, number>;
}

const SPECS: StreamSpec[] = [
  {
    alias: "root-accounting",
    sourcePath: ROOT_LOG,
    start: ROOT_START,
    captureNamespace: "v02-root-accounting",
    agentId: "coordinator",
  },
  {
    alias: "independent-producer",
    sourcePath: PRODUCER_LOG,
    start: PRODUCER_START,
    captureNamespace: "v02-independent-producer",
    agentId: "independent-producer",
    workItemId: WORK_ITEM_ID,
    attemptStart: PRODUCER_START,
    attemptEnd: PRODUCER_REPORTED_END,
  },
];

const ID_FIELDS = new Set([
  "id",
  "session_id",
  "parent_thread_id",
  "thread_id",
  "turn_id",
  "root_turn_id",
  "response_id",
  "window_id",
  "previous_window_id",
  "first_window_id",
]);
const USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("DOGFOOD_INVALID_ID");
  return `sha256:${sha256(value)}`;
}

function counter(value: unknown): CounterValue {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  throw new Error("DOGFOOD_INVALID_COUNTER");
}

function maybeCounter(value: unknown): CounterValue | null {
  if (value === undefined || value === null) return null;
  return counter(value);
}

function timestampInRange(timestamp: string, start?: string): boolean {
  const current = Date.parse(timestamp);
  const upper = Date.parse(CUTOFF);
  if (!Number.isFinite(current) || current > upper) return false;
  return start === undefined || current >= Date.parse(start);
}

function parseLog(path: string): { text: string; rows: RawRecord[]; rawPrefixRows: number; rawPrefixSha256: string } {
  const text = readFileSync(path, "utf8");
  const totalBytes = Buffer.byteLength(text, "utf8");
  const rows: RawRecord[] = [];
  const lines = text.split(/\r?\n/);
  const lastNonEmptyLine = lines.reduce((last, line, index) => line.trim().length > 0 ? index : last, -1);
  let rawPrefixRows = 0;
  let rawPrefixEnd = 0;
  let offset = 0;
  for (const [lineIndex, rawLine] of lines.entries()) {
    const lineBytes = Buffer.byteLength(rawLine, "utf8");
    const newlineBytes = offset + lineBytes < totalBytes ? 1 : 0;
    const trimmed = rawLine.trim();
    if (trimmed.length > 0) {
      let parsed: JsonObject;
      try {
        parsed = JSON.parse(trimmed) as JsonObject;
      } catch (error) {
        // A log can be read while its final JSONL frame is still being
        // written. The frozen cutoff excludes that incomplete tail.
        if (lineIndex === lastNonEmptyLine) {
          offset += lineBytes + newlineBytes;
          continue;
        }
        throw error;
      }
      const payload = object(parsed.payload);
      const type = typeof parsed.type === "string" ? parsed.type : "";
      const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
      const ordinal = typeof parsed.ordinal === "number" && Number.isSafeInteger(parsed.ordinal) ? parsed.ordinal : rows.length;
      rows.push({ type, timestamp, ordinal, payload });
      if (timestampInRange(timestamp)) {
        rawPrefixRows += 1;
        rawPrefixEnd = offset + lineBytes + newlineBytes;
      }
    }
    offset += lineBytes + newlineBytes;
  }
  const bytes = Buffer.from(text, "utf8");
  return { text, rows, rawPrefixRows, rawPrefixSha256: sha256(bytes.subarray(0, rawPrefixEnd)) };
}

function pickIds(payload: JsonObject, names: readonly string[]): JsonObject {
  const result: JsonObject = {};
  for (const name of names) {
    if (payload[name] !== undefined && payload[name] !== null) result[name] = hashId(payload[name]);
  }
  return result;
}

function pickCounters(payload: JsonObject, names: readonly string[] = USAGE_FIELDS): JsonObject {
  const result: JsonObject = {};
  for (const name of names) {
    const value = maybeCounter(payload[name]);
    if (value !== null) result[name] = value;
  }
  return result;
}

function sanitizeUsageRecord(row: RawRecord): JsonObject {
  const payload = row.payload;
  const result: JsonObject = {
    ...pickIds(payload, ["response_id", "thread_id", "session_id", "turn_id", "root_turn_id"]),
    usage: pickCounters(object(payload.usage)),
  };
  for (const nested of ["thread_token_usage", "turn_token_usage"] as const) {
    const counters = pickCounters(object(payload[nested]));
    if (Object.keys(counters).length > 0) result[nested] = counters;
  }
  return { timestamp: row.timestamp, type: "token_usage_record", ordinal: row.ordinal, payload: result };
}

function sanitizeSessionMeta(row: RawRecord): JsonObject {
  const payload = row.payload;
  return {
    timestamp: row.timestamp,
    type: "session_meta",
    ordinal: row.ordinal,
    payload: {
      ...pickIds(payload, ["id", "session_id", "parent_thread_id"]),
      ...(typeof payload.cli_version === "string" ? { cli_version: payload.cli_version } : {}),
    },
  };
}

function sanitizeTurnContext(row: RawRecord): JsonObject {
  const payload = row.payload;
  return {
    timestamp: row.timestamp,
    type: "turn_context",
    ordinal: row.ordinal,
    payload: {
      ...pickIds(payload, ["turn_id", "root_turn_id"]),
      ...(typeof payload.model === "string" ? { model: payload.model } : {}),
      ...(typeof payload.effort === "string" ? { effort: payload.effort } : {}),
    },
  };
}

function sanitizeTokenCount(row: RawRecord): JsonObject {
  const payload = row.payload;
  const info = object(payload.info);
  const result: JsonObject = {
    type: "token_count",
    ...pickIds(payload, ["thread_id", "turn_id"]),
    info: {},
  };
  for (const name of ["last_token_usage", "total_token_usage"] as const) {
    const counters = pickCounters(object(info[name]));
    if (Object.keys(counters).length > 0) (result.info as JsonObject)[name] = counters;
  }
  return { timestamp: row.timestamp, type: "event_msg", ordinal: row.ordinal, payload: result };
}

function sanitizeCompaction(row: RawRecord): JsonObject {
  const payload = row.payload;
  return {
    timestamp: row.timestamp,
    type: "compacted",
    ordinal: row.ordinal,
    payload: {
      ...(payload.window_number === undefined ? {} : { window_number: counter(payload.window_number) }),
      ...pickIds(payload, ["first_window_id", "previous_window_id", "window_id"]),
    },
  };
}

function safeSanitize(row: RawRecord): JsonObject | undefined {
  if (row.type === "session_meta") return sanitizeSessionMeta(row);
  if (row.type === "turn_context") return sanitizeTurnContext(row);
  if (row.type === "token_usage_record") return sanitizeUsageRecord(row);
  if (row.type === "event_msg" && row.payload.type === "token_count") return sanitizeTokenCount(row);
  if (row.type === "compacted") return sanitizeCompaction(row);
  return undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitizeRows(spec: StreamSpec, rows: RawRecord[]): { rows: RawRecord[]; text: string; selectedUsageCount: number; excludedUsageCount: number; selectedTokenCountRows: number; selectedCompactionRows: number } {
  const usageRows = rows.filter((row) => row.type === "token_usage_record");
  const selectedUsage = usageRows.filter((row) => timestampInRange(row.timestamp, spec.start));
  const latestPriorContext = rows.filter((row) => row.type === "turn_context" && Date.parse(row.timestamp) < Date.parse(spec.start) && timestampInRange(row.timestamp)).at(-1);
  const selected = rows.filter((row) => {
    if (row.type === "session_meta") return timestampInRange(row.timestamp);
    if (row.type === "turn_context") return row === latestPriorContext || timestampInRange(row.timestamp, spec.start);
    if (row.type === "token_usage_record") return timestampInRange(row.timestamp, spec.start);
    if (row.type === "event_msg" && row.payload.type === "token_count") return timestampInRange(row.timestamp, spec.start);
    if (row.type === "compacted") return timestampInRange(row.timestamp, spec.start);
    return false;
  });
  const sanitized = selected.map(safeSanitize).filter((row): row is JsonObject => row !== undefined);
  const text = sanitized.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const sanitizedRows: RawRecord[] = sanitized.map((row) => ({
    type: String(row.type),
    timestamp: String(row.timestamp),
    ordinal: typeof row.ordinal === "number" ? row.ordinal : 0,
    payload: object(row.payload),
  }));
  return {
    rows: sanitizedRows,
    text,
    selectedUsageCount: selectedUsage.length,
    excludedUsageCount: usageRows.length - selectedUsage.length,
    selectedTokenCountRows: selected.filter((row) => row.type === "event_msg" && row.payload.type === "token_count").length,
    selectedCompactionRows: selected.filter((row) => row.type === "compacted").length,
  };
}

function writeJson(name: string, value: unknown): number {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(new URL(name, OUTPUT_DIR), text, "utf8");
  return Buffer.byteLength(text, "utf8");
}

function writeText(name: string, text: string): number {
  writeFileSync(new URL(name, OUTPUT_DIR), text, "utf8");
  return Buffer.byteLength(text, "utf8");
}

function bigintValue(value: unknown): bigint | null {
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function sumField(observations: EvidenceBundle["observations"], field: string): string | null {
  let total = 0n;
  for (const observation of observations) {
    const value = bigintValue(observation.usage?.[field as keyof NonNullable<typeof observation.usage>]);
    if (value === null) return null;
    total += value;
  }
  return total.toString();
}

function directSummary(evidence: EvidenceBundle): DirectSummary {
  const direct = evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  const scopeCounts = { direct: 0, snapshot: 0, aggregate: 0, unknown: 0 };
  for (const observation of evidence.observations) scopeCounts[observation.accounting_scope] += 1;
  const nativeTotals = direct.map((observation) => bigintValue(observation.attributes?.native_total_tokens));
  const nativeTotal = nativeTotals.every((value) => value !== null) ? nativeTotals.reduce((sum, value) => sum + (value ?? 0n), 0n).toString() : null;
  const modelCounts: Record<string, number> = {};
  for (const observation of direct) {
    const model = observation.model ?? "<unknown>";
    modelCounts[model] = (modelCounts[model] ?? 0) + 1;
  }
  return {
    count: direct.length,
    category_sums: {
      input_tokens: sumField(direct, "input_tokens"),
      output_tokens: sumField(direct, "output_tokens"),
      cache_read_input_tokens: sumField(direct, "cache_read_input_tokens"),
      cache_write_input_tokens: sumField(direct, "cache_write_input_tokens"),
      reasoning_output_tokens: sumField(direct, "reasoning_output_tokens"),
      native_total_tokens: nativeTotal,
    },
    accounting_scope_counts: scopeCounts,
    model_counts: modelCounts,
    source_ids: [...new Set(direct.flatMap((observation) => observation.source_refs.map((ref) => ref.source_id)))].sort(),
  };
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function directAccountingShape(summary: DirectSummary): JsonObject {
  return {
    count: summary.count,
    category_sums: summary.category_sums,
    accounting_scope_counts: summary.accounting_scope_counts,
    model_counts: summary.model_counts,
  };
}

function publicErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "UNKNOWN_PUBLIC_API_ERROR";
}

function profileFor(spec: StreamSpec, state: CaptureState, sanitizedRows: RawRecord[]): HarnessProfile {
  const artifact = state.evidence.sources.find((source) => source.id === state.captures.at(-1)?.source_id);
  if (!artifact) throw new Error("DOGFOOD_ARTIFACT_MISSING");
  const sessionLine = sanitizedRows.findIndex((row) => row.type === "session_meta") + 1;
  const contextRow = sanitizedRows.filter((row) => row.type === "turn_context").at(-1);
  const contextLine = contextRow ? sanitizedRows.indexOf(contextRow) + 1 : sessionLine;
  const model = typeof contextRow?.payload.model === "string" ? contextRow.payload.model : undefined;
  const effort = typeof contextRow?.payload.effort === "string" ? contextRow.payload.effort : undefined;
  const sessionRef = { source_id: artifact.id, record: `line:${sessionLine}/payload/cli_version` };
  const contextRef = { source_id: artifact.id, record: `line:${contextLine}/payload/model` };
  return createHarnessProfile({
    harness: "codex",
    name: `Codex ${spec.alias} accounting profile`,
    harness_version: { value: CLI_VERSION, evidence: "observed", source_refs: [sessionRef] },
    ...(model === undefined ? {} : { model: { value: model, evidence: "observed" as const, source_refs: [contextRef] } }),
    artifacts: [artifact],
    model_settings: effort === undefined ? {} : {
      effort: { value: effort, evidence: "observed", source_refs: [contextRef] },
    },
  });
}

function reportAttempt(evidence: EvidenceBundle, valuation: Valuation, context: ContextBundle, errorCode?: string): JsonObject | ReturnType<typeof createContextReport> {
  if (errorCode === undefined) {
    const report = createContextReport(evidence, valuation, context);
    validateContextReport(report);
    return { status: "available", report };
  }
  return {
    schema_version: "0.2.0",
    artifact_kind: "context_report_attempt",
    status: "unavailable",
    dataset_id: evidence.dataset_id,
    evidence,
    valuation,
    context,
    public_api: "createContextReport then validateContextReport",
    error_code: errorCode,
    issues: [{
      code: "CONTEXT_REPORT_UNAVAILABLE",
      severity: "warning",
      message: "Recorded-mode valuation has no supported monetary basis; evidence and reconstructed context are retained without a fabricated price.",
    }],
  };
}

function processStream(spec: StreamSpec): StreamResult {
  currentPhase = `${spec.alias}:parse-and-sanitize`;
  const parsed = parseLog(spec.sourcePath);
  const projection = sanitizeRows(spec, parsed.rows);
  const selectedUsageRows = parsed.rows.filter((row) => row.type === "token_usage_record" && timestampInRange(row.timestamp, spec.start));
  const responseIds = selectedUsageRows.map((row) => row.payload.response_id).filter((value): value is string => typeof value === "string" && value.length > 0);
  const duplicateResponseIds = responseIds.length - new Set(responseIds).size;
  const options = {
    harness: "codex" as const,
    capture_namespace: spec.captureNamespace,
    dataset_id: DATASET_ID,
    version: CLI_VERSION,
    ...(spec.agentId === undefined ? {} : { agent_id: spec.agentId }),
    ...(spec.workItemId === undefined ? {} : { work_item_id: spec.workItemId }),
  };
  const prefixRows = Math.max(1, Math.floor(projection.rows.length / 2));
  const prefixText = projection.rows.slice(0, prefixRows).map((row) => JSON.stringify({ timestamp: row.timestamp, type: row.type, ordinal: row.ordinal, payload: row.payload })).join("\n") + "\n";
  currentPhase = `${spec.alias}:advance-prefix`;
  const prefixState = advanceCapture(prefixText, { ...options, sequence: "0" });
  currentPhase = `${spec.alias}:advance-extension`;
  const state = advanceCapture(projection.text, { ...options, sequence: "1" }, prefixState);
  currentPhase = `${spec.alias}:exact-replay`;
  const replayState = advanceCapture(projection.text, { ...options, sequence: "1" }, state);
  currentPhase = `${spec.alias}:validate-capture`;
  validateCaptureState(prefixState);
  validateCaptureState(state);
  validateCaptureState(replayState);
  currentPhase = `${spec.alias}:one-shot-import`;
  const oneShot = validateEvidence(importEvidence("codex", projection.text, {
    dataset_id: DATASET_ID,
    version: CLI_VERSION,
    ...(spec.agentId === undefined ? {} : { agent_id: spec.agentId }),
    ...(spec.workItemId === undefined ? {} : { work_item_id: spec.workItemId }),
  }));
  const direct = directSummary(state.evidence);
  const oneShotDirect = directSummary(oneShot);
  if (!equalJson(directAccountingShape(direct), directAccountingShape(oneShotDirect))) throw new Error("DOGFOOD_ONE_SHOT_MISMATCH");
  if (replayState.captures.length !== state.captures.length || !equalJson(replayState.evidence, state.evidence)) throw new Error("DOGFOOD_REPLAY_MISMATCH");
  currentPhase = `${spec.alias}:recorded-valuation`;
  const valuation = valueEvidence(state.evidence, { mode: "recorded", currency: "USD" });
  const oneShotValuation = valueEvidence(oneShot, { mode: "recorded", currency: "USD" });
  if (valuation.total_nanos !== oneShotValuation.total_nanos || valuation.complete !== oneShotValuation.complete || valuation.observations.filter((line) => line.amount_nanos !== null).length !== oneShotValuation.observations.filter((line) => line.amount_nanos !== null).length) {
    throw new Error("DOGFOOD_VALUATION_MISMATCH");
  }
  currentPhase = `${spec.alias}:profile`;
  const profile = profileFor(spec, state, projection.rows);
  validateHarnessProfile(profile);
  const finalSourceId = state.captures.at(-1)?.source_id;
  if (!finalSourceId) throw new Error("DOGFOOD_FINAL_SOURCE_MISSING");
  currentPhase = `${spec.alias}:native-context`;
  const context = reconstructNativeContext("codex", projection.text, state.evidence, profile, { source_id: finalSourceId });
  let report: ReturnType<typeof createContextReport> | undefined;
  let attempt: JsonObject;
  currentPhase = `${spec.alias}:context-report-attempt`;
  try {
    const created = createContextReport(state.evidence, valuation, context);
    report = validateContextReport(created);
    attempt = report as unknown as JsonObject;
  } catch (error) {
    attempt = reportAttempt(state.evidence, valuation, context, publicErrorCode(error)) as JsonObject;
  }
  const directIds = state.evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct").map((observation) => observation.id).sort();
  let workItemRecord: WorkItemEvidenceRecord | undefined;
  if (spec.workItemId !== undefined) {
    currentPhase = `${spec.alias}:work-item`;
    const rawWorkItem = JSON.parse(readFileSync(WORK_ITEM_PATH, "utf8")) as WorkItem;
    const workItem: WorkItem = {
      ...rawWorkItem,
      outcome: {
        status: "accepted",
        recorded_at: CUTOFF,
        summary: "Accepted after the independent producer crossed the public context and report seams; usage and cost coverage remain partial because provider billing and hidden calls are unavailable.",
      },
      attempts: [{
        attempt_id: "independent-producer-2026-09-06",
        status: "accepted",
        started_at: spec.attemptStart,
        ended_at: selectedUsageRows.map((row) => row.timestamp).sort().at(-1) ?? spec.attemptEnd,
        observation_ids: directIds,
      }],
    };
    const validatedWorkItem = validateWorkItem(workItem);
    writeJson("../../work-items/context-producer-proof.json", validatedWorkItem);
    workItemRecord = joinWorkItemEvidence(validatedWorkItem, state.evidence, valuation);
    validateWorkItem(workItemRecord.work_item);
    if (workItemRecord.dataset_valuation !== null) validateEvidence(state.evidence);
  }
  return {
    spec,
    raw: parsed.rows,
    sanitized: projection.text,
    sanitizedRows: projection.rows,
    state,
    prefixState,
    replayState,
    oneShot,
    direct,
    oneShotDirect,
    valuation,
    oneShotValuation,
    context,
    profile,
    workItemRecord,
    report,
    reportAttempt: attempt,
    directIds,
    selectedUsageCount: projection.selectedUsageCount,
    excludedUsageCount: projection.excludedUsageCount,
    duplicateResponseIds,
    firstSelectedUsageTimestamp: selectedUsageRows[0]?.timestamp ?? null,
    lastSelectedUsageTimestamp: selectedUsageRows.at(-1)?.timestamp ?? null,
    selectedTokenCountRows: projection.selectedTokenCountRows,
    selectedCompactionRows: projection.selectedCompactionRows,
    rawPrefixRows: parsed.rawPrefixRows,
    rawPrefixSha256: parsed.rawPrefixSha256,
    artifactSizes: {},
  };
}

function main(): void {
  currentPhase = "create-output-directory";
  mkdirSync(OUTPUT_DIR, { recursive: true });
  currentPhase = "process-streams";
  const results = SPECS.map(processStream);
  const byAlias = new Map(results.map((result) => [result.spec.alias, result]));
  const root = byAlias.get("root-accounting")!;
  const producer = byAlias.get("independent-producer")!;
  const provenance: JsonObject = {
    schema_version: "0.2.0",
    dataset_id: DATASET_ID,
    description: "Bounded real-work Codex v0.2 capture. Only allowlisted native metadata, hashed identifiers and numeric usage counters are published.",
    cutoff: CUTOFF,
    root_goal_start: ROOT_START,
    independent_producer_reported_bounds: { started_at: PRODUCER_START, ended_at: PRODUCER_REPORTED_END },
    streams: {},
    work_item: {
      path: "examples/work-items/context-producer-proof.json",
      dataset_id: DATASET_ID,
      work_item_id: WORK_ITEM_ID,
      accepted: true,
      estimate_preserved: { estimate_id: "initial", created_at: "2026-09-06T20:16:42Z", point_value: "3", timing: "pre_execution" },
      selected_observation_count: producer.directIds.length,
      selected_observation_ids: producer.directIds,
      temporal_join: "verified pre-execution estimate before reported independent-producer attempt start",
      coverage: "partial usage and cost coverage; accepted workload outcome is separate",
    },
    proof: {
      incremental_capture: "advanceCapture prefix then full extension, exact replay, and one-shot import all agree on direct counts/category sums",
      context: "reconstructNativeContext(codex, sanitized, mergedEvidence, honestProfile, {source_id:lastCaptureSource}) returns unavailable request boundaries",
      valuation: "recorded USD mode retains all-null direct costs; no model price or provider billing is invented",
      acceptance_reference: "test/context-producer.test.ts public seam assertions were used as acceptance evidence; its synthetic fixture is not joined",
    },
  };
  for (const result of results) {
    const evidenceName = `${result.spec.alias}-evidence.json`;
    const stateName = `${result.spec.alias}-capture-state.json`;
    const contextName = `${result.spec.alias}-context.json`;
    const reportName = `${result.spec.alias}-context-report.json`;
    const workRecordName = `${result.spec.alias}-work-item-record.json`;
    const streamName = `${result.spec.alias}.jsonl`;
    result.artifactSizes[streamName] = writeText(streamName, result.sanitized);
    result.artifactSizes[stateName] = writeJson(stateName, result.state);
    result.artifactSizes[evidenceName] = writeJson(evidenceName, result.state.evidence);
    result.artifactSizes[contextName] = writeJson(contextName, result.context);
    result.artifactSizes[reportName] = writeJson(reportName, result.reportAttempt);
    if (result.workItemRecord !== undefined) result.artifactSizes[workRecordName] = writeJson(workRecordName, result.workItemRecord);
    const finalCapture = result.state.captures.at(-1)!;
    const direct = result.direct;
    (provenance.streams as JsonObject)[result.spec.alias] = {
      start: result.spec.start,
      cutoff: CUTOFF,
      source_prefix_rows: result.rawPrefixRows,
      source_prefix_sha256: result.rawPrefixSha256,
      selected_usage_rows: result.selectedUsageCount,
      excluded_usage_rows_before_start: result.excludedUsageCount,
      ...(result.workItemRecord === undefined ? {} : { attempt_bounds: { ...result.workItemRecord.work_item.attempts[0], end_basis: "derived as last observed selected usage timestamp; producer self-reported end is retained separately" } }),
      first_selected_usage_timestamp: result.firstSelectedUsageTimestamp,
      last_selected_usage_timestamp: result.lastSelectedUsageTimestamp,
      sanitized_rows: result.sanitizedRows.length,
      sanitized_sha256: sha256(result.sanitized),
      selected_token_count_rows: result.selectedTokenCountRows,
      selected_compaction_rows: result.selectedCompactionRows,
      captures: result.state.captures.map((capture) => ({ id: capture.id, sequence: capture.sequence, source_id: capture.source_id, record_count: capture.record_count, observation_count: capture.observation_count, prefix_bytes: capture.prefix_bytes })),
      final_source_id: finalCapture.source_id,
      direct_observation_ids: result.directIds,
      direct: direct,
      one_shot_direct: result.oneShotDirect,
      duplicate_response_ids: result.duplicateResponseIds,
      replay_capture_count: result.replayState.captures.length,
      one_shot_matches: true,
      recorded_valuation: {
        currency: result.valuation.currency,
        basis: result.valuation.basis,
        total_nanos: result.valuation.total_nanos,
        complete: result.valuation.complete,
        priced_direct_lines: result.valuation.observations.filter((line) => line.amount_nanos !== null).length,
        direct_lines: result.direct.count,
        issue_codes: [...new Set(result.valuation.issues.map((issue) => issue.code))].sort(),
      },
      context: {
        profile_id: result.profile.id,
        requests: result.context.requests.length,
        linked_observations: result.context.requests.filter((request) => request.observation_id !== null).length,
        unavailable_boundaries: result.context.requests.filter((request) => request.boundary === "unavailable").length,
        issue_codes: [...new Set(result.context.issues.map((issue) => issue.code))].sort(),
      },
      report: {
        status: result.report === undefined ? "unavailable" : "available",
        artifact: reportName,
        public_api_error_code: result.report === undefined ? result.reportAttempt.error_code : null,
      },
      artifact_sizes_bytes: result.artifactSizes,
    };
  }
  writeJson("provenance.json", provenance);
  const sizes = Object.fromEntries(Object.entries(provenance.streams as JsonObject).map(([alias, value]) => [alias, (value as JsonObject).artifact_sizes_bytes]));
  console.log(JSON.stringify({ cutoff: CUTOFF, streams: Object.fromEntries(results.map((result) => [result.spec.alias, { selected_usage_rows: result.selectedUsageCount, direct_observations: result.direct.count, sanitized_rows: result.sanitizedRows.length, recorded_basis: result.valuation.basis, report_status: result.report === undefined ? "unavailable" : "available" }])), artifacts_bytes: sizes, work_item: { dataset_id: DATASET_ID, selected_observations: producer.directIds.length, outcome: "accepted" } }));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ code: publicErrorCode(error), phase: currentPhase }));
  process.exitCode = 1;
}
