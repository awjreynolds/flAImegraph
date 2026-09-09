import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { protectInputs, readInputText, writeArtifact } from "./files.js";
import { createUsageReport, reconcileUsageBundles, validateUsageBundle, validateUsageReport } from "./usage.js";
import { createUsageProfile, validateUsageProfile, type UsageProfileOptions } from "./usage-profile.js";
import { exportUsageFolded, exportUsagePprof, renderUsageSvg } from "./usage-export.js";
import { operationUsage } from "./usage-operations.js";
import { importUsage } from "./usage-import.js";
import type { UsageBundle, UsageReport, UsageGrouping } from "./usage-types.js";
import { mergeLifecycleCaptures, projectLifecycle, validateLifecycleCapture, validateLifecycleEvent } from "./lifecycle.js";
import { readLifecycleJournal } from "./lifecycle-journal.js";
import { getLoggingSchema, type LoggingSchemaKind } from "./logging-schema.js";
import { captureNative, type NativeCaptureOptions } from "./native-capture.js";

const help = `flAImegraph — usage-first AI profiling (experimental 0.5)

Capture and inspect usage without rates, currency or a subscription policy:
  capture --format pi|claude|codex-exec --dataset-id ID --out usage.json [--work-item LABEL] -- COMMAND [ARGS...]
  import --format codex|codex-exec|claude|claude-transcript|pi|openai|anthropic|gemini|otel --input FILE --dataset-id ID --out usage.json
  # Native imports can use --work-item "PROJ-142 / custom work label"
  import --format legacy|operations|usage|lifecycle --input FILE --out usage.json
  merge --inputs usage-a.json,usage-b.json --out usage.json
  report --input usage.json [--group-by task,operation] --out report.json
  export --input report.json --meter input_tokens --out-dir profile [--group-by task,operation|execution] [--svg true]
  validate --kind usage|usage-report|usage-profile|efficiency-input|benchmark --input FILE

Durable action capture and recovery:
  lifecycle-recover --directory JOURNAL_DIR --dataset-id ID --out lifecycle.json
  lifecycle-merge --inputs lifecycle-a.json,lifecycle-b.json --out lifecycle.json
  lifecycle-report --input lifecycle.json --out lifecycle-report.json
  validate --kind lifecycle --input lifecycle.json
  validate --kind lifecycle-event --input event.json
  schema --kind usage|lifecycle|lifecycle-event|journal-frame [--out schema.json]

Optional downstream analysis:
  analyze --input report.json [--options analysis-options.json] --out analysis.json
  benchmark-import --format inspect --input log.json --options import-options.json --out benchmark.json
  benchmark --baseline baseline.json --candidate candidate.json --out comparison.json
  runway --input runway-input.json --out forecast.json

Demonstrations and integration coverage:
  demo --out-dir demo
  capabilities

Use the separate flaimegraph-pricing command for legacy valuation and monetary views.
Import/report commands are offline. Capture runs the supplied harness command with its usual provider access.
Local input files are never overwritten. Capture output must be a new path.
`;

function flags(args: string[], allowed: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1];
    if (!allowed.includes(key) || result.has(key) || value === undefined || value.startsWith("--")) throw new Error(`Unknown/repeated option or missing value: ${key}`);
    result.set(key, value);
  }
  return result;
}
function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new Error(`Required option: ${name}`);
  return value;
}
const json = async (path: string): Promise<unknown> => JSON.parse(await readInputText(path));
const save = async (path: string, value: unknown) => writeArtifact(path, JSON.stringify(value, null, 2) + "\n");
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const asReport = (input: unknown): UsageReport => input && typeof input === "object" && "bundle" in input ? validateUsageReport(input) : createUsageReport(validateUsageBundle(input));

