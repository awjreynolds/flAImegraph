import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importEvidence } from "../src/adapters/index.js";
import { validateEvidence, valueEvidence } from "../src/core.js";
import type { RateCard } from "../src/types.js";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "test", "fixtures", "adapters", name), "utf8");

function fixtureRateCard(model = "gpt-pi", provider = "openai", product = "pi"): RateCard {
  return {
    schema_version: "0.1.0",
    id: "adapter-fixture-card",
    currency: "USD",
    basis: "enterprise_scenario",
    source_url: "https://example.test/adapter-fixture-card",
    retrieved_at: "2026-09-06T00:00:00Z",
    assumptions: ["adapter fixture rates"],
    rules: [{
      id: "adapter-fixture-rule",
      model,
      provider,
      product,
      valid_from: null,
      valid_to: null,
      rates: { input: "1", cache_read: "1", cache_write: "1", output: "1" },
      unit_tokens: "1",
    }],
  };
}

test("Codex additive response records preserve exact usage and keep legacy snapshots non-additive", () => {
  const evidence = importEvidence("codex", fixture("codex-additive.jsonl"), {
    dataset_id: "dataset-codex",
    source_id: "source-codex",
  });

  assert.equal(evidence.schema_version, "0.1.0");
  assert.equal(evidence.dataset_id, "dataset-codex");
  assert.equal(evidence.sources.length, 1);
  assert.equal(evidence.sources[0]?.id, "source-codex");
  assert.equal(evidence.sources[0]?.coverage, "partial");

  const additive = evidence.observations.filter(
    (observation) => observation.accounting_scope === "direct",
  );
  assert.equal(additive.length, 2);
  assert.deepEqual(additive[0]?.usage, {
    input_tokens: "100",
    output_tokens: "40",
    cache_read_input_tokens: "60",
    cache_write_input_tokens: "5",
    reasoning_output_tokens: "7",
  });
  assert.equal(additive[1]?.usage?.input_tokens, "9007199254740993");
  assert.equal(additive[1]?.usage?.output_tokens, "2");
  assert.equal(additive[0]?.model_identity, "response");
  assert.equal(additive[0]?.session_id, "session-1");
  assert.equal(additive[0]?.turn_id, "turn-1");
  assert.equal(additive[0]?.attributes?.native_id_hash !== "resp-1", true);

  const snapshots = evidence.observations.filter(
    (observation) => observation.accounting_scope === "snapshot",
  );
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.usage?.input_tokens, "999");
  assert.ok(
    evidence.issues.some((issue) => issue.code === "legacy_snapshot_non_additive"),
  );
  assert.ok(
    evidence.issues.some((issue) => issue.code === "partial_source_coverage"),
  );
});

test("Pi legacy normalizes cache-exclusive input and retains native cost and compaction unknown", () => {
  const evidence = importEvidence("pi", fixture("pi-legacy.jsonl"), {
    dataset_id: "dataset-pi-legacy",
    source_id: "source-pi-legacy",
  });
  const model = evidence.observations.find((observation) => observation.kind === "model");
  assert.ok(model);
  assert.deepEqual(model.usage, {
    input_tokens: "15",
    output_tokens: "5",
    cache_read_input_tokens: "3",
    cache_write_input_tokens: "2",
    reasoning_output_tokens: "1",
  });
  assert.equal(model.product, "pi");
  assert.equal(model.grain, "operation");
  assert.equal(model.recorded_cost?.amount, "0.000123");
  assert.equal(model.recorded_cost?.basis, "model_price_estimate");
  assert.ok(evidence.observations.some((observation) => observation.kind === "tool"));
  assert.ok(evidence.issues.some((issue) => issue.code === "compaction_usage_unknown"));
  assert.equal(evidence.sources[0]?.coverage, "partial");
});

test("Pi v4 counts durable usage rows once and retains cumulative totals as snapshots", () => {
  const evidence = importEvidence("pi", fixture("pi-v4.jsonl"), {
    dataset_id: "dataset-pi-v4",
    source_id: "source-pi-v4",
  });
  const direct = evidence.observations.filter((observation) => observation.accounting_scope === "direct");
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "13",
    output_tokens: "6",
    cache_read_input_tokens: "8",
    cache_write_input_tokens: "1",
    reasoning_output_tokens: "2",
  });
  assert.equal(direct[0]?.session_id, "pi-session");
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "snapshot"));
  assert.ok(evidence.issues.some((issue) => issue.code === "pi_v4_snapshot_non_additive"));
});

