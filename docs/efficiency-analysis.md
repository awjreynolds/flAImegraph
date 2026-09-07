# Efficiency analysis and delivery runway

Implemented as an optional deterministic analyzer in experimental v0.4 on 7 September 2026. This contract distinguishes implemented calculations from the evidence needed to validate an optimization policy. It follows the [usage/pricing separation decision](adr/0001-separate-usage-from-pricing.md).

## Purpose

Evaluate how effectively a session turns available resources into accepted work. A subscription can remove incremental cash charges while scarce model capacity, provider allowances or a deadline still constrain delivery. The useful target is accepted work within those constraints; fewer tokens or cheaper calls alone do not establish a better execution policy.

Pricing analysis and efficiency analysis independently consume the same immutable evidence. Neither belongs in the capture path. An external analyzer can identify model-selection candidates, quantify measured workflow overhead, compare benchmark results and forecast delivery runway. Any model calls used by the analyzer must themselves be recorded as resource-consuming work.

## Evidence required

Reuse the usage meters, dimensions, timestamps, provenance and execution/context relationships defined by the core design. Join them to:

- Work Item identity, Scope revision, declared Acceptance Outcome, observed result and its evidence; preserve failures, cancellations and missing results.
- Task classification and its provenance, distinguishing a declared work type from a classification inferred later by an analyzer.
- Requested and actual model/version, reasoning configuration, harness configuration, routing policy/reason, tools and relevant input/context conditions at each decision.
- Attempt, delegation, retry, escalation, review and rework relationships so the analysis can account for the complete route to an outcome.
- Available capacity snapshots where exposed: meter identity, quantity/unit, account or shared-pool scope, observation time, reset window and coverage. Account-wide consumption cannot automatically be attributed to the profiled session.
- The analyst's chosen workload mix, quality threshold, latency/deadline constraints, comparison baseline and external capacity-policy version.

Record reported capacity separately from token usage. A provider's allowance or weighted consumption unit need not have a known conversion to tokens, and separate limits need not be interchangeable. Missing or stale capacity information limits a runway forecast; it must not be replaced with an inferred subscription-to-token exchange rate.

## What an analysis can conclude

| Analysis | Supported output |
| --- | --- |
| Session profile | Resource quantities by operation, task class, model, phase and attempt; context growth, reported cache behavior, retries and escalation patterns. |
| Outcome efficiency | Resource usage per accepted Work Item within a declared cohort, including resources spent on failures and rework. Report acceptance rate and latency alongside it; a cohort with no accepted work has no finite per-accepted-item ratio. |
| Model suitability | Candidates for a different model or reasoning configuration, with the task, evidence, quality/latency constraints and confidence shown. A large model on a short task is not by itself a verified mistake. |
| Optimization estimate | Predicted changes in resource usage for a proposed policy, including expected retries, escalation, context transfer and evaluation overhead. Keep token categories and model-specific counts separate; tokenizers and quota weights can differ. |
| Delivery runway | Estimated remaining accepted work over a declared horizon and workload mix, with the limiting resource pool and uncertainty identified. Monetary valuation is optional. |

For a measured before/after comparison, resource savings are the baseline quantities minus the candidate quantities for comparable accepted work, with the same coverage and counting semantics. Report the vector of token, capacity, time and other relevant resource differences; combine them into a score only under an explicitly chosen external objective. A candidate may improve one measure while worsening another.

For one homogeneous task class, one capacity pool and no reset or replenishment during the forecast horizon, a simple baseline is remaining capacity divided by estimated capacity consumed per accepted task, including failed attempts. Multiple pools, shared usage, reset windows and task classes require a constrained forecast. A raw token total cannot supply that forecast without a supported mapping to the limiting capacity.

## Benchmark and validation discipline

Compare equivalent task scope and acceptance criteria, record model/harness/tool versions and cache conditions, and include the full attempt chain. Account for elapsed time without summing overlapping parallel spans. Historical cohorts can suggest candidates but may be confounded: harder work may already have been routed to stronger models.

Evaluate candidate routing policies on held-out comparable tasks or controlled repeated trials before claiming a model choice was inferior. Report sample size, acceptance rate, quality evidence, latency distribution, resource distribution and uncertainty. Keep evaluation work isolated from production outcomes and include its consumption in the analysis overhead.

A weak model that fails twice before escalating may consume more capacity than starting with a stronger model. A stronger model that provides no measured outcome or latency benefit may consume capacity that could serve other tasks. Both are testable hypotheses; the capture records what happened and the analyzer owns the judgment.

The existing Context Points scale can supply declared task-size cohorts once calibrated. It is not a universal conversion between tasks, tokens and remaining capacity. Scope/outcome data and benchmark validation remain prerequisites for numerical optimization claims.

## Delivery criteria

- A session can be profiled and benchmarked without any pricing artifact.
- Findings distinguish measured facts, inferred classifications, alternative-policy predictions and validated comparisons, with references to their evidence.
- Resource and acceptance denominators include failures, review, retries and rework without double counting parent/child or aggregate/direct observations.
- Subscription-covered usage remains visible; unknown allowance rules or incomplete shared-account capture produce explicit forecast limitations.
- Candidate savings include analysis and execution overhead, and no quality or delivery improvement is claimed solely from a reduction in tokens.

The implementation exports `analyzeEfficiency`, `compareBenchmarks`, `deriveCandidatePolicyScenario`, `forecastRunway` and an Inspect AI JSON adapter through `flaimegraph/analysis`. The viewer exposes session findings, benchmark comparisons and editable runway inputs. The CLI and SDK make no provider calls and do not change routing automatically. Current comparisons provide exact resource ratios and mean sample latency; they do not fit a predictive model, estimate confidence intervals or calibrate a universal model ranking. Repository configuration advice remains an evidence-backed candidate to evaluate, not an automatic repair.

The analyzer reserves `elapsed_ns` and `elapsed_seconds` for wall-clock interval union. Generic duration, audio, video and compute meters remain additive according to the usage contract; free-text descriptions never change their meaning. Sub-nanosecond timestamps are retained, and unsupported union precision produces a limitation instead of truncation.

Exported analyses retain normalized input and options. `validateEfficiencyReport` recomputes the result from that evidence, so edited totals or findings cannot pass merely because their JSON shape looks valid. This establishes consistency with supplied evidence, not independent truth of a producer's assertions.
