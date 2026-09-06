import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import test from "node:test";

import { joinWorkItemEvidence, validateValuation, validateWorkItem } from "../src/work-items.js";
import type { EvidenceBundle, Valuation } from "../src/types.js";
import { valueEvidence } from "../src/index.js";

test("validateWorkItem accepts a versioned research item with an unestimated Context Points value", () => {
  const input = {
    schema_version: "0.1.0",
    dataset_id: "research-example",
    work_item_id: "research-context-points",
    scope: {
      revision: "2026-09-06",
      description: "Review evidence for a human-facing AI effort measure",
    },
    acceptance_criteria: ["Publish a bounded research record without inventing a point estimate"],
    outcome: {
      status: "accepted",
      recorded_at: "2026-09-06T12:00:00Z",
    },
    attempts: [
      {
        attempt_id: "research-attempt-1",
        status: "accepted",
        observation_ids: [],
      },
    ],
    estimates: [
      {
        estimate_id: "research-context-points-estimate-1",
        estimate_version: 1,
        scope_revision: "2026-09-06",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No local Context Points scale has been calibrated for this research item",
      },
    ],
  };

  const result = validateWorkItem(input);

  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input);
  assert.equal(result.estimates[0]?.point_estimate, null);
});

test("validateWorkItem preserves exact decimal and ordinal estimates as immutable versions", () => {
  const input = {
    schema_version: "0.1.0",
    dataset_id: "dataset-points",
    work_item_id: "work-1",
    scope: {
      revision: "scope-1",
      description: "Implement a bounded feature",
    },
    acceptance_criteria: ["The acceptance behavior is recorded"],
    outcome: {
      status: "in_progress",
    },
    attempts: [],
    estimates: [
      {
        estimate_id: "estimate-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "team",
        point_estimate: {
          scale_id: "team-context",
          scale_version: "v1",
          kind: "decimal",
          value: "3.125",
        },
      },
      {
        estimate_id: "estimate-2",
        estimate_version: 2,
        scope_revision: "scope-1",
        created_at: "2026-09-06T10:00:00Z",
        timing: "during_execution",
        information_basis: "repository_inspection",
        estimator: "team",
        point_estimate: {
          scale_id: "team-context",
          scale_version: "v1",
          kind: "ordinal",
          value: "L",
        },
        supersedes_estimate_id: "estimate-1",
      },
    ],
  };

  const result = validateWorkItem(input);

  assert.deepEqual(result.estimates, input.estimates);
  assert.equal(result.estimates[0]?.point_estimate?.kind, "decimal");
  assert.equal(result.estimates[0]?.point_estimate?.value, "3.125");
  assert.equal(result.estimates[1]?.point_estimate?.kind, "ordinal");
  assert.equal(result.estimates[1]?.supersedes_estimate_id, "estimate-1");
});

