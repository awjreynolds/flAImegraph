import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { valueEvidence } from "../src/core.js";
import { createOperationReport } from "../src/operations.js";
import type { EvidenceBundle, RateCard } from "../src/types.js";
import type { OperationBundle, OperationSpan } from "../src/operation-types.js";
import { createOperationBudget } from "../src/operation-budget.js";

function span(id: string, parent_id: string | null, observation_id: string | null, sequence: number, kind: OperationSpan["kind"] = "work"): OperationSpan {
  return {
    id, parent_id, parentage: parent_id === null ? null : { evidence: "observed", method: "fixture" }, stream_id: "test", sequence,
    kind, label: id, classification: { evidence: "declared", method: "fixture" }, status: "ok", started_at: null, ended_at: null,
    duration_ns: null, timing: { started_at: { evidence: "unknown", method: "fixture" }, ended_at: { evidence: "unknown", method: "fixture" }, duration_ns: { evidence: "unknown", method: "fixture", clock: "unknown" } },
    agent_id: "agent", requesting_model: null, executing_model: null, observation_id, source_refs: [{ source_id: "ops", record: id }], io: null, routing: null,
  };
}

function operations(): OperationBundle {
  return { schema_version: "0.3.0", dataset_id: "budget-test", artifacts: [{ id: "ops", harness: "test", format: "fixture", coverage: "complete" }],
    spans: [span("root", null, null, 0), span("first", "root", "first", 1, "model"), span("second", "first", "second", 2, "model"), span("unknown", "root", "unknown", 3, "model")], links: [],
    coverage: { boundary: "instrumented", complete: true, dropped_spans: 0, dropped_spans_by_stream: {}, dropped_links: 0, dropped_links_by_stream: {}, limitations: [] } };
}

function card(overrides: Partial<RateCard> = {}): RateCard {
  return { schema_version: "0.1.0", id: "card", currency: "USD", basis: "enterprise_scenario", source_url: "https://example.test/card", retrieved_at: "2026-09-07T00:00:00Z", assumptions: ["fixture"], rules: [{ id: "rule", model: "model", provider: "provider", product: "codex", valid_from: null, valid_to: null, unit_tokens: "1000", rates: { input: "1.25", cache_read: "0.1", cache_write: "0.2", output: "2.5" } }], ...overrides };
}

function evidence(): EvidenceBundle {
  const usage = (input: string, output: string, read: string, write: string) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_write_input_tokens: write, reasoning_output_tokens: "0", unclassified_tokens: "0" });
  return { schema_version: "0.1.0", dataset_id: "budget-test", sources: [{ id: "cost", harness: "test", format: "fixture", coverage: "complete" }], relationships: [], issues: [], observations: [
    { id: "first", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "first" }], model: "model", model_identity: "response", provider: "provider", product: "codex", usage: usage("100", "40", "10", "5") },
    { id: "second", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "second" }], model: "model", model_identity: "response", provider: "provider", product: "codex", usage: usage("20", "10", "0", "0") },
    { id: "unknown", kind: "model", operation: "generate", status: "ok", accounting_scope: "direct", source_refs: [{ source_id: "cost", record: "unknown" }], model: "model", model_identity: "response", provider: "provider", product: "codex", usage: null },
  ] };
}

test("splits inclusive input into fresh/cache categories and keeps output separate", () => {
  const evidenceBundle = evidence();
  const report = createOperationReport(operations(), evidenceBundle, valueEvidence(evidenceBundle, { mode: "rate_card", rate_card: card() }));
  const budget = createOperationBudget(report, card());
  assert.equal(budget.known_total_nanos, "258250000");
  assert.deepEqual(budget.categories.map(row => [row.category, row.tokens, row.amount_nanos]), [
    ["input", "105", "131250000"], ["cache_read", "10", "1000000"], ["cache_write", "5", "1000000"], ["output", "50", "125000000"],
  ]);
  assert.equal(budget.unattributed_amount_nanos, "0");
  assert.equal(budget.observations[0]?.amount_nanos, "208250000");
});

test("recorded amounts and incomplete rate-card observations remain unattributed", () => {
  const source = evidence();
  source.observations[0]!.recorded_cost = { amount: "-1.25", currency: "USD", basis: "billed" };
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "recorded" }));
  const budget = createOperationBudget(report);
  assert.equal(budget.known_total_nanos, "-1250000000");
  assert.equal(budget.unattributed_amount_nanos, "-1250000000");
  assert.equal(budget.observations[0]?.unattributed_amount_nanos, "-1250000000");

  const rateSource = evidence();
  const rateReport = createOperationReport(operations(), rateSource, valueEvidence(rateSource, { mode: "rate_card", rate_card: card() }));
  const rateBudget = createOperationBudget(rateReport, card());
  assert.equal(rateBudget.unknown_observation_count, 1);
  assert.equal(rateBudget.observations.find(row => row.observation_id === "unknown")?.amount_nanos, null);
  assert.ok(rateBudget.notes.some(note => note.includes("usage")));
});

