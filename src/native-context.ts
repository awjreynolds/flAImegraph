import { CoreError, validateEvidence } from "./core.js";
import { captureRequestContext } from "./request-context.js";
import { sha256Hex } from "./context-capture.js";
import { validateContextBundle } from "./context.js";
import type {
  ContextBlockInput,
  ContextBundle,
  ContextIssue,
  ContextRole,
  HarnessFact,
  HarnessProfile,
} from "./context-types.js";
import type { EvidenceBundle, Observation, Source, SourceRef } from "./types.js";

type JsonObject = Record<string, unknown>;

export interface NativeContextOptions {
  /** The evidence source whose physical rows are being reconstructed. */
  source_id: string;
}

type NativeHarness = "codex" | "pi";

type RawRecord = {
  value: JsonObject;
  line: number;
  ordinal: string;
  coordinate: string;
  representation?: "summary";
};

type RawEntry = {
  record: RawRecord;
  value: JsonObject;
  id?: string;
  parentId?: string | null;
};

type IndexedUsage = {
  record: RawRecord;
  entryId?: string;
};

type DirectTarget = {
  observation: Observation;
  sourceRef: SourceRef;
  /** Whether the selected source reference resolved to one usable native row. */
  rowResolved: boolean;
  line?: number;
  record?: RawRecord;
  entry?: RawEntry;
};

const ROLE_VALUES = new Set(["system", "developer", "user", "assistant", "tool", "unknown"]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function issue(code: string, message: string, severity: ContextIssue["severity"] = "warning", request_id?: string): ContextIssue {
  return { code, message, severity, ...(request_id === undefined ? {} : { request_id }) };
}

function parseJsonRecords(input: string): { records: RawRecord[]; issues: ContextIssue[] } {
  const issues: ContextIssue[] = [];
  const trimmed = input.trim();
  if (trimmed.length === 0) return { records: [], issues: [issue("NATIVE_INPUT_EMPTY", "native transcript input contains no records", "error")] };

  // Native session exports are normally JSONL. Accept a single JSON object or
  // array as a convenience, while retaining deterministic physical coordinates.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const records: RawRecord[] = [];
      for (let index = 0; index < parsed.length; index += 1) {
        const value = parsed[index];
        if (!isObject(value)) {
          issues.push(issue("NATIVE_INPUT_INVALID_RECORD", `native record ${index + 1} is not an object`, "error"));
          continue;
        }
        records.push({ value, line: index + 1, ordinal: "0", coordinate: `line:${index + 1}` });
      }
      return { records, issues };
    }
    if (isObject(parsed)) return { records: [{ value: parsed, line: 1, ordinal: "0", coordinate: "line:1" }], issues };
  } catch {
    // Fall through to JSONL parsing below.
  }

  const records: RawRecord[] = [];
  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = index + 1;
    const text = rawLine.trim();
    if (text.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) {
        issues.push(issue("NATIVE_INPUT_INVALID_RECORD", `native JSONL line ${line} is not an object`, "error"));
        continue;
      }
      records.push({ value: parsed, line, ordinal: "0", coordinate: `line:${line}` });
    } catch {
      issues.push(issue("NATIVE_INPUT_PARSE_ERROR", `native JSONL line ${line} could not be parsed`, "error"));
    }
  }
  if (records.length === 0 && issues.length === 0) issues.push(issue("NATIVE_INPUT_EMPTY", "native transcript input contains no records", "error"));
  return { records, issues };
}

function flattenPiRecords(records: RawRecord[], issues: ContextIssue[]): RawRecord[] {
  const flattened: RawRecord[] = [];
  const append = (value: unknown, line: number, ordinal: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => append(entry, line, `${ordinal}.${index}`));
      return;
    }
    if (!isObject(value)) {
      issues.push(issue("NATIVE_PI_INVALID_TRANSACTION_WRITE", `Pi transaction line ${line} contains a non-object write`, "error"));
      return;
    }
    flattened.push({ value, line, ordinal, coordinate: ordinal === "0" ? `line:${line}` : `line:${line}:${ordinal}` });
  };
  for (const record of records) {
    if (firstString(record.value.kind, record.value.type) === "transaction" && Array.isArray(record.value.writes)) {
      append(record.value.writes, record.line, "0");
    } else flattened.push(record);
  }
  return flattened;
}

