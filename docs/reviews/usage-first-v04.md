# Usage-first v0.4 independent review

Status: **approved after corrections**. I reviewed the usage-only core and downstream efficiency analyzer against [ADR 0001](../adr/0001-separate-usage-from-pricing.md) and [the efficiency design](../efficiency-analysis.md). The final revision observed on 7 September 2026 keeps usage capture, import, reconciliation, profiling and analysis independent of valuation, rate cards, currency and subscription policy. Exact decimal arithmetic, direct-delta additivity, explicit subset meters, strict source timestamps and nullable unknown measurements are preserved through the public APIs and browser bundle.

All findings raised during review are resolved below.

## Spec findings

### Resolved [P1] — Recorder lifecycle closure erased correlation and response identity

`UsageCallHandle.end` and `fail` now merge the applied response descriptor through the supported `response` field and preserve `operation_id`, agent, session, Work Item and task joins. Closing a scope no longer replaces the caller's operation identity with its observation identity. Regression coverage exercises request-versus-response model facts, retained lifecycle joins and valid default start/end timestamps.

Location: `src/usage-recorder.ts`, lifecycle closure in `startModelCall` and `update`.

### Resolved [P1] — Conflicting native identities depended on input order

Native observations now have immutable replay semantics. Structurally equal records coalesce with provenance, while a repeated stable identity with changed measurements or dimensions fails as a conflict instead of selecting the later row. Tests cover exact replay, reversed order, overlapping capture and conflicting Pi, OpenCode and OMP payloads.

Location: `src/usage-import.ts`, observation deduplication and conflict detection.

### Resolved [P1] — Timestamp normalization manufactured valid-looking instants

The importer now validates calendar components and timezone bounds before normalizing RFC 3339 input. Invalid dates such as 30 February and offsets such as `+99:99` remain unavailable rather than being moved to another instant. The canonical usage and efficiency validators share the strict timestamp behavior.

Location: `src/usage-import.ts`, timestamp normalization; `src/efficiency.ts`, date validation.

### Resolved [P1] — OTLP delta metrics were classified as cumulative snapshots

OTLP enum value 1 is handled as DELTA/direct interval consumption and value 2 as CUMULATIVE/snapshot evidence. Point start and end times are retained. The focused regression also verifies that delta observations enter additive usage totals while cumulative snapshots do not.

Location: `src/usage-import.ts`, OTLP metric data-point import.

### Resolved [P1] — Distinct OTLP series collided at a shared timestamp

Stable OTLP point identity now includes a deterministic representation of identifying attributes in addition to source, metric and time. Two token series collected at the same instant remain distinct, and replay remains order-independent.

Location: `src/usage-import.ts`, OTLP metric data-point identity construction.

### Resolved [P1] — Benchmark comparison could validate different work

Comparison now requires an explicit comparable design. Controlled and held-out comparisons retain task identities and decline validation when the task sets differ or matching conditions are absent. The regression suite covers disjoint task IDs and unknown comparison conditions.

Location: `src/efficiency.ts`, benchmark condition comparison.

### Resolved [P1] — Duplicate benchmark identities and conflicting meter definitions validated

Benchmark validation requires unique sample IDs, at most one value for a meter in each sample, one unit per meter across the suite, and unique analysis-overhead meters. Comparison accepts exactly one baseline/control artifact and one candidate artifact. It supports either argument order but derives the baseline and candidate labels and subtraction direction from the declared roles, so caller order cannot reverse the result.

Location: `src/efficiency.ts`, benchmark validation and `compareBenchmarks`.

### Resolved [P1] — Evaluation and quality differences could still report a validated comparison

Evaluation-design mismatches, incomplete quality evidence, quality-vector differences and failed accepted-sample checks are explicit limitations and prevent validated status. Comparison output carries the quality implications rather than exposing only a resource delta. Candidate-policy derivation requires a candidate-role benchmark, complete acceptance outcomes and passing quality evidence for accepted work; otherwise its status is `unknown`.

Location: `src/efficiency.ts`, `compareBenchmarks` and candidate-policy derivation; `src/efficiency-types.ts`, comparison types.

### Resolved [P1] — Benchmark deltas omitted declared analysis overhead

`analysis_overhead` has an explicit total-per-benchmark-run basis and is allocated across accepted samples before per-accepted rates are compared. Duplicate overhead meters fail validation. Tests cover a candidate whose execution demand falls but whose declared analysis overhead changes the net result.

Location: `src/efficiency.ts`, benchmark rate construction and comparison.

### Resolved [P1] — One observation could be counted for multiple accepted Work Items

Explicit attempt joins now enforce exclusive observation ownership across the analyzed Work Item cohort. A direct observation referenced by two Work Items fails closed instead of contributing twice. Opaque custom work identifiers remain supported and are tested independently.

Location: `src/efficiency.ts`, explicit observation ownership and cohort accumulation.

### Resolved [P1] — The efficiency report validator accepted forged totals and provenance

The report retains detached normalized analysis input and options. `validateEfficiencyReport` performs full shape and reference validation, then canonically recomputes the report and requires exact equality. It rejects unsupported schema versions, malformed counts, changed quantities, invalid evidence references and otherwise shape-valid forged totals. This invariant is present in both the Node API and regenerated browser bundle.

Location: `src/efficiency.ts`, report construction and `validateEfficiencyReport`; `src/efficiency-types.ts`, `EfficiencyAnalysis`.

### Resolved [P1] — Reconciliation undercounted independent capture loss

Coverage carries optional cumulative `dropped_by_source` counters. Validation requires their safe-integer sum to equal `dropped_observations` and every counter to name a retained source. Reconciliation takes the maximum counter for each source, sums across sources, infers attribution only for an unambiguous single-source legacy capture, and rejects unattributed lossy multi-source capture. Tests cover independent `2 + 3 = 5`, replay, staged merge, reversed order and ambiguous multi-source loss.

