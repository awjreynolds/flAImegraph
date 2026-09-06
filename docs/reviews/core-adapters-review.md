# Core and native adapter accounting review

Review scope: `src/core.ts`, `src/adapters/**`, their focused tests, and the experimental 0.1 evidence/valuation contracts. This was a read-only implementation review apart from this report. Reproductions used local synthetic data and checked-in fixtures only; no provider or network calls were made.

## Confirmed findings

### [P1] Native ancestry is emitted as dangling normalized `parent_id` references

`addModelObservation` writes every adapter-supplied `parentId` directly into `Observation.parent_id` (`src/adapters/common.ts:328`). The adapters supply native entry, tool, session, and span IDs rather than normalized observation IDs (for example Pi at `src/adapters/index.ts:633`, OMP at `src/adapters/index.ts:117`, Gemini at `src/adapters/index.ts:313`, OpenCode at `src/adapters/index.ts:365`, and OTLP at `src/adapters/index.ts:524`). The evidence contract requires `parent_id` to resolve to another observation, and says external lineage must remain explicit incomplete coverage rather than a fabricated local reference (`spec/0.1/evidence.md`, Identity).

This makes adapter output unusable by the downstream public seams. Running each checked-in adapter fixture through `validateEvidence(importEvidence(...))` produced:

```text
codex codex-additive.jsonl VALID
pi pi-legacy.jsonl INVALID REFERENCE_MISSING ... references missing parent observation m-0
pi pi-v4.jsonl VALID
omp omp.jsonl INVALID REFERENCE_MISSING ... references missing parent observation root-session
claude claude.jsonl VALID
gemini gemini.jsonl INVALID REFERENCE_MISSING ... references missing parent observation gemini-parent
opencode opencode.jsonl INVALID REFERENCE_MISSING ... references missing parent observation oc-parent
otel otel.json INVALID EVIDENCE_SCHEMA_INVALID ... timestamp ...
copilot copilot-otel.json INVALID REFERENCE_MISSING ... references missing parent observation copilot-agent
```

Consequently `valueEvidence(importEvidence(...))` fails before valuation for representative Pi, OMP, Gemini, OpenCode, and Copilot inputs. Normalize a parent only when the corresponding parent observation exists, using the normalized observation ID. Preserve unresolved native ancestry in namespaced attributes plus a lineage coverage issue. Add an invariant test that every adapter fixture passes `validateEvidence` and at least one downstream valuation path.

### [P1] Missing exclusive token buckets are converted into known zero contributions and priced

`addQuantities` skips `null`/`undefined` inputs (`src/adapters/common.ts:135-143`). Pi then derives inclusive input by adding exclusive fresh input and cache buckets (`src/adapters/index.ts:41-47`); Claude and OMP use the same pattern (`src/adapters/index.ts:58-76`, `160-170`), and OpenCode derives inclusive input and output this way (`src/adapters/index.ts:320-337`). If the native fresh-input or ordinary-output field is absent, the helper sums the remaining subsets and thereby treats the missing bucket as zero. This contradicts the documented adapter rule that missing fields remain `null` (`docs/adapters.md:18`) and the valuation rule that missing quantities leave the total unknown (`spec/0.1/valuation.md`, Rate matching).

Reproduction with a Pi assistant usage row containing `output: 5`, `cacheRead: 3`, `cacheWrite: 0`, and `reasoning: 1`, but no `input`:

```text
normalized usage = {
  "input_tokens":"3",
  "output_tokens":"5",
  "cache_read_input_tokens":"3",
  "cache_write_input_tokens":"0",
  "reasoning_output_tokens":"1"
}
rate-card valuation amount_nanos = "8000000000"
```

The amount should be unavailable because fresh input is unknown. Make exclusive-to-inclusive addition null-propagating for required operands. The same rule applies to OpenCode ordinary output when only reasoning is known. Add missing-bucket fixtures for each exclusive-format adapter and assert `amount_nanos: null` downstream.

### [P1] OTLP nanosecond timestamps are copied into RFC3339 fields

The OTLP importer chooses `startTimeUnixNano` and `endTimeUnixNano` before any textual timestamp and passes them unchanged to `Observation.timestamp`/`end_time` (`src/adapters/index.ts:524`). Those native fields are decimal epoch-nanosecond strings; the evidence schema requires RFC3339 date-times. The checked-in `otel.json` fixture therefore imports successfully in the adapter test but immediately fails `validateEvidence`:

```text
EVIDENCE_SCHEMA_INVALID: /observations/0/timestamp must match RFC3339 pattern;
/observations/0/end_time must match RFC3339 pattern
```

Convert epoch nanoseconds exactly to a UTC RFC3339 representation, retaining sub-millisecond precision if the contract permits it, or omit the normalized time and preserve the native value in attributes with an issue. The adapter test should validate its result, which would have exposed this failure.

### [P1] Conflicting native identities can be discarded without an explicit conflict

