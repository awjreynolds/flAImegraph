# Durable lifecycle v0.5 independent review

Status: **approved after corrections**. This review covers the durable-lifecycle working-tree change on `codex/durable-lifecycle` against fixed point `063a065`, observed on 7 September 2026. The branch still pointed at the fixed-point commit during review, so the review included all named tracked and untracked working-tree files rather than relying only on a committed three-dot diff.

The final change adds an opt-in immutable lifecycle journal and recovery projection beside the unchanged Usage 0.4 contract. It preserves starts, ancestry, explicit pauses, terminal observations and individual usage receipts; keeps missing starts, parents, retries, completions and consumption visible as unknown; and does not infer success, interruption cause, current liveness or active work from silence or elapsed time.

## Standards

No unresolved documented-standard finding remains. The implementation and contract evolve together, the new identity and replay rules include explicit compatibility guidance, public SDK and CLI behavior has regression coverage, and the checked-in synthetic example is clearly separated from real operational evidence. This satisfies the relevant requirements in `CONTRIBUTING.md` for public-interface tests, compatibility implications and an independently reproducible conformance example.

No material Fowler-baseline smell blocks approval. The lifecycle projector is intentionally a single semantic boundary for ordering, action materialization and Usage projection. The repeated event-kind branches in the validator, projector and filesystem writer follow different responsibilities and do not currently justify a shared abstraction.

## Spec

No unresolved spec finding remains. The following issues were found and corrected during review.

### Resolved [P1] — Derived lifecycle facts cited incomplete or incorrect evidence

Terminal timestamps and raw terminal fields originally cited the start event, while elapsed and other replayed fields did not consistently identify all contributing lifecycle records. The projection now cites the terminal event for the observed end, both start and end for monotonic elapsed, the start for declared retry identity, and the applicable related event set for materialized state and qualification.

Location: `src/lifecycle.ts`, Usage projection provenance; `test/lifecycle.test.ts`, cross-epoch and same-epoch provenance checks.

### Resolved [P1] — Retry cycles and unresolved retry targets were not surfaced

The first projector accepted multi-action retry cycles and silently retained a retry whose earlier attempt was absent. Replay now rejects retry cycles deterministically and emits `LIFECYCLE_RETRY_UNOBSERVED` for a missing earlier attempt without inventing its state or consumption.

Location: `src/lifecycle.ts`, retry lineage validation; `test/lifecycle.test.ts`, retry cycle and unresolved attempt regression.

### Resolved [P1] — Missing sequence records could manufacture a known wait

A gap inside a pause/resume sequence could turn an uncertain eight-hour interval into confirmed waiting time. Incomplete epochs now qualify timing, keep the confirmed wait at zero when the pause calculation depends on missing records, and emit `LIFECYCLE_WAIT_UNCERTAIN`. The viewer renders that value as unknown rather than as a confirmed zero-duration wait.

Location: `src/lifecycle.ts`, incomplete-epoch wait projection; `viewer/app/usage/lifecycle-panel.tsx`; `test/lifecycle.test.ts`, missing-sequence pause regression.

### Resolved [P1] — A delayed receipt extended a completed action's timing diagnostics

A usage receipt recorded eight hours after an end event originally produced an execution gap and timing qualification even though receipt time does not establish consumption time. Phase timing now stops at the terminal event while the late immutable receipt remains attached to the action and included according to its Usage aggregation semantics. Its event-time method explicitly says that recording may occur after consumption.

Location: `src/lifecycle.ts`, action timing and receipt projection; `test/lifecycle.test.ts`, delayed receipt regression.

### Resolved [P1] — A valid `__proto__` meter could disappear during projection

Lifecycle and shared Usage validation initially assigned producer-defined meter IDs into ordinary object accumulators. The valid meter ID `__proto__` invoked JavaScript's inherited prototype setter, silently dropping its quantity before validation and reporting. Computed own-property maps in lifecycle projection and a null-prototype accumulator in the shared Usage validator now retain the exact measurement. The public regression verifies an additive reported total of `7`.

