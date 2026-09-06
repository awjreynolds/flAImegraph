# Find an interoperable foundation for tokenomics flame graphs

Label: wayfinder:map
Status: open
GitHub: https://github.com/awjreynolds/flAImegraph/issues/1

## Destination

Establish a proven route to detailed tokenomics analysis: capture observable work inside agent runs, connect model usage to operations and available context provenance, and support drill-down and aggregation from individual activity through tickets to epics. Reuse existing and emerging standards; propose an upstream extension only for a demonstrated necessary gap outside existing and planned work.

## Notes

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

## Decisions so far

- [What AI usage and execution semantics already exist?](issues/01-telemetry-coverage.md): reuse substantial existing vocabulary; accounting-grain ambiguities and cost work are already being discussed upstream.
- [What cost and work-allocation semantics already exist?](issues/02-accounting-coverage.md): FOCUS supplies cost bases and allocation/correction rules; execution-to-financial evidence correspondence remains a candidate bridge.
- [Can existing profile formats faithfully visualise tokenomics?](issues/03-profile-projection.md): existing exporters can visualise selected measures; accounting meaning and projection losses require explicit treatment.
- [Should adoption take priority over a new tokenomics convention?](issues/04-standardisation-boundary.md): establish industry direction and reuse first; an extension requires a demonstrated necessary gap outside existing and planned work.

- [Which ticket workflow should test the existing standards?](issues/05-representative-workflow.md): this conversation and linked subagents plus public Pi evidence anchor the evaluation.
- [What detailed activity can the selected harness actually expose?](issues/06-detailed-capture.md): response accounting and lineage are demonstrated; request composition, hidden attempts and some auxiliary usage remain bounded gaps.

## Not yet specified

- Migration and version handling where useful conventions are still developing; a roadmap item is not a deployed capability.
- Any upstream clarification or extension only after existing approaches fail the selected scenario and the relevant roadmap has been checked.
- Further analysis views revealed by testing detailed traces with the user, including comparisons across repeated efforts and outcomes.

## Out of scope

- Production ingestion, database selection, deployment, and a complete product build: these follow the planning destination.
- Claiming industry-standard status before independent implementation and external review.
- Designing a competing standard or schema on the assumption that this effort needs to own one.
- Monetary forecasts or model-routing optimisation unless needed to clarify measurement versus valuation.