Location: `src/usage.ts`, coverage validation and `reconcileUsageBundles`.

### Resolved [P2] — Malformed native records disappeared without loss evidence

Malformed JSONL records and non-object entries increase dropped-record coverage, make capture incomplete and produce non-sensitive limitations without echoing rejected content. The raw artifact digest still anchors the supplied bytes. The public reproducer confirms one valid row plus one secret-bearing malformed row reports one drop without retaining the secret.

Location: `src/usage-import.ts`, record parsing and source coverage.

### Resolved [P1] — Capture retained credential-labelled metadata

Recorder context, caller-supplied extension dimensions and imported dotted attributes share credential-key filtering. Common authorization, bearer, token, API-key and credential labels are excluded without echoing their values. Source descriptions now state the remaining metadata trust boundary accurately. Regression tests cover recorder context and direct extensions, and the checked-in artifacts pass a credential-pattern scan.

Location: `src/usage-recorder.ts` and `src/usage-import.ts`, dimension filtering.

### Resolved [P2] — Efficiency time handling lost calendar and sub-millisecond semantics

Efficiency validation uses strict RFC 3339 calendar checks and exact decimal-fraction ordering. Runway horizons and reset windows no longer rely on millisecond `Date.parse` values. Tests cover invalid calendars and ordered instants that differ below one millisecond.

Location: `src/efficiency.ts`, timestamp validation and runway ordering.

### Resolved [P1] — Elapsed union mixed units, meanings and timestamp precision

Interval union is restricted to the explicit `elapsed_ns` and `elapsed_seconds` wall-clock meters. Nanoseconds are converted exactly when the declared meter uses seconds, and derived evidence plus contributing sources are retained. Additive resource meters such as `audio_duration_seconds` remain additive: two overlapping `0.002` observations total `0.004 seconds`. If source timestamps have precision that cannot be represented by the wall-clock union, the calculation is declined with a limitation rather than truncated.

Location: `src/efficiency.ts`, elapsed-meter selection and interval union.

### Resolved [P2] — Invalid usage bypassed the canonical contract at the efficiency boundary

Efficiency input is passed through the public `validateUsageBundle` or `validateUsageReport` boundary before analysis. Provenance, meter references, exact quantities, timestamps, evidence/null consistency, subset bounds, ancestry and accounting scope therefore have the same semantics in capture, analysis and browser use.

Location: `src/efficiency.ts`, efficiency input normalization.

### Resolved [P1] — The usage workbench rendered unknown groups as zero

Grouped totals carry their coverage into rendering. A group with no known additive observation is labelled `Unknown / non-additive`; a known subtotal with unavailable observations is labelled with `+ unknown`; absent reporting is distinct from zero. Bars are drawn only for groups with a known subtotal. Custom Work Item IDs, task IDs and agent IDs remain available as separate grouping choices.

Location: `viewer/app/usage/page.tsx`, grouped meter calculation and bar rows.

### Resolved [P1] — Typed recorder measurements discarded custom meter semantics

`ExplicitUsageMeasurement` advertises `unit`, `description`, `subset_of` and `overlap`, but the recorder originally read those fields only from the separate event-level `meters` map. Typed custom measurements therefore fell back to inferred `count`/unknown meter semantics. Both event capture and `recordMeasurement` now resolve the existing registry definition, the event-level definition and the typed measurement descriptor together. Metadata is retained in the emitted meter registry; incompatible redefinitions, conflicts between the two declaration forms and attempts to override canonical meters fail closed. Focused public-API checks cover a disjoint byte meter, a byte subset, a seconds meter, the incremental measurement API and cross-event conflicts.

The same recorder boundary now declines unsafe integer `Number` values as unknown, preserves arbitrary-size exact decimal strings, and expands finite fractional exponent notation such as `1e-7` to the schema-valid `0.0000001`. Boolean, negative and otherwise invalid measurements are rejected. Callers that require decimal identity beyond JavaScript `Number` semantics can supply the documented string form.

Location: `src/usage-recorder.ts`, measurement normalization and meter resolution; `test/usage-recorder.test.ts`, generic measurement regressions.

## Standards

No separate repository coding-standard violation remains. The final implementation consolidates analysis input on the canonical usage validators and gives derived efficiency reports a recomputable validation boundary, removing the material validator drift observed in the staged revision.

## Verification

The final settled repository passed all 282 tests, `npm run typecheck`, `npm run build` and `git diff --check`. Independent public reproducers additionally verified recorder identity and redaction, malformed-record loss, strict timestamps, OTLP delta semantics and same-time series identity, native replay conflicts, exact audio-duration addition, and rejection of a forged but well-shaped efficiency total. The final typed-meter correction separately passed the focused recorder and usage suites, including registry conflicts, canonical-meter protection and exponent normalization.

The checked-in v0.4 evidence validates as 584 native observations, 5,130 file observations and 278 custom-ticket observations. Native and file efficiency analyses, usage profiles, benchmark comparison, candidate policy, Inspect import and runway forecast reproduce exactly through public APIs. The browser module was regenerated from the settled source, reproduced byte-for-byte on a second build, and validated the same usage, efficiency and benchmark artifacts. Static review confirmed the workbench's unknown and partial group rendering.

The parent integration run used a mirrored viewer installation under `/private/tmp` and passed viewer lint, TypeScript compilation and the static production build. The macOS session remained locked, so live pointer/keyboard interaction was unavailable; the static build, browser-module runtime validation and source review provide the recorded viewer evidence.
