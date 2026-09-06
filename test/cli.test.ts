import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath,
  ["--import", "tsx", "src/cli.ts", ...args], { cwd: root, encoding: "utf8" });

test("CLI explains the offline import-to-dollar-profile workflow", () => {
  const result = cli("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /import/);
  assert.match(result.stdout, /value/);
  assert.match(result.stdout, /export/);
  assert.match(result.stdout, /render/);
});

test("CLI rejects an unknown command with a machine-readable diagnostic", () => {
  const result = cli("publish-everything");
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).code, "USAGE");
  assert.equal(result.stdout, "");
});

test("CLI validates the published two-cost evidence example", () => {
  const result = cli("validate", "--input", "examples/golden/evidence.json");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    valid: true, schema_version: "0.1.0", dataset_id: "golden-two-costs", observations: 2, sources: 1,
  });
});

test("CLI writes a reproducible recorded-cost valuation with the worked total", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-cli-"));
  try {
    const out = join(directory, "valuation.json");
    const result = cli("value", "--input", "examples/golden/evidence.json", "--mode", "recorded", "--out", out);
    assert.equal(result.status, 0, result.stderr);
    const valuation = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(valuation.total_nanos, "200000000");
    assert.equal(valuation.basis, "model_price_estimate");
    assert.equal(valuation.selection_policy, "direct-only-v1");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI imports the actual coordinator fixture without counting snapshots as new calls", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-cli-"));
  try {
    const out = join(directory, "evidence.json");
    const result = cli("import", "--harness", "codex", "--input", "examples/dogfood/codex/coordinator.jsonl",
      "--agent", "coordinator", "--work-item", "flaimegraph-research", "--out", out);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(out, "utf8"));
    const direct = evidence.observations.filter((item: { kind: string; accounting_scope: string }) => item.kind === "model" && item.accounting_scope === "direct");
    assert.equal(direct.length, 88);
    assert.equal(direct[0].agent_id, "coordinator");
    assert.equal(direct[0].model, "gpt-6-astra");
    assert.equal(direct[0].work_item_id, "flaimegraph-research");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI exports the worked valuation to standard folded and gzip pprof artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-cli-"));
  try {
    const valuation = join(directory, "valuation.json");
    assert.equal(cli("value", "--input", "examples/golden/evidence.json", "--mode", "recorded", "--out", valuation).status, 0);
    const report = join(directory, "profile");
    const result = cli("export", "--input", "examples/golden/evidence.json", "--valuation", valuation, "--out-dir", report);
    assert.equal(result.status, 0, result.stderr);
    const profile = JSON.parse(readFileSync(join(report, "profile.json"), "utf8"));
    assert.equal(profile.total_nanos, "200000000");
    const values = readFileSync(join(report, "cost.folded"), "utf8").trim().split("\n").map(line => BigInt(line.split(" ").at(-1)!));
    assert.equal(values.reduce((a, b) => a + b, 0n), 200000000n);
    assert.deepEqual([...readFileSync(join(report, "cost.pprof")).subarray(0, 2)], [0x1f, 0x8b]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI renders the standard interactive flame graph with exact dollar tooltips", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-render-"));
  try {
    const valuation = join(directory, "valuation.json");
    assert.equal(cli("value", "--input", "examples/golden/evidence.json", "--mode", "recorded", "--out", valuation).status, 0);
    assert.equal(cli("export", "--input", "examples/golden/evidence.json", "--valuation", valuation, "--out-dir", directory).status, 0);
    const result = cli("render", "--input", join(directory, "profile.json"), "--out-dir", directory);
    assert.equal(result.status, 0, result.stderr);
    const svg = readFileSync(join(directory, "cost.svg"), "utf8");
    assert.match(svg, /<svg/);
    assert.match(svg, /\$0\.20/);
    assert.match(svg, /\$0\.125/);
    assert.ok(svg.includes("<title>All selected costs: $0.20 (100%)</title>"), "the renderer's synthetic all-frame also uses dollars");
    assert.match(svg, /function zoom/);
    assert.match(svg, /function search/);
    const manifest = JSON.parse(readFileSync(join(directory, "render.json"), "utf8"));
    assert.equal(manifest.renderer, "brendangregg/FlameGraph");
    assert.equal(manifest.total_nanos, "200000000");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("offline demo reproduces the four-agent native-evidence baseline and standard graph", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-demo-"));
  try {
    const result = cli("demo", "--out-dir", directory);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    assert.equal(summary.direct_model_observations, 177);
    assert.equal(summary.total_nanos, "41046242000");
    assert.equal(summary.basis, "enterprise_scenario");
    assert.equal(summary.agents.length, 4);
    assert.match(readFileSync(join(directory, "cost.svg"), "utf8"), /\$41\.046242/);
    assert.equal(JSON.parse(readFileSync(join(directory, "evidence.json"), "utf8")).sources.length, 4);
    const workItem = JSON.parse(readFileSync(join(directory, "work-item-evidence.json"), "utf8"));
    assert.equal(workItem.work_item.estimates[0].point_estimate, null);
    assert.equal(workItem.estimate_semantics[0].interpretation, "post_execution_retrospective");
    assert.equal(workItem.work_item.outcome.status, "unknown");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI runs the portable accounting conformance vectors without private inputs", () => {
  const result = cli("conformance");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.specification, "0.1.0");
  assert.equal(report.passed, 10);
  assert.equal(report.failed, 0);
  assert.equal(report.cases.find((item: { id: string }) => item.id === "inclusive-cache-reasoning").passed, true);
});

