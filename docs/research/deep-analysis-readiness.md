# Readiness for detailed tokenomics analysis

Status on 6 September 2026: **the research now supports a concrete implementation scope**. A real Codex capture has been inspected and reconciled, public Pi fixtures and current Pi/OMP source have been examined, existing profilers have been audited, and a throwaway profile has been generated. User acceptance and browser verification remain open. A production collector has not been built.

The requirement is to understand what an agent did at useful depth and aggregate across work, rather than report only per-agent spend. The evidence now distinguishes what is feasible from what requires more instrumentation.

| Analysis question | Established evidence | Remaining boundary |
| --- | --- | --- |
| Which responses consumed usage? | 177 response usage records in four Codex agents; all thread quantity totals reconcile | Response records are not proof of every physical provider attempt |
| What happened between responses? | 235 selected tool, delegation, file and compaction events | Complete call-to-tool parentage and provider-side activity are not demonstrated |
| Why did input change? | Input trend and a compaction marker; adjacent input changes from 236,561 to 31,758 | Exact source shares and compaction's own consumption are unavailable |
| Which material was reused? | Providers/harnesses expose parts of context and cache state | A per-request manifest after transformations is required; scalar cache totals do not identify sources |
| Can the data be regrouped? | Six token measures conserve totals across three profile groupings and every tree level | Ticket/epic labels in the demo are analyst assignments, not captured work IDs |
| Can existing implementations be reused? | Native Pi/OMP usage infrastructure and existing profile exporters are substantial prior art | Audited Codex adapters have concrete accounting and lineage shortcomings |
| Does the experience satisfy the user? | A self-contained prototype and explicit drilldown/evidence design exist | Browser loading was blocked by URL policy; interaction testing and user review remain open |

See [actual capture validation](codex-capture-validation.md), [Pi and OMP fidelity](pi-capture-fidelity.md), [context attribution limits](context-attribution-limits.md), and [profiler reuse findings](profiler-reuse-evaluation.md).

The user further clarified that **monetary cost must determine flame-graph width**. The initial token-only prototype does not pass that criterion; [cost-baseline evidence and acceptance rules](cost-baseline.md) now make cost valuation a prerequisite to the primary profile.

The public Pi cost demonstration now renders 471 positive recorded cost observations with the existing FlameGraph renderer. Its $42.5959075 model-price subtotal conserves integer nano-USD weights; the static PNG has been visually inspected. This proves monetary-width projection, not complete usage or invoice reconciliation. Two compactions have unreported usage, and 13 zero records do not prove free activity.

The [enterprise valuation and forecasting roadmap](enterprise-valuation-and-forecast-roadmap.md) adds a calibration dataset linking specifications to accepted outcomes. Detailed capture is a prerequisite, but the current four-agent conversation is a measurement fixture, not a representative training dataset or evidence of predictive accuracy.

## Working analytical policy

Keep observed usage, derived quantities, estimated context-source allocation and counterfactual savings distinct. Cache/reasoning detail can overlap input/output totals. Tool results may contribute to later model input without directly consuming model tokens. Compaction reduces context size while potentially adding work. Missing usage is not measured zero. No causal usefulness claim follows from token width.

Execution ancestry, context provenance and work/financial correspondence are separate relationships. Repeated model input across distinct calls is repeated consumption; duplicated observations, copied fork history and aggregate snapshots are not new work.

## What follows

[The implementation route](implementation-route.md) recommends an offline Codex vertical slice, native Pi/OMP reuse, a versioned observation/reconciliation layer, existing profile exports, and linked execution/context views. The wider [profiler comparison](cross-harness-profiler-landscape.md) makes native inspectors and concrete Langfuse/LangSmith integrations the starting point. Custom components are conditional on [comparative workflow validation](https://github.com/awjreynolds/flAImegraph/issues/20). The [GitHub wayfinding map](https://github.com/awjreynolds/flAImegraph/issues/1) tracks remaining review decisions; scoped implementation tickets distinguish build work from unresolved research.

The research does not establish universal capture completeness, workplace-data suitability, actual invoice cost, or a new standard. It establishes enough of the space to begin implementation with explicit capability and accuracy boundaries.
