import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import { OperationError, validateOperationReport } from "./operations.js";
import type { OperationReport } from "./operation-types.js";
import { formatMoney } from "./render.js";

export interface OperationExportOptions {
  projection: "execution" | "source";
  measure: "charges" | "credits" | "operations";
}
interface Sample { frames: string[]; value: string; observation: string | null }
const escapeFrame = (value: string) => value.replace(/[%;\s<>&"'\\{}$\u0000-\u001f\u007f]/gu, char => char === " " ? " " : [...Buffer.from(char)].map(byte => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join(""));
const frame = (label: string, id: string) => `${escapeFrame(label)}[${createHash("sha256").update(id).digest("hex").slice(0, 16)}]`;

function prepare(input: OperationReport, options: OperationExportOptions): { report: OperationReport; samples: Sample[]; unit: string } {
  const report = validateOperationReport(input);
  if (!options || !["execution", "source"].includes(options.projection) || !["charges", "credits", "operations"].includes(options.measure) || Object.keys(options).some(key => !["projection", "measure"].includes(key))) throw new OperationError("OPERATION_EXPORT_OPTIONS", "Select execution/source projection and charges/credits/operations measure");
  if (options.projection === "source" && options.measure === "operations") throw new OperationError("OPERATION_EXPORT_OPTIONS", "Operation counts belong to execution, not estimated source attribution");
  const byId = new Map(report.operations.spans.map(span => [span.id, span]));
  const pathFrames = (ids: string[]) => ids.map(id => { const span = byId.get(id)!; return frame(`${span.kind}:${span.label}`, id); });
  const root = options.projection === "execution" ? "Execution" : "Estimated_source_attribution";
  let samples: Sample[];
  if (options.measure === "operations") {
    samples = report.operations.spans.map(span => {
      const path: string[] = []; let current: typeof span | undefined = span;
      while (current) { path.push(current.id); current = current.parent_id === null ? undefined : byId.get(current.parent_id); }
      return { frames: [root, ...pathFrames(path.reverse())], value: "1", observation: span.observation_id };
    });
  } else {
    const source = options.projection === "execution" ? report.execution_cost : report.source_cost;
    samples = source.flatMap(sample => {
      const signed = BigInt(sample.amount_nanos);
      const amount = options.measure === "charges" ? signed : -signed;
      if (amount <= 0n) return [];
      const path = sample.operation_ids.length > 0 ? pathFrames(sample.operation_ids) : [options.projection === "source" && sample.attribution === "estimated_source" ? "Producer_unattributed" : "Execution_unbound"];
      if (options.projection === "source") path.push(sample.attribution === "unallocated" ? "Unallocated_request_cost" : frame(`source:${sample.label}`, sample.context_source_id!));
      // Explicit leaf keeps distinct valued attempts separate without inventing an execution operation.
      path.push(frame(`observation:${sample.observation_id}`, JSON.stringify([sample.observation_id, sample.request_id, sample.occurrence_id])));
      return [{ frames: [root, ...path], value: amount.toString(), observation: sample.observation_id }];
    });
  }
  samples.sort((a, b) => a.frames.join(";") < b.frames.join(";") ? -1 : a.frames.join(";") > b.frames.join(";") ? 1 : 0);
  return { report, samples, unit: options.measure === "operations" ? "operations" : `${report.summary.currency}_nanos` };
}

export function exportOperationFolded(report: OperationReport, options: OperationExportOptions): string {
  const { samples } = prepare(report, options);
  return samples.map(sample => `${sample.frames.join(";")} ${sample.value}\n`).join("");
}

/** Standard gzip pprof with one integer sample type; no token-to-time relabelling. */
export function exportOperationPprof(input: OperationReport, options: OperationExportOptions): Uint8Array {
  const { report, samples, unit } = prepare(input, options);
  const total = samples.reduce((sum, sample) => sum + BigInt(sample.value), 0n);
  if (total > (1n << 63n) - 1n) throw new OperationError("OPERATION_PPROF_RANGE", "Selected total exceeds pprof signed int64; use exact JSON or folded output");
  const strings = [""], indices = new Map<string, number>([["", 0]]);
  const str = (value: string) => { let index = indices.get(value); if (index === undefined) { index = strings.length; indices.set(value, index); strings.push(value); } return index; };
  const frames = [...new Set(samples.flatMap(sample => sample.frames))].sort();
  const ids = new Map(frames.map((name, i) => [name, i + 1]));
  const type = protobuf.parse(readFileSync(new URL("../vendor/pprof/profile.proto", import.meta.url), "utf8")).root.lookupType("perftools.profiles.Profile");
  const body = {
    sampleType: [{ type: str(options.measure), unit: str(unit) }],
    sample: samples.map(sample => ({ locationId: [...sample.frames].reverse().map(name => ids.get(name)!), value: [sample.value], label: sample.observation === null ? [] : [{ key: str("observation_id"), str: str(sample.observation) }] })),
    function: frames.map(name => ({ id: ids.get(name)!, name: str(name), systemName: str(name), filename: 0 })),
    location: frames.map(name => ({ id: ids.get(name)!, line: [{ functionId: ids.get(name)!, line: 0 }] })),
    comment: [str(JSON.stringify({ projection: options.projection, measure: options.measure, summary: report.summary, coverage: report.operations.coverage })), ...report.assumptions.map(str)],
    stringTable: strings,
  };
  const message = type.fromObject(body);
  const error = type.verify(message);
  if (error) throw new OperationError("OPERATION_PPROF", error);
  return gzipSync(type.encode(message).finish());
}

/** Use the vendored, unmodified FlameGraph renderer. Empty views have no width to render. */
export function renderOperationSvg(input: OperationReport, options: OperationExportOptions): string | null {
  const { report, samples, unit } = prepare(input, options);
  const total = samples.reduce((sum, sample) => sum + BigInt(sample.value), 0n);
  if (total === 0n) return null;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new OperationError("OPERATION_SVG_RANGE", "Selected total exceeds the renderer's exact integer range; use JSON, folded or pprof");
  const title = options.measure === "operations" ? `${total} recorded operations` : `${options.projection === "source" ? "Estimated source allocation" : "Execution"} - ${formatMoney(total.toString(), report.summary.currency)} ${options.measure}`;
  const result = spawnSync("perl", [fileURLToPath(new URL("../vendor/FlameGraph/flamegraph.pl", import.meta.url)), "--title", title,
    "--subtitle", options.projection === "source" ? "Estimated information flow | includes output cost | not causal savings" : "Recorded execution ancestry | click to zoom; Ctrl+F to search",
    "--countname", unit, "--nametype", options.projection === "source" ? "Attribution:" : "Operation:", "--width", "1400", "--minwidth", "0", "--hash"],
    { input: samples.map(sample => `${sample.frames.join(";")} ${sample.value}\n`).join(""), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0" } });
  if (result.error || result.status !== 0) throw new OperationError("OPERATION_SVG", `Upstream FlameGraph renderer failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

/** Chrome Trace Event complete events on logical producer lanes, usable in Perfetto. */
export function exportOperationTrace(input: OperationReport): {
  traceEvents: Array<{ name: string; cat: string; ph: "X"; pid: number; tid: number; ts: number; dur: number; args: object }>;
  displayTimeUnit: string; missing_timing_operation_ids: string[]; assumptions: string[];
} {
  const report = validateOperationReport(input);
  const lanes = new Map<string, number>();
  const missing: string[] = [];
  const starts = report.operations.spans.flatMap(span => span.started_at === null ? [] : [Date.parse(span.started_at)]);
  const origin = starts.reduce((min, start) => Math.min(min, start), Infinity);
  const traceEvents = report.operations.spans.flatMap(span => {
    const elapsed = span.duration_ns !== null ? Number(span.duration_ns) / 1000 : span.started_at !== null && span.ended_at !== null ? (Date.parse(span.ended_at) - Date.parse(span.started_at)) * 1000 : null;
    if (span.started_at === null || elapsed === null || !Number.isFinite(elapsed) || elapsed > Number.MAX_SAFE_INTEGER) { missing.push(span.id); return []; }
    const lane = JSON.stringify([span.stream_id, span.agent_id]);
    if (!lanes.has(lane)) lanes.set(lane, lanes.size + 1);
    return [{ name: span.label, cat: span.kind, ph: "X" as const, pid: 1, tid: lanes.get(lane)!, ts: (Date.parse(span.started_at) - origin) * 1000, dur: elapsed,
      args: { operation_id: span.id, parent_id: span.parent_id, parentage: span.parentage, status: span.status, timing: span.timing,
        duration_method: span.duration_ns === null ? "derived from wall-clock endpoints" : span.timing.duration_ns.method,
        duration_evidence: span.duration_ns === null ? "derived" : span.timing.duration_ns.evidence,
        duration_clock: span.duration_ns === null ? "wall" : span.timing.duration_ns.clock,
        observation_id: span.observation_id, io: span.io } }];
  });
  return { traceEvents, displayTimeUnit: "ms", missing_timing_operation_ids: missing,
    assumptions: ["Lanes represent logical producer streams and agents, not OS threads. Asynchronous intervals can overlap.", "Timeline positions use recorded wall-clock starts relative to the earliest start. Clock skew across producers is not corrected.", "Trace Event time values use floating-point microseconds; exact recorded nanoseconds remain in the operation report."] };
}
