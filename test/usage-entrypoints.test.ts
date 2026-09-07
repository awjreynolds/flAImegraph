import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

test("the default SDK captures operations without exposing a pricing policy", async () => {
  const sdk = await import("../src/index.js");
  assert.equal(typeof sdk.OperationRecorder, "function");
  for (const name of ["valueEvidence", "createCostProfile", "createOperationBudget", "createOperationReport"]) {
    assert.equal(Object.hasOwn(sdk, name), false, `${name} belongs to the optional pricing consumer`);
  }
});

test("capture SDK dependency graph does not load monetary valuation modules", async () => {
  const result = await build({ entryPoints: ["src/index.ts"], bundle: true, platform: "node", format: "esm", write: false, metafile: true });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const path of ["src/pricing.ts", "src/valuation.ts", "src/operations.ts", "src/operation-budget.ts", "src/efficiency.ts", "src/efficiency-types.ts"]) assert.ok(!inputs.includes(path), `Optional consumer unexpectedly imported: ${path}`);
  const analysis = await import("../src/analysis.js");
  assert.equal(typeof analysis.importInspectBenchmark, "function");
  assert.equal(typeof analysis.forecastRunway, "function");
});
