# herdr and AgentScope capture boundaries

Research date: 7 September 2026. Decision evidence for [How can herdr-managed agents expose evidence, informed by AgentScope?](https://github.com/awjreynolds/flAImegraph/issues/37), under [Find a practical telemetry capture route for developer harnesses](https://github.com/awjreynolds/flAImegraph/issues/34).

## Finding

A herdr plugin is a plausible packaging, setup and session-association layer for TScope. Per-operation usage still needs an underlying harness source. AgentScope provides an example of automatic internal instrumentation, not a requirement to replace the user's harness. The later route ticket owns the packaging decision; nothing here is an implemented connector or live compatibility proof.

## User-supplied plugin example

Inspected `herdr-agent-quota` identifies itself as version 1.3.0 with minimum herdr version 0.8.0. Its manifest exposes startup/refresh/configure actions and hooks for pane detection, agent-status changes and pane focus. These are automatic manager events, not callbacks for every model request and tool execution. This supplies concrete prior art for installing and running a collector companion.

Source: [Plugin manifest](https://raw.githubusercontent.com/levi-qiao/herdr-agent-quota/main/herdr-plugin.toml). The URL is a moving `main` reference; pin a commit before implementation.

The documented install path uses a clone and install script, offers selection/configuration of agents and display fields, and may repair integrations and require restarting existing panes. The project says it does not generate model requests for its checks and leaves credentials with the owning CLI. Its provider quota observations are distinct from recorded work consumption.

Source: [Plugin README](https://raw.githubusercontent.com/levi-qiao/herdr-agent-quota/main/README.md).

The refresh implementation queries herdr's agent inventory, matches pane identity and harness, uses native session identity for local diagnostics and publishes metadata. It polls/debounces work-state changes; its Oh My Pi route invokes `omp usage --json --provider`. Provider windows, context percentage, account/model display and cache-rate observations should remain snapshots. Do not add them to individual response receipts or treat a changing allowance as usage attributable to a particular pane.

Source: [Refresh implementation](https://raw.githubusercontent.com/levi-qiao/herdr-agent-quota/main/src/refresh.rs).

## Manager-to-harness identity

herdr owns terminals and detects/manages agent state while retaining the native CLIs. Its integrations can provide pane/socket context and native agent-session references. A candidate collector should join the manager session/host namespace, pane ID, harness and native session identity, then deduplicate usage with the native response or usage-row identity. A pane and its native session are not interchangeable identifiers.

A detached terminal can keep running. Restoring a native agent session requires an available valid session reference; restored layout alone does not prove resumed agent execution or complete telemetry. Socket reconnection and reconciliation are needed where attachment or subscriptions change. These are design implications, not tested recovery behavior in flAImegraph.

Sources: [herdr integrations](https://herdr.dev/docs/integrations/), [Socket API](https://herdr.dev/docs/socket-api/), [Session state](https://herdr.dev/docs/session-state/), [Persistence and remote access](https://herdr.dev/docs/persistence-remote/). Exact socket behavior and identity propagation require validation against the selected herdr release.

## AgentScope reference boundary

AgentScope middleware has distinct hooks around reply, reasoning, model calls, tool acting, permissions, context compression and system-prompt changes. This illustrates where a cooperating harness can expose evidence automatically. Tracing can retain session/model/response/tool identifiers and usage fields; stream closure depends on terminal response handling. Tool acting alone does not describe every permission/context operation around it, and trace completion is not crash-safe accounting.

Sources: [Middleware interface](https://github.com/agentscope-ai/agentscope/blob/main/src/agentscope/middleware/_base.py), [Tracing middleware](https://github.com/agentscope-ai/agentscope/blob/main/src/agentscope/middleware/_tracing/_trace.py). These moving references describe inspected source, not a tested installed version.

## Decision implications and remaining evidence

- Plugin packaging and automatic observation are separate questions. A tool-only plugin or MCP service can expose analysis functions without observing unrelated execution.
- herdr can supply management context; native harness instrumentation or logs must supply authoritative usage where available. Account quota and manager status supplement, rather than replace, those receipts.
- A plugin could configure harness extensions and display capture health while the shared flAImegraph core imports/reconciles evidence. This is a candidate architecture, not a selected implementation.
- Preserve the user's metadata-default, content-opt-in and post-work scope. Terminal content access is not permission to collect it by default.

No live plugin install, socket subscription, restart/remote experiment or receipt reconciliation was performed. The exact Codex/Claude Code/Pi coverage, event loss, stale-session handling and double-count prevention remain validation requirements. No upstream code was copied and no production/harness configuration changed.