test("omitted unclassified coverage can split declared categories while partial quantities stay independently visible", () => {
  const omitted = evidence();
  const { unclassified_tokens: _unreported, ...declared } = omitted.observations[0]!.usage!;
  omitted.observations[0]!.usage = declared;
  const omittedReport = createOperationReport(operations(), omitted, valueEvidence(omitted, { mode: "rate_card", rate_card: card() }));
  const omittedBudget = createOperationBudget(omittedReport, card(), "first");
  assert.equal(omittedBudget.unattributed_amount_nanos, "0");
  assert.ok(omittedBudget.notes.some(note => note.includes("unclassified token category was not reported")));

  const partial = evidence();
  partial.observations[0]!.usage = { input_tokens: "100", output_tokens: null, cache_read_input_tokens: "10", cache_write_input_tokens: "5", reasoning_output_tokens: null, unclassified_tokens: "0" };
  const partialReport = createOperationReport(operations(), partial, valueEvidence(partial, { mode: "rate_card", rate_card: card() }));
  const partialBudget = createOperationBudget(partialReport, card(), "first");
  const row = partialBudget.observations.find(item => item.observation_id === "first")!;
  assert.equal(row.categories.find(item => item.category === "cache_read")?.tokens, "10");
  assert.equal(row.categories.find(item => item.category === "cache_write")?.tokens, "5");
  assert.equal(row.categories.find(item => item.category === "output")?.unknown_token_observations, 1);
  assert.equal(row.categories.find(item => item.category === "output")?.unpriced_observations, 1);
});

test("a mismatched supplied card never invents a category dollar split", () => {
  const source = evidence();
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "rate_card", rate_card: card() }));
  const budget = createOperationBudget(report, { ...card(), currency: "EUR" }, "first");
  assert.equal(budget.known_total_nanos, "258250000");
  assert.equal(budget.unattributed_amount_nanos, "258250000");
  assert.ok(budget.categories.every(category => category.amount_nanos === "0"));
  assert.ok(budget.notes.some(note => note.includes("currency")));
});

test("generic supplied rules stay unattributed when provider or date evidence is ambiguous", () => {
  const source = evidence();
  source.observations[0]!.provider = undefined;
  source.observations[0]!.product = undefined;
  source.observations[0]!.timestamp = "2026-09-07T00:00:00Z";
  const generic = { ...card(), rules: [{ ...card().rules[0]!, provider: undefined, product: undefined }] };
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "rate_card", rate_card: generic }));
  const providerSpecific = { ...generic, rules: [generic.rules[0]!, { ...card().rules[0]!, id: "provider-specific" }] };
  const providerBudget = createOperationBudget(report, providerSpecific, "first");
  assert.equal(providerBudget.unattributed_amount_nanos, providerBudget.known_total_nanos);
  assert.ok(providerBudget.notes.some(note => note.includes("provider")));
  assert.ok(providerBudget.categories.every(category => category.amount_nanos === "0"));

  const productSource = evidence();
  productSource.observations[0]!.product = undefined;
  productSource.observations[0]!.provider = "provider";
  productSource.observations[0]!.timestamp = "2026-09-07T00:00:00Z";
  const productReport = createOperationReport(operations(), productSource, valueEvidence(productSource, { mode: "rate_card", rate_card: generic }));
  const productSpecific = { ...generic, rules: [generic.rules[0]!, { ...card().rules[0]!, id: "product-specific" }] };
  const productBudget = createOperationBudget(productReport, productSpecific, "first");
  assert.equal(productBudget.unattributed_amount_nanos, productBudget.known_total_nanos);
  assert.ok(productBudget.notes.some(note => note.includes("product")));

  const dateSource = evidence();
  dateSource.observations[0]!.timestamp = undefined;
  const dated = { ...card(), rules: [{ ...card().rules[0]!, valid_from: null, valid_to: null }] };
  const datedReport = createOperationReport(operations(), dateSource, valueEvidence(dateSource, { mode: "rate_card", rate_card: dated }));
  const bounded = { ...dated, rules: [dated.rules[0]!, { ...dated.rules[0]!, id: "bounded", valid_from: "2026-01-01", valid_to: null }] };
  const dateBudget = createOperationBudget(datedReport, bounded, "first");
  assert.equal(dateBudget.unattributed_amount_nanos, dateBudget.known_total_nanos);
  assert.ok(dateBudget.notes.some(note => note.includes("timestamp")));
});

