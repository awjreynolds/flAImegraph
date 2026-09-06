# What AI usage and execution semantics already exist?

Type: research
Label: wayfinder:research
Status: resolved
GitHub: https://github.com/awjreynolds/flAImegraph/issues/2
Assignee: awjre (research investigator: telemetry)
Parent: ../map.md
Blocked by: none

Research branch: research/telemetry-coverage

## Question

What do current OpenTelemetry GenAI and OpenInference specifications and reference implementations already define for usage, model and reasoning settings, conversation/agent ancestry, retries, deduplication, cache and reasoning subsets, completeness, and business-work attribution? Which apparent gaps are truly unspecified, merely optional, or implementation-specific? Identify stability and revision evidence, inspect relevant existing issues, and provide an evidence table and concrete counterexamples.

## Answer

Resolved 2026-09-06 by primary-source investigation. GenAI/OI already cover substantial measurement vocabulary and operation structure. OTel's standardized counts may be billable rather than model-consumed; logical spans may include retries; aggregate usage overlaps call usage. Existing upstream discussions cover accounting grain, aggregation and delayed usage, and a cost proposal is open. A complete work-attribution and evidence-conservation contract was not found in the bounded audited surfaces; its novelty remains unproven, particularly given AgentMeasure.

Evidence and limitations: [AI telemetry coverage report](../../../docs/research/telemetry-coverage.md). Research context: branch `research/telemetry-coverage`, commit `0e4339e`; incorporated into planning branch as `4bbae14`.
