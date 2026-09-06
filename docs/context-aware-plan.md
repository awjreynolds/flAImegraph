# Context-aware reference workflow 0.2

The deliverable is a usable local workflow and published demonstration that follows context through a real work item and keeps observed monetary totals intact. The 0.2 context contract composes with the frozen 0.1 evidence/valuation/profile contract; it does not mutate the published 0.1 schemas. Versioned Harness Profiles are part of the context contract, not merely a list of parsers.

## Acceptance

1. A typed context source covers instructions, skills and repository instructions, repository/retrieved material, user input, history, tools and tool schemas, memory, delegation, assistant output and attachments. Origin, representation, role/placement and cache treatment remain independent.
2. Every measurement declares its value or unavailability, unit, method, evidence class and source references. Local text counts cannot become observed provider billing merely by agreeing with an aggregate. Raw content is not needed in the exported manifest.
3. Ordered request occurrences reference source revisions. Transformations preserve truncation, summarization, compaction and delegation lineage. Reusing a source is a new occurrence; merging the same capture is idempotent. No summary's tokens are silently distributed back to original files.
4. Harness Profiles declare version, model/settings, instructions, tools, context policies and capture capabilities. Configured facts are distinguished from observed facts; a request retains effective overrides. Unknown versions or policies stay unknown.
5. Final client-request capture and transcript reconstruction are separate capabilities. An absent final request manifest stays unavailable. The native Codex/Pi workflow and generic request capture SDK must expose this boundary honestly.
6. Incremental capture validates its identity and append-only assumptions; overlapping snapshots cannot be treated as new calls. Conflicting identities or a rewritten prefix fail clearly, without overwriting source input.
7. A report lets a person move from a dollar-weighted observation to its context composition, profile, repeated occurrences and transformation history, and inspect chronological activity. Existing FlameGraph/pprof exports continue to conserve exact selected costs.
8. Optional context cost allocation is explicitly estimated, uses a named conserving method and leaves missing/unexplained input unallocated. It allocates the selected request cost, including any output component, and is never labeled per-source billing or causal savings. The observed cost graph remains separate.
9. A real-work capture and an independently authored producer fixture exercise the same contract and report. Synthetic edge cases are labeled. A pre-execution Work Item/estimate/outcome record demonstrates the collection workflow without claiming a calibrated forecasting model.
10. Public interface tests, independent review, browser interaction checks, package installation, documentation, capability statements and a published experimental release complete the work.

## Public seams and ownership

The tests continue at the user-authorized public library/CLI seams: context validation and reconciliation, capture, report/allocation, native incremental capture, and the exported report interface. Each behavioral change follows a failing public-interface test with the smallest passing implementation. Routine interface decisions are covered by the user's standing autonomy and request to deliver the complete solution.

Initial library signatures use `src/context-types.ts`: `validateHarnessProfile(value)`, `validateContextBundle(value, evidence?)`, `reconcileContextBundles(bundles, evidence?)`, `captureRequestContext(input)`, and `createContextReport(evidence, valuation, context, options?)`. A separate pure request adapter translates explicitly provided provider request payloads to capture blocks. It performs no provider calls or implicit session discovery.

The coordinator owns shared context types, CLI integration, report/allocation and the viewer. Bounded implementation agents own context semantics/schemas, capture adapters, or incremental reconciliation as assigned. Independent review owns reports only. Every subtask uses an explicit goal.

## Release verification status

The implementation, reference fixtures, package workflow and static explorer are delivered in 0.2. Independent reviews and implementation evidence record the corrections and validation results. Acceptance item 10 retains one external verification dependency: actual browser interaction/responsive checks could not run while the Mac was locked. Static export, lint, type checks and browser-validator execution are verified; they do not replace that interaction check. Context Points collection remains uncalibrated and native context capture remains explicitly bounded.