test("Oh My Pi keeps orchestration and child aggregates explicit without double counting", () => {
  const evidence = importEvidence("omp", fixture("omp.jsonl"), {
    dataset_id: "dataset-omp",
    source_id: "source-omp",
  });
  const direct = evidence.observations.filter((observation) => observation.accounting_scope === "direct");
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "180224",
    output_tokens: "29",
    cache_read_input_tokens: "180224",
    cache_write_input_tokens: "0",
    reasoning_output_tokens: null,
    unclassified_tokens: "5629",
  });
  assert.equal(direct[0]?.product, "oh-my-pi");
  assert.equal(direct[0]?.recorded_cost?.basis, "model_price_estimate");
  assert.equal(direct[0]?.recorded_cost?.amount, "0.0042");
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "aggregate" && observation.operation === "omp.model_usage"));
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "aggregate" && observation.operation === "omp.task"));
  assert.ok(evidence.issues.some((issue) => issue.code === "omp_aggregate_non_additive"));
});

test("Claude Code takes the latest usage for a streaming message and preserves separate calls", () => {
  const evidence = importEvidence("claude", fixture("claude.jsonl"), {
    dataset_id: "dataset-claude",
    source_id: "source-claude",
  });
  const direct = evidence.observations.filter((observation) => observation.accounting_scope === "direct");
  assert.equal(direct.length, 2);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "145",
    output_tokens: "12",
    cache_read_input_tokens: "40",
    cache_write_input_tokens: "5",
    reasoning_output_tokens: "3",
  });
  assert.deepEqual(direct[1]?.usage, direct[0]?.usage);
  assert.equal(direct[0]?.product, "claude-code");
  assert.equal(direct[0]?.model_identity, "response");
  assert.ok(evidence.issues.some((issue) => issue.code === "claude_stream_revision"));
  assert.ok(evidence.observations.some((observation) => observation.kind === "tool" && observation.attributes?.tool_name === "Read"));
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "aggregate" && observation.operation === "claude.subagent_completed"));
  assert.ok(evidence.issues.some((issue) => issue.code === "claude_subagent_footprint"));
  assert.ok(evidence.issues.some((issue) => issue.code === "compaction_usage_unknown"));
});

test("Gemini preserves inclusive input and output thoughts while deduplicating repeated message identities", () => {
  const evidence = importEvidence("gemini", fixture("gemini.jsonl"), {
    dataset_id: "dataset-gemini",
    source_id: "source-gemini",
  });
  const direct = evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  assert.equal(direct.length, 2);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "100",
    output_tokens: "22",
    cache_read_input_tokens: "30",
    cache_write_input_tokens: null,
    reasoning_output_tokens: "6",
  });
  assert.deepEqual(direct[1]?.usage, direct[0]?.usage);
  assert.equal(direct[0]?.product, "gemini-cli");
  assert.equal(direct[0]?.model_identity, "response");
  assert.ok(evidence.issues.some((issue) => issue.code === "gemini_stream_revision"));
  assert.ok(evidence.observations.some((observation) => observation.kind === "tool" && observation.attributes?.tool_name === "search"));
  assert.ok(evidence.issues.some((issue) => issue.code === "context_estimate_not_usage"));
});

test("OpenCode adds exclusive cache and reasoning buckets exactly once", () => {
  const evidence = importEvidence("opencode", fixture("opencode.jsonl"), {
    dataset_id: "dataset-opencode",
    source_id: "source-opencode",
  });
  const direct = evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  assert.equal(direct.length, 2);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "1010",
    output_tokens: "150",
    cache_read_input_tokens: "600",
    cache_write_input_tokens: "10",
    reasoning_output_tokens: "50",
  });
  assert.equal(direct[0]?.product, "opencode");
  assert.equal(direct[0]?.recorded_cost?.amount, "0.0075");
  assert.equal(direct[0]?.recorded_cost?.basis, "model_price_estimate");
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "aggregate" && observation.operation === "opencode.session_total"));
  assert.ok(evidence.observations.some((observation) => observation.kind === "tool" && observation.attributes?.tool_name === "bash"));
  assert.ok(evidence.issues.some((issue) => issue.code === "opencode_aggregate_non_additive"));
});

