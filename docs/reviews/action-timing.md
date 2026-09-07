# Action timing independent review

Status: **approved after corrections**. This review covers the bounded action-timing working-tree delta on `codex/action-timing` against `main`, observed on 7 September 2026. The branch and `main` pointed to the same commit during review, so the reviewed change was the named tracked and untracked working-tree files rather than a committed three-dot branch diff.

The requested behavior is present: Start, End and Duration are separate fields; event and collection times never stand in for action boundaries; missing, running and reversed states explain what is known; recorded duration is distinguished from wall-clock derivation; and timestamp fractions are preserved beyond milliseconds.

## Standards

No documented repository-standard violation remains. Timing evidence stays explicit and unavailable facts remain unavailable, consistent with `CONTEXT.md`. The implementation has public-interface regression coverage, and TypeScript, repository formatting checks and viewer checks pass.

Three non-blocking design smells remain as judgement calls:

- **Possible Duplicated Code / Shotgun Surgery:** Codex boundary precedence is encoded independently in `src/adapters/index.ts` and `src/usage-import.ts`. A future source-shape change must update both the legacy and usage importers consistently. A shared boundary extractor or a legacy projection from the canonical importer could reduce drift.
- **Possible Primitive Obsession:** `TimingValue.value` represents timestamps, quantities and states such as `Not captured`, `In progress` and `Cannot calculate` with one string. A tagged union would make presentation and accessibility behavior easier to enforce.
- **Possible Divergent Change:** `viewer/lib/timing.ts` combines general display-time calculation with legacy OTLP extension decoding. Moving native-boundary normalization fully into import would leave this module concerned only with timing selection and presentation.

These are maintenance observations rather than correctness failures in the bounded change.

## Spec

No unresolved spec finding remains. Five issues found during review were corrected before approval.

### Resolved [P1] — Canonical recorded duration was displayed as wall-clock-derived

The first implementation recognized only a custom `elapsed_ns` meter with unit `nanoseconds`. Real OTLP and recorder paths emit `duration_ns` with unit `ns`, so a valid provider-native duration was ignored and the equal endpoint difference was labelled derived. Timing selection now supports canonical `duration_ns` and operation `elapsed_ns`, accepts their defined nanosecond unit spellings, requires suitable interval/event and aggregation semantics, and retains evidence, count basis and method in the explanation. An actual `importUsage(..., { format: "otlp" })` regression proves the provider-native duration wins over endpoint derivation.

Location: `viewer/lib/timing.ts`, recorded-duration selection; `test/timing.test.ts`, OTLP duration regression.

### Resolved [P1] — A running action could show a final numeric duration

A recorded elapsed value originally overwrote `In progress` even when the observation was still running and had no end. The display now keeps both End and Duration open while explaining the measured elapsed-so-far value and its provenance. The regression asserts the Duration state and note, not only the End field.

Location: `viewer/lib/timing.ts`, running-state selection; `test/timing.test.ts`, running duration regression.

### Resolved [P1] — Legacy Codex import discarded or relabelled explicit starts

The legacy Evidence adapter previously fell back from event timestamp to `started_at`, which could relabel a start as an event, while an outer-wrapper start could be discarded. It now normalizes event, start and end independently, stores an explicit start in the namespaced legacy attribute, and never uses start as event time. `contextTiming` reads that start separately, and legacy-to-0.4 migration preserves it as `started_at`. Tests cover import, view and migration with an absent event timestamp.

Location: `src/adapters/index.ts`, Codex boundary import; `viewer/lib/timing.ts`, legacy timing; `src/usage-import.ts`, legacy migration.

### Resolved [P2] — Accounting scope hid an observation's own recorded interval

The initial recorded-duration path required `accounting_scope: "direct"`. Accounting scope controls cross-observation aggregation, not whether one observation's duration exists. The direct-only restriction is removed while interval/event, aggregation and meter-unit guards remain. Aggregate and other non-additive observations can show their own duration without implying that durations may be summed.

Location: `viewer/lib/timing.ts`, recorded-duration selection; `test/timing.test.ts`, non-additive accounting regression.

### Resolved [P1] — An open recorder scope still claimed complete capture

A snapshot taken while a model-call handle remained open originally set `coverage.complete` to true when no configured bound had dropped data. That overstated a capture with no terminal result and unknown current liveness. Snapshot coverage now remains incomplete while any observation has `status: "running"` and carries an explicit terminal-state/liveness limitation. Closing the handle restores complete coverage when no other limitation prevents it. This correction describes current snapshot completeness only; it does not claim a durable crash journal or extend the bounded timing change into interruption recovery.

Location: `src/usage-recorder.ts`, snapshot coverage; `test/usage-recorder.test.ts`, unfinished-scope regression.

## Verification

Independent focused execution passed all 36 timing, adapter and recorder tests after the corrections. The cases cover event-only input, missing boundaries, exact zero, two-nanosecond endpoint differences, reversed clocks, running scopes with elapsed-so-far evidence, measured-versus-derived precedence, canonical OTLP duration, explicit legacy OTLP start, Codex outer-wrapper boundaries, legacy Codex view and migration, aggregate recorded intervals, and snapshot coverage before and after an open handle closes. The final repository suite passed all 292 tests, `npm run typecheck`, `npm run build`, browser-module regeneration and `git diff --check`.

Viewer lint, TypeScript compilation and static production build passed in the mirrored viewer installation. The unlocked-browser check confirmed that usage rows with no source boundaries show `Not captured`, while a real file observation shows distinct start and end timestamps plus a measured `0.199223791 s` duration with full evidence in the detail panel. The context view shows all three fields and their explanations. A first visual pass exposed inherited global definition-list columns and a shared compact-class collision; explicit one-column detail layout and a component-specific compact modifier corrected both. The final narrow-viewport check at about 508 px shows Start, End and Duration stacked correctly in the context table.
