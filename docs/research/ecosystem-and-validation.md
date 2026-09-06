# Existing implementations and candidate validation cases

Research date: 2026-09-06. This is a bounded documentation review, not a certification of the referenced projects. No software was installed or run, no private agent logs were inspected, and no external maintainers were contacted. Recommendations below are proposals for the next decision, not adopted standard requirements.

## Existing implementations materially overlap the idea

| Project or source | Documented capability | Implication for flAImegraph |
| --- | --- | --- |
| AgentSight's agentpprof | Converts local Codex and Claude Code histories into semantic operation profiles, including token-weighted views and pprof, folded-stack, and SVG exports. Its configurable stack is a projection over operation attributes. | AI usage flame graphs and standard profiler exports are already implemented concepts. Investigate reuse before creating another exporter. |
| Skiagram | Documents token- and cost-weighted flame graphs, regroupable hierarchy, and folded-stack output. | Regrouping project/session/model/token type is already prior art; a new visual hierarchy alone is a weak standardisation claim. |
| Traceburn | Documents SDK instrumentation, spans with usage/cost, cost-weighted flame graphs, and comparisons between runs. | Cost flame graphs and run comparisons are also existing product capabilities. |

Sources: [agentpprof documentation](https://github.com/eunomia-bpf/agentsight/blob/master/docs/agentpprof.md), [Skiagram README](https://github.com/TanvirAnjumApurbo/skiagram), [Traceburn README](https://github.com/TommyTranX/traceburn). These are first-party descriptions; this review has not independently validated output correctness or completeness. Marketing comparisons with other tools on those pages are not adopted as findings.

## AgentMeasure is especially relevant prior art

AgentMeasure describes an open measurement effort for agent-facing software and conformance outcomes that distinguish failures from insufficient evidence. Its core specification separates actual attempts from logical operations, retains external identifiers for correlation, and describes immutable attempt records with provenance for inferred grouping. Task identity is already present. This overlaps proposed accounting and evidence concepts directly. [Project overview](https://github.com/roy-tong/AgentMeasure), [core specification](https://github.com/roy-tong/AgentMeasure/blob/main/standard/CORE.md), [conformance pack](https://github.com/roy-tong/AgentMeasure/blob/main/conformance/pack/README.md).

The core document identifies draft compatibility 0.4 and revision 0.4.3 while also containing 0.4.4 sections. It lists graduation criteria including independent implementations. This is evidence of a developing proposal, not proof of industry adoption or conformance. A deeper versioned comparison and examination of its test vectors would be needed before choosing to reuse or extend it. This inspection does not establish whether it already covers every ticket/epic allocation case.

Its author has opened an OpenTelemetry discussion about [whether token/usage metrics count operations or attempts](https://github.com/open-telemetry/semantic-conventions-genai/issues/476). The question was open when inspected. That is a concrete existing discussion into which grounded examples may fit; it is not an accepted resolution.

## Real exporters already provide useful evidence, with different semantics

VS Code's Copilot monitoring documentation describes an agent span tree with propagated subagent ancestry. The same input/output token attributes appear on the root agent as session totals and on model-call spans as call usage. Consequently, blindly summing those attributes across all spans can count the same consumption twice. It also documents standard, canonical product-specific, and legacy namespaces. Supporting OTLP alone does not remove the need to understand the producer's semantics. [VS Code monitoring](https://code.visualstudio.com/docs/agents/guides/monitoring-agents).

Claude Code documents metrics, events, and optional traces. API-request events carry input/output/cache quantities, an API request identifier when available, and cost fields explicitly described as estimates. A client request identifier is documented for sufficiently recent versions. These fields make it a candidate validation source, but an estimated price must not become an invoice charge merely because it is exported as telemetry. [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage).

The above is documentation-level evidence. It does not prove that a particular installed version or this current conversation exports complete records. No capture was enabled during this research.

## Candidate scenarios to settle before a format

The following are deliberately synthetic accounting examples. Their arithmetic exposes choices; they are not measurements of the user's work. Each should eventually have a versioned input fixture and expected output or an explicit indeterminate result. These are proposed validation questions, not tests implemented during charting.

| Case | Evidence | Result or decision needed |
| --- | --- | --- |
| Aggregate plus detail | Agent total reports 1,500 input tokens; two child calls report 1,000 and 500 | Observed consumption is 1,500 if scope and complete coverage agree, not a 3,000 sum. A total/detail mismatch must remain visible. |
| Cache subset | A documented total-input measure is 10,000; 8,000 are reported as a subset served from cache | Total stays 10,000. Disjoint fresh/cache widths are 2,000 and 8,000 only when the source defines those relationships. A different provider's exclusive input counter needs a different mapping. |
| Reasoning subset | Output total 1,000; reasoning subset 600 | Output remains 1,000; any residual category needs an accurate label and justified scope, not an assumption that all residual tokens are visible text. |
| Two paid attempts | Failed attempt has measured usage 300; successful attempt 700; both belong to one logical operation | Operation count is one, attempt count two, accounted usage 1,000. If the failed attempt lacks usage, the total is not established. |
| Duplicate observations | SDK event and gateway span carry the same external request evidence | Merge observations only when identity and semantics justify it. A replayed import must not increase consumption. |
| Shared research | A measured operation costs USD 10 and supports two tickets; a declared allocation policy is 60/40 | Allocated charge is USD 6 and USD 4. Links to both tickets must not create USD 20. Without a policy, show unresolved allocation rather than select an arbitrary split. |
| Changed epic membership | A ticket moves from one epic to another after work occurred | Historical membership and current membership are different valid report choices. Two outputs agree only if they declare the same policy and as-of point. |
| Cost correction | USD 10 charge is followed by a USD -2 credit | Net cost is USD 8. A positive-width visual needs an explicit adjustments presentation; hiding the credit or treating its magnitude as spend changes meaning. |
| Incomplete capture | Some trace records are absent or usage is unreported | Show observed totals and the scope of incompleteness. A disabled trace sampler alone cannot guarantee capture completeness. |
| Different models | Two models each report 1,000 tokens | A combined reported count is possible with retained identities. It does not establish equivalent content, computational work, price, or value. |

## Candidate success condition

Given the same source evidence, the same versioned mappings, the same scope, and the same allocation/valuation policies, two independent implementations should yield the same selected total and flame-graph widths, or agree that a result is not determinable. The condition should permit different declared allocation policies; it should prevent silent policy differences from masquerading as measurement differences.

This condition is a proposed focus for the next human decision. Existing AgentMeasure conformance work must be compared before claiming the condition or its general approach is new. A useful project outcome may be a contribution to existing work plus a demonstrator, rather than ownership of a separate standard.