test("OTLP keeps inference spans direct and agent/tool spans separate", () => {
  const evidence = importEvidence("otel", fixture("otel.json"), {
    dataset_id: "dataset-otel",
    source_id: "source-otel",
  });
  const direct = evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "100",
    output_tokens: "20",
    cache_read_input_tokens: "60",
    cache_write_input_tokens: null,
    reasoning_output_tokens: "5",
  });
  assert.equal(direct[0]?.provider, "agent-test");
  assert.equal(direct[0]?.model_identity, "response");
  assert.equal(direct[0]?.recorded_cost?.basis, "provider_reported");
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "aggregate" && observation.operation === "otel.invoke_agent"));
  assert.ok(evidence.observations.some((observation) => observation.kind === "tool" && observation.attributes?.tool_name === "search"));
  assert.ok(evidence.relationships.some((relationship) => relationship.kind === "parent"));
  assert.ok(evidence.issues.some((issue) => issue.code === "otel_aggregate_non_additive"));
});

test("Copilot OTLP preserves per-call IDs, cost and AI units while excluding parent totals", () => {
  const evidence = importEvidence("copilot", fixture("copilot-otel.json"), {
    dataset_id: "dataset-copilot",
    source_id: "source-copilot",
  });
  const direct = evidence.observations.filter((observation) => observation.kind === "model" && observation.accounting_scope === "direct");
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0]?.usage, {
    input_tokens: "200",
    output_tokens: "30",
    cache_read_input_tokens: "100",
    cache_write_input_tokens: null,
    reasoning_output_tokens: null,
  });
  assert.equal(direct[0]?.product, "copilot");
  assert.equal(direct[0]?.recorded_cost?.amount, "0.005");
  assert.equal(direct[0]?.attributes?.ai_units, "1.5");
  assert.equal(direct[0]?.session_id, "conversation-1");
  assert.equal(direct[0]?.turn_id, "turn-1");
  assert.ok(evidence.observations.some((observation) => observation.accounting_scope === "aggregate"));
});

test("every checked-in adapter fixture is schema-valid and enters downstream valuation", () => {
  const cases = [
    ["codex", "codex-additive.jsonl"],
    ["pi", "pi-legacy.jsonl"],
    ["pi", "pi-v4.jsonl"],
    ["omp", "omp.jsonl"],
    ["claude", "claude.jsonl"],
    ["gemini", "gemini.jsonl"],
    ["opencode", "opencode.jsonl"],
    ["otel", "otel.json"],
    ["otel", "otel-roundtrip.json"],
    ["copilot", "copilot-otel.json"],
  ] as const;

  for (const [harness, name] of cases) {
    const evidence = importEvidence(harness, fixture(name), {
      dataset_id: `validation-${harness}-${name}`,
      source_id: `validation-${harness}-${name}`,
    });
    assert.doesNotThrow(() => validateEvidence(evidence), `${harness}/${name}`);
  }

  const piEvidence = importEvidence("pi", fixture("pi-legacy.jsonl"), {
    dataset_id: "downstream-pi",
    source_id: "downstream-pi",
  });
  const valuation = valueEvidence(piEvidence, { mode: "recorded" });
  assert.equal(valuation.observations.some((observation) => observation.amount_nanos !== null), true);
});

test("native parent IDs resolve only to normalized observations and unresolved ancestry is explicit", () => {
  const otel = importEvidence("otel", fixture("otel.json"), {
    dataset_id: "parent-otel",
    source_id: "parent-otel",
  });
  const model = otel.observations.find((observation) => observation.span_id === "span-model");
  const agent = otel.observations.find((observation) => observation.span_id === "span-agent");
  assert.ok(model);
  assert.ok(agent);
  assert.equal(model.parent_id, agent.id);

  const pi = importEvidence("pi", fixture("pi-legacy.jsonl"), {
    dataset_id: "parent-pi",
    source_id: "parent-pi",
  });
  const direct = pi.observations.find((observation) => observation.accounting_scope === "direct");
  assert.ok(direct);
  assert.equal(direct.parent_id, undefined);
  assert.equal(typeof direct.attributes?.["flAImegraph.lineage.parent_id_hashes"], "string");
  assert.ok(pi.issues.some((issue) => issue.code === "lineage_parent_unresolved"));
});

