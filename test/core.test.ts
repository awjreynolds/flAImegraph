import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileEvidence,
  validateEvidence,
  type CoreError,
} from "../src/core.js";
import type { EvidenceBundle, Observation } from "../src/types.js";

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    source_refs: [{ source_id: "source-1", record: "row-1" }],
    kind: "model",
    operation: "responses.create",
    status: "ok",
    accounting_scope: "direct",
    timestamp: "2026-09-06T10:00:00Z",
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

function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
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
    observations: [observation()],
    relationships: [],
    issues: [],
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

test("validateEvidence accepts a complete normalized bundle and preserves quantities", () => {
  const input = bundle();
  const validated = validateEvidence(input);

  assert.deepEqual(validated, input);
  assert.notStrictEqual(validated, input);
  assert.equal(validated.observations[0]?.usage?.input_tokens, "100");
});

test("validateEvidence rejects a cache or reasoning subset that exceeds its inclusive total", () => {
  const invalid = bundle({
    observations: [
      observation({
        usage: {
          input_tokens: "10",
          output_tokens: "40",
          cache_read_input_tokens: "11",
          cache_write_input_tokens: "0",
          reasoning_output_tokens: "41",
          unclassified_tokens: "0",
        },
      }),
    ],
  });

  assert.equal(codeOf(() => validateEvidence(invalid)), "SUBSET_OVERFLOW");
});

test("reconcileEvidence deduplicates equal observations and unions source references", () => {
  const first = bundle();
  const second = bundle({
    sources: [
      ...first.sources,
      {
        id: "source-2",
        harness: "fixture",
        format: "json",
        coverage: "complete",
      },
    ],
    observations: [
      observation({
        source_refs: [
          { source_id: "source-2", record: "row-1" },
          { source_id: "source-1", record: "row-1" },
        ],
      }),
    ],
  });

  const result = reconcileEvidence([first, second]);

  assert.equal(result.observations.length, 1);
  assert.deepEqual(result.observations[0]?.source_refs, [
    { source_id: "source-1", record: "row-1" },
    { source_id: "source-2", record: "row-1" },
  ]);
  assert.equal(result.sources.length, 2);
});

test("reconcileEvidence fails closed when an identity has conflicting payloads", () => {
  const conflicting = bundle({
    observations: [observation({ usage: { ...observation().usage!, input_tokens: "101" } })],
  });

  assert.equal(codeOf(() => reconcileEvidence([bundle(), conflicting])), "OBSERVATION_CONFLICT");
});

test("validateEvidence rejects malformed parent cycles and dangling references", () => {
  const first = observation({ id: "obs-1" });
  const second = observation({
    id: "obs-2",
    source_refs: [{ source_id: "source-1", record: "row-2" }],
    parent_id: "obs-1",
  });
  const cyclic = bundle({
    observations: [
      { ...first, parent_id: "obs-2" },
      second,
    ],
    relationships: [
      { from: "obs-1", to: "obs-2", kind: "parent" },
      { from: "obs-2", to: "missing", kind: "parent" },
    ],
  });

  assert.equal(codeOf(() => validateEvidence(cyclic)), "REFERENCE_MISSING");

  const cycle = bundle({
    observations: [
      { ...first, parent_id: "obs-2" },
      second,
    ],
    relationships: [
      { from: "obs-1", to: "obs-2", kind: "parent" },
      { from: "obs-2", to: "obs-1", kind: "parent" },
    ],
  });
  assert.equal(codeOf(() => validateEvidence(cycle)), "RELATIONSHIP_CYCLE");
});

test("evidential context links may be reciprocal without creating cyclic execution ancestry", () => {
  const input = bundle({
    observations: [observation(), observation({ id: "obs-2" })],
    relationships: [
      { from: "obs-1", to: "obs-2", kind: "context_from" },
      { from: "obs-2", to: "obs-1", kind: "context_from" },
    ],
  });
  assert.deepEqual(validateEvidence(input).relationships, input.relationships);
});

test("a known cache subset cannot exceed total input when the other cache subset is unavailable", () => {
  const input = bundle({ observations: [observation({ usage: {
    ...observation().usage!, input_tokens: "10", cache_read_input_tokens: "11", cache_write_input_tokens: null,
  } })] });
  assert.equal(codeOf(() => validateEvidence(input)), "SUBSET_OVERFLOW");
});
