# Conformance and evolution

Version 0.1.0 is experimental. A producer or consumer declares both the specification version and the subset of formats it supports. Unknown schema versions, unsupported required semantics and malformed quantities fail explicitly. Optional extension metadata MUST be namespaced and MUST NOT change the meaning of core fields without a new version.

## Conformance classes

1. **Evidence producer:** emits schema-valid bundles and satisfies identity, usage partition, scope and provenance invariants. An adapter additionally declares accepted native formats, tested source versions and coverage limits.
2. **Valuation consumer:** selects direct evidence deterministically, preserves conflicts/unknowns, matches price rules reproducibly and passes exact-arithmetic examples.
3. **Profile producer:** preserves selected monetary totals and required manifest information while emitting valid pprof or folded data.
4. **Profile consumer:** decodes the declared measure and paths without harness-specific logic, and presents basis/coverage alongside the graph.

An implementation can conform to a class without claiming the others. Structural schema validation alone is insufficient. A test that returns an expected unsupported/incomplete diagnostic can pass a fixture; silently claiming complete numeric coverage cannot.

## Required examples

The conformance corpus and reference tests cover exact known cost, duplicates versus equal independent calls, conflicting IDs, aggregate/snapshot exclusion, cache/reasoning subsets, unavailable versus zero, failed/cancelled measured usage, dated prices, unknown models, signed credits, shared-allocation remainders, malformed references/cycles, hostile labels, exact large integers and target overflow. Equivalent native examples from multiple harnesses must pass the same downstream valuation/profile interfaces.

Expected totals are independently worked literals or published frozen observations, not recomputed by the implementation under test. Tests should be executable without private accounts or paid provider calls. Pprof validation includes an independently maintained consumer; folded validation uses the pinned upstream renderer. Rendering checks complement decoded-value checks.

The portable [accounting corpus](fixtures/accounting.json) supplies ten JSON vectors with literal monetary/completeness expectations or explicit errors. Run `node dist/pricing-cli.js conformance` after building the reference implementation. It checks these values and successful profile/folded conservation; this command is one part of conformance, not the entire adversarial suite. `npm run check` adds the broader reference tests, and CI opens the dogfood pprof with Go's independently maintained consumer. Another consumer can read the corpus without importing reference code. The worked $0.20 evidence example is hand-authored; it is not an independently maintained producer adoption claim.

## Stability and changes

Before any stable claim, publish compatibility evidence from independently maintained implementations. Changes to required fields, meaning, selection, rounding, allocation or escaping are breaking changes. New optional metadata is additive only when old consumers can safely ignore it. Migration notes must identify semantic changes rather than merely provide a schema transformer.

Proposals should identify the user problem, relevant existing standards, concrete gap, proposed binding, adversarial examples and compatibility impact. Reuse or extend adequate upstream specifications before expanding this profile. Project-maintainer acceptance is not external endorsement or industry standardization.

Current native adapters and interoperability results are documented in the release capability matrix. Where live validation was not performed, fixture/source verification must be labeled as such. Dogfooding proves the reference workflow on our own work; it does not independently establish general forecasting accuracy or ecosystem adoption.
