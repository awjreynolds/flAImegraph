import assert from "node:assert/strict";
import test from "node:test";

import {
  validateRateCard,
  valueEvidence,
  type CoreError,
} from "../src/core.js";
import type { EvidenceBundle, Observation, RateCard } from "../src/types.js";

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    source_refs: [{ source_id: "source-1", record: "row-1" }],
    kind: "model",
    operation: "responses.create",
    status: "ok",
    accounting_scope: "direct",
    timestamp: "2026-03-01T00:00:00Z",
    provider: "provider-a",
    product: "api",
    model: "model-a",
    model_identity: "response",
    usage: {
      input_tokens: "100",
      output_tokens: "40",
      cache_read_input_tokens: "10",
      cache_write_input_tokens: "5",
      reasoning_output_tokens: "20",
      unclassified_tokens: "0",
    },
    ...overrides,
  };
}

function evidence(observations: Observation[] = [observation()]): EvidenceBundle {
  return {
    schema_version: "0.1.0",
    dataset_id: "dataset-1",
    sources: [
      {
        id: "source-1",
        harness: "fixture",
        format: "json",
        coverage: "complete",
      },
    ],
    observations,
    relationships: [],
    issues: [],
  };
}

function rateCard(overrides: Partial<RateCard> = {}): RateCard {
  return {
    schema_version: "0.1.0",
    id: "card-1",
    currency: "USD",
    basis: "enterprise_scenario",
    source_url: "https://example.test/rates/card-1",
    retrieved_at: "2026-03-01T00:00:00Z",
    assumptions: ["fixture schedule"],
    rules: [
      {
        id: "rule-1",
        model: "model-a",
        provider: "provider-a",
        product: "api",
        valid_from: null,
        valid_to: null,
        rates: {
          input: "1.25",
          cache_read: "0.1",
          cache_write: "0.2",
          output: "2.5",
        },
        unit_tokens: "1000",
      },
    ],
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as CoreError).code;
  }
  return "";
}

test("validateRateCard accepts exact decimal rates and rejects invalid validity intervals", () => {
  assert.deepEqual(validateRateCard(rateCard()), rateCard());
  assert.equal(
    codeOf(() =>
      validateRateCard(
        rateCard({
          rules: [{ ...rateCard().rules[0]!, valid_from: "2026-04-01", valid_to: "2026-04-01" }],
        }),
      ),
    ),
    "INVALID_RATE_INTERVAL",
  );
});

test("valueEvidence prices inclusive input and disjoint cache subsets, without adding reasoning twice", () => {
  const valuation = valueEvidence(evidence(), { mode: "rate_card", rate_card: rateCard() });

  assert.equal(valuation.observations[0]?.amount_nanos, "208250000");
  assert.equal(valuation.total_nanos, "208250000");
  assert.equal(valuation.observations[0]?.basis, "enterprise_scenario");
  assert.equal(valuation.complete, true);
});

test("valueEvidence rounds the exact observation sum once with HALF_EVEN", () => {
  const card = rateCard({
    rules: [
      {
        id: "rule-1",
        model: "model-a",
        provider: "provider-a",
        product: "api",
        rates: { input: "0.0000000004", cache_read: "0", cache_write: "0", output: "0.0000000004" },
        unit_tokens: "1",
      },
    ],
  });
  const valuation = valueEvidence(
    evidence(
      [
        observation({
          usage: {
            input_tokens: "1",
            output_tokens: "1",
            cache_read_input_tokens: "0",
            cache_write_input_tokens: "0",
            reasoning_output_tokens: "0",
            unclassified_tokens: "0",
          },
        }),
      ],
    ),
    { mode: "rate_card", rate_card: card },
  );
  assert.equal(valuation.total_nanos, "1");

  const recorded = valueEvidence(
    evidence([
      observation({ recorded_cost: { amount: "0.0000000015", currency: "USD", basis: "billed" } }),
    ]),
    { mode: "recorded" },
  );
  assert.equal(recorded.total_nanos, "2");
});

test("valueEvidence keeps aggregate and snapshot evidence but excludes it from direct totals", () => {
  const aggregate = observation({
    id: "aggregate-1",
    accounting_scope: "aggregate",
    source_refs: [{ source_id: "source-1", record: "aggregate" }],
    usage: {
      input_tokens: "1000",
      output_tokens: "0",
      cache_read_input_tokens: "0",
      cache_write_input_tokens: "0",
      reasoning_output_tokens: "0",
      unclassified_tokens: "0",
    },
  });
  const valuation = valueEvidence(evidence([observation(), aggregate]), {
    mode: "rate_card",
    rate_card: rateCard(),
  });

  assert.equal(valuation.total_nanos, "208250000");
  assert.equal(valuation.observations.length, 2);
  assert.equal(valuation.observations.find((value) => value.observation_id === "aggregate-1")?.amount_nanos, null);
  assert.equal(valuation.complete, false);
  assert.ok(valuation.issues.some((coverageIssue) => coverageIssue.code === "NON_DIRECT_EXCLUDED"));
});

