# Independent v0.1 interoperability design review

Review date: 6 September 2026. Scope: the proposed evidence, valuation and profile contract in `docs/research`, before production implementation. This is an adoption-first review: OTLP/OpenTelemetry, FOCUS, pprof and folded stacks remain the owning standards at their respective seams.

## Verdict

The proposed architecture is coherent: retain evidence, derive one declared valuation, then project it into existing profile formats. It should proceed as an experimental v0.1. The release should not claim accounting interoperability until the specification defines the deterministic selection of authoritative quantities from overlapping observations. Stable IDs, `direct` versus `inclusive`, and an authority label are individually insufficient: two implementations could still choose different snapshots, retry records or aggregates and both appear conformant.

The smallest useful public contribution is a bridge profile and conformance corpus, not a new telemetry transport, financial vocabulary or flame-graph format. Its novel surface should be limited to correspondence, derivation and projection semantics that the reused standards do not own.

## Minimum coherent v0.1 specification

Keep the normative interface small and separate it from adapters and explanatory material:

1. **Conformance and versioning.** Define RFC 2119 terms, experimental status, producer and consumer conformance classes, semantic-version compatibility, extension namespaces, and how unknown fields and unknown enum values are handled. Schema validity is only structural conformance.
2. **Logical evidence model.** Define immutable source observations and references, observation grain, measured subject, interval, revision/correction relationship, count basis, availability, and conflicts. Bind standard OTel GenAI attributes where they exist; keep the original source record or a content-addressed reference. Do not rename local fields to look like upstream OTel attributes.
3. **Correspondence and work allocation.** Define typed links among execution subjects, observations, financial records and work items. Execution ancestry, evidential equivalence and work allocation are different link types. Reuse FOCUS split-allocation conservation rules; define only the missing reference and policy identifiers.
4. **Valuation derivation.** Define how selected usage quantities become monetary lines, including valuation kind, currency, rate-card identity and version, effective interval, model/SKU matching, exact arithmetic, boundary rounding, and unresolved residuals. A public or enterprise rate scenario is a scenario valuation, not FOCUS `BilledCost`, `EffectiveCost`, `ListCost` or `ContractedCost` unless its evidence meets that term's requirements.
5. **Projection bindings.** Normatively bind one nonnegative monetary measure to pprof and folded stacks. Define path order, frame identity, display names, escaping, labels, manifest discovery, included scope, losses and correction view. State that paths are synthetic attribution paths rather than sampled runtime stacks.
6. **Conformance corpus.** Publish input artifacts, expected normalized selections, expected valuation lines, expected projection manifests, decoded pprof assertions and folded output. Fixtures must be consumable without flAImegraph code.

An artifact bundle can reuse standard representations directly: OTLP JSON or referenced native evidence for telemetry, FOCUS-compatible records for qualifying financial evidence, pprof protobuf and folded text for projections. The bridge manifest may carry the minimum missing correspondence and derivation data. If a canonical JSON evidence ledger is introduced for offline harnesses, describe it as this project's bridge format, not as OTLP or FOCUS.

## Required semantics before profiles are authoritative

### Observation

An observation is an immutable assertion by a named producer about one subject at one grain and interval. At minimum its identity must include producer namespace, source dataset/export identity and source record identity; globally unique-looking IDs alone are not enough. The model must distinguish:

- logical operation, physical attempt, point observation, cumulative snapshot, aggregate and correction;
- the observed subject from the record that carries the observation;
- billable, consumed, context-occupancy and provider-native count bases;
- recorded zero, unavailable, redacted and unsupported;
- subset/overlap relationships from additive partitions;
- duplicate delivery from a distinct observation with an equal value;
- replacement/revision from ledger-style additive correction.

Deduplication should use stable source identity and declared delivery semantics, never matching values, timestamps or display names. Reimporting the same artifact is idempotent. Reusing an observation inside an inclusive aggregate does not make the aggregate a second direct quantity. The selection result should retain selected observation references, rejected/superseded candidates, conflicts and an unexplained residual.

There should be no universal priority such as “native beats OTLP” or “leaf beats parent.” Authority is scoped to a measure, subject and reconciliation interval. A deterministic policy can prefer attempt-level direct observations when complete, use an operation aggregate when it is the only available authority, and preserve a parent-minus-known-children residual when coverage is partial. Conflicting records with the same source identity should fail authoritative projection unless a declared resolution rule selects one.

### Valuation

A valuation is a reproducible derivation over selected quantities. It must state `kind` (for example scenario, provider-reported, allocated effective, or billed), currency, price/rate source, immutable version or digest, effective time, model/SKU match inputs, arithmetic expression and rounding rule. Original quantities remain unchanged.

Use exact decimal or rational arithmetic through the derivation and round once at a specified monetary-line boundary. Define tie-breaking and allocation remainder distribution so results do not depend on input order. The candidate `cost`/`nanoUSD` pprof binding is acceptable for a USD-only v0.1 if overflow is checked, but the specification should state its finite range and must not imply that `nanoUSD` is an existing pprof or UCUM currency unit. JSON representations of exact integers should be strings, or otherwise explicitly capped at the safe-integer range.

Invoice, subscription and provisioned-capacity amounts need financial correspondence and allocation; tokens alone do not turn them into per-call costs. Unknown price matches and missing usage remain uncovered amounts or records. They must not become zero-cost samples.

### Projection

A projection consumes selected monetary lines, never raw observations. Each line contributes exactly once to one path in an allocated-spend view. Inclusive values are renderer-derived. Alternative beneficiary views that intentionally repeat value must be named non-additive views and cannot claim monetary conservation.

