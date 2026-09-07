/**
 * Regenerate the bounded native Codex operation dogfood.
 *
 * The input is deliberately supplied by the caller. The script selects one
 * frozen time window, passes that exact in-memory JSONL snapshot to both
 * importers, and only writes metadata-only, privacy-checked projections.
 */
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  importEvidence,
  validateEvidence,
  validateRateCard,
  valueEvidence,
  type EvidenceBundle,
  type Observation,
  type Source,
  type SourceRef,
  type Valuation,
} from "../src/index.js";
import {
  createOperationReport,
  reconcileOperationBundles,
  validateOperationBundle,
  validateOperationReport,
} from "../src/operations.js";
import {
  exportOperationFolded,
  exportOperationPprof,
  exportOperationTrace,
  renderOperationSvg,
} from "../src/operation-export.js";
import { importNativeOperations } from "../src/native-operations.js";
import type { OperationBundle, OperationReport } from "../src/operation-types.js";

const DATASET_ID = "native-dogfood-v03";
const NAMESPACE = "native-dogfood-v03";
const RESOURCE_KEY = "native-dogfood-public-v03";
const START_AT = "2026-09-06T23:29:51.200Z";
const CUTOFF_AT = "2026-09-07T00:17:07.300Z";
const RATE_CARD_PATH = new URL("../examples/rates/enterprise-astra-scenario.json", import.meta.url);

type JsonObject = Record<string, unknown>;
type PhysicalLine = { text: string; number: number };
type SelectedRow = { timestamp: string; ordinal: number | string | null };

function usage(): never {
  throw new Error("Usage: node --import tsx tools/dogfood-native-v03.ts --input /absolute/path/to/codex-rollout.jsonl [--output examples/dogfood/v03]");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) usage();
  return value;
}

function parseArgs(args: string[]): { input: string; output: string } {
  if (args.includes("--help")) {
    process.stdout.write("Usage: node --import tsx tools/dogfood-native-v03.ts --input /absolute/path/to/codex-rollout.jsonl [--output examples/dogfood/v03]\n");
    process.exit(0);
  }
  const input = option(args, "--input");
  if (input === undefined) usage();
  const output = option(args, "--output") ?? "examples/dogfood/v03";
  const consumed = new Set(["--input", input, "--output", output]);
  if (args.some((arg) => arg.startsWith("--") && !consumed.has(arg))) usage();
  return { input, output: resolve(output) };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pseudonym(domain: string, value: string): string {
  return `sha256:${sha256(`native-dogfood-v03\0${domain}\0${value}`)}`;
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function physicalLines(input: string): PhysicalLine[] {
  // Keep each original line ending so the selected snapshot has one stable
  // byte representation. JSONL sources in the capture use LF; CRLF is also
  // preserved and accepted by the public parsers.
  const parts = input.match(/[^\n]*(?:\n|$)/g) ?? [];
  return parts.filter((text) => text.length > 0).map((text, index) => ({ text, number: index + 1 }));
}

function selectSnapshot(input: string): {
  text: string;
  rows: SelectedRow[];
  source_sha256: string;
  raw_source_sha256: string;
  raw_nonempty_lines: number;
  first_source_line: number;
  last_source_line: number;
} {
  const start = Date.parse(START_AT);
  const cutoff = Date.parse(CUTOFF_AT);
  const selected: string[] = [];
  const rows: SelectedRow[] = [];
  let rawNonempty = 0;
  let firstSourceLine = 0;
  let lastSourceLine = 0;
  for (const physical of physicalLines(input)) {
    const trimmed = physical.text.trim();
    if (trimmed.length === 0) continue;
    rawNonempty += 1;
    let record: JsonObject;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const parsedRecord = object(parsed);
      if (parsedRecord === undefined) continue;
      record = parsedRecord;
    } catch {
      // A malformed line cannot be safely associated with the time window.
      // The evidence and operation importers report malformed selected input
      // themselves; this selector simply excludes malformed source lines.
      continue;
    }
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
    const epoch = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
    if (timestamp === undefined || !Number.isFinite(epoch) || epoch < start || epoch > cutoff) continue;
    selected.push(physical.text);
    const ordinal = typeof record.ordinal === "number" || typeof record.ordinal === "string" ? record.ordinal : null;
    rows.push({ timestamp, ordinal });
    if (firstSourceLine === 0) firstSourceLine = physical.number;
    lastSourceLine = physical.number;
  }
  const text = selected.join("");
  if (rows.length === 0 || text.trim().length === 0) throw new Error("DOGFOOD_EMPTY_NATIVE_WINDOW");
  return {
    text,
    rows,
    source_sha256: sha256(text),
    raw_source_sha256: sha256(input),
    raw_nonempty_lines: rawNonempty,
    first_source_line: firstSourceLine,
    last_source_line: lastSourceLine,
  };
}

function lineOnly(record: string): string {
  const match = /(?:^|:)line:(\d+)(?:$|[:/])/u.exec(record);
  return match === null ? "record:unavailable" : `line:${match[1]}`;
}

function safeSemantic(value: string | undefined, fallback: string): string {
  return value !== undefined && /^[A-Za-z][A-Za-z0-9_.:/-]{0,95}$/u.test(value) ? value : fallback;
}

function safeQuantity(value: unknown): string | null {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
    ? value
    : value === null ? null : null;
}

function safeSourceId(source: Source, digest: string, index: number): string {
  if (/^[A-Za-z][A-Za-z0-9_.:-]{0,100}$/u.test(source.id)) return source.id;
  return `codex:${digest.slice(0, 16)}${index === 0 ? "" : `-${index}`}`;
}

function safeObservationId(value: string): string {
  // The adapter already derives IDs from a native identity. Keep those IDs so
  // operation/evidence joins continue to point to the same observation.
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,120}$/u.test(value)) throw new Error("DOGFOOD_UNSAFE_OBSERVATION_ID");
  return value;
}