test("reasoning tokens stay inside output and every selected row conserves its known amount", () => {
  const source = evidence();
  source.observations[0]!.usage!.reasoning_output_tokens = "35";
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "rate_card", rate_card: card() }));
  const budget = createOperationBudget(report, card());
  assert.equal(budget.categories.find(category => category.category === "output")?.tokens, "50");
  assert.equal(budget.known_total_nanos, "258250000");
  for (const row of budget.observations) {
    if (row.amount_nanos === null) continue;
    const categoryTotal = row.categories.reduce((sum, category) => sum + BigInt(category.amount_nanos), 0n);
    assert.equal(categoryTotal + BigInt(row.unattributed_amount_nanos) + BigInt(row.rounding_adjustment_nanos), BigInt(row.amount_nanos));
  }
  const categoryTotal = budget.categories.reduce((sum, category) => sum + BigInt(category.amount_nanos), 0n);
  assert.equal(categoryTotal + BigInt(budget.unattributed_amount_nanos) + BigInt(budget.rounding_adjustment_nanos), BigInt(budget.known_total_nanos));
});

test("operation-export emits the budget and optional token SVG while protecting report and rate-card inputs", () => {
  const source = evidence();
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "rate_card", rate_card: card() }));
  const directory = mkdtempSync(join(tmpdir(), "operation-budget-cli-"));
  try {
    const reportFile = join(directory, "operation-report.json");
    const rateFile = join(directory, "rates.json");
    const output = join(directory, "export");
    writeFileSync(reportFile, JSON.stringify(report));
    writeFileSync(rateFile, JSON.stringify(card()));
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "operation-export", ...args], { encoding: "utf8" });
    const result = run("--input", reportFile, "--out-dir", output, "--rate-card", rateFile, "--svg", "true");
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(output, "export.json"), "utf8"));
    assert.ok(manifest.artifacts["operation-budget.json"]?.sha256);
    assert.ok(manifest.artifacts["token-costs.svg"]?.sha256);
    assert.deepEqual(JSON.parse(readFileSync(join(output, "operation-budget.json"), "utf8")).categories.map((row: { category: string }) => row.category), ["input", "cache_read", "cache_write", "output"]);
    assert.notEqual(run("--input", reportFile, "--out-dir", directory, "--rate-card", rateFile).status, 0);
    const rateProtectedDirectory = join(directory, "rate-protected");
    const rateProtectedFile = join(rateProtectedDirectory, "operation-report.json");
    mkdirSync(rateProtectedDirectory);
    writeFileSync(rateProtectedFile, JSON.stringify(card()));
    assert.notEqual(run("--input", reportFile, "--out-dir", rateProtectedDirectory, "--rate-card", rateProtectedFile, "--svg", "false").status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("subtree selection conserves nested known and unknown observations without parent double counting", () => {
  const source = evidence();
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "rate_card", rate_card: card() }));
  const whole = createOperationBudget(report, card());
  const subtree = createOperationBudget(report, card(), "first");
  assert.deepEqual(subtree.scope_observation_ids, ["first", "second"]);
  assert.equal(subtree.known_total_nanos, "258250000");
  assert.equal(whole.unknown_observation_count, 1);
  assert.equal(subtree.unknown_observation_count, 0);
  assert.equal(BigInt(subtree.known_total_nanos) + BigInt(createOperationBudget(report, card(), "unknown").known_total_nanos), BigInt(whole.known_total_nanos));
});

test("category rounding exposes signed residual when separately rounded components differ", () => {
  const source = evidence();
  source.observations[0]!.usage = { input_tokens: "1", output_tokens: "1", cache_read_input_tokens: "0", cache_write_input_tokens: "0", reasoning_output_tokens: "0", unclassified_tokens: "0" };
  source.observations[1]!.usage = { input_tokens: "0", output_tokens: "0", cache_read_input_tokens: "0", cache_write_input_tokens: "0", reasoning_output_tokens: "0", unclassified_tokens: "0" };
  const tinyCard = card({ rules: [{ ...card().rules[0]!, rates: { input: "0.0000000005", cache_read: "0", cache_write: "0", output: "0.0000000005" }, unit_tokens: "1" }] });
  const report = createOperationReport(operations(), source, valueEvidence(source, { mode: "rate_card", rate_card: tinyCard }));
  const budget = createOperationBudget(report, tinyCard, "first");
  assert.equal(budget.known_total_nanos, "1");
  assert.equal(budget.categories.find(row => row.category === "input")?.amount_nanos, "0");
  assert.equal(budget.categories.find(row => row.category === "output")?.amount_nanos, "0");
  assert.equal(budget.rounding_adjustment_nanos, "1");
});