test("validateWorkItem rejects unknown fields, unsupported versions, and unexplained unestimated points", () => {
  const base = {
    schema_version: "0.1.0",
    dataset_id: "dataset-validation",
    work_item_id: "work-validation",
    scope: {
      revision: "scope-1",
      description: "Validate sidecar semantics",
    },
    acceptance_criteria: ["Invalid records fail closed"],
    outcome: { status: "failed" },
    attempts: [
      {
        attempt_id: "attempt-1",
        status: "failed",
        observation_ids: [],
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: {
          scale_id: "local-scale",
          scale_version: "v1",
          kind: "decimal",
          value: "2",
        },
      },
    ],
  };

  assert.throws(() => validateWorkItem({ ...base, unexpected: true }), /WORK_ITEM_SCHEMA_INVALID/);
  assert.throws(
    () => validateWorkItem({ ...base, scope: { ...base.scope, unexpected: true } }),
    /WORK_ITEM_SCHEMA_INVALID/,
  );
  assert.throws(() => validateWorkItem({ ...base, schema_version: "0.2.0" }), /WORK_ITEM_SCHEMA_INVALID/);
  assert.throws(
    () =>
      validateWorkItem({
        ...base,
        estimates: [{ ...base.estimates[0], point_estimate: null }],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_ESTIMATE_UNEXPLAINED",
  );
  assert.throws(
    () =>
      validateWorkItem({
        ...base,
        estimates: [{ ...base.estimates[0], scope_revision: "scope-2" }],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_SCOPE_MISMATCH",
  );
  assert.throws(
    () =>
      validateWorkItem({
        ...base,
        estimates: [{ ...base.estimates[0], estimate_version: 2 }],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_ESTIMATE_REFERENCE_MISSING",
  );
});

test("validateWorkItem retains historical scopes for superseding estimates", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-scope-history",
    work_item_id: "work-scope-history",
    scope: {
      revision: "scope-2",
      description: "The narrowed research scope",
    },
    scope_history: [
      {
        revision: "scope-1",
        description: "The original research scope",
      },
    ],
    acceptance_criteria: ["Both scope revisions remain attributable"],
    outcome: { status: "accepted" },
    attempts: [],
    estimates: [
      {
        estimate_id: "estimate-scope-history-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
      {
        estimate_id: "estimate-scope-history-2",
        estimate_version: 2,
        scope_revision: "scope-2",
        created_at: "2026-09-06T10:00:00Z",
        timing: "pre_execution",
        information_basis: "repository_inspection",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
        supersedes_estimate_id: "estimate-scope-history-1",
      },
    ],
  };

  const result = validateWorkItem(item);

  assert.equal(result.scope.revision, "scope-2");
  assert.deepEqual(result.scope_history?.map((scope) => scope.revision), ["scope-1"]);
  assert.deepEqual(result.estimates.map((estimate) => estimate.scope_revision), ["scope-1", "scope-2"]);
});

test("validateWorkItem requires chronological linear estimate revisions", () => {
  const estimate = (version: number, created_at: string, supersedes_estimate_id?: string) => ({
    estimate_id: `estimate-linear-${version}`,
    estimate_version: version,
    scope_revision: "scope-1",
    created_at,
    timing: "pre_execution",
    information_basis: "specification_only",
    estimator: "human",
    point_estimate: null,
    unestimated_reason: "No calibrated point scale is available",
    ...(supersedes_estimate_id === undefined ? {} : { supersedes_estimate_id }),
  });
  const base = {
    schema_version: "0.1.0",
    dataset_id: "dataset-linear-estimates",
    work_item_id: "work-linear-estimates",
    scope: { revision: "scope-1", description: "Linear estimate history" },
    acceptance_criteria: ["Estimate history is append-only"],
    outcome: { status: "accepted" },
    attempts: [],
  };

  assert.throws(
    () =>
      validateWorkItem({
        ...base,
        estimates: [
          estimate(1, "2026-09-06T10:00:00Z"),
          estimate(2, "2026-09-06T09:00:00Z", "estimate-linear-1"),
        ],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_ESTIMATE_ORDER",
  );

  assert.throws(
    () =>
      validateWorkItem({
        ...base,
        estimates: [
          estimate(1, "2026-09-06T09:00:00Z"),
          estimate(2, "2026-09-06T10:00:00Z", "estimate-linear-1"),
          estimate(3, "2026-09-06T11:00:00Z", "estimate-linear-1"),
        ],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_ESTIMATE_ORDER",
  );
});

test("validateWorkItem rejects estimate timing contradicted by complete attempt bounds", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-invalid",
    work_item_id: "work-timing-invalid",
    scope: { revision: "scope-1", description: "Timing boundary checks" },
    acceptance_criteria: ["Estimate timing remains truthful"],
    outcome: { status: "accepted" },
    attempts: [
      {
        attempt_id: "attempt-timing-invalid",
        status: "accepted",
        observation_ids: [],
        started_at: "2026-09-06T10:00:00Z",
        ended_at: "2026-09-06T11:00:00Z",
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-timing-invalid",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T12:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
    ],
  };

  assert.throws(
    () => validateWorkItem(item),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
  );
});

test("joinWorkItemEvidence marks timing verified only when execution bounds support it", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-verified",
    work_item_id: "work-timing-verified",
    scope: { revision: "scope-1", description: "Timing boundary checks" },
    acceptance_criteria: ["Estimate timing remains attributable"],
    outcome: { status: "accepted" },
    attempts: [
      {
        attempt_id: "attempt-timing-verified",
        status: "accepted",
        observation_ids: ["observation-timing-verified"],
        started_at: "2026-09-06T10:00:00Z",
        ended_at: "2026-09-06T11:00:00Z",
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-timing-verified-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
      {
        estimate_id: "estimate-timing-verified-2",
        estimate_version: 2,
        scope_revision: "scope-1",
        created_at: "2026-09-06T10:30:00Z",
        timing: "during_execution",
        information_basis: "repository_inspection",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
        supersedes_estimate_id: "estimate-timing-verified-1",
      },
      {
        estimate_id: "estimate-timing-verified-3",
        estimate_version: 3,
        scope_revision: "scope-1",
        created_at: "2026-09-06T12:00:00Z",
        timing: "post_execution",
        information_basis: "probe_assisted",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
        supersedes_estimate_id: "estimate-timing-verified-2",
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-verified",
    sources: [
      { id: "source-timing-verified", harness: "codex", format: "fixture", coverage: "complete" },
    ],
    observations: [
      {
        id: "observation-timing-verified",
        source_refs: [{ source_id: "source-timing-verified", record: "record-1" }],
        kind: "activity",
        operation: "review",
        status: "ok",
        accounting_scope: "unknown",
        work_item_id: "work-timing-verified",
        timestamp: "2026-09-06T10:15:00Z",
        end_time: "2026-09-06T10:45:00Z",
        usage: null,
      },
    ],
    relationships: [],
    issues: [],
  };

  const result = joinWorkItemEvidence(item, evidence);

  assert.deepEqual(result.estimate_semantics.map((semantic) => semantic.temporal_status), [
    "verified",
    "verified",
    "verified",
  ]);
});

test("joinWorkItemEvidence keeps execution timing unknown when no attempt boundary exists", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-unknown",
    work_item_id: "work-timing-unknown",
    scope: { revision: "scope-1", description: "Unknown timing bounds" },
    acceptance_criteria: ["Missing execution bounds remain explicit"],
    outcome: { status: "planned" },
    attempts: [],
    estimates: [
      {
        estimate_id: "estimate-timing-unknown",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "during_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-unknown",
    sources: [],
    observations: [],
    relationships: [],
    issues: [],
  };

  const result = joinWorkItemEvidence(item, evidence);

  assert.equal(result.estimate_semantics[0]?.temporal_status, "unknown");
});

test("joinWorkItemEvidence rejects pre-execution timing disproved by a linked observation timestamp", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-observation-contradiction",
    work_item_id: "work-timing-observation-contradiction",
    scope: { revision: "scope-1", description: "Observation timing contradiction" },
    acceptance_criteria: ["A pre-execution estimate predates linked execution evidence"],
    outcome: { status: "accepted" },
    attempts: [
      {
        attempt_id: "attempt-timing-observation-contradiction",
        status: "accepted",
        observation_ids: ["observation-timing-observation-contradiction"],
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-timing-observation-contradiction",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T12:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-timing-observation-contradiction",
    sources: [
      {
        id: "source-timing-observation-contradiction",
        harness: "codex",
        format: "fixture",
        coverage: "complete",
      },
    ],
    observations: [
      {
        id: "observation-timing-observation-contradiction",
        source_refs: [{ source_id: "source-timing-observation-contradiction", record: "record-1" }],
        kind: "activity",
        operation: "review",
        status: "ok",
        accounting_scope: "unknown",
        work_item_id: "work-timing-observation-contradiction",
        timestamp: "2026-09-06T10:00:00Z",
        usage: null,
      },
    ],
    relationships: [],
    issues: [],
  };

  assert.throws(
    () => joinWorkItemEvidence(item, evidence),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION",
  );
});

test("joinWorkItemEvidence retains observations, coverage, valuation, and estimate timing", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-join",
    work_item_id: "work-join",
    scope: {
      revision: "scope-1",
      description: "Join a work item to evidence",
    },
    acceptance_criteria: ["The joined row retains its evidence"],
    outcome: {
      status: "accepted",
      recorded_at: "2026-09-06T12:00:00Z",
    },
    attempts: [
      {
        attempt_id: "attempt-join",
        status: "accepted",
        observation_ids: ["obs-join", "activity-join"],
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-join-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: {
          scale_id: "local-scale",
          scale_version: "v1",
          kind: "decimal",
          value: "2.5",
        },
      },
      {
        estimate_id: "estimate-join-2",
        estimate_version: 2,
        scope_revision: "scope-1",
        created_at: "2026-09-06T11:00:00Z",
        timing: "post_execution",
        information_basis: "repository_inspection",
        estimator: "human",
        point_estimate: {
          scale_id: "local-scale",
          scale_version: "v1",
          kind: "ordinal",
          value: "M",
        },
        supersedes_estimate_id: "estimate-join-1",
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-join",
    sources: [
      {
        id: "source-join",
        harness: "codex",
        format: "fixture",
        coverage: "partial",
      },
    ],
    observations: [
      {
        id: "obs-join",
        source_refs: [{ source_id: "source-join", record: "record-1" }],
        kind: "model",
        operation: "response",
        status: "ok",
        accounting_scope: "direct",
        work_item_id: "work-join",
        usage: {
          input_tokens: "10",
          output_tokens: "4",
          cache_read_input_tokens: "0",
          cache_write_input_tokens: "0",
          reasoning_output_tokens: "0",
        },
      },
      {
        id: "activity-join",
        source_refs: [{ source_id: "source-join", record: "record-2" }],
        kind: "activity",
        operation: "review",
        status: "ok",
        accounting_scope: "unknown",
        work_item_id: "work-join",
        usage: null,
      },
    ],
    relationships: [],
    issues: [
      {
        code: "PARTIAL_SOURCE",
        message: "fixture coverage is partial",
        severity: "warning",
        source_id: "source-join",
      },
    ],
  };
  const valuation: Valuation = {
    schema_version: "0.1.0",
    id: "valuation-join",
    dataset_id: "dataset-join",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "enterprise_scenario",
    rate_card_id: "rate-card-join",
    assumptions: ["fixture rate"],
    observations: [
      {
        observation_id: "obs-join",
        amount_nanos: "125000000",
        basis: "enterprise_scenario",
        rate_rule_id: "rule-join",
      },
    ],
    total_nanos: "125000000",
    complete: false,
    issues: [],
  };

  const result = joinWorkItemEvidence(item, evidence, valuation);

  assert.equal(result.dataset_id, "dataset-join");
  assert.deepEqual(result.observation_ids, ["obs-join", "activity-join"]);
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.coverage.source_ids, ["source-join"]);
  assert.deepEqual(result.coverage.source_coverage, [{ id: "source-join", coverage: "partial" }]);
  assert.equal(result.coverage.issues[0]?.code, "PARTIAL_SOURCE");
  assert.equal(result.valuation?.total_nanos, "125000000");
  assert.deepEqual(result.valuation?.observations.map((line) => line.observation_id), ["obs-join"]);
  assert.equal(result.valuation?.complete, false);
  assert.equal(result.valuation?.issues[0]?.code, "WORK_ITEM_VALUATION_LINE_MISSING");
  assert.deepEqual(result.dataset_valuation, valuation);
  assert.deepEqual(result.work_item.estimates[0], item.estimates[0]);
  assert.deepEqual(result.estimate_semantics, [
    {
      estimate_id: "estimate-join-1",
      timing: "pre_execution",
      interpretation: "pre_execution_estimate",
      temporal_status: "unknown",
    },
    {
      estimate_id: "estimate-join-2",
      timing: "post_execution",
      interpretation: "post_execution_retrospective",
      temporal_status: "unknown",
    },
  ]);
});

test("joinWorkItemEvidence guards dataset and observation mismatches while preserving capped outcomes", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-errors",
    work_item_id: "work-errors",
    scope: {
      revision: "scope-1",
      description: "Exercise incomplete outcomes",
    },
    acceptance_criteria: ["An incomplete outcome remains visible"],
    outcome: {
      status: "capped",
    },
    attempts: [
      {
        attempt_id: "attempt-capped",
        status: "interrupted",
        observation_ids: [],
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-errors-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated scale is available",
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-errors",
    sources: [],
    observations: [],
    relationships: [],
    issues: [],
  };

  const validated = validateWorkItem(item);
  assert.equal(validated.outcome.status, "capped");
  assert.equal(validated.attempts[0]?.status, "interrupted");
  assert.deepEqual(joinWorkItemEvidence(item, evidence).observation_ids, []);

  const missingObservationItem = {
    ...item,
    attempts: [{ ...item.attempts[0], observation_ids: ["missing-observation"] }],
  };
  assert.throws(
    () => joinWorkItemEvidence(missingObservationItem, evidence),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_OBSERVATION_MISSING",
  );

  assert.throws(
    () => joinWorkItemEvidence(item, { ...evidence, dataset_id: "other-dataset" }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_DATASET_MISMATCH",
  );

  const valuation: Valuation = {
    schema_version: "0.1.0",
    id: "valuation-errors",
    dataset_id: "other-dataset",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "enterprise_scenario",
    assumptions: [],
    observations: [],
    total_nanos: "0",
    complete: false,
    issues: [],
  };
  assert.throws(
    () => joinWorkItemEvidence(item, evidence, valuation),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "WORK_ITEM_VALUATION_DATASET_MISMATCH",
  );
});

test("the research example validates without inventing Context Points", () => {
  const input = JSON.parse(
    readFileSync(new URL("../examples/work-items/research.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  const result = validateWorkItem(input);

  assert.equal(result.estimates[0]?.point_estimate, null);
  assert.match(result.estimates[0]?.unestimated_reason ?? "", /calibrated/i);
});

test("joinWorkItemEvidence scopes a dataset valuation to each Work Item", () => {
  const itemFor = (workItemId: string, observationId: string) => ({
    schema_version: "0.1.0",
    dataset_id: "dataset-shared",
    work_item_id: workItemId,
    scope: {
      revision: "scope-1",
      description: `Work for ${workItemId}`,
    },
    acceptance_criteria: ["The selected cost remains attributable"],
    outcome: { status: "accepted" },
    attempts: [
      {
        attempt_id: `${workItemId}-attempt`,
        status: "accepted",
        observation_ids: [observationId],
      },
    ],
    estimates: [
      {
        estimate_id: `${workItemId}-estimate-1`,
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
    ],
  });
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-shared",
    sources: [
      {
        id: "source-shared",
        harness: "codex",
        format: "fixture",
        coverage: "complete",
      },
    ],
    observations: [
      {
        id: "observation-a",
        source_refs: [{ source_id: "source-shared", record: "a" }],
        kind: "model",
        operation: "response",
        status: "ok",
        accounting_scope: "direct",
        work_item_id: "work-a",
        usage: null,
      },
      {
        id: "observation-b",
        source_refs: [{ source_id: "source-shared", record: "b" }],
        kind: "model",
        operation: "response",
        status: "ok",
        accounting_scope: "direct",
        work_item_id: "work-b",
        usage: null,
      },
    ],
    relationships: [],
    issues: [],
  };
  const valuation: Valuation = {
    schema_version: "0.1.0",
    id: "valuation-shared",
    dataset_id: "dataset-shared",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "enterprise_scenario",
    assumptions: ["fixture rates"],
    observations: [
      {
        observation_id: "observation-a",
        amount_nanos: "125000000",
        basis: "enterprise_scenario",
      },
      {
        observation_id: "observation-b",
        amount_nanos: "75000000",
        basis: "enterprise_scenario",
      },
    ],
    total_nanos: "200000000",
    complete: true,
    issues: [],
  };

  const joinedA = joinWorkItemEvidence(itemFor("work-a", "observation-a"), evidence, valuation);
  const joinedB = joinWorkItemEvidence(itemFor("work-b", "observation-b"), evidence, valuation);

  assert.equal(joinedA.valuation?.total_nanos, "125000000");
  assert.deepEqual(joinedA.valuation?.observations.map((line) => line.observation_id), ["observation-a"]);
  assert.equal(joinedA.dataset_valuation?.total_nanos, "200000000");
  assert.equal(joinedB.valuation?.total_nanos, "75000000");
  assert.deepEqual(joinedB.valuation?.observations.map((line) => line.observation_id), ["observation-b"]);
});

test("joinWorkItemEvidence rejects a schema-valid valuation whose total does not conserve its lines", () => {
  const item = {
    schema_version: "0.1.0",
    dataset_id: "dataset-invalid-valuation",
    work_item_id: "work-invalid-valuation",
    scope: {
      revision: "scope-1",
      description: "Reject a nonconserving valuation",
    },
    acceptance_criteria: ["The valuation must conserve exact lines"],
    outcome: { status: "failed" },
    attempts: [
      {
        attempt_id: "attempt-invalid-valuation",
        status: "failed",
        observation_ids: ["observation-invalid-valuation"],
      },
    ],
    estimates: [
      {
        estimate_id: "estimate-invalid-valuation-1",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-invalid-valuation",
    sources: [
      {
        id: "source-invalid-valuation",
        harness: "codex",
        format: "fixture",
        coverage: "complete",
      },
    ],
    observations: [
      {
        id: "observation-invalid-valuation",
        source_refs: [{ source_id: "source-invalid-valuation", record: "record-1" }],
        kind: "model",
        operation: "response",
        status: "error",
        accounting_scope: "direct",
        work_item_id: "work-invalid-valuation",
        usage: null,
      },
    ],
    relationships: [],
    issues: [],
  };
  const invalidValuation: Valuation = {
    schema_version: "0.1.0",
    id: "valuation-invalid-valuation",
    dataset_id: "dataset-invalid-valuation",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "enterprise_scenario",
    assumptions: [],
    observations: [
      {
        observation_id: "observation-invalid-valuation",
        amount_nanos: "125000000",
        basis: "enterprise_scenario",
      },
    ],
    total_nanos: "999",
    complete: true,
    issues: [],
  };

  assert.throws(
    () => joinWorkItemEvidence(item, evidence, invalidValuation),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VALUATION_TOTAL_MISMATCH",
  );
});

test("validateValuation enforces unique lines, basis consistency, issue references, and completeness", () => {
  const base: Valuation = {
    schema_version: "0.1.0",
    id: "valuation-semantic",
    dataset_id: "dataset-semantic",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "enterprise_scenario",
    assumptions: ["fixed test rate"],
    observations: [
      {
        observation_id: "observation-semantic",
        amount_nanos: "42",
        basis: "enterprise_scenario",
      },
    ],
    total_nanos: "42",
    complete: true,
    issues: [],
  };

  assert.deepEqual(validateValuation(base), base);
  assert.throws(
    () =>
      validateValuation({
        ...base,
        observations: [...base.observations, { ...base.observations[0] }],
        total_nanos: "84",
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VALUATION_OBSERVATION_DUPLICATE",
  );
  assert.throws(
    () =>
      validateValuation({
        ...base,
        complete: true,
        issues: [{ code: "MISSING", message: "warning", severity: "warning" }],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VALUATION_COMPLETENESS_INVALID",
  );
  assert.throws(
    () =>
      validateValuation({
        ...base,
        issues: [{ code: "MISSING", message: "bad reference", severity: "warning", observation_id: "absent" }],
        complete: false,
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VALUATION_ISSUE_REFERENCE_MISSING",
  );
  assert.throws(
    () => validateValuation({ ...base, basis: "mixed" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "VALUATION_BASIS_MISMATCH",
  );
});

test("selected valuation IDs preserve replay identity for distinct Unicode-equivalent identifiers", () => {
  const evidence: EvidenceBundle = JSON.parse(
    readFileSync(new URL("../examples/golden/evidence.json", import.meta.url), "utf8"),
  );
  const item = validateWorkItem(JSON.parse(
    readFileSync(new URL("../examples/work-items/golden.json", import.meta.url), "utf8"),
  ));
  const ids = ["é", "e\u0301"];
  evidence.observations.forEach((observation, index) => { observation.id = ids[index]!; });
  item.attempts[0]!.observation_ids = ids;
  const valuation = valueEvidence(evidence, { mode: "recorded" });
  valuation.issues = ids.map((observation_id) => ({
    code: "REPLAY_NOTE", message: "Observation retained", severity: "info", observation_id,
  }));
  const original = joinWorkItemEvidence(item, evidence, valuation).valuation!;

  valuation.observations.reverse();
  const reorderedLines = joinWorkItemEvidence(item, evidence, valuation).valuation!;
  assert.equal(reorderedLines.id, original.id);

  valuation.issues.reverse();
  const reorderedIssues = joinWorkItemEvidence(item, evidence, valuation).valuation!;
  assert.equal(reorderedIssues.id, original.id);
  assert.equal(reorderedIssues.observations.length, 2);
});

test("selected valuation IDs distinguish subsets and ignore replay ordering", () => {
  const itemFor = (observation_ids: string[]) => ({
    schema_version: "0.1.0",
    dataset_id: "dataset-valuation-id",
    work_item_id: "ticket-7",
    scope: { revision: "scope-1", description: "Selected valuation identity" },
    acceptance_criteria: ["Selected valuation identities remain stable"],
    outcome: { status: "accepted" },
    attempts: [{ attempt_id: "attempt-ticket-7", status: "accepted", observation_ids }],
    estimates: [
      {
        estimate_id: "estimate-ticket-7",
        estimate_version: 1,
        scope_revision: "scope-1",
        created_at: "2026-09-06T09:00:00Z",
        timing: "pre_execution",
        information_basis: "specification_only",
        estimator: "human",
        point_estimate: null,
        unestimated_reason: "No calibrated point scale is available",
      },
    ],
  });
  const evidence: EvidenceBundle = {
    schema_version: "0.1.0",
    dataset_id: "dataset-valuation-id",
    sources: [{ id: "source-valuation-id", harness: "codex", format: "fixture", coverage: "complete" }],
    observations: [
      {
        id: "example-call-a",
        source_refs: [{ source_id: "source-valuation-id", record: "a" }],
        kind: "model",
        operation: "response",
        status: "ok",
        accounting_scope: "direct",
        usage: null,
      },
      {
        id: "example-call-b",
        source_refs: [{ source_id: "source-valuation-id", record: "b" }],
        kind: "model",
        operation: "response",
        status: "ok",
        accounting_scope: "direct",
        usage: null,
      },
    ],
    relationships: [],
    issues: [],
  };
  const valuation: Valuation = {
    schema_version: "0.1.0",
    id: "valuation-ticket-7",
    dataset_id: "dataset-valuation-id",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "enterprise_scenario",
    assumptions: ["fixed test rate"],
    observations: [
      { observation_id: "example-call-a", amount_nanos: "125000000", basis: "enterprise_scenario" },
      { observation_id: "example-call-b", amount_nanos: "75000000", basis: "enterprise_scenario" },
    ],
    total_nanos: "200000000",
    complete: true,
    issues: [],
  };

  const one = joinWorkItemEvidence(itemFor(["example-call-a"]), evidence, valuation);
  const both = joinWorkItemEvidence(itemFor(["example-call-a", "example-call-b"]), evidence, valuation);
  const bothReplayed = joinWorkItemEvidence(itemFor(["example-call-b", "example-call-a"]), evidence, valuation);

  assert.notEqual(one.valuation?.id, both.valuation?.id);
  assert.equal(both.valuation?.id, bothReplayed.valuation?.id);
  assert.match(both.valuation?.id ?? "", /^valuation-ticket-7\/work-item\/ticket-7\//);
});