test("missing exclusive buckets stay unavailable through valuation", () => {
  const cases = [
    ["pi", "pi-legacy-missing-input.jsonl", "gpt-pi", "openai", "pi", "input_tokens"],
    ["pi", "pi-v4-missing-input.jsonl", "pi-v4", "anthropic", "pi", "input_tokens"],
    ["omp", "omp-missing-input.jsonl", "omp-model", "anthropic", "oh-my-pi", "input_tokens"],
    ["claude", "claude-missing-input.jsonl", "claude-sonnet", "anthropic", "claude-code", "input_tokens"],
    ["opencode", "opencode-missing-output.jsonl", "openai/gpt-test", "openai", "opencode", "output_tokens"],
  ] as const;

  for (const [harness, name, model, provider, product, missing] of cases) {
    const evidence = importEvidence(harness, fixture(name), {
      dataset_id: `missing-${harness}-${name}`,
      source_id: `missing-${harness}-${name}`,
    });
    const direct = evidence.observations.find((observation) => observation.accounting_scope === "direct");
    assert.ok(direct, `${harness}/${name} should preserve the call`);
    assert.equal(direct.usage?.[missing], null, `${harness}/${name}`);
    const valuation = valueEvidence(evidence, {
      mode: "rate_card",
      rate_card: fixtureRateCard(model, provider, product),
    });
    const valued = valuation.observations.find((observation) => observation.observation_id === direct.id);
    assert.equal(valued?.amount_nanos, null, `${harness}/${name} should not be priced`);
  }
});

test("recognized model calls without usage remain as missing direct observations", () => {
  const gemini = importEvidence("gemini", JSON.stringify({
    type: "message",
    id: "gemini-missing-usage",
    role: "assistant",
    model: "gemini-test",
  }), { dataset_id: "missing-gemini", source_id: "missing-gemini" });
  const geminiCall = gemini.observations.find((observation) => observation.accounting_scope === "direct");
  assert.ok(geminiCall);
  assert.equal(geminiCall.usage, null);
  assert.ok(gemini.issues.some((issue) => issue.code === "missing_usage"));

  const opencode = importEvidence("opencode", JSON.stringify({
    type: "step-finish",
    messageID: "opencode-missing-usage",
    modelID: "openai/gpt-test",
    part: { id: "step-missing-usage", reason: "stop" },
  }), { dataset_id: "missing-opencode", source_id: "missing-opencode" });
  const opencodeCall = opencode.observations.find((observation) => observation.accounting_scope === "direct");
  assert.ok(opencodeCall);
  assert.equal(opencodeCall.usage, null);
  assert.ok(opencode.issues.some((issue) => issue.code === "missing_usage"));
});