OMP tracks only a `Set` of identities and returns immediately for every duplicate (`src/adapters/index.ts:90-95`), without comparing semantic content. OpenCode also drops every later identity and states it was an identical duplicate without checking (`src/adapters/index.ts:345-358`). Pi v4 builds `Map`s of durable rows and entries with unconditional `set`, so later conflicting rows replace earlier ones before conflict checking (`src/adapters/index.ts:579-595`). This violates the evidence identity rule: identical replay can deduplicate, but the same ID with conflicting quantities must be an explicit conflict.

Two OMP assistant records with ID `same`, one with input `1` and the other with input `999`, reproduce the silent loss:

```text
observation count = 1
retained input_tokens = "1"
conflict issues = []
```

Store a canonical semantic signature alongside each identity. Merge exact repeats, and emit an error or fail import on differences. For source formats whose contract establishes streaming revisions, keep the separately documented terminal-update behavior; OMP, OpenCode, and Pi durable ledger rows do not currently declare that exception.

### [P1] Recognized model-call records without usage can disappear entirely

Gemini recognizes a model record only when `usage` is truthy (`src/adapters/index.ts:282-293`). A Gemini assistant/model response with a stable ID and model but no usage is silently omitted; the only issue is the generic `partial_source_coverage` info entry. OpenCode similarly requires `isStep && tokens` (`src/adapters/index.ts:351-368`), so a terminal `step-finish` lacking tokens is not retained as a missing-usage call. The evidence contract requires failed/missing usage to remain distinct from zero, and coverage issues to preserve unknown/unmapped rows.

Reproduction with `{ "type":"message", "id":"g", "role":"assistant", "model":"gemini" }`:

```text
observations = 0
issue codes = ["partial_source_coverage"]
```

Emit a direct model observation with `usage: null` and a row-specific `missing_usage` warning whenever the source record establishes a call identity but lacks usage. Do the same for recognized OpenCode terminal steps. This preserves call count and makes downstream incompleteness attributable.

### [P2] OTLP `service.name` overrides the declared GenAI provider and breaks rate matching

The OTLP importer assigns `provider` from resource `service.name` before looking at `gen_ai.system` or `gen_ai.provider` (`src/adapters/index.ts:512`). `service.name` identifies the emitting application/service, not the model provider. A span from service `frontend` with `gen_ai.system = openai` is normalized with `provider = frontend`; an otherwise matching `provider: openai` rate rule then returns `RATE_UNMATCHED` and no amount.

Use the supported GenAI provider/system attribute as `Observation.provider`. Keep `service.name` in attributes as emitter identity. A resource service name should not shadow an explicit span provider.

### [P2] Core rejects cycles in non-hierarchical relationship kinds

`assertAcyclic` adds `delegates`, `context_from`, and `adjusts` to the ancestry graph along with `parent` (`src/core.ts:325-347`). The specification distinguishes these relationship kinds from execution ancestry and requires rejection of cyclic parentage, not arbitrary evidential or provenance cycles (`spec/0.1/evidence.md`, Identity). A two-node `context_from` cycle currently throws `RELATIONSHIP_CYCLE` even though neither node is the other's execution parent.

Restrict tree-cycle validation to `parent_id` and `kind: "parent"`. If a separate relationship kind needs an acyclicity invariant, specify it explicitly and add conformance cases before enforcing it.

### [P2] Numeric native costs can produce invalid or inexact decimal strings

`recordedCost` accepts any finite JavaScript number and applies `String(amountValue)` (`src/adapters/common.ts:421-431`). Small or large values can become exponent notation, which is forbidden by the evidence decimal schema; values can also have already lost precision during JSON number parsing. For example a native numeric cost of `1e-7` becomes `"1e-7"`, and the adapter returns a bundle that `validateEvidence` rejects.

Accept canonical decimal strings for exact costs. If a native format supplies JSON numbers, either constrain conversion to values whose canonical non-exponent decimal representation is demonstrably safe, or retain the monetary value as unavailable with an explicit precision/format issue. Adapter results should be schema-validated in tests.

## Verification and limitations

The focused suite passed:

```text
node --import tsx --test test/core.test.ts test/valuation.test.ts test/adapters.test.ts
23 tests passed
```

The full `npm test` run had 42 passes and one unrelated CLI failure: `CLI renders the standard interactive flame graph with exact dollar tooltips` failed because `render` was reported as an unknown command. I did not investigate that out-of-scope CLI issue.

The exact BigInt component arithmetic, one-round-per-observation HALF_EVEN behavior, direct-only exclusion, recorded-versus-scenario repricing, mixed basis/currency rejection, and dated unique-rule matching all passed the focused tests and did not yield a confirmed accounting defect in this review. The principal test gap is that adapter tests inspect selected fields but never assert that the returned bundle satisfies `validateEvidence` or can enter `valueEvidence`; this allowed invalid ancestry and timestamps to pass all nine adapter tests.
