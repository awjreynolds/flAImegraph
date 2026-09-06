# Context Points

**Status: experimental proposal, checked 6 September 2026.** This document adopts a human-facing planning concept and describes how it can be measured and calibrated. It does not define a universal numeric scale, an industry standard or a conversion formula.

## The concept

Context Points are a human-facing way for a person or team to size and compare anticipated AI effort for a specified Work Item and Acceptance Outcome under stated working conditions. The idea is intentionally familiar: a team can discuss a Context Points estimate in the same planning conversation where it uses T-shirt sizes, story points or function points, while keeping the concepts distinct.

The name describes the work setting and the evidence around an estimate. A Context Points value does not measure context-window occupancy, tokens, request count, dollars or the number of files an agent touches. Those are observations or valuations that may help explain a result and must be recorded separately.

The useful question is: “Given this scope, acceptance endpoint and working setup, how much AI effort do we expect relative to work we have already seen?” The answer is a versioned human estimate until a local scale has enough evidence to support reliable comparison or forecasting.

## Separate the planning and evidence layers

| Layer | Question | What is recorded | What it means |
| --- | --- | --- | --- |
| Context Points estimate | How much AI effort do we expect? | Point value or range, scale version, estimator, confidence and timestamp | A human-facing relative size for planning |
| Observation | What happened during the work? | Attempts, resource quantities, activity, provenance and coverage | Evidence that may be partial, repeated, aggregate or unavailable |
| Valuation | What is that usage worth under a chosen basis? | Currency, rate source or scenario, date, assumptions and calculation version | A declared financial interpretation, which may be contractual or hypothetical |
| Cost Profile | How should valued evidence be compared? | Selected monetary measure, grouping and attribution | A reproducible view of valued work |
| Acceptance Outcome | Did the specified work meet its endpoint? | Declared endpoint, result and time | The outcome used to judge delivered work |

A point estimate and an observed metric answer different questions. Both are valuable when their definitions, versions and uncertainty stay visible. One successful Attempt is not automatically the cost or outcome of an accepted Work Item; failed, cancelled, capped, reviewed and reworked Attempts belong in the evidence as well.

## Rules for a useful estimate

1. Name the Work Item, Scope revision and Acceptance Outcome before assigning points.
2. Record the Context Point Scale version, its anchors, the estimation moment and whether the estimate came from an individual, a team or a model-assisted process.
3. Use a point value or range with a confidence or rationale appropriate to the scale. A coarse ordinal scale is acceptable while the evidence is small; a numeric scale does not acquire more meaning merely by having more numbers.
4. Keep the original estimate when Scope, acceptance criteria, repository state, Harness, Model or execution policy changes. A re-estimate is a new version with a reason.
5. Compare points only within a named scale version, or publish a separately supported mapping between versions. Do not silently translate a team's scale into another team's scale.
6. Preserve observed Resource Usage and its categories independently of the points. Recorded zero, unavailable, estimated and unknown quantities are different states.
7. Keep Valuation separate from both the estimate and the Observation. A selected enterprise scenario can value captured usage without rewriting what was observed or claiming that the result is an invoice.
8. Do not derive a universal point value from a token or dollar total. A local relationship may be tested after calibration, with its uncertainty and scope stated.

Context Points can coexist with existing size measures. Function points describe delivered or specified functionality, story points describe a team's relative delivery sizing convention, and T-shirt sizes provide coarse communication. A Context Points record may reference any of them as scope context without renaming one measure as another.

## Minimum record for adoption

An adopter should retain enough information to answer “what was estimated, for which work, under which scale, and what happened later?” The conceptual record includes:

- a Work Item identity, Scope/specification revision and Acceptance Outcome;
- the Context Point Scale version, point value or range, estimator, confidence, basis and timestamp;
- the Harness, Model and execution conditions that define the comparison;
- every relevant Attempt, including failure, cancellation, budget cap, escalation, review and rework;
- Observations with their source identity, resource categories, measurement/estimation provenance and Coverage;
- any Valuation and Cost Profile references used for financial comparison; and
- the resulting outcome, subsequent Scope changes and any recalibration decision.

This record supports a planning conversation without requiring raw prompts, tool results or reasoning text. It also preserves the evidence needed to discover when a point scale is stable only for one team, Harness, Model or work class.

## Calibration remains empirical

