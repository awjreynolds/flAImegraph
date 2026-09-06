# Find an interoperable foundation for tokenomics flame graphs

Label: wayfinder:map
Status: open

## Destination

Establish a shared understanding of the existing and emerging standards for AI usage, cost, and profiling, then find a way to support ticket-to-epic flame graphs by adopting that work. Propose an upstream extension only if a necessary gap remains after checking released capabilities, planned work, and existing implementations.

## Notes

- Planning effort; no production implementation or external publication is authorised by this map.
- User's motivating case: collect conversations, model usage, subagent work, retries, and resumed work under tickets and aggregate across epics; visualise tokenomics using flame graphs.
- Existing workplace analysis is high-level. Its raw data and implementation have not been inspected.
- Do not assume a new exchange format is necessary. OpenTelemetry, OpenInference, FOCUS, and profile formats are candidates to evaluate, not selected architecture.
- User decision on 2026-09-06: avoiding duplication and understanding industry direction take priority over designing a new convention. A standards-based application or integration can fully satisfy this effort; a new standard is not a required outcome.
- Follow-up candidates: Pi and Codex; the intended “MyPi” project is unconfirmed. Include ACP's existing session usage and draft end-turn accounting in the assessment; see the ecosystem research note. These are candidates, not selected integrations.
- Consult wayfinder, research, grilling, and domain-modeling skills as appropriate. Research tickets can resolve in parallel; human decisions require the user's answer.
- Local Markdown tracker conventions: one child issue per file in issues/; Type, Status, Assignee, and Blocked by metadata. Unclaimed open tickets use Status: open. Resolutions go under Answer. The frontier is open, unclaimed children whose blockers are resolved, in numeric order.
- Research checked on 2026-09-06. Cite primary sources, identify draft/development status, and distinguish documented coverage, implementation limits, and unverified gaps.

## Decisions so far

- [What AI usage and execution semantics already exist?](issues/01-telemetry-coverage.md): reuse substantial existing vocabulary; accounting-grain ambiguities and cost work are already being discussed upstream.
- [What cost and work-allocation semantics already exist?](issues/02-accounting-coverage.md): FOCUS supplies cost bases and allocation/correction rules; execution-to-financial evidence correspondence remains a candidate bridge.
- [Can existing profile formats faithfully visualise tokenomics?](issues/03-profile-projection.md): existing exporters can visualise selected measures; accounting meaning and projection losses require explicit treatment.
- [Should adoption take priority over a new tokenomics convention?](issues/04-standardisation-boundary.md): establish industry direction and reuse first; an extension requires a demonstrated necessary gap outside existing and planned work.

## Not yet specified

- The precise compatibility assessment across released conventions, accepted drafts, producer implementations, and the selected work scenario.
- Migration and version handling where useful conventions are still developing; a roadmap item is not a deployed capability.
- Any upstream clarification or extension only after existing approaches fail the selected scenario and the relevant roadmap has been checked.
- How visual views expose accounting uncertainty and different attribution choices without implying false precision.

## Out of scope

- Production ingestion, database selection, deployment, and a complete product build: these follow the planning destination.
- Claiming industry-standard status before independent implementation and external review.
- Designing a competing standard or schema on the assumption that this effort needs to own one.
- Monetary forecasts or model-routing optimisation unless needed to clarify measurement versus valuation.
