# Project plan: evidence-backed AI delivery measurement

**Status: experimental contract and reference implementation, checked 6 September 2026.** The immediate deliverable is an adoptable experimental standard with harness adapters, exact USD cost profiles and a visible demonstration using existing FlameGraph tooling. See the [integration evidence](implementation-evidence/integration.md) for current verification. Context Points provide the human-facing planning layer; their scale and forecasting method remain to be calibrated from evidence.

## Intent and boundaries

The project connects five questions without collapsing them into one number:

1. What work was specified, and what Acceptance Outcome counts as delivery?
2. What Attempts and Resource Usage were observed, with what Coverage?
3. What Valuation applies under a historical, enterprise-equivalent or repricing scenario?
4. How can the selected monetary measure be inspected in a Cost Profile such as a dollar flame graph?
5. Can a versioned Context Point estimate help people compare or forecast that work?

Context Points are the selected human-facing concept for sizing/comparing anticipated AI effort, analogous in use to T-shirt sizing, story points and function points. They are a planning measure with local semantics. Observed tokens, calls, context-related measurements, human/infrastructure resources, dollars and accepted outcomes remain separately named and versioned.

The project reuses existing standards where they fit: OpenTelemetry/OTLP for execution evidence, FOCUS concepts for financial quantities, and pprof/folded stacks for profile interchange. The result is an independent experimental bridge and semantic binding. It is not a formal industry-standard submission or an endorsement by those communities.

## Delivery sequence

### 1. Record full work evidence

Capture the complete evidence available for each scoped Work Item: source identity, Scope revision, Attempts, delegation, retries, failures, cancellations, budget caps, human review, rework, model/harness conditions and missing Coverage. Record the declared Acceptance Outcome and preserve changes to it. Keep direct observations, snapshots, aggregates, corrections and unknowns distinct so a repeated checkpoint is not counted as a new charge.

The existing dogfood capture and the [enterprise-rate prototype](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/enterprise-valuation) are baseline fixtures. The prototype's partial $41.046242 model-token subtotal is useful for demonstrating valuation and reconciliation; it is not a complete project bill or a calibrated Context Points dataset.

### 2. Publish the contract and conformance fixtures

Use the [Agent Cost Interchange 0.1 specification](../spec/0.1/README.md) as the experimental contract. It must define meanings and invariants as well as syntax: identity, quantity authority, work/attempt relationships, disjoint usage categories, valuation basis, completeness/coverage, allocation and projection. Keep normative field meanings separate from implementation guidance.

Conformance evidence should include duplicate and aggregate observations, snapshots, retries, delegated work, shared ownership, missing usage, corrections, dated/scenario prices, exact monetary conservation and profile decoding. A consumer rejects unsupported required semantics rather than silently interpreting an older version. Independent producer/consumer evidence is required before the binding is described as stable.

### 3. Add and verify native adapters

Implement adapters at the native evidence boundary for the harnesses selected by the project, beginning with the strongest available Codex/Pi/OMP evidence and adding comparable Claude, Gemini, Copilot or OTLP inputs where their semantics can be demonstrated. An adapter preserves source identity, version and missing coverage; it does not turn an aggregate snapshot into direct calls or infer hidden provider billing.

Each adapter needs sanitized fixtures, duplicate/lineage handling and a capability statement. Downstream profile conversion should consume the common contract rather than branch on harness-specific formats. New adapter or CLI paths are implementation work in progress until the integrated tests and artifacts are verified.

### 4. Produce dollar flame graphs

Apply a named, versioned Valuation to observed or forecast Resource Usage, retaining the original quantities and assumptions. Use exact fixed-point monetary arithmetic, explicit currency/scale and deterministic allocation so regrouping conserves the selected total. Unknown usage or rate dimensions remain visible as unpriced Coverage rather than invented zero or a claim of an invoice.

Project the selected monetary measure into pprof and folded stacks, then render through existing FlameGraph tooling. Preserve stable frame identity, attribution paths, profile metadata and the evidence manifest. The graph is a reproducible projection of valued evidence; it does not create missing provenance or prove complete capture.

### 5. Build the scope and outcome dataset

Join each versioned Context Points estimate to its Work Item, Scope/specification, Harness/Model conditions, all relevant Attempts, observed Resource Usage, selected Valuation and declared Acceptance Outcome. Retain the original estimate and every re-estimate. Keep human and infrastructure resources separate, include estimator overhead, and retain failed, interrupted and capped work.

Split specification-only estimates from repository-inspection or probe-assisted estimates. Hold out whole Work Items/repositories and later periods for evaluation. Do not use realized turns, final changed lines or observed retries as pre-execution features.

### 6. Calibrate the human point scale and forecast

Start with local, explainable anchors and compare Context Points with cohort medians, similar-work retrieval and calibrated regressions. Test whether points rank effort usefully, whether ranges cover observed outcomes, and whether the scale retains value across models, harnesses, policies and work classes. Report bias, error, interval coverage, expensive tails, drift and estimator cost.

Any points-to-resource or points-to-USD mapping is a versioned local forecast conditioned on a declared population, configuration and acceptance endpoint. It may be useful for planning without being universal. Recalibrate when the evidence, model, harness or policy changes, and preserve competing baselines when they perform better.

## Acceptance gates for this phase

- A producer independent of flAImegraph can emit the experimental contract, and a consumer can validate and project it with published fixtures.
- At least two harnesses map sanitized evidence into the same semantics, with source versions, limitations and Coverage retained.
- Exact USD cost profiles conserve selected monetary totals across Work Item, agent, model and other supported groupings.
- Existing pprof consumers and the vendored FlameGraph renderer accept the corresponding profiles, with decoded-value and rendered-geometry checks documented.
- The public demonstration remains visible and reproducible, including its assumptions and the partial $41.046242 baseline.
- The first scope/outcome records distinguish Context Points estimates from Observations and Valuations; no calibration claim is made until held-out evidence supports it.
- The maintainer verifies the integrated implementation and release artifacts before new CLI workflows are described as ready.

## Adoption and limits

The 0.1 implementation supplies the contract, eight fixture-tested adapter names, exact valuation, standard profile exports, the visible frozen demo and initial Work Item/estimate/outcome records. Independent producer adoption, complete live capture and held-out point-scale calibration remain future evidence gates. The broader research issues retain those requirements; completing this experimental reference release does not close them automatically.

Adopters can use Context Points immediately as a documented local planning convention, recording the scale version and preserving observed evidence for later calibration. The repository supplies an experimental vocabulary and contract, not a mandate for teams to replace their existing size measures. A team's points may be ordinal or numeric; the chosen anchors and comparisons must be explicit.

The research reviewed so far supports empirical calibration, separate resource accounting and declared valuation. It does not establish a universal Context Points scale, a fixed relation to tokens, exact per-source context billing, complete hidden provider usage or accepted-delivery cost from one attempt. Current standards and product conventions are inputs to an open interoperability experiment; adoption by this repository does not establish formal industry endorsement.

See the [Context Points proposal](context-points.md) for the term, minimum record and issue draft; [dogfooding](dogfooding.md) for the current evidence protocol; and the [interoperable export research](research/interoperable-export-contract.md) for the common-contract rationale.