The project does not currently choose a Context Points formula. Calibration should begin with a small set of human anchors and completed Work Items, then test whether the scale is repeatable and useful for decisions. The test set should join the original estimate to complete, failed and interrupted Attempts, observed Resource Usage, selected Valuation, configuration and the declared Acceptance Outcome.

Useful checks include:

- whether different estimators rank comparable Work Items similarly;
- bias, error and interval coverage for any point-to-resource or point-to-outcome forecast;
- performance on unseen Work Items, repositories and later time periods;
- sensitivity to Harness, Model, reasoning, tool permissions, retry policy and acceptance endpoint;
- expensive failures, estimator overhead and the value of changing a model, budget or work split; and
- whether a point display improves planning after its own cost and uncertainty are included.

The first baselines should include team sizing, a cohort median, recent similar-work retrieval and a calibrated regression. Probe-assisted estimates are a separate condition because the probe consumes resources and can perform work. Any mapping from points to tokens or USD is a local, versioned forecast with a stated population and uncertainty; it is not a property of the word “point.”

## Open interoperability and current status

flAImegraph is working toward an independent, open experimental contract that can be implemented without this repository. It reuses existing vocabulary and encodings where they fit: OpenTelemetry/OTLP for telemetry, FOCUS concepts for financial quantities, and pprof or folded stacks for profile interchange. Reuse and mapping do not constitute formal industry endorsement, and the project will publish conformance evidence before calling a binding stable.

The practical sequence is [full work evidence](project-plan.md#1-record-full-work-evidence) → [versioned contract and conformance](project-plan.md#2-publish-the-contract-and-conformance-fixtures) → [native harness adapters](project-plan.md#3-add-and-verify-native-adapters) → [exact USD cost profiles](project-plan.md#4-produce-dollar-flame-graphs) → [scope and accepted-outcome data](project-plan.md#5-build-the-scope-and-outcome-dataset) → [Context Points calibration and forecasting](project-plan.md#6-calibrate-the-human-point-scale-and-forecast). The existing public prototype is a baseline demonstration: its enterprise scenario reports a partial $41.046242 model-token subtotal from a frozen capture. It does not validate a point scale or represent the whole project's cost.

The repository now contains a working experimental reference implementation, with its integration evidence documented in [the integration report](implementation-evidence/integration.md). Calibration and broader adoption remain future work; the existing prototype links remain useful for review while maintainers verify the new CLI workflows and cross-harness claims.

## GitHub issue draft

The proposal was published as [GitHub issue #25](https://github.com/awjreynolds/flAImegraph/issues/25). The draft below remains the design record for that issue.

### Suggested title

Adopt Context Points as an experimental human-facing AI effort measure

### Suggested body

#### Intent

Give teams a clear way to discuss and compare anticipated AI effort for a specified Work Item and Acceptance Outcome. Context Points should feel as approachable as T-shirt sizing, story points or function points while preserving the difference between human estimates, observed resource usage, financial valuation and accepted delivery.

#### Proposed work

1. Define a versioned Context Points vocabulary and a small set of local anchors without declaring a universal numeric scale.
2. Record each estimate with Work Item, Scope revision, Acceptance Outcome, working conditions, scale version, confidence and estimator.
3. Preserve complete work evidence, including retries, delegation, failures, cancellations, budget caps, human review, rework and missing coverage.
4. Conform the evidence to the open experimental interchange contract, then add native adapters and exact USD valuation/profile projections.
5. Join estimates and observed resource vectors to accepted outcomes so that point scales and forecasts can be calibrated on unseen work.
6. Publish the uncertainty, version changes, limitations and conformance evidence with every supported mapping.

#### Boundaries

Context Points are not tokens, dollars, context-window occupancy, a replacement for function points, or a claim that an AI point scale is already validated. No points-to-token or points-to-dollar exchange rate is fixed by this issue. A rate-card scenario remains a Valuation, and a flame graph remains a projection of observed/valued evidence.

#### Acceptance evidence

- Human estimates and observed metrics are separately versioned and remain traceable to the same Work Item and Acceptance Outcome.
- Existing OTLP/FOCUS/pprof/folded conventions are reused or mapped with explicit semantics; reuse is not represented as formal industry endorsement.
- At least two harnesses can produce comparable evidence through independently checkable adapters and fixtures.
- Point-scale calibration reports ranking quality, error/coverage, drift and expensive failures on unseen work, with estimator overhead included.
- The public prototype and any new CLI path are described as demonstrations until integration and release verification are complete.
