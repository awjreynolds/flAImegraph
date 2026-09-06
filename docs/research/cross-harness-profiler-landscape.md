# Profilers and capture across coding harnesses

Research date: 6 September 2026. The comparison distinguishes native telemetry, adapters, trace backends, local profilers and aggregate usage dashboards. A tool's support for an OpenAI-compatible SDK does not establish that it captures an installed coding harness. Likewise, a skill or MCP integration that lets an agent query traces is not instrumentation of that agent.

## What the wider scan changes

There is already a substantial cross-harness analysis ecosystem. **Do not build an all-harness collector or full trace viewer from scratch as the default.** Evaluate native exports and concrete LangSmith/Langfuse/local-profiler integrations using the same accounting and depth fixtures. Extend a suitable adapter or add a reconciled profile projection where the evidence demonstrates a gap.

The two initial local Codex profilers were too narrow a basis for selecting the whole architecture. Their source-level accounting issues remain valid, but do not establish that every other integration has the same behavior. Conversely, first-party integrations can also contain normalization or completeness gaps. Each path needs its own capability assessment.

## Shared backends and existing conventions

**LangSmith** documents integrations for Claude Code, Codex, Cursor, Copilot Chat, Pi, OpenCode and DeepAgents Code. Its coding-agent metadata contract is concrete prior art: `coding-agent-v1` identifies runtime, integration, conversation and agent role, with availability tiers for fields such as model and repository. This is a LangSmith integration contract, not an independently adopted financial or token-accounting standard. Its scope does not by itself settle attempt completeness, invoice matching or per-source attribution. [Metadata contract](https://docs.langchain.com/langsmith/coding-agent-metadata-contract).

Its specific Codex plugin documents model/tool/subagent traces reconstructed from completed transcripts; the Claude plugin omits system prompts and delays interrupted-run flushes, while the OpenCode plugin builds trees from completed turns. These are concrete integration paths, with different fidelity. [Codex](https://docs.langchain.com/langsmith/trace-with-codex), [Claude Code](https://docs.langchain.com/langsmith/trace-claude-code), [OpenCode](https://docs.langchain.com/langsmith/trace-with-opencode).

**Langfuse** documents native Copilot OTLP ingestion and hook/plugin paths for Claude Code, Codex, Cursor, Kiro, OpenCode and Augment. Its overview explicitly distinguishes a VS Code MCP connection, which queries existing data, from collecting agent traces. It also acknowledges that hook-visible transcripts do not expose the assembled context. [Coding-agent integration overview](https://langfuse.com/resources/engineering/coding-agent-tracing).

Langfuse's Codex plugin offers a separate parser and trace reconstruction path, with uploaded-turn state. Its Pi plugin is explicitly experimental and documents generation/tool events, persistent turn numbering and subagent nesting. Neither should be assumed compatible with every new native storage generation or to observe every hidden provider attempt. [Codex plugin](https://langfuse.com/integrations/developer-tools/codex), [Pi plugin](https://langfuse.com/integrations/developer-tools/pi-agent).

**Phoenix/OpenInference** remains relevant as a reusable trace/evaluation backend. Its coding-agent skills, MCP setup and agent-assisted instrumentation workflow must not be mistaken for automatically capturing those coding agents' own internal calls. The inspected setup material describes agents querying traces and instrumenting application code. Harness-specific capture still needs a proven exporter. [Phoenix repository](https://github.com/Arize-ai/phoenix), [CLI setup behavior](https://github.com/Arize-ai/phoenix/blob/main/.agents/skills/phoenix-cli/SKILL.md). This bounded review did not certify a native Phoenix integration for every harness.

Backend portability must be checked at the actual adapter seam. LangSmith's SDK supports OTel/hybrid routing, but an individual TypeScript hook need not expose those choices simply because the SDK can. [SDK routing modes](https://docs.langchain.com/langsmith/log-traces-to-project). An OTLP endpoint is a transport boundary, not evidence that a backend understands every native cost field or aggregate scope.

## Source-backed shortlist by harness

| Harness | Concrete candidates | What must be checked before adoption |
| --- | --- | --- |
| Codex | Langfuse parser/plugin; LangSmith plugin; agent-profiler; AgentSight; Skiagram | New additive usage records, cache/reasoning mappings, compaction, copied history and root-turn ownership. [Dedicated integration audit](langsmith-codex-reuse.md), [local profiler audit](profiler-reuse-evaluation.md). |
| Claude Code | Native beta traces and raw API capture; agent-profiler; Langfuse and LangSmith plugins | Native attempt/final-request semantics versus transcript reconstruction, streaming revisions, compaction usage and exporter delivery. [Claude/Copilot report](claude-copilot-profilers.md). |
| Copilot in VS Code | First-party Agent Debug Logs, Chat Debug and Cache Explorer; native OTLP to a trace backend | Existing flow/context/cache views are substantial. Verify wrapper/native overlap, aggregate scopes and export fidelity. [Native debug tools](https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view), [Cache Explorer](https://code.visualstudio.com/docs/agents/agent-troubleshooting/cache-explorer). |
| Copilot CLI | Native OTLP/JSONL; Langfuse native OTLP integration | Per-call versus parent aggregates, response identity, content truncation and independently rooted terminal sessions. [CLI and integration evidence](claude-copilot-profilers.md). |
| Gemini CLI | Native DevTools; separate OTel/Genkit route; Skiagram | Native request inspection and estimated context buckets already exist. Skiagram discovery misses nested subagent files in the inspected versions. [Gemini report](gemini-opencode-profilers.md). |
| OpenCode | OpenCode Trace; official LangSmith plugin | Raw exchange capture versus completed-turn trees, transport boundaries, incomplete turns and cache-exclusive native bucket normalization. [OpenCode report](gemini-opencode-profilers.md). |
| Pi / OMP | Native Pi v4 ledger and OMP operational/OTel usage; Langfuse experimental Pi extension; LangSmith Pi integration | Distinct storage generations, auxiliary work, orchestration and child aggregates. Compatibility with a named Pi integration does not imply OMP compatibility. [Native evidence](pi-capture-fidelity.md), [Langfuse Pi](https://langfuse.com/integrations/developer-tools/pi-agent), [LangSmith Pi](https://docs.langchain.com/langsmith/trace-with-pi). |

The Claude/Copilot report includes one executed synthetic pure-parser check: first-row request deduplication retained an earlier usage value and ignored a later revision. Other new integration findings are documentation or static-source evidence, not live capture certification. The original Codex frozen capture and Pi public-fixture arithmetic are separate executed evidence checks.

## Depth checklist for evaluating a path

| Question | Passing evidence |
| --- | --- |
| Does it capture this harness? | Specific adapter/native exporter and tested installed version |
| Does it show internal work? | Individual model responses, tool records, outcomes and explicit delegation links |
| Does it capture attempts? | Attempt identity and error/final-usage handling, or clearly declared unobservability |
| Can totals be trusted? | Source-specific category semantics, duplicate handling, inherited-history ownership and reconciliation |
| Can context be explained? | Declared request-capture boundary, transformation lineage and measured/estimated component basis |
| Can work be regrouped? | Stable execution IDs, explicit work metadata/allocation and conserved quantities |
| Can the result be reused? | Export/API/parser boundary, data fidelity, licence and dependency review |
| Does it survive interruption? | Flush/replay/correction behavior demonstrated, including incomplete child work |

A local flame profiler is useful for aggregate structure, a trace backend for chronology and filtering, and a native inspector for exact request debugging where available. None of these names implies complete accounting. Compare them on the actual representative workflow before selecting the user-facing experience.

## Research boundary

Cursor, Kiro, Augment and DeepAgents Code are identified through concrete vendor integration documentation but are not source-audited in this pass. Other harnesses can be added when an intended workflow makes them relevant; an exhaustive catalogue would quickly become stale. The immediate goal is representative coverage across different capture models, with a versioned capability matrix that can grow.

## Decision and next validation

Use existing native inspectors and cross-harness backends as the starting point. For a local Codex parser, the inspected Langfuse parser offers a useful reusable boundary, but requires additive-record/lineage/compaction work before this capture can be accounted for faithfully. No audited integration is certified unchanged as a complete financial ledger.

[Validate shortlisted profilers against the representative workflow](https://github.com/awjreynolds/flAImegraph/issues/20) records the next concrete task. The implementation epic and component tickets are conditional on that comparison. A new viewer, collector, exchange schema or public standard is not a foregone conclusion.
