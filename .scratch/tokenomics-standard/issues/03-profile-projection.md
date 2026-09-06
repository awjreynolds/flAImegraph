# Can existing profile formats faithfully visualise tokenomics?

Type: research
Label: wayfinder:research
Status: resolved
Assignee: awjre (research investigator: profiles)
Parent: ../map.md
Blocked by: none

Research branch: research/profile-projection

## Question

Can folded stacks, pprof, Speedscope, or OpenTelemetry Profiles express token- and cost-weighted agent work while preserving units, self/inclusive semantics, attribution, provenance, and incomplete evidence? Distinguish exchange of source evidence from a derived visual projection. Evaluate tree versus DAG, shared work, parallelism, signed cost adjustments, and multiple measures; identify what is specified, what can be encoded, and what interoperable meaning remains undefined.

## Answer

Resolved 2026-09-06 by specification and source-code investigation. Existing formats suffice for useful projections, with materially different unit, sign, precision and metadata constraints. Pprof supports multiple measures; current Alpha OTel Profiles has one measure per Profile and native trace links. Neither these encodings nor a renderer establish business allocation or accounting completeness. No new profile format is justified by this research alone.

Evidence and limitations: [Profile projection report](../../../docs/research/profile-projection.md). Research context: branch `research/profile-projection`, commit `b288b9f595d60ce76634461b6640da3dc6eb9e75`; incorporated into planning branch as `463b1cb`.