test("unknown unclassified tokens remain unpriced and prevent a complete valuation", () => {
  const valuation = valueEvidence(
    evidence([
      observation({
        usage: {
          input_tokens: "100",
          output_tokens: "40",
          cache_read_input_tokens: "10",
          cache_write_input_tokens: "5",
          reasoning_output_tokens: "20",
          unclassified_tokens: null,
        },
      }),
    ]),
    { mode: "rate_card", rate_card: rateCard() },
  );

  assert.equal(valuation.observations[0]?.amount_nanos, null);
  assert.equal(valuation.complete, false);
  assert.ok(valuation.issues.some((coverageIssue) => coverageIssue.code === "UNCLASSIFIED_TOKENS"));
});

test("omitted unclassified category prices declared tokens but records incomplete hidden coverage", () => {
  const { unclassified_tokens: _omitted, ...declaredUsage } = observation().usage!;
  const valuation = valueEvidence(
    evidence([observation({ usage: declaredUsage })]),
    { mode: "rate_card", rate_card: rateCard() },
  );

  assert.equal(valuation.observations[0]?.amount_nanos, "208250000");
  assert.equal(valuation.complete, false);
  assert.ok(valuation.issues.some((coverageIssue) => coverageIssue.code === "UNCLASSIFIED_NOT_REPORTED"));
});

test("dated rules use a unique half-open UTC interval and ambiguous rules remain unpriced", () => {
  const card = rateCard({
    rules: [
      {
        id: "old",
        model: "model-a",
        provider: "provider-a",
        product: "api",
        valid_from: "2026-01-01",
        valid_to: "2026-03-01",
        rates: { input: "1", cache_read: "1", cache_write: "1", output: "1" },
        unit_tokens: "1",
      },
      {
        id: "new",
        model: "model-a",
        provider: "provider-a",
        product: "api",
        valid_from: "2026-03-01",
        valid_to: null,
        rates: { input: "2", cache_read: "2", cache_write: "2", output: "2" },
        unit_tokens: "1",
      },
    ],
  });
  const valuation = valueEvidence(evidence(), { mode: "rate_card", rate_card: card });
  assert.equal(valuation.observations[0]?.rate_rule_id, "new");
  assert.equal(valuation.total_nanos, "280000000000");

  const ambiguous = valueEvidence(
    evidence([observation({ timestamp: "2026-02-01T00:00:00Z" })]),
    {
      mode: "rate_card",
      rate_card: rateCard({
        rules: [
          { ...rateCard().rules[0]!, id: "one", valid_from: "2026-01-01", valid_to: null },
          { ...rateCard().rules[0]!, id: "two", valid_from: "2026-01-15", valid_to: null },
        ],
      }),
    },
  );
  assert.equal(ambiguous.observations[0]?.amount_nanos, null);
  assert.ok(ambiguous.issues.some((coverageIssue) => coverageIssue.code === "RATE_AMBIGUOUS"));
});

test("recorded valuations reject mixed bases and currencies instead of combining them", () => {
  const first = observation({ recorded_cost: { amount: "1", currency: "USD", basis: "billed" } });
  const second = observation({
    id: "obs-2",
    source_refs: [{ source_id: "source-1", record: "row-2" }],
    recorded_cost: { amount: "1", currency: "USD", basis: "provider_reported" },
  });
  assert.equal(codeOf(() => valueEvidence(evidence([first, second]), { mode: "recorded" })), "MIXED_BASIS");

  const euro = observation({
    id: "obs-2",
    source_refs: [{ source_id: "source-1", record: "row-2" }],
    recorded_cost: { amount: "1", currency: "EUR", basis: "billed" },
  });
  assert.equal(codeOf(() => valueEvidence(evidence([first, euro]), { mode: "recorded" })), "MIXED_CURRENCY");
});

test("valuation IDs are replayable across evidence and rate-rule delivery order", () => {
  const first = valueEvidence(evidence(), { mode: "rate_card", rate_card: rateCard() });
  const reorderedEvidence = evidence([observation({ source_refs: [{ source_id: "source-1", record: "row-1" }] })]);
  const extraRule = {
    ...rateCard().rules[0]!,
    id: "unused-rule",
    model: "unused-model",
  };
  const reorderedCard = rateCard({ rules: [extraRule, ...rateCard().rules].reverse() });
  const second = valueEvidence(reorderedEvidence, { mode: "rate_card", rate_card: reorderedCard });

  assert.notEqual(first.id, second.id);
  assert.equal(first.total_nanos, second.total_nanos);

  const firstWithExtra = valueEvidence(evidence(), { mode: "rate_card", rate_card: rateCard({ rules: [rateCard().rules[0]!, extraRule] }) });
  assert.equal(firstWithExtra.id, second.id);
});