function messageOf(value: JsonObject): JsonObject | undefined {
  const entry = isObject(value.entry) ? value.entry : undefined;
  if (entry && isObject(entry.message)) return entry.message;
  if (isObject(value.message)) return value.message;
  return typeof value.role === "string" ? value : undefined;
}

function entryValueOf(record: RawRecord): JsonObject | undefined {
  if (isObject(record.value.entry)) {
    // Some v4 exports put id/parentId on the envelope while others put them
    // on the nested entry. Preserve whichever side supplied the metadata.
    return {
      ...record.value.entry,
      ...(idOf(record.value.entry) === undefined && idOf(record.value) !== undefined ? { id: idOf(record.value) } : {}),
      ...(parentIdOf(record.value.entry) === undefined && parentIdOf(record.value) !== undefined ? { parentId: parentIdOf(record.value) } : {}),
    };
  }
  if (record.value.type === "message" || record.value.kind === "message" || messageOf(record.value) !== undefined) return record.value;
  return undefined;
}

function idOf(value: JsonObject | undefined): string | undefined {
  return value === undefined ? undefined : firstString(value.id, value.entryId, value.entry_id);
}

function parentIdOf(value: JsonObject | undefined): string | null | undefined {
  if (value === undefined || !("parentId" in value) && !("parent_id" in value)) return undefined;
  const raw = value.parentId ?? value.parent_id;
  return raw === null ? null : firstString(raw) ?? null;
}

function roleOf(record: RawRecord | JsonObject): string | undefined {
  const value: JsonObject = "line" in record && "coordinate" in record ? (record as RawRecord).value : record;
  const message = messageOf(value);
  return firstString(message?.role, value.role);
}

function normalizedRole(value: string | undefined): ContextRole {
  if (value === "model") return "assistant";
  if (value === "toolResult" || value === "tool_result" || value === "bashExecution") return "tool";
  if (value !== undefined && ROLE_VALUES.has(value)) return value as ContextRole;
  return "unknown";
}

function originForRole(role: ContextRole): ContextBlockInput["origin"] {
  if (role === "system") return "system_instruction";
  if (role === "developer") return "developer_instruction";
  if (role === "user") return "user_prompt";
  if (role === "assistant") return "assistant_output";
  if (role === "tool") return "tool_result";
  return "unknown";
}

function contentOf(record: RawRecord | JsonObject): unknown {
  const value: JsonObject = "line" in record && "coordinate" in record ? (record as RawRecord).value : record;
  const message = messageOf(value);
  if (message !== undefined && "content" in message) return message.content;
  const role = firstString(message?.role, value.role);
  if (role === "bashExecution") return value.output;
  if (value.type === "custom_message" || value.kind === "custom_message") return value.content;
  return undefined;
}