Location: `src/lifecycle.ts`, measurement maps; `src/usage.ts`, validated measurement accumulator; `test/lifecycle.test.ts`, custom-meter regression.

### Resolved [P1] — Journal fault paths did not yet meet the durability contract

The journal was tightened so creation acknowledgement synchronizes every newly created directory entry, complete frames require exact envelope and event-data fields plus valid UTF-8, and recovery reads no more than the configured per-read and directory-wide bounds even while a segment grows. Write or synchronization uncertainty poisons the writer. If both a wrapped callback and its terminal append fail, both errors remain available in an `AggregateError`. A callback result followed by terminal logging failure remains a storage failure and does not create a false error terminal event.

Location: `src/lifecycle-journal.ts`; `test/lifecycle-journal.test.ts`, strict framing, bounds, injected storage faults, poisoning and dual-failure regressions.

### Resolved [P2] — Timing could be mistaken for uninstrumented or active duration

The start timestamp is sampled before its durable acknowledgement and callback dispatch, so start-to-end elapsed includes pre-dispatch synchronization and other in-action instrumentation. The contract, guide, Usage coverage limitation and viewer explanation now state this explicitly and continue to describe elapsed as potentially including waits rather than active CPU time.

Location: `spec/0.5/README.md`, `docs/lifecycle.md`, `src/lifecycle.ts`, and `viewer/lib/timing.ts`.

## Verification

Independent focused execution passed 35 tests: 14 filesystem journal tests, 11 lifecycle replay tests, one SDK-to-CLI recovery test and nine timing tests. The cases include durable start recovery after `SIGKILL`, a kill during a deliberately partial frame write, unchanged torn-tail bytes, strict complete-frame corruption handling, concurrent isolated writers, restart epochs, late terminal and receipt evidence, cumulative read limits, injected write/sync faults, parent and retry recovery, missing sequences, clock reversal, cross-epoch completion, eight-hour quota and unexplained-gap scenarios, simulated 429/503/DNS/timeout/lost-response/sleep evidence, failed and retried usage, non-additive cumulative receipts, and the `__proto__` meter edge case.

The static contract and UI review also confirmed the required limits: physical power loss, real suspend and provider-outage tests are not claimed; file synchronization is described as an operating-system/filesystem acknowledgement; missing entire segments and unseen external work remain unknowable; and the viewer labels completion, clock continuity, known wait and gap cause without presenting them as current liveness or active work.

Summary: Standards 0 unresolved findings; Spec 0 unresolved findings after seven correction groups, with the worst resolved issues affecting evidence integrity and durable recovery semantics.

## Supplementary task-driven usage review

Status: **approved after corrections**. This supplementary review covers the task-first usage profile and token-viewer work added during the lifecycle change. The final behavior makes task and operation the default profile hierarchy, keeps model grouping explicit, renders exact selected-meter quantities in the browser, and exposes token totals, declared subset relationships, task rows and underlying evidence without introducing pricing or inferred attribution.

### Standards

No unresolved documented-standard finding remains. The public profile default, CLI examples, usage guide, viewer guide and deterministic example agree on task → operation behavior. The implementation keeps Usage Interchange 0.4 quantities and subset declarations authoritative, retains model and execution views as explicit choices, and labels the synthetic task example as declared evidence rather than a provider capture.

No material Fowler-baseline smell blocks approval. The profile tree isolates exact hierarchy construction and chart layout from React rendering. The token component derives display trees from meter metadata rather than duplicating cache and reasoning arithmetic, while the task table consumes the canonical report totals and coverage.

### Spec

No unresolved spec finding remains. The following issues were found and corrected during supplementary review.

#### Resolved [P1] — Display labels could merge missing identities with literal producer IDs

