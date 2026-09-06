# Find an interoperable foundation for tokenomics flame graphs

Label: wayfinder:map
Status: open

## Destination

Establish an evidence-backed route to a common tokenomics profiling model: identify what existing standards cover, demonstrate any unmet accounting and attribution needs, and decide the smallest interoperable contribution worth validating for potential industry adoption.

## Notes

- Planning effort; no production implementation or external publication is authorised by this map.
- User's motivating case: collect conversations, model usage, subagent work, retries, and resumed work under tickets and aggregate across epics; visualise tokenomics using flame graphs.
- Existing workplace analysis is high-level. Its raw data and implementation have not been inspected.
- Do not assume a new exchange format is necessary. OpenTelemetry, OpenInference, FOCUS, and profile formats are candidates to evaluate, not selected architecture.
- Consult wayfinder, research, grilling, and domain-modeling skills as appropriate. Research tickets can resolve in parallel; human decisions require the user's answer.
- Local Markdown tracker conventions: one child issue per file in issues/; Type, Status, Assignee, and Blocked by metadata. Unclaimed open tickets use Status: open. Resolutions go under Answer. The frontier is open, unclaimed children whose blockers are resolved, in numeric order.
- Research checked on 2026-09-06. Cite primary sources, identify draft/development status, and distinguish documented coverage, implementation limits, and unverified gaps.

## Decisions so far

- [What AI usage and execution semantics already exist?](issues/01-telemetry-coverage.md): reuse substantial existing vocabulary; accounting-grain ambiguities and cost work are already being discussed upstream.
- [What cost and work-allocation semantics already exist?](issues/02-accounting-coverage.md): FOCUS supplies cost bases and allocation/correction rules; execution-to-financial evidence correspondence remains a candidate bridge.
- [Can existing profile formats faithfully visualise tokenomics?](issues/03-profile-projection.md): existing exporters can visualise selected measures; accounting meaning and projection losses require explicit treatment.

## Not yet specified

- The validation corpus and practical capture boundaries, informed by accessible real-world agent records and the first accounting guarantee selected.
- The smallest portable accounting contract, after comparing the chosen guarantee with AgentMeasure and upstream GenAI conformance work.
- The extension, contribution, and adoption path once actual discrepancies are demonstrated; OTel and FOCUS already have overlapping active work.
- How visual views expose accounting uncertainty and different attribution choices without implying false precision.

## Out of scope

- Production ingestion, database selection, deployment, and a complete product build: these follow the planning destination.
- Claiming industry-standard status before independent implementation and external review.
- Monetary forecasts or model-routing optimisation unless needed to clarify measurement versus valuation.