The manifest should define a projection ID/version, valuation reference, currency and scale, capture and reconciliation intervals, ordered path dimensions, allocation policy, included and excluded record references, unknown amounts/counts, residuals, rounding residual, correction treatment, and output digest. Coverage is multidimensional: trace capture, usage availability, price coverage and financial reconciliation should not collapse into one percentage unless each denominator is evidenced.

Pprof locations are leaf-first; the human hierarchy is root-first. Define the conversion explicitly and keep stable frame identity separate from display text. For folded output, define a reversible or collision-resistant encoding for semicolons, whitespace, control characters, Unicode normalization and repeated display names. Test the exact selected renderer because folded-stack escaping is not a universal schema feature.

Ordinary cost profiles should contain nonnegative widths. For corrections, v0.1 should emit separate gross-charge and credit-magnitude profiles plus a signed net summary in the manifest. A net-negative tree or pprof differential view has different geometry and should be deferred until its semantics are specified.

## Release-blocking conformance fixtures

The following are the minimum golden fixtures. Each fixture should assert selection, valuation, manifest coverage, total conservation and decoded export values.

| Fixture | Required result |
| --- | --- |
| Duplicate OTLP delivery and idempotent reimport | One selected observation; importing the same artifact twice changes no total. |
| Same source identity, different payload | Explicit conflict; no authoritative profile unless a named resolution selects a revision. |
| Two cumulative snapshots, including late arrival | Deterministic latest/revision selection; never sum snapshots; event order does not change the result. |
| Logical operation with two attempts, one missing usage | Known attempt cost is retained, operation coverage is incomplete, and missing usage is not zero or inferred from success. |
| Inclusive agent total plus fully known child calls | Children and aggregate do not double count; inclusive total is derived or the aggregate is reconciliation evidence. |
| Inclusive total plus partially known children | Known children plus a named residual conserve the authoritative aggregate without inventing a hidden call. |
| Cached input and reasoning subsets | Input plus cache/reasoning is rejected as an additive total; rate components use the declared partition only. |
| Recorded zero versus unavailable | Zero may produce a known zero valuation; unavailable affects coverage and produces no invented sample. |
| Shared 101-unit amount split 50/50 | Deterministic 51/50 (or specified equivalent) remainder assignment; regroupings total exactly 101. |
| Work item reassigned during the capture interval | The declared event-time/report-time policy selects the expected path and records its version. |
| Rate changes at an interval boundary | Each observation matches exactly one dated rate; timezone and inclusive/exclusive boundary rules are fixed. |
| Unknown model alias or price | Observation is preserved, valuation is unavailable, and the profile reports excluded known usage. |
| Replacement, delta and ledger correction deliveries | Each FOCUS delivery style produces the same intended net, with no snapshot duplication. |
| Charge followed by credit | Gross, credit-magnitude and signed net agree; no negative folded width is emitted. |
| Subscription plus API-equivalent scenario | Actual allocation and counterfactual scenario remain separate and are never added as one expenditure. |
| Exact-integer and overflow boundaries | Values above JavaScript's safe integer survive JSON round trip; pprof `int64` overflow fails clearly. |
| Folded hostile names | Semicolons, spaces, control characters, duplicate labels and Unicode cannot merge or split identities. |
| Execution/work DAG and cycle | Multiple beneficiaries require allocation; cycles in a selected tree are rejected deterministically. |
| Cross-harness semantic equivalence | At least two native fixtures normalize to the same logical result and use the same downstream projector. |

Useful additional cases for the first adapter suite are cancellation before terminal usage, streaming terminal usage, delayed polling, fork/resume with inherited history, compaction, and opaque hosted-agent totals. These may establish incomplete coverage rather than a numeric answer; that is still a passing conformance outcome when expected explicitly.

## Acceptance gate for experimental v0.1

An experimental release is ready when:

- an independent producer can construct the bridge bundle from the specification and fixtures without importing flAImegraph;
- an independent consumer gets the golden selection, valuation and totals without harness-specific branches;
- two harness adapters pass the same semantic corpus and preserve their original evidence references;
- every profile references a manifest that explains basis, scope, allocation, coverage, losses and exact scale;
- all regroupings conserve selected monetary lines exactly, including deterministic rounding residuals;
- `go tool pprof` or another pinned real pprof consumer decodes the expected paths, labels and values, and the pinned FlameGraph renderer accepts the folded output;
- malformed identity, ambiguous authority, cycles, unknown required semantics and numeric overflow fail closed with machine-readable diagnostics.

Claims should remain “experimental interoperability profile” until compatibility is demonstrated by an implementation maintained independently of this repository. The stronger “stable” claim should require published migration evidence and at least one independent producer and consumer.

## Highest-risk implementation shortcuts

1. Treating every normalized telemetry row as a direct additive call.
2. Encoding a single `authority` rank without subject, grain, interval and selection rationale.
3. Calling an enterprise scenario `contracted` or `effective` cost without qualifying FOCUS evidence.
4. Rounding per token category or per allocation branch before deriving the monetary line.
5. Using ticket names, span names or timestamps as deduplication or frame identity.
6. Reporting one “coverage percent” when expected call count or financial denominator is unknown.
7. Making the pprof/folded converter aware of Codex, Pi or Claude source fields.
8. Letting negative corrections disappear because the selected renderer cannot draw them.
9. Publishing a JSON Schema without semantic golden tests and calling it conformance.
10. Reconstructing authoritative totals from rendered SVG geometry.

These checks keep v0.1 narrow while preserving a clean seam: adapters translate evidence; one selection and valuation module owns accounting; projection adapters consume only monetary lines and a manifest.