async function exportReport(report: UsageReport, options: UsageProfileOptions, directory: string, svg: boolean, inputs: string[]): Promise<void> {
  const profile = createUsageProfile(report, options);
  const paths = ["usage.json", "report.json", "profile.json", "usage.folded", "usage.pprof", "export.json", ...(svg ? ["usage.svg"] : [])];
  await protectInputs(paths.map(path => join(directory, path)), inputs);
  const folded = exportUsageFolded(profile), pprof = exportUsagePprof(profile), rendered = svg ? renderUsageSvg(profile) : null;
  const bytes: Record<string, string | Uint8Array> = { "usage.folded": folded, "usage.pprof": pprof, ...(rendered === null ? {} : { "usage.svg": rendered }) };
  await save(join(directory, "usage.json"), report.bundle);
  await save(join(directory, "report.json"), report);
  await save(join(directory, "profile.json"), profile);
  for (const [name, data] of Object.entries(bytes)) await writeArtifact(join(directory, name), data);
  await save(join(directory, "export.json"), { schema_version: "0.4.0", dataset_id: report.dataset_id, meter_id: profile.meter_id, total: profile.total, unit: profile.unit, integer_unit: profile.integer_unit,
    artifacts: Object.fromEntries(Object.entries(bytes).map(([name, data]) => [name, { sha256: createHash("sha256").update(data).digest("hex") }])),
    skipped_svg: svg && rendered === null ? "No known positive usage for the selected meter; unavailable usage remains in the report." : null,
  });
  output({ output: directory, meter_id: profile.meter_id, total: profile.total, unit: profile.unit, unknown_observations: profile.unknown_observation_ids.length });
}

