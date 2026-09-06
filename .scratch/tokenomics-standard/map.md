# Find an interoperable foundation for tokenomics flame graphs

Label: wayfinder:map
Status: open
GitHub: https://github.com/awjreynolds/flAImegraph/issues/1

## Destination

Establish a proven route to detailed monetary cost analysis: capture observable work inside agent runs, connect model usage to operations and available context provenance, and support drill-down and aggregation from individual activity through tickets to epics. Build the evidence needed for later specification-to-delivery resource and enterprise-cost forecasts. Reuse existing and emerging standards; propose an upstream extension only for a demonstrated necessary gap outside existing and planned work.

## Notes

- Critical output requirement: a common, versioned, harness-independent export contract convertible to existing flame-graph formats. The [working design](../../docs/research/interoperable-export-contract.md) separates interoperable evidence from pprof/folded projections and requires shared semantics, validation fixtures and cross-harness proof.
- Subsequent clarification: develop that contract toward an open, independently implementable specification; flAImegraph is a reference implementation. Formal industry-standard status is not a prerequisite. Preserve adoption-first evaluation and do not claim endorsement or invent competing primitives where existing standards suffice.
- [Open interchange specification ticket](https://github.com/awjreynolds/flAImegraph/issues/24) is a prerequisite for shared fixtures, reconciliation interfaces, profile exports and the calibration dataset.

- Planning and evidence prototypes. The user authorised independent progress on 2026-09-06 and publication to their GitHub with scoped tickets. Production deployment remains outside this effort.
- User's motivating case: collect conversations, model usage, subagent work, retries, and resumed work under tickets and aggregate across epics; visualise tokenomics using flame graphs.
- User clarified that per-agent spend totals are insufficient. The destination requires detail about what the agent did, with meaningful drill-down and aggregation. Standards research alone does not satisfy this destination.
- Depth criteria and remaining evidence are recorded in [Detailed analysis readiness](../../docs/research/deep-analysis-readiness.md). Current-session Codex records and public Pi fixtures are the representative evidence; capture reconciliation and a source-checked prototype are complete; user review and browser verification remain outstanding.
- Existing workplace analysis is high-level. Its raw data and implementation have not been inspected.
- Do not assume a new exchange format is necessary. OpenTelemetry, OpenInference, FOCUS, and profile formats are candidates to evaluate, not selected architecture.
- User decision on 2026-09-06: avoiding duplication and understanding industry direction take priority over designing a new convention. A standards-based application or integration can fully satisfy this effort; a new standard is not a required outcome.
- Follow-up candidates: Pi and Codex; the intended “MyPi” project is unconfirmed. Include ACP's existing session usage and draft end-turn accounting in the assessment; see the ecosystem research note. These are candidates, not selected integrations.
- Consult wayfinder, research, grilling, and domain-modeling skills as appropriate. Research tickets can resolve in parallel; human decisions require the user's answer.
- GitHub issues are now canonical, using native sub-issues and blocking relationships. Local Markdown files are a migration snapshot and context pointer, not an independently maintained tracker.
- Research checked on 2026-09-06. Cite primary sources, identify draft/development status, and distinguish documented coverage, implementation limits, and unverified gaps.

- User clarification: monetary cost must drive flame-graph width. A token-width profile or time waterfall with cost annotations is insufficient. [Cost-baseline specification](../../docs/research/cost-baseline.md).
- Next scoped work: [Validate shortlisted profilers against the representative workflow](https://github.com/awjreynolds/flAImegraph/issues/20), using cost conservation and actual monetary-width rendering as acceptance criteria.
- User expanded the roadmap to selected enterprise-rate valuation, including subscription-origin usage, and forecasts from developed specifications/tickets. The [valuation and forecasting roadmap](../../docs/research/enterprise-valuation-and-forecast-roadmap.md) separates measurement, calibration, held-out evaluation and planning integration. ACEM's coefficients remain uncalibrated; existing sizing and empirical prediction research are candidates to test.
- [Forecasting epic](https://github.com/awjreynolds/flAImegraph/issues/21): [scope-to-outcome calibration dataset](https://github.com/awjreynolds/flAImegraph/issues/22) precedes [held-out estimator evaluation](https://github.com/awjreynolds/flAImegraph/issues/23). An [existing Pi estimator](../../docs/research/pi-cost-estimator-prior-art.md) supplies a concrete reuse candidate; its published session summaries do not demonstrate accepted-delivery forecast accuracy.

## Decisions so far

- [What AI usage and execution semantics already exist?](issues/01-telemetry-coverage.md): reuse substantial existing vocabulary; accounting-grain ambiguities and cost work are already being discussed upstream.
- [What cost and work-allocation semantics already exist?](issues/02-accounting-coverage.md): FOCUS supplies cost bases and allocation/correction rules; execution-to-financial evidence correspondence remains a candidate bridge.
- [Can existing profile formats faithfully visualise tokenomics?](issues/03-profile-projection.md): existing exporters can visualise selected measures; accounting meaning and projection losses require explicit treatment.
- [Should adoption take priority over a new tokenomics convention?](issues/04-standardisation-boundary.md): establish industry direction and reuse first; an extension requires a demonstrated necessary gap outside existing and planned work.

- [Which ticket workflow should test the existing standards?](issues/05-representative-workflow.md): this conversation and linked subagents plus public Pi evidence anchor the evaluation.
- [What detailed activity can the selected harness actually expose?](issues/06-detailed-capture.md): response accounting and lineage are demonstrated; request composition, hidden attempts and some auxiliary usage remain bounded gaps.

- [Compare deep profilers and native capture across other harnesses](https://github.com/awjreynolds/flAImegraph/issues/19): native inspectors and concrete multi-harness integrations narrow custom work to validated accounting, coverage and aggregation gaps.

## Not yet specified

- Migration and version handling where useful conventions are still developing; a roadmap item is not a deployed capability.
- Any upstream clarification or extension only after existing approaches fail the selected scenario and the relevant roadmap has been checked.
- Further analysis views revealed by testing detailed traces with the user, including comparisons across repeated efforts and outcomes.

## Out of scope

- Production ingestion, database selection, deployment, and a complete product build: these follow the planning destination.
- Claiming industry-standard status before independent implementation and external review.
- Designing a competing standard or schema on the assumption that this effort needs to own one.
- Production forecast deployment and model-routing optimisation; forecasting research and a calibration plan are now in scope.
