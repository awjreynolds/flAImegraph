# Claude Code and Copilot: capture fidelity and existing profilers

Research date: 2026-09-06. This supplements [the telemetry overview](telemetry-coverage.md) and [Pi capture investigation](pi-capture-fidelity.md). Scope: primary documentation and public integration implementations; no private transcripts, installations, provider calls, or live backend tests. Product documentation describes current capabilities, while the source pins below identify the exact integration revisions inspected. A documented capability is not a deployment guarantee for an older installed runtime.

The evidence changes the product positioning: local agent flow views, nested tracing, context inspection, and cache diagnostics already exist. The more defensible opportunity is a portable capture and reconciliation layer that states what it observed, preserves raw evidence, and distinguishes exact reported usage from inferred attribution and missing work.

## Native capture surfaces

| Surface | Verified capture | Consequence for flAImegraph |
| --- | --- | --- |
| Claude Code | Opt-in beta spans cover interaction → model/tool, including nested Agent/Task calls. Model spans expose Anthropic request ID, final client-request ID, attempt count, attempt events, and usage/cache counts. TRACEPARENT supports external correlation. Raw API bodies can be written untruncated to files. Compaction exposes approximate before/after sizes. | Native evidence is richer than transcript reconstruction. Crucially, `subagent_completed.total_tokens` measures the **final request footprint**, not cumulative subagent expenditure. Source: [Claude monitoring](https://code.claude.com/docs/en/monitoring-usage). |
| Copilot CLI | Native OTLP or JSON-lines file export; conversation, turn, interaction and response IDs; model/tool/agent hierarchy; per-call usage, cache counts, cost and AI units. Content capture includes system instructions. Parent agent spans also contain aggregate usage. | Treat parent totals as checks, not additional consumption. The reference does not establish a durable accounting-event ID, settlement/revision rules, or complete per-attempt billed-usage coverage. Source: [CLI monitoring reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring). |
| Copilot in VS Code | Nested subagent traces, per-call and parent aggregate usage, content capture, file export and optional SQLite span persistence. Embedded Copilot SDK spans share the wrapper trace; separately launched terminal CLI sessions have independent roots. Claude sessions have an additional extension-generated tracing surface. | Do not merge observations solely by service/session labels or assume every visible CLI root connects to its launcher. Establish observation authority when native and wrapper instrumentation coexist. Source: [VS Code monitoring](https://code.visualstudio.com/docs/agents/guides/monitoring-agents). |

Two distinctions matter for the protocol design. A response ID identifies a provider response, whereas a turn or trace identifies orchestration: these are different grains. Also, capturing the effective prompt enables investigation but does not itself provide a provider-verified token allocation to every source file or tool result. Those allocations require an explicit measurement or estimation method.

The native references above are sufficient to reject “these harnesses only expose coarse cost metrics.” They are insufficient to certify complete billable consumption under crashes, cancellation, retries, hidden requests, or delayed settlement. Those require controlled fixtures and runtime experiments.

## Existing deep profiling, beyond dashboards

A dashboard groups counts and costs by date, model, developer, or session. A profiler lets an engineer inspect a particular execution and connect an expensive request to context, tools, and delegated work. All three integrations below offer more than aggregate dashboards; their capture fidelity still differs.

### First-party VS Code tools are substantial prior art

Agent Debug Logs has persistent historical sessions, a chronological/tree log, an agent flow chart, summaries, and OTLP JSON export/import. Chat Debug exposes complete request/response details, including system prompts and tool payloads. These are useful local debugging facilities already shipped or documented in preview. [VS Code debugging documentation](https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view).

Cache Explorer compares consecutive requests with a prefix diff, shows cache-hit and latency information, and expands system instructions, tool definitions, and messages around the first divergence. Thus a context/cache visualization alone is not a new product category. [Cache Explorer documentation, dated 2026-09-02](https://code.visualstudio.com/docs/agents/agent-troubleshooting/cache-explorer).

### 1. agent-profiler: a local Claude/Codex transcript profiler

Pinned revision: [`DevonPeroutky/agent-profiler@aac6cf9478cd8fc3936e7026b905e1c904f19bbd`](https://github.com/DevonPeroutky/agent-profiler/tree/aac6cf9478cd8fc3936e7026b905e1c904f19bbd), commit dated 2026-05-23.

The project offers trajectory, agent/skill flow and summary views, reads local transcripts without a hook or hosted collector, and has Claude Code and Codex adapters. Copilot is absent from the inspected adapter registry. This is direct local-profiler prior art, not a generic observability dashboard. [README](https://github.com/DevonPeroutky/agent-profiler/blob/aac6cf9478cd8fc3936e7026b905e1c904f19bbd/README.md), [registry](https://github.com/DevonPeroutky/agent-profiler/blob/aac6cf9478cd8fc3936e7026b905e1c904f19bbd/lib/adapters/registry.js).

Its Claude transformer deduplicates usage by `requestId`, selects the first eligible row, and excludes API-error rows and rows lacking request IDs or usage. Inference timing comes from surrounding transcript timestamps; it is reconstructed elapsed time. The transformer retains structurally unmatched subagents separately, a useful alternative to fabricating a parent. [Transformer](https://github.com/DevonPeroutky/agent-profiler/blob/aac6cf9478cd8fc3936e7026b905e1c904f19bbd/lib/claude-code/traces.js#L337).

A small synthetic experiment directly invoked the downloaded pure `dedupeUsagesByRequestId` and `totalUsage` functions with Node, without installation or session access:

| Input rows | Observed output tokens |
| --- | ---: |
| Same request ID, identical usage of 2 then 2 | 2 |
| Same request ID, usage revised from 2 to 9 | 2 |
| Usage of 9 with no request ID | 0 |
| Usage of 9 marked `isApiErrorMessage` | 0 |

This verifies an assumption, not a claim that real current Claude transcripts necessarily violate it. Compare the last-row policy in the two plugins below. A portable adapter needs a versioned rule for duplicate snapshots versus final revisions, plus an unknown/incomplete state instead of silently equating excluded observations with zero consumption.

The reader drops an unterminated final line and silently skips malformed JSON; it reads direct sibling agent files rather than recursively traversing workflow subdirectories. These choices trade strict completeness for a usable live viewer. [Reader](https://github.com/DevonPeroutky/agent-profiler/blob/aac6cf9478cd8fc3936e7026b905e1c904f19bbd/lib/claude-code/transcripts.js).

The architecture explicitly says exact per-tool/per-skill token attribution is not directly recoverable from this transcript representation. That limitation should remain visible in any derived flamegraph. [Architecture, token attribution](https://github.com/DevonPeroutky/agent-profiler/blob/aac6cf9478cd8fc3936e7026b905e1c904f19bbd/ARCHITECTURE.md#token-attribution).

### 2. Langfuse: Claude hooks and native Copilot OTLP

Pinned Claude plugin: [`langfuse/claude-observability-plugin@169ddfac42a6836f0017f1f8ff1396ff6c67e12f`](https://github.com/langfuse/claude-observability-plugin/tree/169ddfac42a6836f0017f1f8ff1396ff6c67e12f), commit dated 2026-09-03.

Its Stop and SessionEnd hooks reconstruct turn traces, generations, tools, nested subagents and workflow agents. The integration supports skill tags, optional injected skill content, images, cache-write lifetime splits and external trace parents. This is detailed trajectory capture. [README](https://github.com/langfuse/claude-observability-plugin/blob/169ddfac42a6836f0017f1f8ff1396ff6c67e12f/README.md), [hook configuration](https://github.com/langfuse/claude-observability-plugin/blob/169ddfac42a6836f0017f1f8ff1396ff6c67e12f/hooks/hooks.json).

Implementation findings: assistant chunks merge by `message.id` using the last row's usage; timing is backdated from transcript timestamps; state tracks incremental emission and deferred agents. Most consequentially, code acknowledges both a crash duplicate window and a loss window: progress persists before SDK flush, so a failed flush can leave never-delivered spans marked emitted. Flush/shutdown is capped at five seconds. These are concrete reasons telemetry delivery cannot be treated as an accounting ledger. [Hook implementation](https://github.com/langfuse/claude-observability-plugin/blob/169ddfac42a6836f0017f1f8ff1396ff6c67e12f/hooks/langfuse_hook.py#L1213), [delivery limitation](https://github.com/langfuse/claude-observability-plugin/blob/169ddfac42a6836f0017f1f8ff1396ff6c67e12f/hooks/langfuse_hook.py#L3256).

For Copilot, Langfuse accepts native OTLP from CLI or VS Code and maps agent/model/tool spans into its trace UI. It ingests traces only: exported metrics/events do not become stored Langfuse signals. Content opt-in and attribute truncation determine how much context survives. A collector intended for reconciliation must therefore preserve any additional signals it needs before routing traces to this backend. [First-party Copilot integration](https://langfuse.com/integrations/developer-tools/github-copilot).

### 3. LangSmith: lifecycle hooks and a coding-agent metadata contract

Pinned plugin: [`langchain-ai/langsmith-claude-code-plugins@98debbc0c16bb6b181c06a64bca0b0b1b60e63ea`](https://github.com/langchain-ai/langsmith-claude-code-plugins/tree/98debbc0c16bb6b181c06a64bca0b0b1b60e63ea), commit dated 2026-08-20.

Its hook configuration covers prompt submission, tools, Stop/StopFailure, subagent completion, compaction and session end. It is richer than a stop-only exporter. [Hook configuration](https://github.com/langchain-ai/langsmith-claude-code-plugins/blob/98debbc0c16bb6b181c06a64bca0b0b1b60e63ea/hooks/hooks.json).

The parser groups streaming chunks by `message.id` and takes final-chunk usage. Its LangSmith usage mapping adds ordinary input, cache reads and cache creation to inclusive input, retaining cache details separately. This differs from a raw Anthropic noncached-input field and must be normalized before comparisons. [Transcript parser](https://github.com/langchain-ai/langsmith-claude-code-plugins/blob/98debbc0c16bb6b181c06a64bca0b0b1b60e63ea/src/transcript.ts#L241), [usage mapping](https://github.com/langchain-ai/langsmith-claude-code-plugins/blob/98debbc0c16bb6b181c06a64bca0b0b1b60e63ea/src/langsmith.ts#L122).

It already defines `coding-agent-v1` metadata with runtime/version, session, turn, subagent and skill identity. This is relevant schema prior art for cross-harness interoperability. [Metadata contract implementation](https://github.com/langchain-ai/langsmith-claude-code-plugins/blob/98debbc0c16bb6b181c06a64bca0b0b1b60e63ea/src/metadata.ts).

The PostCompact hook emits a chain run containing the summary, trigger and elapsed interval, but does not attach model usage. A visible compaction event therefore does not establish its token cost. [PostCompact implementation](https://github.com/langchain-ai/langsmith-claude-code-plugins/blob/98debbc0c16bb6b181c06a64bca0b0b1b60e63ea/src/hooks/post-compact.ts).

Documentation says assembled system prompts are absent from conversation transcripts. Interrupted turns flush later, and interrupted subagent child runs may be missing because subagents are traced on completion. These limitations apply to this integration path, not to every current native Claude telemetry mode. [LangSmith Claude integration](https://docs.langchain.com/langsmith/trace-claude-code).

## Recommended prototype boundary

These are design deductions from the evidence above, not claims that all missing fields must become a new standard:

1. Accept native OTLP/file captures and transcript adapters as distinct evidence sources, recording harness version, adapter revision, capture options and truncation/malformed-record diagnostics.
2. Preserve raw events; normalize a separate usage ledger with response identity, logical operation and attempt identity, measurement source, observation revision and completeness. Re-importing the same evidence should not increase totals.
3. Use model-call observations as the counting grain; retain aggregate parent values for reconciliation. Never sum parent usage into the same total as its children.
4. Represent structural parentage, externally linked spans, and unresolved edges separately. Do not repair missing causal identity by timestamp proximity.
5. Separate reported request usage, observed context size, and estimated tool/file allocation. A context diff and a financial ledger answer different questions.
6. Use existing viewers or their exports for the first comparison. A convincing differentiator is detecting a missing/revised/double-counted contribution with an evidence trail, not reproducing their flowchart.

Before claiming end-to-end exactness, test duplicate/revised usage, retries after dispatch, cancellation during a subagent, asynchronous completion after its initiating turn, compaction, malformed/truncated capture, exporter outage, and wrapper/native duplicate observation. No such completeness certification was performed in this research.