Task, operation, agent, session and work-item frames initially used their human-facing unassigned labels as identity keys. A producer could supply the same literal text, merging assigned and missing work into one profile frame. Profile identities now retain the raw nullable value while labels remain readable, with regressions for every affected grouping.

Location: `src/usage-profile.ts`; `test/usage-export.test.ts`, missing-label and identifier-grouping regressions.

#### Resolved [P1] — Browser layout could lose integer precision for large usage totals

The first interactive tree path converted profile quantities through JavaScript numbers. Profile construction and layout accumulation now use `bigint`; only bounded percentage coordinates become numbers. The regression uses quantities above `Number.MAX_SAFE_INTEGER` and verifies exact conservation and equal widths.

Location: `viewer/lib/profile-tree.ts`; `test/usage-export.test.ts`, exact interactive-width regression.

#### Resolved [P1] — Hidden tiny frames could not be selected despite the viewer guidance

Frames narrower than the chart threshold were omitted from both the drawing and the available interaction path. The viewer now provides a progressive child selector at every zoom level, so hidden tasks and operations remain reachable and preserve observation identity.

Location: `viewer/app/usage/flamegraph.tsx`; `viewer/lib/profile-tree.ts`; `test/usage-export.test.ts`, tiny-task selection regression.

#### Resolved [P1] — The dynamic graph concealed incomplete and excluded usage

The initial panel presented the known subtotal without the profile's unavailable observations, non-additive exclusions or limitations. It now calls the value a known additive subtotal and renders the unknown count, excluded count and every profile limitation beside the graph.

Location: `viewer/app/usage/flamegraph.tsx`.

#### Resolved [P1] — Token cards could contradict valid producer-declared subset relationships

Canonical Input and Output sections were initially treated as independent roots even when a valid capture declared one beneath another meter. A shared rendered set could also suppress the child in its actual parent tree. Token trees now follow `subset_of`, classify root relationships from the meter declaration, retain custom meters with `token` or `tokens` units, and render each tree without shared mutable traversal state. The copy no longer claims that every Input and Output meter is independent.

Location: `viewer/app/usage/token-breakdown.tsx`.

#### Resolved [P2] — Partially reported token families could hide missing canonical meters

When any token meter existed, the declaration-driven layout briefly omitted a missing Input or Output meter entirely. It now displays an explicit Not reported placeholder when that canonical meter is absent, while avoiding a false placeholder when the meter exists as a declared child elsewhere in the tree.

Location: `viewer/app/usage/token-breakdown.tsx`.

#### Resolved [P2] — The primary task view did not consistently connect totals to evidence

The final task table reports each token meter independently with known, unavailable and excluded coverage; distinguishes an unassigned task from a literal producer value; and provides observation inspection without repeating the same evidence list in every meter cell. Selecting a task filters the complete observation table, including zero and unknown token records.

Location: `viewer/app/usage/token-breakdown.tsx`; `viewer/app/usage/page.tsx`.

### Supplementary verification

The complete Node test suite passed 324 tests after the final profile changes. Focused profile cases cover the new default, explicit model grouping, literal unassigned-label collisions, exact values above the safe-integer boundary, execution ancestry, unknown and excluded coverage, observation identity and tiny-frame zoom. Static checks passed for the root TypeScript package and viewer component bundle, and the final diff passed whitespace validation. Browser checks exercised task filtering, unknown reasoning quantities, selected-meter graph changes, progressive zoom and observation inspection against the synthetic task dataset.

The generated fixture was also regenerated and inspected: it contains nine observations across three declared tasks, six model-call observations, the five standard token meters, two explicitly unavailable reasoning quantities, and no duration or tool-call measurements. Both checked-in copies are described as synthetic and make no live provider-usage claim.

Supplementary summary: Standards 0 unresolved findings; Spec 0 unresolved findings after seven correction groups. The worst resolved issues affected identity separation, exact numeric display and the visibility of incomplete usage evidence.
