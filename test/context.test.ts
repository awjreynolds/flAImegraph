import assert from "node:assert/strict";
import test from "node:test";

import { reconcileContextBundles, validateContextBundle, validateHarnessProfile } from "../src/context.js";
import type { ContextBundle, HarnessProfile } from "../src/context-types.js";
import type { EvidenceBundle } from "../src/types.js";

function source(id: string, record = "manifest"): { source_id: string; record: string } {
  return { source_id: id, record };
}

function profile(): HarnessProfile {
  return {
    schema_version: "0.2.0",
    id: "profile-codex-v1",
    name: "Codex local profile",
    harness: "codex",
    harness_version: { value: "1.2.3", evidence: "declared", source_refs: [source("profile-config", "version")] },
    profile_version: "2026-09-06",
    model: {
      provider: { value: "openai", evidence: "declared", source_refs: [source("profile-config", "provider")] },
      name: { value: "gpt-test", evidence: "declared", source_refs: [source("profile-config", "model")] },
      settings: {
        temperature: { value: "0", evidence: "declared", source_refs: [source("profile-config")] },
      },
    },
    instruction_sources: [
      {
        origin: "system_instruction",
        label: "system",
        delivery: "always",
        evidence: "declared",
        source_refs: [source("profile-config", "system")],
      },
    ],
    tools: [
      {
        id: "tool-shell",
        name: "shell",
        definition_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        definition_evidence: "declared",
        definition_method: "producer-declared digest",
        evidence: "declared",
        source_refs: [source("profile-config", "tool-shell")],
      },
    ],
    policies: {
      assembly: { value: "ordered", evidence: "declared", source_refs: [source("profile-config", "assembly")] },
      truncation: { value: null, evidence: "unknown", source_refs: [] },
      compaction: { value: "disabled", evidence: "declared", source_refs: [source("profile-config", "compaction")] },
      caching: { value: null, evidence: "unknown", source_refs: [] },
    },
    context_capabilities: [
      {
        origin: "user_prompt",
        capture: "direct",
        evidence: "declared",
        source_refs: [source("profile-config", "capability")],
        note: "Final request capture is available",
      },
    ],
    artifacts: [
      { id: "profile-config", harness: "codex", format: "json", coverage: "complete" },
    ],
  };
}

function measurement(value: string, unit: "tokens" | "utf8_bytes", record: string) {
  return {
    value,
    unit,
    evidence: "observed" as const,
    method: "provider capture",
    source_refs: [source("capture", record)],
  };
}

function bundle(): ContextBundle {
  return {
    schema_version: "0.2.0",
    dataset_id: "dataset-context",
    evidence_schema_version: "0.1.0",
    artifacts: [{ id: "capture", harness: "codex", format: "json", coverage: "complete" }],
    profiles: [profile()],
    sources: [
      {
        id: "context-user",
        origin: "user_prompt",
        origin_evidence: "observed",
        label: "user request",
        identity_basis: "producer",
        source_refs: [source("capture", "sources[0]")],
      },
    ],
    revisions: [
      {
        id: "revision-user-1",
        source_id: "context-user",
        representation: "original",
        media: "text",
        content_sha256: null,
        fingerprint_evidence: "unknown",
        fingerprint_method: null,
        tokens: measurement("3", "tokens", "revisions[0].tokens"),
        bytes: measurement("12", "utf8_bytes", "revisions[0].bytes"),
        source_refs: [source("capture", "revisions[0]")],
      },
    ],
    requests: [
      {
        id: "request-1",
        observation_id: null,
        profile_id: "profile-codex-v1",
        captured_at: "2026-09-06T10:00:00Z",
        boundary: "client_request",
        coverage: "complete",
        coverage_evidence: "observed",
        occurrences: [
          {
            id: "occurrence-user-1",
            revision_id: "revision-user-1",
            role: "user",
            placement: "current_turn",
            treatment: {
              value: "fresh",
              evidence: "observed",
              method: "provider capture",
              source_refs: [source("capture", "occurrences[0]")],
            },
          },
        ],
        overrides: {},
        source_refs: [source("capture", "requests[0]")],
      },
    ],
    transformations: [],
    issues: [],
  };
}

