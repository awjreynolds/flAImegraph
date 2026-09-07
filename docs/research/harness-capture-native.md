# Codex CLI and Claude Code telemetry capture surfaces

Research date: 7 September 2026. Decision evidence for [Which capture surfaces can Codex CLI and Claude Code expose?](https://github.com/awjreynolds/flAImegraph/issues/35), under [Find a practical telemetry capture route for developer harnesses](https://github.com/awjreynolds/flAImegraph/issues/34).

## Finding

Both harnesses document useful telemetry and lifecycle integration surfaces. The candidate route is native telemetry and/or logs, supplemented by hooks where needed. A launcher can configure collection for a run; a plugin can package supported hooks. Neither packaging choice alone establishes complete passive observation. Transport compatibility, event coverage and the selected installed version need separate validation.

## Codex CLI

Official advanced configuration documents opt-in OpenTelemetry export. Representative structured events include conversation/model/reasoning settings, API request attempt/status/duration, streaming completion usage, prompt metadata and tool decisions/results. Metrics are a separate signal and should not be substituted for per-operation records. Prompt content has an opt-in setting. This is a possible producer path; flAImegraph does not currently implement a live collector for every documented event shape.

Source: [OpenAI advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry).

Documented hooks cover session, prompt, tool, subagent, compaction, stop and interruption boundaries. Hook input can include session/turn identity and transcript references. A stop event is not equivalent to an interrupt; transcript formats and coverage of hosted tools have limitations. Hooks can supplement telemetry, but raw hook input can include content and must be filtered for the user's metadata-default policy.

Source: [OpenAI hooks](https://learn.chatgpt.com/docs/hooks).

The App Server exposes structured thread/turn/item lifecycle and usage notifications with start/resume/fork operations. It is an alternative for a client integration, not evidence that prefixing the stock CLI automatically subscribes to its internals. Its version-generated schema needs compatibility validation and should be evaluated against the user's desire to keep ordinary harness interaction.

Source: [OpenAI App Server](https://learn.chatgpt.com/docs/app-server).

## Claude Code

Official monitoring documentation describes opt-in OTel metrics/logs and beta traces. Relevant data includes token/cache categories, model and effort, request/correlation identifiers, API timing/errors and attribution fields. The documented tracing surface can represent interaction, tool, hook and nested-agent work. Aggregate metrics, estimated costs and individual request records have different accounting meanings. Content settings such as `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` and `OTEL_LOG_TOOL_CONTENT` require deliberate review; retain metadata by default.

Source: [Claude Code monitoring and usage](https://code.claude.com/docs/en/monitoring-usage).

Hooks expose lifecycle and tool boundaries, including subagents and compaction. Transcript paths are useful discovery pointers but are not a stable interchange contract. Stop and user interruption must be treated distinctly. Plugins can package hooks as well as skills, agents and MCP tools: an automatically triggered hook is materially different from an analysis tool the agent chooses to call. Assess the actual enabled hook/telemetry behavior, rather than assuming all plugins are observers or that none can observe automatically.

Sources: [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Claude Code plugins](https://code.claude.com/docs/en/plugins).

## Existing flAImegraph support

The [native adapters](../../src/adapters/index.ts) already parse supplied Codex rollout JSONL and Claude transcript JSONL. Coverage is explicitly partial; Claude streaming revisions are collapsed by message identity. [Incremental capture](../../src/capture.ts) and [native operation import](../../src/native-operations.ts) have narrower Codex/Pi contracts and must not be described as general Claude streaming integration.

Our OTLP importer primarily reads trace/span-shaped JSON with selected GenAI attributes. Codex structured OTLP logs and Claude metrics/logs/beta traces require signal-specific mapping; choosing OTLP does not by itself make any of these feeds compatible. Existing [adapter documentation](../adapters.md) records what is currently supported.

## Durability and evidence limits

The [lifecycle journal](../lifecycle.md) establishes a durable start before dispatch only when instrumentation waits for its acknowledgement. A post-event observer or later transcript import cannot retroactively supply that guarantee. Which hooks can enforce this ordering, and whether capture failure should block execution or allow work with a recorded gap, need explicit validation and policy decisions.

Neither transcript nor telemetry inspection proves complete hidden retries, internal shell/filesystem operations, complete child-agent coverage or accepted delivery outcomes. A tool named `read` is activity evidence; usage belongs to observed model calls around that activity. Selected effort and provider-confirmed settings should remain distinct.

## Remaining validation and decision implications

Evaluate plugins/hooks, per-run launcher configuration and offline import against the agreed forensic questions. Preserve existing CLI interaction where possible. Use separate source identities and native request/message IDs to reconcile feeds without adding snapshots or duplicate parent/child usage.

This pass read current official documentation and local source at baseline `5d0f52569fecd2a0b9660a59d47d1013c327229c`. External documentation URLs are moving references, not installed-version pins. No harness was installed/run, telemetry endpoint configured, user log inspected or live compatibility tested. Before implementation, select versions and verify exported schemas, redaction, correlation, interruption and observer failure behavior. No production code or configuration changed.