test("OMP, OpenCode, and Pi durable identities report conflicting duplicate payloads", () => {
  const omp = importEvidence("omp", [
    { type: "assistant", id: "same-omp", message: { role: "assistant", model: "omp-model", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } },
    { type: "assistant", id: "same-omp", message: { role: "assistant", model: "omp-model", usage: { input: 999, output: 1, cacheRead: 0, cacheWrite: 0 } } },
  ].map((record) => JSON.stringify(record)).join("\n"), { dataset_id: "conflict-omp", source_id: "conflict-omp" });
  assert.equal(omp.observations.filter((observation) => observation.accounting_scope === "direct").length, 1);
  assert.equal(omp.observations.find((observation) => observation.accounting_scope === "direct")?.usage?.input_tokens, "1");
  assert.ok(omp.issues.some((issue) => issue.code === "conflicting_duplicate_usage" && issue.severity === "error"));

  const opencode = importEvidence("opencode", [
    { type: "step-finish", messageID: "same-oc", modelID: "openai/gpt-test", part: { id: "step", tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } },
    { type: "step-finish", messageID: "same-oc", modelID: "openai/gpt-test", part: { id: "step", tokens: { input: 999, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } },
  ].map((record) => JSON.stringify(record)).join("\n"), { dataset_id: "conflict-oc", source_id: "conflict-oc" });
  assert.equal(opencode.observations.filter((observation) => observation.accounting_scope === "direct").length, 1);
  assert.equal(opencode.observations.find((observation) => observation.accounting_scope === "direct")?.usage?.input_tokens, "1");
  assert.ok(opencode.issues.some((issue) => issue.code === "conflicting_duplicate_usage" && issue.severity === "error"));

  const pi = importEvidence("pi", [
    { v: 4, kind: "header", storageVersion: 1, sessionId: "pi-conflict" },
    { kind: "transaction", writes: [{ kind: "usage", row: { id: "same-row", entryId: "entry", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }] },
    { kind: "transaction", writes: [{ kind: "usage", row: { id: "same-row", entryId: "entry", usage: { input: 999, output: 1, cacheRead: 0, cacheWrite: 0 } } }] },
  ].map((record) => JSON.stringify(record)).join("\n"), { dataset_id: "conflict-pi", source_id: "conflict-pi" });
  assert.equal(pi.observations.filter((observation) => observation.accounting_scope === "direct").length, 1);
  assert.equal(pi.observations.find((observation) => observation.accounting_scope === "direct")?.usage?.input_tokens, "1");
  assert.ok(pi.issues.some((issue) => issue.code === "conflicting_duplicate_usage" && issue.severity === "error"));
});

test("OTLP timestamps become RFC3339 and provider metadata prefers GenAI system", () => {
  const evidence = importEvidence("otel", JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [
        { key: "service.name", value: { stringValue: "frontend" } },
        { key: "gen_ai.system", value: { stringValue: "openai" } },
      ] },
      scopeSpans: [{ spans: [{
        traceId: "t",
        spanId: "s",
        name: "chat",
        startTimeUnixNano: "1000000123",
        endTimeUnixNano: "2000000456",
        attributes: [
          { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
          { key: "gen_ai.response.model", value: { stringValue: "gpt-test" } },
          { key: "gen_ai.usage.input_tokens", value: { intValue: "1" } },
          { key: "gen_ai.usage.output_tokens", value: { intValue: "1" } },
        ],
      }] }],
    }],
  }), { dataset_id: "time-otel", source_id: "time-otel" });
  assert.doesNotThrow(() => validateEvidence(evidence));
  const observation = evidence.observations.find((candidate) => candidate.span_id === "s");
  assert.ok(observation);
  assert.equal(observation.timestamp, "1970-01-01T00:00:01.000000123Z");
  assert.equal(observation.end_time, "1970-01-01T00:00:02.000000456Z");
  assert.equal(observation.provider, "openai");
  assert.equal(observation.attributes?.["flAImegraph.otel.service_name"], "frontend");
});

test("OTLP local binding round-trips accounting fields and remains rateable", () => {
  const evidence = importEvidence("otel", fixture("otel-roundtrip.json"), {
    dataset_id: "roundtrip-otel",
    source_id: "roundtrip-otel",
  });
  const observation = evidence.observations.find((candidate) => candidate.accounting_scope === "direct");
  assert.ok(observation);
  assert.equal(observation.kind, "model");
  assert.equal(observation.operation, "roundtrip.model");
  assert.equal(observation.provider, "openai");
  assert.equal(observation.model, "gpt-roundtrip");
  assert.equal(observation.model_identity, "response");
  assert.equal(observation.product, "roundtrip");
  assert.equal(observation.session_id, "session-1");
  assert.equal(observation.turn_id, "turn-1");
  assert.equal(observation.work_item_id, "work-1");
  assert.equal(observation.subject_id, "native-observation-1");
  assert.deepEqual(observation.usage, {
    input_tokens: "10",
    output_tokens: "5",
    cache_read_input_tokens: "4",
    cache_write_input_tokens: "1",
    reasoning_output_tokens: "2",
  });
  assert.deepEqual(observation.recorded_cost, {
    amount: "0.005",
    currency: "USD",
    basis: "provider_reported",
  });
  assert.match(observation.timestamp ?? "", /^2024-09-06T/);
  const valuation = valueEvidence(evidence, {
    mode: "rate_card",
    rate_card: fixtureRateCard("gpt-roundtrip", "openai", "roundtrip"),
  });
  const valued = valuation.observations.find((candidate) => candidate.observation_id === observation.id);
  assert.notEqual(valued?.amount_nanos, null);
});

test("numeric native costs are rendered as canonical decimals with an explicit precision issue", () => {
  const evidence = importEvidence("opencode", JSON.stringify({
    type: "step-finish",
    messageID: "numeric-cost",
    modelID: "openai/gpt-test",
    part: {
      id: "numeric-step",
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 1e-7,
    },
  }), { dataset_id: "numeric-cost", source_id: "numeric-cost" });
  const observation = evidence.observations.find((candidate) => candidate.accounting_scope === "direct");
  assert.ok(observation);
  assert.equal(observation.recorded_cost?.amount, "0.0000001");
  assert.ok(evidence.issues.some((issue) => issue.code === "numeric_cost_precision"));
  assert.doesNotThrow(() => validateEvidence(evidence));
});