function evidenceFor(dataset_id = "dataset-context", kind: "model" | "tool" = "model"): EvidenceBundle {
  return {
    schema_version: "0.1.0",
    dataset_id,
    sources: [{ id: "evidence-source", harness: "codex", format: "json", coverage: "complete" }],
    observations: [
      {
        id: "observation-model-1",
        source_refs: [{ source_id: "evidence-source", record: "observations[0]" }],
        kind,
        operation: kind === "model" ? "response" : "shell",
        status: "ok",
        accounting_scope: "direct",
        usage: null,
      },
    ],
    relationships: [],
    issues: [],
  };
}

test("validateHarnessProfile accepts a strict versioned profile and returns a detached value", () => {
  const input = profile();

  const result = validateHarnessProfile(input);

  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input);
  assert.notStrictEqual(result.model.settings, input.model.settings);
});

test("validateContextBundle accepts a detached context manifest with explicit measurements and provenance", () => {
  const input = bundle();

  const result = validateContextBundle(input);

  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input);
  assert.notStrictEqual(result.revisions[0]?.tokens, input.revisions[0]?.tokens);
  assert.equal(result.revisions[0]?.tokens.value, "3");
});

test("context validation rejects unresolved refs, wrong measurement units, and unavailable zeroes", () => {
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error: unknown) {
      return error instanceof Error && "code" in error ? String(error.code) : undefined;
    }
  };

  assert.equal(
    codeOf(() =>
      validateContextBundle({
        ...bundle(),
        sources: [{ ...bundle().sources[0]!, source_refs: [source("missing-artifact")] }],
      }),
    ),
    "CONTEXT_ARTIFACT_REFERENCE_MISSING",
  );
  assert.equal(
    codeOf(() =>
      validateContextBundle({
        ...bundle(),
        revisions: [
          {
            ...bundle().revisions[0]!,
            tokens: { ...bundle().revisions[0]!.tokens, unit: "utf8_bytes" },
          },
        ],
      }),
    ),
    "CONTEXT_MEASUREMENT_UNIT_MISMATCH",
  );
  assert.equal(
    codeOf(() =>
      validateContextBundle({
        ...bundle(),
        revisions: [
          {
            ...bundle().revisions[0]!,
            tokens: { ...bundle().revisions[0]!.tokens, value: "0", evidence: "unavailable", source_refs: [] },
          },
        ],
      }),
    ),
    "CONTEXT_MEASUREMENT_UNKNOWN_INCOHERENT",
  );
});

test("profile observed facts require provenance while declared facts may be unreferenced", () => {
  const input = profile();
  assert.throws(
    () =>
      validateHarnessProfile({
        ...input,
        model: {
          ...input.model,
          provider: { value: "openai", evidence: "observed", source_refs: [] },
        },
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_PROVENANCE_MISSING",
  );
  const result = validateHarnessProfile({
    ...input,
    model: {
      ...input.model,
      provider: { value: "openai", evidence: "declared", source_refs: [] },
    },
  });
  assert.equal(result.model.provider.value, "openai");
});

test("context fingerprints and treatments preserve explicit unknown states", () => {
  const input = bundle();
  const knownFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        revisions: [
          {
            ...input.revisions[0]!,
            content_sha256: knownFingerprint,
            fingerprint_evidence: "unknown",
            fingerprint_method: null,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "CONTEXT_FINGERPRINT_UNKNOWN_INCOHERENT",
  );
  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        requests: [
          {
            ...input.requests[0]!,
            occurrences: [
              {
                ...input.requests[0]!.occurrences[0]!,
                treatment: {
                  ...input.requests[0]!.occurrences[0]!.treatment,
                  value: "unknown",
                  evidence: "declared",
                },
              },
            ],
          },
        ],
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_UNKNOWN_INCOHERENT",
  );
});

test("context source identity basis is backed by the corresponding provenance or fingerprint", () => {
  const input = bundle();
  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        sources: [{ ...input.sources[0]!, identity_basis: "producer", source_refs: [] }],
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_PROVENANCE_MISSING",
  );
  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        sources: [{ ...input.sources[0]!, identity_basis: "content_fingerprint" }],
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "CONTEXT_FINGERPRINT_REFERENCE_MISSING",
  );
});

