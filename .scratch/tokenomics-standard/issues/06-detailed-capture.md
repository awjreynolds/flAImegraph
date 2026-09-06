# What detailed activity can the selected harness actually expose?

Type: research
Label: wayfinder:research
Status: resolved
GitHub: https://github.com/awjreynolds/flAImegraph/issues/7
Assignee: Codex
Parent: ../map.md
Blocked by: 05

## Question

Using the representative workflow and exact selected harness version, what observable events, identifiers, per-call usage, delegation links, tool inputs/results, context changes, and timing can be captured? Verify the available records directly, distinguish cumulative observations from new usage, and classify each requested field as measured, derived, inferred, unavailable, or version-dependent. Map that evidence to existing ACP, OTel, and native export semantics before suggesting extensions. Do not infer complete capture from documentation alone.

## Answer

[The actual Codex capture](../../../docs/research/codex-capture-validation.md) reconciles 177 response usage records across four agents to 21,155,141 reported tokens at the frozen cutoff. Tools, root-turn/subagent links and compaction are visible; exact request composition, complete physical attempts and compaction cost are not established. [Pi/OMP source and fixture analysis](../../../docs/research/pi-capture-fidelity.md) identifies multiple storage generations, existing durable usage rows, operational usage and aggregate telemetry. [Context attribution limits](../../../docs/research/context-attribution-limits.md) define provider boundaries, and [profiler reuse evaluation](../../../docs/research/profiler-reuse-evaluation.md) identifies concrete adapter pitfalls. Use source-version-specific authority and reconciliation, rather than a generic transcript sum.