export async function runUsageCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || ["--help", "-h"].includes(command)) { process.stdout.write(help); return; }
  if (command === "capture") {
    const separator = rest.indexOf("--");
    if (separator < 0) throw new Error("Capture requires a command after --");
    const options = flags(rest.slice(0, separator), ["--format", "--dataset-id", "--out", "--work-item"]);
    const code = await captureNative({ format: required(options, "--format") as NativeCaptureOptions["format"], dataset_id: required(options, "--dataset-id"), out: required(options, "--out"), work_item_id: options.get("--work-item"), command: rest.slice(separator + 1) });
    process.exitCode = code;
    output({ output: required(options, "--out"), child_exit_code: code });
    return;
  }
  if (command === "schema") {
    const options = flags(rest, ["--kind", "--out"]);
    const kind = required(options, "--kind") as LoggingSchemaKind;
    const schema = getLoggingSchema(kind), out = options.get("--out");
    if (out) { await save(out, schema); output({ output: out, kind }); }
    else output(schema);
    return;
  }
  if(command === "lifecycle-recover") {
    const options=flags(rest,["--directory","--dataset-id","--out"]), directory=required(options,"--directory"), out=required(options,"--out");
    // The reader owns immutable .jsonl segments. A recovery artifact must live outside them.
    if(out.endsWith(".jsonl")) throw new Error("Recovery output must be a .json artifact, never a journal segment");
    const capture=await readLifecycleJournal({directory,dataset_id:required(options,"--dataset-id")});
    const report=projectLifecycle(capture);
    await save(out,capture); output({output:out,events:capture.events.length,actions:report.actions.length,issues:report.issues.length}); return;
  }
  if(command === "lifecycle-merge") {
    const options=flags(rest,["--inputs","--out"]), inputs=required(options,"--inputs").split(","), out=required(options,"--out");
    await protectInputs([out],inputs);
    const capture=mergeLifecycleCaptures(await Promise.all(inputs.map(async path=>validateLifecycleCapture(await json(path)))));
    await save(out,capture); output({output:out,events:capture.events.length}); return;
  }
  if(command === "lifecycle-report") {
    const options=flags(rest,["--input","--out"]), input=required(options,"--input"), out=required(options,"--out");
    await protectInputs([out],[input]); const report=projectLifecycle(validateLifecycleCapture(await json(input)));
    await save(out,report); output({output:out,actions:report.actions.length,issues:report.issues.length}); return;
  }
  if (["value", "render", "conformance", "work-item"].includes(command) || command.startsWith("operation-") || command.startsWith("context-") || command === "harness-profile") throw new Error("Legacy cost/context commands are available through flaimegraph-pricing; the default command profiles usage without a valuation.");
  if (command === "import") {
    const options = flags(rest, ["--format", "--input", "--dataset-id", "--source-id", "--version", "--work-item", "--agent", "--session", "--task", "--out"]);
    const input = required(options, "--input"), out = required(options, "--out"), format = required(options, "--format");
    if (["usage", "operations", "lifecycle"].includes(format) && ["--work-item", "--agent", "--session", "--task", "--source-id", "--version"].some(key => options.has(key))) throw new Error("Existing captures retain their immutable associations. Set work identifiers in the producer or when importing a native log.");
    await protectInputs([out], [input]);
    const text = await readInputText(input);
    let bundle: UsageBundle;
    if (format === "operations") bundle = operationUsage(JSON.parse(text));
    else if (format === "usage") bundle = validateUsageBundle(JSON.parse(text));
    else if (format === "lifecycle") bundle = projectLifecycle(validateLifecycleCapture(JSON.parse(text))).usage;
    else {
      let dataset = options.get("--dataset-id");
      if (!dataset && ["legacy", "legacy-evidence"].includes(format)) dataset = JSON.parse(text).dataset_id;
      if (!dataset) throw new Error("Native imports require --dataset-id to identify the work being captured");
      bundle = validateUsageBundle(importUsage(text, { format, dataset_id: dataset, source_id: options.get("--source-id"), version: options.get("--version"), work_item_id: options.get("--work-item"), agent_id: options.get("--agent"), session_id: options.get("--session"), task_id: options.get("--task") }));
    }
    if (options.has("--dataset-id") && bundle.dataset_id !== options.get("--dataset-id")) throw new Error("Embedded dataset differs from --dataset-id");
    await save(out, bundle); output({ output: out, dataset_id: bundle.dataset_id, observations: bundle.observations.length, meters: bundle.meters.length }); return;
  }
  if (command === "merge") {
    const options = flags(rest, ["--inputs", "--out"]), inputs = required(options, "--inputs").split(","), out = required(options, "--out");
    await protectInputs([out], inputs);
    const bundle = reconcileUsageBundles(await Promise.all(inputs.map(async path => validateUsageBundle(await json(path)))));
    await save(out, bundle); output({ output: out, observations: bundle.observations.length }); return;
  }
  if (command === "report") {
    const options = flags(rest, ["--input", "--group-by", "--out"]), input = required(options, "--input"), out = required(options, "--out");
    await protectInputs([out], [input]);
    const report = createUsageReport(validateUsageBundle(await json(input)), { group_by: options.get("--group-by")?.split(",") as UsageGrouping[] | undefined });
    await save(out, report); output({ output: out, dataset_id: report.dataset_id, meters: report.meter_totals.map(meter => ({ meter_id: meter.meter_id, unit: meter.unit, known_total: meter.known_total, unknown_observations: meter.coverage.unknown_observations })) }); return;
  }
  if (command === "export") {
    const options = flags(rest, ["--input", "--meter", "--group-by", "--out-dir", "--svg"]), input = required(options, "--input");
    const svg = options.get("--svg") ?? "false";
    if (!["true", "false"].includes(svg)) throw new Error("--svg must be true or false");
    await exportReport(asReport(await json(input)), { meter_id: required(options, "--meter"), group_by: options.get("--group-by")?.split(",") as UsageProfileOptions["group_by"] }, required(options, "--out-dir"), svg === "true", [input]); return;
  }
  if (command === "validate") {
    const options = flags(rest, ["--input", "--kind"]), value = await json(required(options, "--input")), kind = options.get("--kind") ?? "usage";
    if (kind === "usage") validateUsageBundle(value);
    else if (kind === "lifecycle") projectLifecycle(validateLifecycleCapture(value));
    else if (kind === "lifecycle-event") validateLifecycleEvent(value);
    else if (kind === "usage-report") validateUsageReport(value);
    else if (kind === "usage-profile") validateUsageProfile(value);
    else if (kind === "efficiency-input") (await import("./efficiency.js")).validateEfficiencyInput(value);
    else if (kind === "benchmark") (await import("./efficiency.js")).validateBenchmarkInput(value);
    else throw new Error(`Unknown usage artifact: ${kind}; legacy validation is available through flaimegraph-pricing`);
    output({ valid: true, kind }); return;
  }
  if (command === "analyze") {
    const options = flags(rest, ["--input", "--options", "--out"]), input = required(options, "--input"), out = required(options, "--out"), optionsPath = options.get("--options");
    await protectInputs([out], [input, ...(optionsPath ? [optionsPath] : [])]);
    const { analyzeEfficiency } = await import("./efficiency.js");
    const analysis = analyzeEfficiency(await json(input) as Parameters<typeof analyzeEfficiency>[0], optionsPath ? await json(optionsPath) as Parameters<typeof analyzeEfficiency>[1] : {});
    await save(out, analysis); output({ output: out, findings: analysis.findings.length, accepted_work: analysis.cohort.accepted_count }); return;
  }
  if (command === "benchmark-import") {
    const options = flags(rest, ["--format", "--input", "--options", "--out"]), input = required(options, "--input"), config = required(options, "--options"), out = required(options, "--out");
    if (required(options, "--format") !== "inspect") throw new Error("Supported external benchmark format: inspect (JSON export)");
    await protectInputs([out], [input, config]);
    const { importInspectBenchmarkDetailed } = await import("./benchmark-import.js");
    const { validateBenchmarkInput } = await import("./efficiency.js");
    const result = importInspectBenchmarkDetailed(await json(input), await json(config) as Parameters<typeof importInspectBenchmarkDetailed>[1]);
    await save(out, validateBenchmarkInput(result.benchmark)); output({ output: out, samples: result.benchmark.samples.length, limitations: result.limitations }); return;
  }
  if (command === "benchmark") {
    const options = flags(rest, ["--baseline", "--candidate", "--out"]), left = required(options, "--baseline"), right = required(options, "--candidate"), out = required(options, "--out");
    await protectInputs([out], [left, right]);
    const { validateBenchmarkInput, compareBenchmarks } = await import("./efficiency.js");
    const baseline = validateBenchmarkInput(await json(left)), candidate = validateBenchmarkInput(await json(right));
    if (baseline.role !== "baseline" || candidate.role !== "candidate") throw new Error("--baseline and --candidate must name benchmarks with their corresponding roles");
    const comparison = compareBenchmarks(baseline, candidate);
    await save(out, comparison); output({ output: out, status: comparison.status }); return;
  }
  if (command === "runway") {
    const options = flags(rest, ["--input", "--out"]), input = required(options, "--input"), out = required(options, "--out");
    await protectInputs([out], [input]);
    const { forecastRunway } = await import("./efficiency.js");
    const value = await json(input) as { snapshots: Parameters<typeof forecastRunway>[0]; demand: Parameters<typeof forecastRunway>[1]; options: Parameters<typeof forecastRunway>[2] };
    const forecast = forecastRunway(value.snapshots, value.demand, value.options);
    await save(out, forecast); output({ output: out, status: forecast.status, accepted_work: forecast.accepted_work }); return;
  }
  if (command === "demo") {
    const options = flags(rest, ["--out-dir"]), path = fileURLToPath(new URL("../examples/dogfood/v04/native-usage.json", import.meta.url));
    await exportReport(createUsageReport(validateUsageBundle(await json(path))), { meter_id: "input_tokens" }, required(options, "--out-dir"), true, [path]); return;
  }
  if (command === "capabilities") {
    flags(rest, []);
    output({ schema_version: "0.4.0", imports: ["usage", "operations", "legacy-evidence", "codex", "codex-exec", "claude", "claude-transcript", "pi", "openai", "anthropic", "gemini", "otel"], profiles: ["JSON", "folded stacks", "pprof", "upstream FlameGraph SVG"], analysis: ["session efficiency", "matched benchmarks", "candidate policy", "capacity runway"], limitations: ["Only recorded provider settings and usage are captured; missing facts stay unavailable.", "Benchmark conclusions depend on outcome evidence and comparable conditions.", "Pricing is a separate optional consumer."] }); return;
  }
  throw new Error(`Unknown command: ${command}. Run flaimegraph --help.`);
}