test("CLI merges replayed evidence idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-merge-"));
  try {
    const out = join(directory, "evidence.json");
    const result = cli("merge", "--inputs", "examples/golden/evidence.json,examples/golden/evidence.json", "--out", out);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).observations.length, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI refuses a symlink output that would overwrite source evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-overwrite-"));
  try {
    const input = join(directory, "evidence.json");
    const original = readFileSync(join(root, "examples/golden/evidence.json"), "utf8");
    writeFileSync(input, original);
    const out = join(directory, "alias.json");
    symlinkSync(input, out);
    const result = cli("value", "--input", input, "--mode", "recorded", "--out", out);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, "INPUT_OVERWRITE");
    assert.equal(readFileSync(input, "utf8"), original);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI reports formats and tested coverage for all eight harness adapters", () => {
  const result = cli("capabilities");
  assert.equal(result.status, 0, result.stderr);
  const matrix = JSON.parse(result.stdout);
  assert.deepEqual(matrix.map((item: { harness: string }) => item.harness).sort(), ["claude", "codex", "copilot", "gemini", "omp", "opencode", "otel", "pi"]);
  assert.ok(matrix.every((item: { formats: string[]; limitations: string[] }) => item.formats.length && item.limitations.length));
});

test("the public Pi fixture reaches the same profile path with its independent monetary baseline", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-pi-"));
  try {
    const evidencePath = join(directory, "evidence.json");
    const imported = cli("import", "--harness", "pi", "--input", "examples/dogfood/pi/before-compaction.jsonl", "--out", evidencePath);
    assert.equal(imported.status, 0, imported.stderr);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.observations.filter((item: { kind: string }) => item.kind === "model").length, 484);
    const valuationPath = join(directory, "valuation.json");
    const valued = cli("value", "--input", evidencePath, "--mode", "recorded", "--out", valuationPath);
    assert.equal(valued.status, 0, valued.stderr);
    assert.equal(JSON.parse(readFileSync(valuationPath, "utf8")).total_nanos, "42595907500");
    const exported = cli("export", "--input", evidencePath, "--valuation", valuationPath, "--out-dir", directory);
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(JSON.parse(readFileSync(join(directory, "profile.json"), "utf8")).total_nanos, "42595907500");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI validates the separate Context Points work-item artifact", () => {
  const result = cli("validate", "--kind", "work-item", "--input", "examples/work-items/research.json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).work_item_id, "research-context-points");
});

test("CLI joins versioned point estimates and acceptance to observed evidence and valuation", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-work-item-"));
  try {
    const valuation = join(directory, "valuation.json");
    assert.equal(cli("value", "--input", "examples/golden/evidence.json", "--mode", "recorded", "--out", valuation).status, 0);
    const out = join(directory, "joined.json");
    const result = cli("work-item", "--input", "examples/work-items/golden.json", "--evidence", "examples/golden/evidence.json", "--valuation", valuation, "--out", out);
    assert.equal(result.status, 0, result.stderr);
    const joined = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(joined.work_item.estimates[0].point_estimate.value, "5");
    assert.equal(joined.valuation.total_nanos, "200000000");
    assert.equal(joined.observations.length, 2);
    assert.equal(joined.estimate_semantics[0].interpretation, "pre_execution_estimate");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI rejects a mistyped PNG option before writing artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-boolean-"));
  try {
    const result = cli("demo", "--out-dir", directory, "--png", "treu");
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).code, "USAGE");
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI valuation validation rejects a schema-valid but nonconserving total", () => {
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-invalid-value-"));
  try {
    const file = join(directory, "valuation.json");
    assert.equal(cli("value", "--input", "examples/golden/evidence.json", "--mode", "recorded", "--out", file).status, 0);
    const value = JSON.parse(readFileSync(file, "utf8"));
    value.total_nanos = "999";
    writeFileSync(file, JSON.stringify(value));
    const result = cli("validate", "--kind", "valuation", "--input", file);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).code, /VALUATION/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
