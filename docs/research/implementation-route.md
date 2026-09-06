# Implementation route after capture research

Decision-ready research, 6 September 2026. The route below is the working recommendation developed under the user's instruction to continue independently. It does not assert user acceptance of the prototype, select an unconfirmed “MyPi” project, or authorise production deployment.

## Build the analysis layer around existing evidence

The useful product is a profiler that joins and checks evidence, then exposes several linked views. Reusing one existing renderer is straightforward; making source accounting trustworthy is the difficult part. Start with a local command-line importer and existing profile exports, followed by the detailed viewer. No skill or MCP server is required to capture usage. A skill can help label work or explain a profile; MCP can later expose queries. Native hooks/extensions and OTLP exporters supply evidence where their actual implementation supports it.

The first offline adapter should target the **inspected Codex 0.153.4 additive records**, because a real four-agent capture now reconciles. Give older Codex snapshots a separate capability mode. Investigate **OMP native OTel and operational usage**, and **Pi v4 durable usage rows**, before writing replacement instrumentation. Installed-version verification comes first: current source, legacy docs and public fixtures represent different generations. “MyPi” remains a name to clarify when choosing an actual installation, not a blocker on this research.

Use a small local persistence layer for the initial vertical slice; SQLite is a reasonable implementation default, not an interchange standard. It needs transactionally stored observations and replayable derivations. A remote collector/database can follow deployment requirements later. Local versus remote, and CLI versus MCP, are packaging choices independent of the accounting model.

## Preserve three different relationships

1. **Execution:** conversations, root turns, agents, model operations, physical attempts where observable, tools, summaries and compactions. Parentage and causal links are explicit; timestamps alone do not prove them.
2. **Context provenance:** source content → retained/truncated/summary representation → appearance in a specific outgoing request. Origin, current role/representation and cache treatment are different axes. Summaries can have many source parents without an exact allocation of their tokens.
3. **Work and financial correspondence:** execution observations link to ticket/epic ownership and optionally valuation/billing records. A shared run has one observed quantity; work allocation can partition that quantity under a declared policy. An invoice line may reconcile many calls, not one.

These are application concepts, not a proposal for a new public protocol. Keep originals and mapping versions so evolving conventions can be remapped without losing evidence.

## What to adopt at each boundary

| Boundary | Starting point | Necessary local responsibility |
| --- | --- | --- |
| Live execution export | OTLP traces/logs and OTel GenAI semantics, plus harness-native attributes | Pin convention versions; declare call versus aggregate and operation versus attempt scope. |
| Harness-client usage | ACP session usage and evolving end-turn usage | Treat context occupancy/cumulative cost as their declared measures; do not infer a request ledger. |
| Durable capture | Native Codex records, Pi usage rows, OMP message/operational usage | Identity, inheritance, authority order, late observations, conflicts, and residuals. |
| Cost and allocation | FOCUS cost bases, allocation and financial correspondence | Separate local price estimates, provider reports, subscription equivalents and invoice evidence. |
| Aggregate profiles | pprof and folded-stack exports; existing renderers/viewers | Choose one declared measure per width, preserve identities, include projection metadata and loss warnings. |
| Detailed explanation | Linked execution, context and activity views | Preserve missing evidence and distinguish observations, arithmetic, estimates and counterfactuals. |

Evidence is in [telemetry coverage](telemetry-coverage.md), [accounting coverage](accounting-coverage.md), [profile formats](profile-projection.md), [Pi/OMP fidelity](pi-capture-fidelity.md), [actual Codex capture](codex-capture-validation.md), [context limits](context-attribution-limits.md), and [profiler source evaluation](profiler-reuse-evaluation.md). AgentMeasure and OMP/Pi already contain relevant accounting concepts; a novelty claim would be premature.

## Depth requires several linked views

A token flame graph answers where selected observed usage aggregates. A time-ordered activity view shows what occurred and overlaps. A request-input trend exposes growth and compaction. A context-residency view follows a source representation through successive requests. A comparison view can show repeated work, changed usage and outcomes between runs.

A single flame graph cannot represent all those axes honestly: aggregate x-position is not time, one tree cannot faithfully encode every multi-parent relationship, and missing context evidence cannot be recovered by finer categories. Clicking an aggregate should reveal source observations, nearby activity, identity/lineage, accounting basis and coverage. Semantic phases such as “research” can be recorded labels or explicitly marked classifications.

For source contribution, capture the final **client-side request after harness transformations**, not just tool-return text. Even that does not reveal hidden provider rendering. A locally exact tokenizer count of a text block remains an estimate of its contribution to a fully rendered request. Provide a declared attribution method and residual; do not proportionally force estimated children to look measured. Compaction and server-held state can leave attribution irreducibly opaque.

## First vertical slice and acceptance boundary

Deliver a versioned Codex importer into a replayable observation store, explicit root/subagent lineage, manual ticket assignment, reconciled token measures, and pprof/folded plus inspectable HTML output. Use one work owner per observation initially; make shared allocations explicit before enabling them. Prove idempotent reimport, preservation of repeated genuine calls, no inherited-history double counting, and clear missing-usage reporting.

Then validate native OMP/Pi capture with the same adversarial fixtures and add a bounded context-manifest hook where source code permits. A controlled run must include tool-output truncation, reappearance, a compaction, retries/cancellation, a subagent, a fork/resume, and delayed usage. Expected accounting should be independently specified before the implementation is exercised.

Do not gate the first useful token profiler on perfect invoice matching or unknowable per-source causality. Gate each claim on its actual evidence. The initial release may provide response-level usage and context trends while explicitly withholding exact per-file spend.

## Remaining uncertainty is bounded

- The actual installed Pi/OMP release path and runtime telemetry must be executed to confirm deployed coverage. Public main-branch code is insufficient.
- Provider retries hidden below the observed surface, failures without final usage, and opaque compaction can leave unknown consumption even when captured totals reconcile.
- Financial reconciliation requires real billing exports or a suitable provider account. Subscription usage alone cannot yield an actual per-call charge.
- A user's judgement of whether the drilldown answers their workplace questions still requires review of a runnable profile. Browser verification of the current throwaway HTML was blocked.

These are explicit validation tasks and product-feedback boundaries. The research is sufficient to scope implementation; there is no demonstrated need to invent a competing tokenomics standard.
