# Core and native adapter repair verification

Verification scope: the eight confirmed findings in `docs/reviews/core-adapters-review.md`, plus the related reciprocal-context and known-cache-subset core corrections. This pass reran the original synthetic cases and every checked-in adapter fixture against the current implementation. No production source was changed during verification.

## Result

All reviewed corrections are verified. I found no residual regression in the repaired core or adapter paths.

| Original finding | Verification result |
| --- | --- |
| Dangling native `parent_id` values | **Fixed.** Every emitted `parent_id` in the checked fixtures resolves to an observation in the same bundle. OTLP/Copilot parent spans resolve to normalized observation IDs. Unresolved native Pi, OMP, Gemini, and OpenCode ancestry remains hashed in attributes and produces an explicit `lineage_parent_unresolved` issue instead of a dangling reference. |
| Missing exclusive token buckets treated as zero | **Fixed.** Pi legacy, Pi v4, OMP, and Claude missing-input fixtures retain `input_tokens: null`; the OpenCode missing-output fixture retains `output_tokens: null`. Rate-card valuation returns `amount_nanos: null` for every affected direct observation. |
| OTLP epoch nanoseconds copied into RFC3339 fields | **Fixed.** The exact reproduction now emits `1970-01-01T00:00:01.000000123Z` and `1970-01-01T00:00:02.000000456Z`, and the resulting bundle passes `validateEvidence`. |
| Conflicting native identities silently discarded | **Fixed.** Conflicting OMP, OpenCode, and Pi v4 duplicate identities are counted once and each emits an error-severity `conflicting_duplicate_usage` issue. The retained first payload remains deterministic. |
| Recognized model calls without usage disappear | **Fixed.** The original Gemini assistant record and an OpenCode `step-finish` without tokens each produce one direct observation with `usage: null` and a row-specific `missing_usage` warning. |
| OTLP `service.name` overrides GenAI provider | **Fixed.** With resource `service.name: frontend` and `gen_ai.system: openai`, the normalized provider is `openai`; the service name is retained separately as `flAImegraph.otel.service_name`. The local OTLP binding also round-trips provider and usage fields and remains rateable. |
| Non-hierarchical relationship cycles rejected | **Fixed.** Reciprocal `context_from` links validate, while parent cycles still fail with `RELATIONSHIP_CYCLE`. Hierarchical cycle detection now follows only `parent_id` and `kind: parent` edges. |
| Numeric native costs become invalid/inexact strings | **Fixed with explicit provenance.** The original `1e-7` JSON-number cost becomes schema-valid `0.0000001`, carries a `numeric_cost_precision` warning, and passes `validateEvidence`. Recorded valuation therefore cannot claim completeness from that uncertain source precision. |

The adjacent cache-subset correction is also verified: an inclusive input total of 10 with known cache-read 11 and unavailable cache-write fails with `SUBSET_OVERFLOW`. An unavailable sibling subset no longer suppresses validation of the known overflowing subset.

## Fixture matrix

All 15 files under `test/fixtures/adapters` completed both `validateEvidence` and recorded `valueEvidence` without throwing:

```text
claude-missing-input.jsonl       PASS
claude.jsonl                     PASS
codex-additive.jsonl             PASS
copilot-otel.json                PASS
gemini.jsonl                     PASS
omp-missing-input.jsonl          PASS
omp.jsonl                        PASS
opencode-missing-output.jsonl    PASS
opencode.jsonl                   PASS
otel-roundtrip.json              PASS
otel.json                        PASS
pi-legacy-missing-input.jsonl    PASS
pi-legacy.jsonl                  PASS
pi-v4-missing-input.jsonl        PASS
pi-v4.jsonl                      PASS
```

The normal incomplete/partial fixtures still produce `complete: false`; successful valuation here means the artifact entered the valuation seam and preserved known subtotals and unknown amounts without an exception.

## Automated verification

```text
node --import tsx --test test/core.test.ts test/valuation.test.ts test/adapters.test.ts
33 tests passed

npm run typecheck
passed

npm test
80 tests passed
```

The full suite was green in the final concurrent workspace state, including the adapter invariants, core relationship/subset tests, downstream valuation, profiles, renderer, CLI, and work-item joins.
