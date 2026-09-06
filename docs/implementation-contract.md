# Implementation interfaces for experimental 0.1

These are the reference implementation's public interfaces. TypeScript definitions are in `src/types.ts`; normative wire schemas, semantics and conformance examples are in `spec/0.1/`. The [usage guide](usage.md) shows the installed package API and CLI.

- `src/core.ts`: `validateEvidence(value: unknown): EvidenceBundle`; `reconcileEvidence(bundles: EvidenceBundle[]): EvidenceBundle`; `valueEvidence(evidence: EvidenceBundle, options: ValuationOptions): Valuation`; `validateRateCard(value: unknown): RateCard`. Public errors expose a stable `code` and readable message. No private content required.
- `src/adapters/index.ts`: `importEvidence(harness: Harness, input: string, options?: ImportOptions): EvidenceBundle`; `adapterCapabilities(): AdapterCapability[]`. Native input is JSON or JSONL depending on the selected adapter. JSONL parse failures are explicit errors with line references. Never scan the user's home directory implicitly. No network or writes in importers.
- `src/profile.ts`: `createCostProfile(evidence: EvidenceBundle, valuation: Valuation, options?: ProfileOptions): CostProfile`; `exportFolded(profile: CostProfile): string`; `exportPprof(profile: CostProfile): Uint8Array`; `exportOtlp(evidence: EvidenceBundle): object`. Filesystem/network/renderer execution belongs to the CLI, not these pure functions.
- `src/profile.ts` also exposes `validateProfile(value: unknown): CostProfile`, enforcing structural and monetary invariants before a serialized artifact is exported or rendered.
- `src/work-items.ts`: `validateWorkItem`, `validateValuation` and `joinWorkItemEvidence` validate scope/estimate/acceptance records and join selected observations with a conserving work-item valuation. Dataset valuation is preserved separately.
- `src/cli.ts`: validate, import, merge, value, export, render, demo, conformance, capabilities and work-item commands. Owns I/O, writes JSON summaries to stdout and machine-readable errors to stderr.

Tests use these public interfaces and independently specified literal outcomes. Behavior was developed through failing tests followed by minimal passing implementations, then independent review and repair verification. See the [integration evidence](implementation-evidence/integration.md).

Quantities use decimal digit strings, not JSON floating-point money. Normalized input includes disjoint cache-read/cache-write subsets. Reasoning is a subset of output. Null means unavailable. Direct, aggregate, snapshot and unknown scopes remain distinguishable; aggregate observations never silently become extra direct charges. Duplicate identities with conflicting quantities are errors rather than arbitrary last-write wins.

All valuation bases remain explicit. Recorded values from different bases cannot quietly form a single monetary profile: reject mixed bases or require an explicit coherent selection. Scenario rules are model/provider/product/date matched; unknown dimensions or quantities produce unpriced observations and coverage issues, not invented zero. Round once per observation to nano-currency units using exact arithmetic. Shared allocations use positive integer weights and deterministic largest remainders to conserve integer totals.

The standard is an open experimental draft, implemented through existing OTLP vocabulary and pprof/folded formats plus narrowly documented binding metadata. No claim of external adoption, every possible native version, exact context-source billing, or complete hidden provider usage is made.
