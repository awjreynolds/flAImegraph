#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { CostProfile, EvidenceBundle, Grouping, Harness, ProfileOptions, Valuation } from "./types.js";
import { protectInputs, writeArtifact } from "./files.js";

const help = `flAImegraph — agent cost and context interchange (experimental 0.2.0)

Offline workflow:
  import   --harness NAME --input FILE --out evidence.json
  merge    --inputs evidence-a.json,evidence-b.json --out evidence.json
  validate --input FILE [--kind evidence|valuation|profile|work-item|rate-card|context|context-report|harness-profile|capture-state]
  value    --input evidence.json (--mode recorded | --rate-card rates.json) --out valuation.json
  export   --input evidence.json --valuation valuation.json --out-dir profile
  render   --input profile/profile.json --out-dir report
  demo     --out-dir demo [--png true]
  conformance
  capabilities
  work-item --input work-item.json --evidence evidence.json --valuation valuation.json --out joined.json

Context workflow (0.2 composes with frozen 0.1 cost evidence):
  harness-profile --harness NAME [--version VERSION] [--model MODEL] --out profile.json
  capture --harness codex|pi --input session.jsonl --namespace NAME --dataset-id ID --out state.json [--evidence-out evidence.json]
  capture --input session.jsonl --state state.json --out state.json [--evidence-out evidence.json]
  context-capture --input descriptor.json --out context.json
  context-capture --format openai-responses|anthropic-messages|gemini-content --input request.json --options capture-options.json --out context.json
  context-merge --inputs context-a.json,context-b.json [--evidence evidence.json] --out context.json
  context-import --harness codex|pi --input session.jsonl --evidence evidence.json --profile profile.json --source-id ID --out context.json
  context-report --evidence evidence.json --valuation valuation.json --context context.json [--allocate-requests request-a,request-b] --out report.json

Use --help to show this workflow. No command sends data to a provider.
`;

class CliError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function flags(args: string[], allowed: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]!;
    if (!allowed.includes(name) || result.has(name)) throw new CliError("USAGE", `Unknown or repeated option: ${name}`);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new CliError("USAGE", `A value is required for ${name}`);
    result.set(name, value);
  }
  return result;
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new CliError("USAGE", `Required option: ${name}`);
  return value;
}

function booleanOption(options: Map<string, string>, name: string): boolean {
  const value = options.get(name);
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new CliError("USAGE", `${name} must be true or false`);
}

async function readJson(file: string): Promise<unknown> {
  const input = await readFile(file, "utf8");
  try { return JSON.parse(input); }
  catch { throw new CliError("INVALID_JSON", `Invalid JSON in ${file}`); }
}

async function saveJson(file: string, value: unknown, input?: string): Promise<void> {
  if (input) await protectInputs([file], [input]);
  await writeArtifact(file, JSON.stringify(value, null, 2) + "\n");
}

async function checkedArtifact<T>(name: "valuation" | "profile", value: unknown): Promise<T> {
  if (name === "profile") {
    const { validateProfile } = await import("./profile.js");
    return validateProfile(value) as T;
  }
  const { validateValuation } = await import("./work-items.js");
  return validateValuation(value) as T;
}

