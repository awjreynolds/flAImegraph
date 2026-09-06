import test from "node:test";
import assert from "node:assert/strict";
import { importEvidence, validateEvidence, valueEvidence, createCostProfile, exportFolded } from "../src/index.js";
import type { RateCard } from "../src/types.js";

test("equivalent Codex and Pi partitions produce the same monetary projection without harness logic downstream", () => {
  const codex = JSON.stringify({ type: "token_usage_record", payload: {
    response_id: "response-1", model: "equivalent-model", provider: "openai",
    usage: { input_tokens: "100", output_tokens: "40", cached_input_tokens: "60", cache_write_input_tokens: "5", reasoning_output_tokens: "7", total_tokens: "140" },
  } });
  const pi = JSON.stringify({ type: "message", id: "message-1", message: {
    role: "assistant", model: "equivalent-model", provider: "openai", stopReason: "stop",
    usage: { input: "35", output: "40", cacheRead: "60", cacheWrite: "5", reasoning: "7", totalTokens: "140" },
  } });
  const card: RateCard = {
    schema_version: "0.1.0", id: "hand-worked-comparison", currency: "USD", basis: "enterprise_scenario",
    source_url: "https://example.test/hand-worked-comparison", retrieved_at: "2026-09-06T00:00:00Z", assumptions: ["Synthetic common schedule; no product constraint"],
    rules: [{ id: "common", model: "equivalent-model", provider: "openai", unit_tokens: "1000", rates: { input: "1.25", cache_read: "0.1", cache_write: "0.2", output: "2.5" } }],
  };
  const folded: string[] = [];
  for (const [harness, native] of [["codex", codex], ["pi", pi]] as const) {
    const evidence = validateEvidence(importEvidence(harness, native, { dataset_id: "comparison", work_item_id: "same-work" }));
    const value = valueEvidence(evidence, { mode: "rate_card", rate_card: card });
    // (35*1.25 + 60*0.1 + 5*0.2 + 40*2.5)/1000 = $0.15075.
    assert.equal(value.total_nanos, "150750000");
    assert.equal(value.complete, false);
    const profile = createCostProfile(evidence, value, { group_by: ["work_item", "model"] });
    folded.push(exportFolded(profile));
  }
  assert.equal(folded[0], folded[1]);
});
