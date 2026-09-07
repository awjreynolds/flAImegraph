import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { protectInputs, writeArtifact } from "./files.js";
import { OperationError, createOperationReport, reconcileOperationBundles, validateOperationBundle, validateOperationReport } from "./operations.js";
import { exportOperationFolded, exportOperationPprof, exportOperationTrace, renderOperationBudgetSvg, renderOperationSvg, type OperationExportOptions } from "./operation-export.js";
import { validateEvidence, validateRateCard } from "./core.js";
import { createOperationBudget } from "./operation-budget.js";
import { validateValuation } from "./work-items.js";
import { validateContextReport } from "./context-report.js";
import { importNativeOperations } from "./native-operations.js";

const usage = (message: string): never => { throw new OperationError("USAGE", message); };
function flags(args: string[], allowed: string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]!, value = args[i + 1];
    if (!allowed.includes(name) || values.has(name) || !value || value.startsWith("--")) usage(`Unknown, repeated or incomplete option ${name}`);
    values.set(name, value!);
  }
  return values;
}
const required = (values: Map<string, string>, name: string) => values.get(name) ?? usage(`Required option ${name}`);
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));
const save = (file: string, value: unknown) => writeArtifact(file, JSON.stringify(value, null, 2) + "\n");

export async function runOperationCommand(command: string, args: string[]): Promise<void> {
  if (command === "operation-import") {
    const values = flags(args, ["--harness", "--input", "--dataset-id", "--namespace", "--evidence", "--out"]);
    const harness = required(values, "--harness"), input = required(values, "--input"), output = required(values, "--out"), evidenceFile = values.get("--evidence");
    if (harness !== "codex" && harness !== "pi") usage("--harness must be codex or pi");
    await protectInputs([output], [input, ...(evidenceFile ? [evidenceFile] : [])]);
    const result = validateOperationBundle(importNativeOperations(harness as "codex" | "pi", await readFile(input, "utf8"), {
      dataset_id: required(values, "--dataset-id"), namespace: required(values, "--namespace"),
      ...(evidenceFile ? { evidence: validateEvidence(await readJson(evidenceFile)) } : {}),
    }));
    await save(output, result);
    process.stdout.write(JSON.stringify({ spans: result.spans.length, coverage: result.coverage }) + "\n");
    return;
  }
  if (command === "operation-report") {
    const values = flags(args, ["--input", "--evidence", "--valuation", "--context-report", "--out"]);
    const input = required(values, "--input"), evidenceFile = required(values, "--evidence"), valuationFile = required(values, "--valuation"), output = required(values, "--out"), contextFile = values.get("--context-report");
    await protectInputs([output], [input, evidenceFile, valuationFile, ...(contextFile ? [contextFile] : [])]);
    const report = createOperationReport(validateOperationBundle(await readJson(input)), validateEvidence(await readJson(evidenceFile)), validateValuation(await readJson(valuationFile)), contextFile ? validateContextReport(await readJson(contextFile)) : undefined);
    await save(output, report);
    process.stdout.write(JSON.stringify(report.summary) + "\n");
    return;
  }
  if (command === "operation-merge") {
    const values = flags(args, ["--inputs", "--out"]);
    const inputs = required(values, "--inputs").split(","), output = required(values, "--out");
    await protectInputs([output], inputs);
    const bundles = await Promise.all(inputs.map(async file => validateOperationBundle(await readJson(file))));
    const result = reconcileOperationBundles(bundles);
    await save(output, result);
    process.stdout.write(JSON.stringify({ spans: result.spans.length, coverage: result.coverage }) + "\n");
    return;
  }
  if (command === "operation-export") {
    const values = flags(args, ["--input", "--out-dir", "--svg", "--rate-card"]);
    const input = required(values, "--input"), directory = required(values, "--out-dir"), rateCardFile = values.get("--rate-card");
    const svg = values.get("--svg") ?? "false";
    if (!["true", "false"].includes(svg)) usage("--svg must be true or false");
    const report = validateOperationReport(await readJson(input));
    const rateCard = rateCardFile === undefined ? undefined : validateRateCard(await readJson(rateCardFile));
    const budget = createOperationBudget(report, rateCard);
    const choices: Array<[string, OperationExportOptions]> = [
      ["execution-charges", { projection: "execution", measure: "charges" }], ["execution-credits", { projection: "execution", measure: "credits" }],
      ["source-charges", { projection: "source", measure: "charges" }], ["source-credits", { projection: "source", measure: "credits" }],
      ["operations", { projection: "execution", measure: "operations" }],
    ];
    const names = ["operation-report.json", "operations.trace.json", "operation-budget.json", "export.json", ...choices.flatMap(([name]) => [`${name}.folded`, `${name}.pprof`, ...(svg === "true" ? [`${name}.svg`] : [])]), ...(svg === "true" ? ["token-costs.svg"] : [])];
    await protectInputs(names.map(name => join(directory, name)), [input, ...(rateCardFile === undefined ? [] : [rateCardFile])]);
    // Prepare all formats first: a range or renderer error must not leave a partially updated export.
    const artifacts: Array<[string, string | Uint8Array]> = [["operation-report.json", JSON.stringify(report, null, 2) + "\n"], ["operations.trace.json", JSON.stringify(exportOperationTrace(report), null, 2) + "\n"], ["operation-budget.json", JSON.stringify(budget, null, 2) + "\n"]];
    const skipped: string[] = [];
    for (const [name, options] of choices) {
      artifacts.push([`${name}.folded`, exportOperationFolded(report, options)], [`${name}.pprof`, exportOperationPprof(report, options)]);
      if (svg === "true") {
        const rendered = renderOperationSvg(report, options);
        if (rendered === null) skipped.push(`${name}.svg: zero positive width`);
        else artifacts.push([`${name}.svg`, rendered]);
      }
    }
    if (svg === "true") {
      const rendered = renderOperationBudgetSvg(report, rateCard);
      if (rendered === null) skipped.push("token-costs.svg: zero positive width");
      else artifacts.push(["token-costs.svg", rendered]);
    }
    const manifest = { schema_version: "0.3.0", summary: report.summary, assumptions: report.assumptions, skipped,
      artifacts: Object.fromEntries(artifacts.map(([name, data]) => [name, { sha256: createHash("sha256").update(data).digest("hex") }])) };
    await mkdir(directory, { recursive: true });
    for (const [name, data] of artifacts) await writeArtifact(join(directory, name), data);
    await save(join(directory, "export.json"), manifest);
    process.stdout.write(JSON.stringify(manifest.summary) + "\n");
    return;
  }
  usage(`Unknown operation command ${command}`);
}