function pointerRecord(record: RawRecord, suffix?: string): string {
  return suffix === undefined ? record.coordinate : `${record.coordinate}:${suffix}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const result = JSON.stringify(value);
  return result === undefined ? "null" : result;
}

function textPart(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isObject(value)) return undefined;
  const type = firstString(value.type);
  if ((type === "text" || type === "output_text" || type === "input_text") && typeof value.text === "string") return value.text;
  if (typeof value.text === "string" && Object.keys(value).length <= 2) return value.text;
  return undefined;
}

function contentBlocks(record: RawRecord, sourceId: string, label: string): ContextBlockInput[] {
  const content = contentOf(record);
  if (content === undefined || content === null) return [];
  const value = record.value;
  const role = normalizedRole(roleOf(record));
  const origin = record.representation === "summary" ? "conversation_history" : originForRole(role);
  const originEvidence = origin === "unknown" ? "unknown" as const : "observed" as const;
  const common = {
    source_id: sourceId,
    origin,
    origin_evidence: originEvidence,
    label,
    identity_basis: "producer" as const,
    representation: record.representation ?? "original" as const,
    role,
    placement: record.representation === "summary" ? "history" as const : role === "tool" ? "tool_result" as const : role === "assistant" || role === "user" ? "history" as const : "unknown" as const,
    record: record.coordinate,
  };
  const blocks: ContextBlockInput[] = [];
  const add = (entry: unknown, index?: number): void => {
    const suffix = index === undefined ? undefined : `part:${index}`;
    const partRecord = pointerRecord(record, suffix);
    const text = textPart(entry);
    if (text !== undefined) {
      blocks.push({ ...common, record: partRecord, media: "text", content: text });
    } else if (isObject(entry) || Array.isArray(entry)) {
      blocks.push({ ...common, record: partRecord, media: "structured", content: canonicalJson(entry) });
    }
  };
  if (Array.isArray(content)) content.forEach((entry, index) => add(entry, index));
  else add(content);
  return blocks;
}

function lineFromRecord(record: string): number | undefined {
  const match = /(?:^|:)line:(\d+)(?::|$)/.exec(record);
  return match === null ? undefined : Number(match[1]);
}

function timestamp(value: unknown): string | null {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/.exec(value);
    return match === null ? null : value;
  }
  const numeric = asNumber(value);
  if (numeric === undefined) return null;
  const millis = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function recordTimestamp(record: RawRecord | undefined): string | null {
  if (record === undefined) return null;
  const message = messageOf(record.value);
  return timestamp(record.value.timestamp) ?? timestamp(message?.timestamp);
}

function sourceArtifact(evidence: EvidenceBundle, sourceId: string): Source {
  const artifact = evidence.sources.find((source) => source.id === sourceId);
  if (artifact === undefined) throw new CoreError("NATIVE_SOURCE_MISSING", `evidence source ${sourceId} is not present`);
  return structuredClone(artifact);
}

function assertSourceInputMatchesArtifact(input: string, artifact: Source): void {
  if (artifact.sha256 === undefined) {
    throw new CoreError("NATIVE_SOURCE_DIGEST_MISSING", `source artifact ${artifact.id} does not declare a SHA-256 digest`);
  }
  const actual = sha256Hex(input);
  if (actual !== artifact.sha256.toLowerCase()) {
    throw new CoreError("NATIVE_SOURCE_DIGEST_MISMATCH", `native input does not match source artifact ${artifact.id}`);
  }
}

function usageIdentityFromReference(record: string): string | undefined {
  if (!record.startsWith("usage:")) return undefined;
  const marker = record.lastIndexOf(":line:");
  if (marker <= "usage:".length || !/^\d+(?::.*)?$/.test(record.slice(marker + ":line:".length))) return undefined;
  return record.slice("usage:".length, marker);
}

function directTargets(evidence: EvidenceBundle, sourceId: string, records: RawRecord[], entries: Map<string, RawEntry>, usageEntryIds: Map<string, IndexedUsage>): { targets: DirectTarget[]; issues: ContextIssue[] } {
  const issues: ContextIssue[] = [];
  const byLine = new Map<number, RawRecord[]>();
  for (const record of records) (byLine.get(record.line) ?? (byLine.set(record.line, []), byLine.get(record.line)!)).push(record);
  const targets: DirectTarget[] = [];
  const direct = evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  for (const observation of direct) {
    const refs = observation.source_refs.filter((ref) => ref.source_id === sourceId);
    const lineValues = [...new Set(refs.map((ref) => lineFromRecord(ref.record)).filter((line): line is number => line !== undefined))];
    const sourceRef = refs[0] ?? observation.source_refs[0];
    if (sourceRef === undefined || refs.length === 0) {
      issues.push(issue("NATIVE_OBSERVATION_SOURCE_UNRESOLVED", `direct model observation ${observation.id} has no reference to source ${sourceId}`, "warning"));
      targets.push({ observation, sourceRef: sourceRef ?? { source_id: sourceId, record: `observation:${observation.id}` }, rowResolved: false });
      continue;
    }
    const usageIdentity = usageIdentityFromReference(sourceRef.record);
    if (usageIdentity !== undefined) {
      const indexedUsage = usageEntryIds.get(usageIdentity);
      if (indexedUsage === undefined) {
        issues.push(issue("NATIVE_OBSERVATION_ROW_UNAVAILABLE", `direct model observation ${observation.id} references missing usage ${usageIdentity}`, "warning"));
        targets.push({ observation, sourceRef, rowResolved: false, line: lineValues.length === 1 ? lineValues[0] : undefined });
        continue;
      }
      const entry = indexedUsage.entryId === undefined ? undefined : entries.get(indexedUsage.entryId);
      const rowResolved = entry !== undefined;
      if (!rowResolved) {
        issues.push(issue("NATIVE_OBSERVATION_ROW_UNAVAILABLE", `direct model observation ${observation.id} references usage ${usageIdentity}, but its linked native entry was not found`, "warning"));
      }
      targets.push({ observation, sourceRef, rowResolved, line: indexedUsage.record.line, record: indexedUsage.record, entry });
      continue;
    }
    if (lineValues.length !== 1) {
      issues.push(issue("NATIVE_OBSERVATION_ROW_AMBIGUOUS", `direct model observation ${observation.id} does not identify one physical source row`, "warning"));
      targets.push({ observation, sourceRef, rowResolved: false, line: lineValues[0] });
      continue;
    }
    const line = lineValues[0] as number;
    const candidates = byLine.get(line) ?? [];
    const record = candidates.find((candidate) => {
      const value = candidate.value;
      const kind = firstString(value.kind, value.type);
      return kind === "usage" || kind === "usage_row" || kind === "usage_added" || kind === "message" || kind === "entry" || messageOf(value) !== undefined;
    }) ?? candidates[0];
    let entry: RawEntry | undefined;
    if (record !== undefined) {
      const entryValue = entryValueOf(record);
      if (entryValue !== undefined) {
        const id = idOf(entryValue);
        entry = id === undefined ? { record, value: entryValue, parentId: parentIdOf(entryValue) } : entries.get(id) ?? { record, value: entryValue, id, parentId: parentIdOf(entryValue) };
      }
      const row = isObject(record.value.row) ? record.value.row : record.value;
      const entryId = firstString(row.entryId, row.entry_id);
      if (entryId !== undefined) entry = entries.get(entryId) ?? entry;
    }
    const rowResolved = record !== undefined && (entry !== undefined || entryValueOf(record) !== undefined);
    if (!rowResolved) {
      issues.push(issue("NATIVE_OBSERVATION_ROW_UNAVAILABLE", `direct model observation ${observation.id} references source line ${line}, but no usable native row was found`, "warning"));
    }
    targets.push({ observation, sourceRef, rowResolved, line, record, entry });
  }
  targets.sort((left, right) => (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER) || (left.observation.id < right.observation.id ? -1 : 1));
  return { targets, issues };
}

function overrideFacts(target: DirectTarget, artifact: Source): Record<string, HarnessFact> {
  const result: Record<string, HarnessFact> = {};
  const record = target.entry?.value ?? target.record?.value;
  const message = record === undefined ? undefined : messageOf(record);
  const ref = { source_id: artifact.id, record: target.entry?.record.coordinate ?? target.record?.coordinate ?? target.sourceRef.record };
  const values: Array<[string, unknown]> = [
    ["provider", message?.provider ?? message?.responseProvider ?? record?.provider],
    ["model", message?.model ?? message?.responseModel ?? message?.response_model ?? record?.model],
  ];
  for (const [key, value] of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    result[key] = { value, evidence: "observed", source_refs: [ref] };
  }
  return result;
}

function piEntryIndex(records: RawRecord[]): { entries: Map<string, RawEntry>; usageEntryIds: Map<string, IndexedUsage>; hasTree: boolean } {
  const entries = new Map<string, RawEntry>();
  const usageEntryIds = new Map<string, IndexedUsage>();
  let hasTree = false;
  for (const record of records) {
    const entryValue = entryValueOf(record);
    if (entryValue !== undefined) {
      const id = idOf(entryValue);
      if (id !== undefined) {
        const candidate: RawEntry = { record, value: entryValue, id, parentId: parentIdOf(entryValue) };
        if (candidate.parentId !== undefined || "parentId" in entryValue || "parent_id" in entryValue) hasTree = true;
        if (!entries.has(id)) entries.set(id, candidate);
      }
    } else {
      // Compaction, branch-summary and model-change records are not message
      // entries, but their parent links still form part of a Pi ancestry.
      const id = idOf(record.value);
      if (id !== undefined && parentIdOf(record.value) !== undefined) {
        hasTree = true;
        if (!entries.has(id)) entries.set(id, { record, value: record.value, id, parentId: parentIdOf(record.value) });
      }
    }
    const kind = firstString(record.value.kind, record.value.type);
    if (kind === "usage" || kind === "usage_row" || kind === "usage_added" || kind === "entry_added") {
      const row = isObject(record.value.row) ? record.value.row : isObject(record.value.usage) ? record.value.usage : record.value;
      const entryId = firstString(row.entryId, row.entry_id);
      const usageIdentity = firstString(row.id, row.usageId, row.usage_id, row.entryId, row.entry_id) ?? record.coordinate;
      if (!usageEntryIds.has(usageIdentity)) usageEntryIds.set(usageIdentity, { record, entryId });
    }
  }
  return { entries, usageEntryIds, hasTree };
}

function isCompaction(record: RawRecord): boolean {
  const kind = firstString(record.value.type, record.value.kind);
  return kind === "compaction" || kind === "branch_summary";
}

function summaryRecord(record: RawRecord): RawRecord | undefined {
  const summary = record.value.summary;
  if (typeof summary !== "string") return undefined;
  return {
    ...record,
    value: { type: "message", message: { role: "unknown", content: summary } },
    representation: "summary",
    coordinate: `${record.coordinate}:/summary`,
  };
}

function retainedTailRecords(record: RawRecord): RawRecord[] {
  if (!Array.isArray(record.value.retainedTail)) return [];
  return record.value.retainedTail.flatMap((tail, index) => {
    if (!isObject(tail)) return [];
    return [{
      ...record,
      value: tail,
      coordinate: `${record.coordinate}:retained:${index}`,
    }];
  });
}

function linearContext(records: RawRecord[], targetLine: number, issues: ContextIssue[]): RawRecord[] {
  const result: RawRecord[] = [];
  for (const record of records) {
    if (record.line >= targetLine) break;
    if (isCompaction(record)) {
      result.length = 0;
      const summary = summaryRecord(record);
      if (summary !== undefined) result.push(summary, ...retainedTailRecords(record));
      else issues.push(issue("NATIVE_COMPACTION_CONTENT_UNAVAILABLE", `Pi compaction on line ${record.line} has no captured summary`, "warning"));
      if (!Array.isArray(record.value.retainedTail) && record.value.firstKeptEntryIndex !== undefined) {
        issues.push(issue("NATIVE_COMPACTION_ANCESTRY_AMBIGUOUS", `Pi compaction on line ${record.line} names an index without explicit entry ancestry`));
      }
      continue;
    }
    const role = roleOf(record);
    const kind = firstString(record.value.type, record.value.kind);
    if (role !== undefined || kind === "custom_message") result.push(record);
  }
  return result;
}

function ancestryContext(target: DirectTarget, records: RawRecord[], entries: Map<string, RawEntry>, issues: ContextIssue[]): RawRecord[] {
  if (target.entry?.id === undefined) return linearContext(records, target.entry?.record.line ?? target.line ?? Number.MAX_SAFE_INTEGER, issues);
  const chain: RawRecord[] = [];
  const targetId = target.entry.id;
  const seen = new Set<string>([targetId]);
  let current: RawEntry | undefined = target.entry;
  while (current?.parentId) {
    if (seen.has(current.parentId)) {
      issues.push(issue("NATIVE_TRANSCRIPT_ANCESTRY_CYCLE", `Pi ancestry for entry ${targetId} contains a cycle`));
      break;
    }
    seen.add(current.parentId);
    const parent = entries.get(current.parentId);
    if (parent === undefined) {
      issues.push(issue("NATIVE_TRANSCRIPT_ANCESTRY_MISSING", `Pi ancestry for entry ${targetId} references missing parent ${current.parentId}`));
      break;
    }
    chain.push(parent.record);
    current = parent;
  }
  chain.reverse();
  const context: RawRecord[] = [];
  for (const record of chain) {
    if (!isCompaction(record)) {
      if (roleOf(record) !== undefined || firstString(record.value.type, record.value.kind) === "custom_message") context.push(record);
      continue;
    }
    const kind = firstString(record.value.type, record.value.kind);
    if (kind === "compaction") {
      const firstKept = firstString(record.value.firstKeptEntryId, record.value.first_kept_entry_id);
      if (firstKept !== undefined) {
        const keptIndex = context.findIndex((candidate) => idOf(entryValueOf(candidate)) === firstKept || idOf(candidate.value) === firstKept);
        if (keptIndex >= 0) context.splice(0, keptIndex);
        else {
          context.length = 0;
          issues.push(issue("NATIVE_COMPACTION_ANCESTRY_AMBIGUOUS", `Pi compaction on line ${record.line} names a missing kept entry ${firstKept}`));
        }
      } else {
        context.length = 0;
        issues.push(issue("NATIVE_COMPACTION_ANCESTRY_AMBIGUOUS", `Pi compaction on line ${record.line} has no explicit kept entry ancestry`));
      }
    }
    const summary = summaryRecord(record);
    if (summary !== undefined) context.push(summary, ...retainedTailRecords(record));
    else issues.push(issue("NATIVE_COMPACTION_CONTENT_UNAVAILABLE", `Pi summary on line ${record.line} has no captured content`));
  }
  return context;
}

function contextBlocks(records: RawRecord[], harness: NativeHarness): ContextBlockInput[] {
  const blocks: ContextBlockInput[] = [];
  for (const record of records) {
    const role = normalizedRole(roleOf(record));
    const nativeId = idOf(entryValueOf(record));
    const sourceId = `${harness}-context:${nativeId ?? record.coordinate}`;
    const label = `${harness} ${role} ${record.coordinate}`;
    blocks.push(...contentBlocks(record, sourceId, label));
  }
  return blocks;
}

function baseBundle(evidence: EvidenceBundle, profile: HarnessProfile, artifact: Source, issues: ContextIssue[]): ContextBundle {
  return validateContextBundle({
    schema_version: "0.2.0",
    dataset_id: evidence.dataset_id,
    evidence_schema_version: "0.1.0",
    artifacts: [artifact],
    profiles: [structuredClone(profile)],
    sources: [],
    revisions: [],
    requests: [],
    transformations: [],
    issues,
  }, evidence);
}

function reconstructCodex(evidence: EvidenceBundle, profile: HarnessProfile, artifact: Source, targets: DirectTarget[], initialIssues: ContextIssue[]): ContextBundle {
  const captures: ContextBundle[] = [];
  const issues = [...initialIssues];
  for (const target of targets) {
    const requestId = `native-request:codex:${target.observation.id}`;
    const capture = captureRequestContext({
      dataset_id: evidence.dataset_id,
      request_id: requestId,
      observation_id: target.observation.id,
      captured_at: target.observation.timestamp ?? null,
      profile,
      boundary: "unavailable",
      coverage: "unknown",
      coverage_evidence: "unknown",
      artifact,
      record: target.sourceRef.record,
      blocks: [],
      overrides: overrideFacts(target, artifact),
    });
    captures.push(capture);
    issues.push(issue("NATIVE_REQUEST_BOUNDARY_UNAVAILABLE", "Codex accounting evidence does not expose a final request boundary; context was not inferred from nearby events", "warning", requestId));
  }
  if (captures.length === 0) return baseBundle(evidence, profile, artifact, issues);
  const merged = validateContextBundle({
    schema_version: "0.2.0", dataset_id: evidence.dataset_id, evidence_schema_version: "0.1.0",
    artifacts: [artifact], profiles: [profile], sources: [], revisions: [], requests: captures.map((capture) => capture.requests[0]!).filter(Boolean), transformations: [], issues,
  }, evidence);
  return merged;
}

function reconstructPi(evidence: EvidenceBundle, profile: HarnessProfile, artifact: Source, records: RawRecord[], targets: DirectTarget[], initialIssues: ContextIssue[]): ContextBundle {
  const captures: ContextBundle[] = [];
  const issues = [...initialIssues];
  const index = piEntryIndex(records);
  const orderedTargets = targets;
  for (const target of orderedTargets) {
    const requestId = `native-request:pi:${target.observation.id}`;
    const localIssues: ContextIssue[] = [];
    const ancestry = !target.rowResolved ? [] : index.hasTree && target.entry?.id !== undefined
      ? ancestryContext(target, records, index.entries, localIssues)
      : linearContext(records, target.entry?.record.line ?? target.line ?? Number.MAX_SAFE_INTEGER, localIssues);
    const blocks = contextBlocks(ancestry, "pi");
    const coverage = !target.rowResolved || blocks.length === 0 ? "unknown" as const : "partial" as const;
    const coverageEvidence = coverage === "unknown" ? "unknown" as const : "declared" as const;
    const capture = captureRequestContext({
      dataset_id: evidence.dataset_id,
      request_id: requestId,
      observation_id: target.observation.id,
      captured_at: recordTimestamp(target.entry?.record ?? target.record),
      profile,
      boundary: "transcript_reconstruction",
      coverage,
      coverage_evidence: coverageEvidence,
      artifact,
      record: target.sourceRef.record,
      blocks,
      overrides: overrideFacts(target, artifact),
    });
    captures.push(capture);
    issues.push(...localIssues.map((item) => ({ ...item, request_id: item.request_id ?? requestId })));
    if (!target.rowResolved) {
      issues.push(issue("NATIVE_TRANSCRIPT_ROW_UNAVAILABLE", "Pi evidence did not resolve this request to one native transcript row; context was not inferred", "warning", requestId));
    } else if (blocks.length === 0) {
      issues.push(issue("NATIVE_TRANSCRIPT_CONTENT_UNAVAILABLE", "Pi transcript ancestry contains no captured message content; the boundary remains unknown", "warning", requestId));
    }
  }
  if (captures.length === 0) return baseBundle(evidence, profile, artifact, issues);
  const merged = validateContextBundle({
    schema_version: "0.2.0", dataset_id: evidence.dataset_id, evidence_schema_version: "0.1.0",
    artifacts: [artifact], profiles: [profile], sources: mergeSources(captures), revisions: mergeRevisions(captures), requests: captures.map((capture) => capture.requests[0]!).filter(Boolean), transformations: [], issues,
  }, evidence);
  return merged;
}

function mergeSources(captures: ContextBundle[]): ContextBundle["sources"] {
  const map = new Map<string, ContextBundle["sources"][number]>();
  for (const capture of captures) for (const source of capture.sources) {
    const existing = map.get(source.id);
    if (existing === undefined) map.set(source.id, source);
    else {
      const refs = new Map(existing.source_refs.map((ref) => [`${ref.source_id}\u0000${ref.record}`, ref]));
      for (const ref of source.source_refs) refs.set(`${ref.source_id}\u0000${ref.record}`, ref);
      map.set(source.id, { ...existing, source_refs: [...refs.values()] });
    }
  }
  return [...map.values()];
}

function mergeRevisions(captures: ContextBundle[]): ContextBundle["revisions"] {
  const map = new Map<string, ContextBundle["revisions"][number]>();
  for (const capture of captures) for (const revision of capture.revisions) {
    const existing = map.get(revision.id);
    if (existing === undefined) map.set(revision.id, revision);
    else {
      const merge = (left: SourceRef[], right: SourceRef[]): SourceRef[] => {
        const refs = new Map(left.map((ref) => [`${ref.source_id}\u0000${ref.record}`, ref]));
        for (const ref of right) refs.set(`${ref.source_id}\u0000${ref.record}`, ref);
        return [...refs.values()];
      };
      map.set(revision.id, { ...existing, source_refs: merge(existing.source_refs, revision.source_refs), tokens: { ...existing.tokens, source_refs: merge(existing.tokens.source_refs, revision.tokens.source_refs) }, bytes: { ...existing.bytes, source_refs: merge(existing.bytes.source_refs, revision.bytes.source_refs) } });
    }
  }
  return [...map.values()];
}

/**
 * Reconstruct stored transcript context around direct model observations.
 * Raw message text is passed to captureRequestContext only long enough to
 * derive a digest and byte measurement; no raw content is returned.
 */
export function reconstructNativeContext(
  harness: NativeHarness,
  input: string,
  evidence: EvidenceBundle,
  profile: HarnessProfile,
  options: NativeContextOptions,
): ContextBundle {
  if (harness !== "codex" && harness !== "pi") throw new CoreError("NATIVE_HARNESS_UNSUPPORTED", `unsupported native context harness ${harness}`);
  if (typeof input !== "string") throw new CoreError("NATIVE_INPUT_INVALID", "native transcript input must be a string");
  if (typeof options?.source_id !== "string" || options.source_id.trim().length === 0) throw new CoreError("NATIVE_SOURCE_INVALID", "native context source_id must be a non-empty string");
  const normalizedEvidence = validateEvidence(evidence);
  const artifact = sourceArtifact(normalizedEvidence, options.source_id);
  assertSourceInputMatchesArtifact(input, artifact);
  const parsed = parseJsonRecords(input);
  const parseIssues = parsed.issues;
  const records = harness === "pi" ? flattenPiRecords(parsed.records, parseIssues) : parsed.records;
  const index = harness === "pi" ? piEntryIndex(records) : { entries: new Map<string, RawEntry>(), usageEntryIds: new Map<string, IndexedUsage>(), hasTree: false };
  const selected = directTargets(normalizedEvidence, options.source_id, records, index.entries, index.usageEntryIds);
  const allIssues = [...parseIssues, ...selected.issues];
  if (harness === "codex") return reconstructCodex(normalizedEvidence, profile, artifact, selected.targets, allIssues);
  return reconstructPi(normalizedEvidence, profile, artifact, records, selected.targets, allIssues);
}