test("tool and output schemas are origins while representation remains independent", () => {
  const input = bundle();
  const outputSchema = {
    ...input,
    sources: [{ ...input.sources[0]!, origin: "output_schema" as const }],
    revisions: [{ ...input.revisions[0]!, media: "structured" as const, representation: "original" as const }],
  };
  assert.equal(validateContextBundle(outputSchema).sources[0]?.origin, "output_schema");
  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        revisions: [{ ...input.revisions[0]!, representation: "tool_schema" }],
      }),
    /CONTEXT_BUNDLE_SCHEMA_INVALID/,
  );
});

test("request overrides can cite the union of bundle and embedded profile artifacts", () => {
  const input = bundle();
  const result = validateContextBundle({
    ...input,
    requests: [
      {
        ...input.requests[0]!,
        overrides: {
          model_temperature: {
            value: "0",
            evidence: "declared",
            source_refs: [source("profile-config", "overrides.temperature")],
          },
        },
      },
    ],
  });

  assert.equal(result.requests[0]?.overrides.model_temperature?.value, "0");
});

test("embedded profile provenance resolves against the bundle artifact union while standalone profiles stay portable", () => {
  const input = bundle();
  const embedded = {
    ...input,
    profiles: [
      {
        ...input.profiles[0]!,
        model: {
          ...input.profiles[0]!.model,
          provider: { value: "openai", evidence: "declared" as const, source_refs: [source("capture", "profile.provider")] },
        },
      },
    ],
  };

  const result = validateContextBundle(embedded);
  assert.deepEqual(result.profiles[0]?.model.provider.source_refs, [source("capture", "profile.provider")]);
  assert.throws(
    () => validateHarnessProfile(embedded.profiles[0]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_ARTIFACT_REFERENCE_MISSING",
  );
});

test("request observation links require the matching dataset and a model observation when evidence is supplied", () => {
  const input = bundle();
  const linked = {
    ...input,
    requests: [{ ...input.requests[0]!, observation_id: "observation-model-1" }],
  };
  const result = validateContextBundle(linked, evidenceFor());
  assert.equal(result.requests[0]?.observation_id, "observation-model-1");

  assert.throws(
    () => validateContextBundle(linked, evidenceFor("other-dataset")),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_EVIDENCE_DATASET_MISMATCH",
  );
  assert.throws(
    () => validateContextBundle(linked, evidenceFor("dataset-context", "tool")),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_OBSERVATION_NOT_MODEL",
  );
  assert.equal(
    validateContextBundle({ ...input, requests: [{ ...input.requests[0]!, observation_id: "prepared-observation" }] }).requests[0]
      ?.observation_id,
    "prepared-observation",
  );
});

test("context provenance never falls back to an EvidenceBundle source registry", () => {
  const input = bundle();
  const contextOnlyMissing = {
    ...input,
    artifacts: [],
    sources: [{ ...input.sources[0]!, source_refs: [source("evidence-source", "record")] }],
  };
  assert.throws(
    () => validateContextBundle(contextOnlyMissing, evidenceFor()),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_ARTIFACT_REFERENCE_MISSING",
  );
});

test("multiple named boundary requests may retain the same observed model link", () => {
  const input = bundle();
  const first = { ...input.requests[0]!, id: "request-client", observation_id: "observation-model-1", boundary: "client_request" as const };
  const second = {
    ...input.requests[0]!,
    id: "request-harness",
    observation_id: "observation-model-1",
    boundary: "harness_context" as const,
    occurrences: [{ ...input.requests[0]!.occurrences[0]!, id: "occurrence-user-harness" }],
  };

  const result = validateContextBundle({ ...input, requests: [first, second] }, evidenceFor());

  assert.deepEqual(result.requests.map((request) => request.observation_id), ["observation-model-1", "observation-model-1"]);
});

test("complete coverage is restricted to final request or assembled harness boundaries", () => {
  const input = bundle();
  for (const boundary of ["transcript_reconstruction", "unavailable"] as const) {
    assert.throws(
      () =>
        validateContextBundle({
          ...input,
          requests: [{ ...input.requests[0]!, boundary }],
        }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_COMPLETENESS_INVALID",
    );
  }
  const partial = validateContextBundle({
    ...input,
    requests: [{ ...input.requests[0]!, boundary: "transcript_reconstruction", coverage: "partial", coverage_evidence: "declared" }],
  });
  assert.equal(partial.requests[0]?.coverage, "partial");
  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        requests: [{ ...input.requests[0]!, boundary: "unavailable", coverage: "unknown", coverage_evidence: "unknown" }],
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_UNAVAILABLE_OCCURRENCES",
  );
});

test("transformations resolve revisions and reject lineage cycles without inventing attribution", () => {
  const input = bundle();
  const revision = {
    ...input.revisions[0]!,
    id: "revision-user-2",
    representation: "summary" as const,
    fingerprint_evidence: "declared" as const,
    fingerprint_method: "producer digest",
    content_sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  };
  const transformation = {
    id: "transformation-summary",
    kind: "summarize" as const,
    from_revision_ids: ["revision-user-1"],
    to_revision_ids: ["revision-user-2"],
    evidence: "declared" as const,
    method: "producer manifest",
    observation_id: null,
    source_refs: [source("capture", "transformations[0]")],
  };
  const result = validateContextBundle({ ...input, revisions: [input.revisions[0]!, revision], transformations: [transformation] });
  assert.deepEqual(result.transformations[0]?.from_revision_ids, ["revision-user-1"]);
  assert.deepEqual(result.transformations[0]?.to_revision_ids, ["revision-user-2"]);

  assert.throws(
    () =>
      validateContextBundle({
        ...input,
        revisions: [input.revisions[0]!, revision],
        transformations: [
          transformation,
          { ...transformation, id: "transformation-cycle", from_revision_ids: ["revision-user-2"], to_revision_ids: ["revision-user-1"] },
        ],
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_TRANSFORMATION_CYCLE",
  );
});

test("reconcileContextBundles deduplicates replay, unions provenance, and preserves occurrence order", () => {
  const first = bundle();
  first.requests[0]!.occurrences.push({
    ...first.requests[0]!.occurrences[0]!,
    id: "occurrence-user-2",
    placement: "history",
  });
  const replay = structuredClone(first);
  replay.artifacts.push({ id: "capture-replay", harness: "codex", format: "json", coverage: "complete" });
  replay.sources[0]!.source_refs = [source("capture-replay", "sources[0]")];
  replay.requests[0]!.source_refs = [source("capture-replay", "requests[0]")];

  const result = reconcileContextBundles([first, replay]);
  const reverse = reconcileContextBundles([replay, first]);

  assert.deepEqual(result, reverse);
  assert.equal(result.requests.length, 1);
  assert.deepEqual(result.requests[0]?.occurrences.map((occurrence) => occurrence.id), ["occurrence-user-1", "occurrence-user-2"]);
  assert.deepEqual(result.sources[0]?.source_refs, [
    source("capture", "sources[0]"),
    source("capture-replay", "sources[0]"),
  ]);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.id), ["capture", "capture-replay"]);
});

test("reconcileContextBundles fails on same-ID semantic changes and dataset mismatches", () => {
  const input = bundle();
  const changedRevision = structuredClone(input);
  changedRevision.revisions[0]!.tokens.value = "4";
  assert.throws(
    () => reconcileContextBundles([input, changedRevision]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_ID_CONFLICT",
  );

  const changedProfile = structuredClone(input);
  changedProfile.profiles[0]!.name = "Changed profile";
  assert.throws(
    () => reconcileContextBundles([input, changedProfile]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_ID_CONFLICT",
  );

  const changedDataset = structuredClone(input);
  changedDataset.dataset_id = "other-dataset";
  assert.throws(
    () => reconcileContextBundles([input, changedDataset]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTEXT_DATASET_MISMATCH",
  );
});
