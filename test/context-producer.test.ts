import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateContextBundle, validateHarnessProfile } from "../src/context.js";
import { createContextReport, validateContextReport } from "../src/context-report.js";
import { valueEvidence } from "../src/core.js";
import type { ContextBundle } from "../src/context-types.js";
import type { EvidenceBundle } from "../src/types.js";

const DATASET_ID = "independent-producer-fixture-v02";
const producer = fileURLToPath(new URL("../tools/context-producer-python/producer.py", import.meta.url));

const syntheticIssue = {
  code: "SYNTHETIC_FIXTURE",
  severity: "info" as const,
  message: "Synthetic fixture: token measurements and model_price_estimate are illustrative; no provider call, billed amount, or accepted user task exists.",
};

function evidence(): EvidenceBundle {
  return {
    schema_version: "0.1.0",
    dataset_id: DATASET_ID,
    sources: [
      {
        id: "independent-evidence",
        harness: "independent-python",
        format: "synthetic-json",
        coverage: "complete",
        description: "Synthetic valuation input; no provider call or bill is represented.",
      },
    ],
    observations: [
      {
        id: "model-call-1",
        source_refs: [{ source_id: "independent-evidence", record: "observations[0]" }],
        kind: "model",
        operation: "synthetic.context-producer",
        status: "ok",
        accounting_scope: "direct",
        timestamp: "2026-09-06T20:00:00Z",
        provider: "synthetic-provider",
        model: "synthetic-model",
        model_identity: "setting",
        usage: {
          input_tokens: "100",
          output_tokens: "5",
          cache_read_input_tokens: null,
          cache_write_input_tokens: null,
          reasoning_output_tokens: null,
        },
        recorded_cost: {
          amount: "0.000000101",
          currency: "USD",
          basis: "model_price_estimate",
        },
      },
    ],
    relationships: [],
    issues: [syntheticIssue],
  };
}

function runProducer(): ContextBundle {
  const result = spawnSync("python3", [producer], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message || "producer failed");
  assert.equal(result.stderr, "", result.stderr);
  return JSON.parse(result.stdout) as ContextBundle;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error && "code" in error ? String(error.code) : undefined;
  }
}

test("independent Python producer crosses the public context and report seams", () => {
  const produced = runProducer();
  const profile = produced.profiles[0];
  assert.ok(profile);
  assert.deepEqual(validateHarnessProfile(profile), profile);

  const context = validateContextBundle(produced, evidence());
  assert.equal(context.dataset_id, DATASET_ID);
  assert.equal(context.profiles.length, 1);

  const request = context.requests.find((candidate) => candidate.id === "request-main");
  assert.ok(request);
  const repeated = request.occurrences.filter((occurrence) => occurrence.revision_id === "revision-user");
  assert.equal(repeated.length, 2);
  assert.deepEqual(request.occurrences.map((occurrence) => occurrence.id), [
    "occurrence-system",
    "occurrence-user-first",
    "occurrence-history-summary",
    "occurrence-user-repeat",
  ]);
  assert.equal(request.overrides.temperature?.evidence, "observed");
  assert.deepEqual(request.overrides.temperature?.source_refs, [
    { source_id: "context-capture", record: "requests[0].overrides.temperature" },
  ]);

  const transformation = context.transformations.find((candidate) => candidate.id === "transformation-history-summary");
  assert.deepEqual(transformation, {
    id: "transformation-history-summary",
    kind: "summarize",
    from_revision_ids: ["revision-history-full"],
    to_revision_ids: ["revision-history-summary"],
    evidence: "declared",
    method: "synthetic compaction summary-v1 with explicit source lineage",
    observation_id: "model-call-1",
    source_refs: [{ source_id: "context-capture", record: "transformations[0]" }],
  });

  assert.equal(context.revisions.find((revision) => revision.id === "revision-system")?.tokens.value, null);
  assert.equal(context.revisions.find((revision) => revision.id === "revision-system")?.tokens.evidence, "unavailable");
  assert.equal(context.revisions.find((revision) => revision.id === "revision-user")?.tokens.evidence, "estimated");
  assert.equal(context.revisions.find((revision) => revision.id === "revision-history-summary")?.tokens.evidence, "estimated");

  const valuation = valueEvidence(evidence(), { mode: "recorded" });
  const report = createContextReport(evidence(), valuation, context, { allocation_request_ids: ["request-main"] });
  assert.deepEqual(validateContextReport(JSON.parse(JSON.stringify(report))), report);
  assert.equal(report.summary.known_cost_nanos, "101");
  const allocation = report.allocations[0];
  assert.ok(allocation);
  assert.equal(allocation.denominator_tokens, "100");
  assert.equal(allocation.unallocated_weight_tokens, "20");
  assert.equal(
    BigInt(allocation.unallocated_nanos) + allocation.portions.reduce((sum, portion) => sum + BigInt(portion.amount_nanos), 0n),
    101n,
  );
  assert.equal(allocation.portions.filter((portion) => portion.revision_id === "revision-user").length, 2);

  const corruptedArtifactRef = structuredClone(context);
  corruptedArtifactRef.sources[0]!.source_refs = [{ source_id: "missing-artifact", record: "sources[0]" }];
  assert.equal(codeOf(() => validateContextBundle(corruptedArtifactRef, evidence())), "CONTEXT_ARTIFACT_REFERENCE_MISSING");

  const corruptedRevisionRef = structuredClone(context);
  corruptedRevisionRef.transformations[0]!.to_revision_ids = ["missing-revision"];
  assert.equal(codeOf(() => validateContextBundle(corruptedRevisionRef, evidence())), "CONTEXT_REVISION_REFERENCE_MISSING");
});

test("published independent producer report is a detached valid report", () => {
  const reportPath = fileURLToPath(new URL("../examples/context/independent-producer-report.json", import.meta.url));
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const validated = validateContextReport(report);
  assert.deepEqual(validated, report);
  assert.equal(validated.dataset_id, DATASET_ID);
  assert.equal(validated.context.profiles[0]?.harness, "independent-python");
  assert.equal(validated.valuation.total_nanos, "101");
});