async function exportFiles(evidence: EvidenceBundle, valuation: Valuation, options: ProfileOptions, directory: string): Promise<CostProfile> {
  const { createCostProfile, exportFolded, exportPprof, exportOtlp } = await import("./profile.js");
  const profile = createCostProfile(evidence, valuation, options);
  const folded = exportFolded(profile);
  const pprof = exportPprof(profile);
  await mkdir(directory, { recursive: true });
  await saveJson(join(directory, "profile.json"), profile);
  await writeArtifact(join(directory, "cost.folded"), folded);
  await writeArtifact(join(directory, "cost.pprof"), pprof);
  await saveJson(join(directory, "evidence.otlp.json"), exportOtlp(evidence));
  await saveJson(join(directory, "export.json"), {
    schema_version: "0.1.0", profile_id: profile.id, dataset_id: profile.dataset_id, valuation_id: profile.valuation_id,
    artifacts: {
      "cost.folded": { sha256: createHash("sha256").update(folded).digest("hex"), format: "folded-stacks", unit: profile.unit },
      "cost.pprof": { sha256: createHash("sha256").update(pprof).digest("hex"), format: "gzip-pprof", unit: profile.unit },
    },
  });
  return profile;
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return;
  }
  if (command === "validate") {
    const options = flags(rest, ["--input", "--kind"]);
    const kind = options.get("--kind") ?? "evidence";
    if (kind === "capture-state") {
      const { validateCaptureState } = await import("./capture.js");
      const state = validateCaptureState(await readJson(required(options, "--input")));
      process.stdout.write(JSON.stringify({ valid: true, schema_version: state.schema_version, captures: state.captures.length, sequence: state.cursor.sequence }) + "\n");
      return;
    }
    if (kind === "context-report") {
      const { validateContextReport } = await import("./context-report.js");
      const report = validateContextReport(await readJson(required(options, "--input")));
      process.stdout.write(JSON.stringify({ valid: true, ...report.summary }) + "\n");
      return;
    }
    if (kind === "harness-profile" || kind === "context") {
      const { validateHarnessProfile, validateContextBundle } = await import("./context.js");
      const value = await readJson(required(options, "--input"));
      const artifact = kind === "harness-profile" ? validateHarnessProfile(value) : validateContextBundle(value);
      process.stdout.write(JSON.stringify({ valid: true, schema_version: artifact.schema_version, kind }) + "\n");
      return;
    }
    if (kind === "work-item") {
      const { validateWorkItem } = await import("./work-items.js");
      const item = validateWorkItem(await readJson(required(options, "--input")));
      process.stdout.write(JSON.stringify({ valid: true, schema_version: item.schema_version, work_item_id: item.work_item_id, estimates: item.estimates.length }) + "\n");
      return;
    }
    if (kind === "rate-card") {
      const { validateRateCard } = await import("./core.js");
      const card = validateRateCard(await readJson(required(options, "--input")));
      process.stdout.write(JSON.stringify({ valid: true, schema_version: card.schema_version, rate_card_id: card.id, rules: card.rules.length }) + "\n");
      return;
    }
    if (kind === "valuation" || kind === "profile") {
      const artifact = await checkedArtifact<Valuation | CostProfile>(kind, await readJson(required(options, "--input")));
      process.stdout.write(JSON.stringify({ valid: true, schema_version: artifact.schema_version, id: artifact.id, total_nanos: artifact.total_nanos }) + "\n");
      return;
    }
    if (kind !== "evidence") throw new CliError("USAGE", `Unsupported artifact kind: ${kind}`);
    const { validateEvidence } = await import("./core.js");
    const evidence = validateEvidence(await readJson(required(options, "--input")));
    process.stdout.write(JSON.stringify({ valid: true, schema_version: evidence.schema_version,
      dataset_id: evidence.dataset_id, observations: evidence.observations.length, sources: evidence.sources.length }) + "\n");
    return;
  }
  if (command === "harness-profile") {
    const options = flags(rest, ["--harness", "--version", "--model", "--provider", "--name", "--out"]);
    const { createHarnessProfile } = await import("./context-capture.js");
    const { validateHarnessProfile } = await import("./context.js");
    const profile = validateHarnessProfile(createHarnessProfile({ harness: required(options, "--harness"), harness_version: options.get("--version"), model: options.get("--model"), provider: options.get("--provider"), name: options.get("--name") }));
    const out = required(options, "--out");
    await saveJson(out, profile);
    process.stdout.write(JSON.stringify({ output: out, profile_id: profile.id }) + "\n");
    return;
  }
  if (command === "capture") {
    const options = flags(rest, ["--harness", "--input", "--namespace", "--dataset-id", "--state", "--out", "--evidence-out", "--sequence", "--version", "--work-item", "--agent"]);
    const input = required(options, "--input");
    const out = required(options, "--out");
    const evidenceOut = options.get("--evidence-out");
    const statePath = options.get("--state");
    // A caller may explicitly advance its derived state in place; raw input is always protected.
    await protectInputs([out, ...(evidenceOut ? [evidenceOut] : [])], [input]);
    if (evidenceOut) await protectInputs([evidenceOut], [out, ...(statePath ? [statePath] : [])]);
    const { advanceCapture, validateCaptureState } = await import("./capture.js");
    const previous = statePath ? validateCaptureState(await readJson(statePath)) : undefined;
    const harness = options.get("--harness") ?? previous?.harness;
    if (harness !== "codex" && harness !== "pi") throw new CliError("USAGE", "Capture requires --harness codex or pi");
    const state = advanceCapture(await readFile(input, "utf8"), { harness,
      capture_namespace: options.get("--namespace") ?? previous?.capture_namespace ?? required(options, "--namespace"),
      dataset_id: options.get("--dataset-id") ?? previous?.dataset_id ?? required(options, "--dataset-id"),
      sequence: options.get("--sequence"), version: options.get("--version") ?? previous?.import_options.version,
      work_item_id: options.get("--work-item") ?? previous?.import_options.work_item_id,
      agent_id: options.get("--agent") ?? previous?.import_options.agent_id,
    }, previous);
    if (evidenceOut) await saveJson(evidenceOut, state.evidence);
    await saveJson(out, state);
    process.stdout.write(JSON.stringify({ output: out, evidence_output: evidenceOut, captures: state.captures.length, sequence: state.cursor.sequence, observations: state.evidence.observations.length }) + "\n");
    return;
  }
  if (command === "context-report") {
    const options = flags(rest, ["--evidence", "--valuation", "--context", "--allocate-requests", "--out"]);
    const evidencePath = required(options, "--evidence");
    const valuationPath = required(options, "--valuation");
    const contextPath = required(options, "--context");
    const out = required(options, "--out");
    await protectInputs([out], [evidencePath, valuationPath, contextPath]);
    const { validateEvidence } = await import("./core.js");
    const { validateContextBundle } = await import("./context.js");
    const { createContextReport } = await import("./context-report.js");
    const evidence = validateEvidence(await readJson(evidencePath));
    const valuation = await checkedArtifact<Valuation>("valuation", await readJson(valuationPath));
    const context = validateContextBundle(await readJson(contextPath), evidence);
    const report = createContextReport(evidence, valuation, context, { allocation_request_ids: options.get("--allocate-requests")?.split(",") });
    await saveJson(out, report);
    process.stdout.write(JSON.stringify({ output: out, ...report.summary, estimated_allocations: report.allocations.length }) + "\n");
    return;
  }
  if (command === "context-capture") {
    const options = flags(rest, ["--format", "--input", "--options", "--out"]);
    const input = required(options, "--input");
    const out = required(options, "--out");
    const format = options.get("--format") ?? "generic";
    const optionsPath = options.get("--options");
    await protectInputs([out], [input, ...(optionsPath ? [optionsPath] : [])]);
    const { captureRequestContext, captureProviderRequest } = await import("./request-context.js");
    const value = await readJson(input);
    if (format === "generic" && optionsPath) throw new CliError("USAGE", "Generic capture takes its full descriptor in --input; omit --options");
    if (format !== "generic" && !optionsPath) throw new CliError("USAGE", "Provider request capture requires --options FILE");
    const context = format === "generic"
      ? captureRequestContext(value as import("./context-types.js").CaptureContextInput)
      : captureProviderRequest(format, value, await readJson(optionsPath!) as import("./request-context.js").CaptureProviderOptions);
    await saveJson(out, context);
    process.stdout.write(JSON.stringify({ output: out, requests: context.requests.length, sources: context.sources.length, issues: context.issues.length }) + "\n");
    return;
  }
  if (command === "context-import") {
    const options = flags(rest, ["--harness", "--input", "--evidence", "--profile", "--source-id", "--out"]);
    const input = required(options, "--input");
    const evidencePath = required(options, "--evidence");
    const profilePath = required(options, "--profile");
    const out = required(options, "--out");
    const harness = required(options, "--harness");
    if (harness !== "codex" && harness !== "pi") throw new CliError("USAGE", "Native context requires --harness codex or pi");
    await protectInputs([out], [input, evidencePath, profilePath]);
    const { validateEvidence } = await import("./core.js");
    const { validateHarnessProfile } = await import("./context.js");
    const { reconstructNativeContext } = await import("./native-context.js");
    const context = reconstructNativeContext(harness, await readFile(input, "utf8"), validateEvidence(await readJson(evidencePath)), validateHarnessProfile(await readJson(profilePath)), { source_id: required(options, "--source-id") });
    await saveJson(out, context);
    process.stdout.write(JSON.stringify({ output: out, requests: context.requests.length, sources: context.sources.length, issues: context.issues.length }) + "\n");
    return;
  }
  if (command === "context-merge") {
    const options = flags(rest, ["--inputs", "--evidence", "--out"]);
    const inputs = required(options, "--inputs").split(",");
    const evidencePath = options.get("--evidence");
    const out = required(options, "--out");
    await protectInputs([out], [...inputs, ...(evidencePath ? [evidencePath] : [])]);
    const { validateContextBundle, reconcileContextBundles } = await import("./context.js");
    const { validateEvidence } = await import("./core.js");
    const evidence = evidencePath ? validateEvidence(await readJson(evidencePath)) : undefined;
    const bundles = [];
    for (const input of inputs) bundles.push(validateContextBundle(await readJson(input), evidence));
    const context = reconcileContextBundles(bundles, evidence);
    await saveJson(out, context);
    process.stdout.write(JSON.stringify({ output: out, requests: context.requests.length, sources: context.sources.length }) + "\n");
    return;
  }
  if (command === "import") {
    const options = flags(rest, ["--harness", "--input", "--out", "--source-id", "--dataset-id", "--version", "--work-item", "--agent"]);
    const input = required(options, "--input");
    const out = required(options, "--out");
    const harness = required(options, "--harness");
    if (!["codex", "pi", "omp", "claude", "gemini", "opencode", "otel", "copilot"].includes(harness)) {
      throw new CliError("USAGE", `Unsupported harness: ${harness}`);
    }
    const { importEvidence } = await import("./adapters/index.js");
    const { validateEvidence } = await import("./core.js");
    const evidence = importEvidence(harness as Harness, await readFile(input, "utf8"), {
      source_id: options.get("--source-id"), dataset_id: options.get("--dataset-id"), version: options.get("--version"),
      work_item_id: options.get("--work-item"), agent_id: options.get("--agent"),
    });
    const errors = evidence.issues.filter(issue => issue.severity === "error");
    if (errors.length) throw new CliError("IMPORT_FAILED", errors.map(issue => `${issue.code}: ${issue.message}`).join("; "));
    validateEvidence(evidence);
    await saveJson(out, evidence, input);
    process.stdout.write(JSON.stringify({ output: out, dataset_id: evidence.dataset_id, observations: evidence.observations.length, issues: evidence.issues.length }) + "\n");
    return;
  }
  if (command === "value") {
    const options = flags(rest, ["--input", "--out", "--mode", "--rate-card", "--currency"]);
    const input = required(options, "--input");
    const out = required(options, "--out");
    const ratePath = options.get("--rate-card");
    await protectInputs([out], [input, ...(ratePath ? [ratePath] : [])]);
    const mode = options.get("--mode") ?? (ratePath ? "rate-card" : undefined);
    if (!mode || !["recorded", "rate-card"].includes(mode) || (mode === "recorded" && ratePath) || (mode === "rate-card" && !ratePath)) {
      throw new CliError("USAGE", "Choose --mode recorded or --rate-card FILE");
    }
    const { validateEvidence, validateRateCard, valueEvidence } = await import("./core.js");
    const evidence = validateEvidence(await readJson(input));
    const valuation = valueEvidence(evidence, { mode: mode === "recorded" ? "recorded" : "rate_card",
      currency: options.get("--currency"), rate_card: ratePath ? validateRateCard(await readJson(ratePath)) : undefined });
    await saveJson(out, valuation, input);
    process.stdout.write(JSON.stringify({ output: out, total_nanos: valuation.total_nanos, currency: valuation.currency, complete: valuation.complete }) + "\n");
    return;
  }
  if (command === "merge") {
    const options = flags(rest, ["--inputs", "--out"]);
    const inputs = required(options, "--inputs").split(",");
    const out = required(options, "--out");
    await protectInputs([out], inputs);
    const { validateEvidence, reconcileEvidence } = await import("./core.js");
    const bundles: EvidenceBundle[] = [];
    for (const input of inputs) bundles.push(validateEvidence(await readJson(input)));
    const evidence = reconcileEvidence(bundles);
    await saveJson(out, evidence);
    process.stdout.write(JSON.stringify({ output: out, dataset_id: evidence.dataset_id, observations: evidence.observations.length, sources: evidence.sources.length }) + "\n");
    return;
  }
  if (command === "export") {
    const options = flags(rest, ["--input", "--valuation", "--out-dir", "--group-by", "--root-label", "--cost-view", "--allocations"]);
    const { validateEvidence } = await import("./core.js");
    const evidence = validateEvidence(await readJson(required(options, "--input")));
    const valuation = await checkedArtifact<Valuation>("valuation", await readJson(required(options, "--valuation")));
    const directory = required(options, "--out-dir");
    await protectInputs(["profile.json", "cost.folded", "cost.pprof", "evidence.otlp.json", "export.json"].map(name => join(directory, name)),
      [required(options, "--input"), required(options, "--valuation"), ...(options.has("--allocations") ? [required(options, "--allocations")] : [])]);
    const profile = await exportFiles(evidence, valuation, {
      group_by: options.get("--group-by")?.split(",") as Grouping[] | undefined,
      root_label: options.get("--root-label"), cost_view: options.get("--cost-view") as ProfileOptions["cost_view"],
      allocations: options.has("--allocations") ? await readJson(required(options, "--allocations")) as ProfileOptions["allocations"] : undefined,
    }, directory);
    process.stdout.write(JSON.stringify({ output_directory: directory, total_nanos: profile.total_nanos, currency: profile.currency, samples: profile.samples.length, complete: profile.complete }) + "\n");
    return;
  }
  if (command === "render") {
    const options = flags(rest, ["--input", "--out-dir", "--png"]);
    const png = booleanOption(options, "--png");
    const profile = await checkedArtifact<CostProfile>("profile", await readJson(required(options, "--input")));
    const { renderProfile } = await import("./render.js");
    await protectInputs(["render.folded", "render.nameattr", "cost.svg", "cost.png", "render.json"].map(name => join(required(options, "--out-dir"), name)), [required(options, "--input")]);
    const manifest = await renderProfile(profile, required(options, "--out-dir"), png);
    process.stdout.write(JSON.stringify(manifest) + "\n");
    return;
  }
  if (command === "demo") {
    const options = flags(rest, ["--out-dir", "--png"]);
    const png = booleanOption(options, "--png");
    const directory = required(options, "--out-dir");
    const { importEvidence } = await import("./adapters/index.js");
    const { reconcileEvidence, validateRateCard, valueEvidence } = await import("./core.js");
    const { renderProfile, formatMoney } = await import("./render.js");
    const agents = ["coordinator", "telemetry", "accounting", "profiles"];
    const bundles: EvidenceBundle[] = [];
    for (const agent of agents) {
      const input = await readFile(new URL(`../examples/dogfood/codex/${agent}.jsonl`, import.meta.url), "utf8");
      bundles.push(importEvidence("codex", input, { source_id: `dogfood-${agent}`, dataset_id: "flaimegraph-dogfood-2026-09-06", agent_id: agent, work_item_id: "flaimegraph-research" }));
    }
    const evidence = reconcileEvidence(bundles);
    const rateCard = validateRateCard(JSON.parse(await readFile(new URL("../examples/rates/enterprise-astra-scenario.json", import.meta.url), "utf8")));
    const valuation = valueEvidence(evidence, { mode: "rate_card", rate_card: rateCard });
    const { validateWorkItem, joinWorkItemEvidence } = await import("./work-items.js");
    const workItem = validateWorkItem(JSON.parse(await readFile(new URL("../examples/work-items/codex-dogfood.json", import.meta.url), "utf8")));
    workItem.attempts = agents.map(agent => ({ attempt_id: `captured-${agent}`, status: "unknown", observation_ids: evidence.observations.filter(item => item.agent_id === agent).map(item => item.id) }));
    const workItemRecord = joinWorkItemEvidence(workItem, evidence, valuation);
    await saveJson(join(directory, "work-item.json"), workItemRecord.work_item);
    await saveJson(join(directory, "work-item-evidence.json"), workItemRecord);
    await saveJson(join(directory, "evidence.json"), evidence);
    await saveJson(join(directory, "rate-card.json"), rateCard);
    await saveJson(join(directory, "valuation.json"), valuation);
    const profile = await exportFiles(evidence, valuation, { root_label: "flAImegraph research" }, directory);
    await renderProfile(profile, directory, png);
    const summary = { dataset_id: evidence.dataset_id, direct_model_observations: evidence.observations.filter(item => item.kind === "model" && item.accounting_scope === "direct").length,
      agents, total_nanos: valuation.total_nanos, formatted_total: formatMoney(valuation.total_nanos, valuation.currency),
      basis: valuation.basis, currency: valuation.currency, complete: valuation.complete,
      assumptions: valuation.assumptions, coverage_issues: valuation.issues, output_directory: directory };
    await saveJson(join(directory, "summary.json"), summary);
    process.stdout.write(JSON.stringify({ output_directory: directory, total_nanos: summary.total_nanos, formatted_total: summary.formatted_total, direct_model_observations: summary.direct_model_observations, complete: summary.complete }) + "\n");
    return;
  }
  if (command === "conformance") {
    flags(rest, []);
    const { runConformance } = await import("./conformance.js");
    const report = await runConformance();
    process.stdout.write(JSON.stringify(report) + "\n");
    if (report.failed) process.exitCode = 1;
    return;
  }
  if (command === "capabilities") {
    flags(rest, []);
    const { adapterCapabilities } = await import("./adapters/index.js");
    process.stdout.write(JSON.stringify(adapterCapabilities()) + "\n");
    return;
  }
  if (command === "work-item") {
    const options = flags(rest, ["--input", "--evidence", "--valuation", "--out"]);
    const input = required(options, "--input");
    const evidencePath = required(options, "--evidence");
    const valuationPath = options.get("--valuation");
    const out = required(options, "--out");
    await protectInputs([out], [input, evidencePath, ...(valuationPath ? [valuationPath] : [])]);
    const { validateEvidence } = await import("./core.js");
    const { joinWorkItemEvidence } = await import("./work-items.js");
    const evidence = validateEvidence(await readJson(evidencePath));
    const valuation = valuationPath ? await checkedArtifact<Valuation>("valuation", await readJson(valuationPath)) : null;
    const record = joinWorkItemEvidence(await readJson(input), evidence, valuation);
    await saveJson(out, record);
    process.stdout.write(JSON.stringify({ output: out, work_item_id: record.work_item.work_item_id, observations: record.observations.length, estimates: record.work_item.estimates.length }) + "\n");
    return;
  }
  throw new CliError("USAGE", `Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "ERROR";
  const message = error instanceof Error ? error.message : "Unknown failure";
  process.stderr.write(JSON.stringify({ code, message }) + "\n");
  process.exitCode = code === "USAGE" ? 2 : 1;
});