const SAFE_ATTRIBUTE_KEYS = new Set([
  "source_record_type",
  "snapshot_kind",
  "native_total_tokens",
  "effort",
  "event_type",
]);

function safeAttributes(attributes: Observation["attributes"]): Observation["attributes"] {
  if (attributes === undefined) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.includes("hash") && typeof value === "string" && /^[a-f0-9]{16,128}$/u.test(value)) {
      result[key] = value;
      continue;
    }
    if (key.endsWith("_id") || key === "id") {
      if (typeof value === "string" && value.length > 0) result[key] = pseudonym(`attribute:${key}`, value);
      continue;
    }
    if (!SAFE_ATTRIBUTE_KEYS.has(key)) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      result[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (key === "native_total_tokens") {
        const quantity = safeQuantity(value);
        if (quantity !== null) result[key] = quantity;
      } else {
        result[key] = safeSemantic(value, key === "effort" ? "unknown" : "metadata");
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function safeUsage(usage: Observation["usage"]): Observation["usage"] {
  if (usage === null) return null;
  if (usage === undefined) return null;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    cache_write_input_tokens: usage.cache_write_input_tokens,
    reasoning_output_tokens: usage.reasoning_output_tokens,
    ...(usage.unclassified_tokens !== undefined ? { unclassified_tokens: usage.unclassified_tokens } : {}),
  };
}

function safeSourceRefs(refs: SourceRef[], sourceMap: Map<string, string>, fallback: string): SourceRef[] {
  const result = refs.map((ref) => ({
    source_id: sourceMap.get(ref.source_id) ?? fallback,
    record: lineOnly(ref.record),
  }));
  return result.length > 0 ? result : [{ source_id: fallback, record: "record:unavailable" }];
}

function sanitizeEvidence(input: EvidenceBundle): EvidenceBundle {
  const digest = input.sources.find((source) => source.sha256 !== undefined)?.sha256 ?? sha256(JSON.stringify(input));
  const sourceMap = new Map<string, string>();
  const sources = input.sources.map((source, index) => {
    const id = safeSourceId(source, digest, index);
    sourceMap.set(source.id, id);
    return {
      id,
      harness: safeSemantic(source.harness, "native"),
      format: safeSemantic(source.format, "native-jsonl"),
      ...(source.version !== undefined ? { version: safeSemantic(source.version, "unknown") } : {}),
      ...(source.sha256 !== undefined ? { sha256: source.sha256 } : {}),
      coverage: source.coverage,
      description: "Sanitized metadata-only native capture; raw IDs, paths, prompts, messages, arguments and results are omitted.",
    } satisfies Source;
  });
  const fallbackSource = sources[0]?.id ?? `codex:${digest.slice(0, 16)}`;
  const originalIds = new Set(input.observations.map((observation) => observation.id));
  const observations = input.observations.map((observation) => {
    const id = safeObservationId(observation.id);
    const sanitized: Observation = {
      id,
      source_refs: safeSourceRefs(observation.source_refs, sourceMap, fallbackSource),
      kind: observation.kind,
      operation: safeSemantic(observation.operation, observation.kind),
      status: observation.status,
      accounting_scope: observation.accounting_scope,
      usage: safeUsage(observation.usage),
      ...(observation.grain !== undefined ? { grain: observation.grain } : {}),
      ...(observation.count_basis !== undefined ? { count_basis: observation.count_basis } : {}),
      ...(observation.timestamp !== undefined ? { timestamp: observation.timestamp } : {}),
      ...(observation.end_time !== undefined ? { end_time: observation.end_time } : {}),
      ...(observation.provider !== undefined ? { provider: safeSemantic(observation.provider, "provider") } : {}),
      ...(observation.product !== undefined ? { product: safeSemantic(observation.product, "product") } : {}),
      ...(observation.model !== undefined ? { model: safeSemantic(observation.model, "unknown") } : {}),
      ...(observation.model_identity !== undefined ? { model_identity: observation.model_identity } : {}),
      ...(observation.subject_id !== undefined ? { subject_id: pseudonym("subject", observation.subject_id) } : {}),
      ...(observation.agent_id !== undefined ? { agent_id: pseudonym("agent", observation.agent_id) } : {}),
      ...(observation.session_id !== undefined ? { session_id: pseudonym("session", observation.session_id) } : {}),
      ...(observation.turn_id !== undefined ? { turn_id: pseudonym("turn", observation.turn_id) } : {}),
      ...(observation.trace_id !== undefined ? { trace_id: pseudonym("trace", observation.trace_id) } : {}),
      ...(observation.span_id !== undefined ? { span_id: pseudonym("span", observation.span_id) } : {}),
      ...(observation.work_item_id !== undefined ? { work_item_id: pseudonym("work-item", observation.work_item_id) } : {}),
      ...(observation.parent_id !== undefined && originalIds.has(observation.parent_id) ? { parent_id: observation.parent_id } : {}),
      ...(observation.recorded_cost !== undefined ? { recorded_cost: { ...observation.recorded_cost } } : {}),
      ...(safeAttributes(observation.attributes) !== undefined ? { attributes: safeAttributes(observation.attributes) } : {}),
    };
    return sanitized;
  });
  const observationIds = new Set(observations.map((observation) => observation.id));
  const relationships = input.relationships.flatMap((relationship) => {
    if (!observationIds.has(relationship.from) || !observationIds.has(relationship.to)) return [];
    return [{ from: relationship.from, to: relationship.to, kind: relationship.kind }];
  });
  const issues = input.issues.map((issue) => {
    const line = /\bline (\d+)\b/u.exec(issue.message)?.[1];
    return {
      code: safeSemantic(issue.code, "native_issue"),
      message: `Sanitized native evidence ${safeSemantic(issue.code, "native_issue")}${line === undefined ? "" : ` at line ${line}`}.`,
      severity: issue.severity,
      ...(issue.observation_id !== undefined && observationIds.has(issue.observation_id) ? { observation_id: issue.observation_id } : {}),
      ...(issue.source_id !== undefined ? { source_id: sourceMap.get(issue.source_id) ?? fallbackSource } : {}),
    };
  });
  return validateEvidence({
    schema_version: input.schema_version,
    dataset_id: DATASET_ID,
    sources,
    observations,
    relationships,
    issues,
  });
}

function directObservations(evidence: EvidenceBundle): Observation[] {
  return evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
}

function sumUsage(observations: Observation[], field: "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_write_input_tokens" | "reasoning_output_tokens"): string | null {
  let total = 0n;
  for (const observation of observations) {
    const value = observation.usage?.[field];
    if (value === null || value === undefined) return null;
    total += BigInt(value);
  }
  return total.toString();
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function publicJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sensitiveValues(input: string): string[] {
  const result = new Set<string>();
  const idKey = /(?:^|_)(?:id|ids|session|thread|turn|response|call|parent|trace|span)(?:$|_)/iu;
  const bodyKey = /^(?:input|output|arguments|command|path|content|message|prompt|text|cwd|workdir|raw_content|encrypted_content)$/iu;
  const visit = (value: unknown, key = ""): void => {
    if (typeof value === "string") {
      const isBody = bodyKey.test(key);
      const isId = idKey.test(key);
      // Short directory components such as "examples" also occur in the
      // vendored FlameGraph comment. Require a path separator or a longer
      // body for a useful privacy check; IDs remain checked at eight bytes.
      if ((isId && value.length >= 8) || (isBody && value.length >= 8 && (/[\\/]/u.test(value) || value.length >= 12))) result.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    const record = object(value);
    if (record === undefined) return;
    for (const [childKey, child] of Object.entries(record)) visit(child, childKey);
  };
  for (const line of input.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try { visit(JSON.parse(line)); } catch { /* selector already excludes malformed rows */ }
  }
  return [...result].sort((a, b) => b.length - a.length);
}

function assertPrivate(serialized: string, selectedInput: string, inputPath: string): { candidates: number; leaks: number } {
  const candidates = sensitiveValues(selectedInput);
  const hits = candidates.filter((candidate) => serialized.includes(candidate));
  const pathHit = serialized.includes(inputPath);
  const leaks = hits.length + (pathHit ? 1 : 0);
  if (leaks > 0) throw new Error("DOGFOOD_PRIVACY_LEAK");
  return { candidates: candidates.length, leaks };
}

async function save(output: string, name: string, value: unknown): Promise<void> {
  await writeFile(`${output}/${name}`, typeof value === "string" ? value : publicJson(value), "utf8");
}

async function saveBytes(output: string, name: string, value: Uint8Array): Promise<void> {
  await writeFile(`${output}/${name}`, value);
}

function render(report: OperationReport, projection: "execution" | "source", measure: "operations" | "charges"): { folded: string; pprof: Uint8Array; svg: string | null } {
  return {
    folded: exportOperationFolded(report, { projection, measure }),
    pprof: exportOperationPprof(report, { projection, measure }),
    svg: renderOperationSvg(report, { projection, measure }),
  };
}

async function main(): Promise<void> {
  const { input: inputPath, output } = parseArgs(process.argv.slice(2));
  const rawInput = await readFile(inputPath, "utf8");
  const snapshot = selectSnapshot(rawInput);

  // Keep this variable as the sole importer input. This is an explicit guard
  // against evidence and operation data being selected from different reads.
  const selectedSnapshot = snapshot.text;
  const importedEvidence = importEvidence("codex", selectedSnapshot, { dataset_id: DATASET_ID });
  const evidence = sanitizeEvidence(importedEvidence);
  const operations = importNativeOperations("codex", selectedSnapshot, {
    dataset_id: DATASET_ID,
    namespace: NAMESPACE,
    resource_key: RESOURCE_KEY,
    evidence,
  });
  validateEvidence(evidence);
  validateOperationBundle(operations);
  if (evidence.sources[0]?.sha256 !== snapshot.source_sha256 || operations.artifacts[0]?.sha256 !== snapshot.source_sha256) throw new Error("DOGFOOD_SNAPSHOT_DIGEST_MISMATCH");

  const rateCard = validateRateCard(JSON.parse(await readFile(RATE_CARD_PATH, "utf8")) as unknown);
  const valuation = valueEvidence(evidence, { mode: "rate_card", rate_card: rateCard });
  const report = createOperationReport(operations, evidence, valuation);
  validateOperationReport(report);

  const replay = importNativeOperations("codex", selectedSnapshot, {
    dataset_id: DATASET_ID,
    namespace: NAMESPACE,
    resource_key: RESOURCE_KEY,
    evidence,
  });
  validateOperationBundle(replay);
  if (JSON.stringify(replay) !== JSON.stringify(operations)) throw new Error("DOGFOOD_NATIVE_REPLAY_MISMATCH");
  const merged = reconcileOperationBundles([operations, replay]);
  assert.deepEqual(merged, operations);

  const count = render(report, "execution", "operations");
  const execution = render(report, "execution", "charges");
  const source = render(report, "source", "charges");
  if (count.svg === null || execution.svg === null || source.svg === null) throw new Error("DOGFOOD_EMPTY_EXPORT");
  const direct = directObservations(evidence);
  const pricedDirect = valuation.observations.filter((item) => item.amount_nanos !== null && direct.some((observation) => observation.id === item.observation_id));
  const unpricedDirect = valuation.observations.filter((item) => item.amount_nanos === null && direct.some((observation) => observation.id === item.observation_id));
  const joined = operations.spans.filter((span) => span.observation_id !== null);
  const benchmark = {
    schema_version: "0.3.0",
    dataset_id: DATASET_ID,
    harness: "codex",
    selection: {
      start_at: START_AT,
      cutoff_at: CUTOFF_AT,
      inclusive: true,
      selected_lines: snapshot.rows.length,
      selected_bytes: Buffer.byteLength(selectedSnapshot, "utf8"),
      first_timestamp: snapshot.rows[0]?.timestamp ?? null,
      last_timestamp: snapshot.rows.at(-1)?.timestamp ?? null,
      first_source_line: snapshot.first_source_line,
      last_source_line: snapshot.last_source_line,
      first_source_ordinal: snapshot.rows[0]?.ordinal ?? null,
      last_source_ordinal: snapshot.rows.at(-1)?.ordinal ?? null,
    },
    source: {
      raw_source_sha256: snapshot.raw_source_sha256,
      selected_source_sha256: snapshot.source_sha256,
      raw_nonempty_lines: snapshot.raw_nonempty_lines,
    },
    evidence: {
      observations: evidence.observations.length,
      models: evidence.observations.filter((observation) => observation.kind === "model").length,
      direct_models: direct.length,
      direct_model_models: countBy(direct.map((observation) => observation.model ?? "unknown")),
      activities: evidence.observations.filter((observation) => observation.kind === "activity").length,
      issues: evidence.issues.length,
      usage_sums: {
        input_tokens: sumUsage(direct, "input_tokens"),
        output_tokens: sumUsage(direct, "output_tokens"),
        cache_read_input_tokens: sumUsage(direct, "cache_read_input_tokens"),
        cache_write_input_tokens: sumUsage(direct, "cache_write_input_tokens"),
        reasoning_output_tokens: sumUsage(direct, "reasoning_output_tokens"),
      },
    },
    operations: {
      spans: operations.spans.length,
      by_kind: countBy(operations.spans.map((span) => span.kind)),
      by_status: countBy(operations.spans.map((span) => span.status)),
      joined_observations: joined.length,
      parented_spans: operations.spans.filter((span) => span.parent_id !== null).length,
      max_depth: report.summary.max_depth,
      dropped_spans: operations.coverage.dropped_spans,
      dropped_links: operations.coverage.dropped_links,
    },
    valuation: {
      basis: valuation.basis,
      currency: valuation.currency,
      total_nanos: valuation.total_nanos,
      complete: valuation.complete,
      priced_direct: pricedDirect.length,
      unpriced_direct: unpricedDirect.length,
      unpriced_non_direct: valuation.observations.length - direct.length,
      issues: valuation.issues.length,
    },
    replay: { same_snapshot: true, exact_import: true, exact_merge: true },
    privacy: { checked: true, candidate_values_checked: 0, leaks: 0, rule: "metadata-only outputs are scanned against selected raw ID/body fields and the caller input path" },
    limitations: [
      "Native Codex records expose outer transcript calls and usage rows; hidden provider retries, model internals, shell internals and complete child-thread operation coverage remain outside this capture.",
      "The source window begins after the first call and ends after a call whose result is outside the window; partial lifecycle halves are retained with unknown status or timing where necessary.",
      "The selected Enterprise rate card is a scenario for gpt-6-astra. Unknown-model direct observations remain unpriced, and the amount is not an invoice.",
    ],
  };

  await mkdir(output, { recursive: true });
  const publicPieces = [
    ["operations", publicJson(operations)], ["evidence", publicJson(evidence)], ["valuation", publicJson(valuation)], ["report", publicJson(report)],
    ["trace", publicJson(exportOperationTrace(report))], ["benchmark", publicJson(benchmark)], ["count-folded", count.folded],
    ["execution-folded", execution.folded], ["source-folded", source.folded], ["count-svg", count.svg], ["execution-svg", execution.svg], ["source-svg", source.svg],
    ["count-pprof", Buffer.from(count.pprof).toString("latin1")], ["execution-pprof", Buffer.from(execution.pprof).toString("latin1")], ["source-pprof", Buffer.from(source.pprof).toString("latin1")],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  const serializable = publicPieces.map(([, value]) => value).join("\n");
  const privacy = assertPrivate(serializable, selectedSnapshot, inputPath);
  benchmark.privacy.candidate_values_checked = privacy.candidates;
  benchmark.privacy.leaks = privacy.leaks;

  await save(output, "native-operations.json", operations);
  await save(output, "native-evidence.json", evidence);
  await save(output, "native-valuation.json", valuation);
  await save(output, "native-report.json", report);
  await save(output, "native-trace.json", exportOperationTrace(report));
  await save(output, "native-benchmark.json", benchmark);
  await save(output, "native-count.folded", count.folded);
  await saveBytes(output, "native-count.pprof", count.pprof);
  await save(output, "native-count.svg", count.svg);
  await save(output, "native-execution.folded", execution.folded);
  await saveBytes(output, "native-execution.pprof", execution.pprof);
  await save(output, "native-execution.svg", execution.svg);
  await save(output, "native-source.folded", source.folded);
  await saveBytes(output, "native-source.pprof", source.pprof);
  await save(output, "native-source.svg", source.svg);
  process.stdout.write(`${JSON.stringify({ ok: true, selected_lines: snapshot.rows.length, selected_bytes: Buffer.byteLength(selectedSnapshot, "utf8"), evidence_observations: evidence.observations.length, direct_models: direct.length, operation_spans: operations.spans.length, max_depth: report.summary.max_depth, priced_direct: pricedDirect.length, unpriced_direct: unpricedDirect.length, privacy: "passed" })}\n`);
}

await main();
