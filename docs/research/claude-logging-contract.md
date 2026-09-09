# Claude Code / Agent SDK logging contract

Research date: 2026-09-09. Scope: current public Claude Code documentation and the locally installed CLI’s non-network help/version output. No provider call, authentication, private transcript, settings, or dependency mutation was performed. “Current” below means the public docs retrieved on this date; the local executable is older and is reported separately.

## What is a supported stream

`claude -p --output-format json` returns one structured JSON result. `--output-format stream-json` returns newline-delimited JSON, one event object per line; with `--include-partial-messages`, the stream contains `stream_event` wrappers for raw Anthropic streaming events. The CLI docs say the final line is a `result` message. The relevant flags require print mode, and partial messages also require stream-json. [CLI reference](https://code.claude.com/docs/en/cli-usage), [programmatic usage](https://code.claude.com/docs/en/headless), [streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)

The TypeScript Agent SDK’s live stream is `SDKMessage`, a union that includes `assistant`, `user`, `result`, `system`, `stream_event`, and additional lifecycle/observability messages. A live `SDKAssistantMessage` is:

```ts
{
  type: "assistant";
  uuid: UUID;
  session_id: string;
  message: BetaMessage;           // Anthropic API message
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
}
```

`message` contains the API `id`, `content`, `model`, `stop_reason`, and `usage`. The outer `uuid` is the SDK envelope identifier; the nested API `message.id` is the identity relevant to per-response usage accounting. [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

By default, the SDK yields a complete assistant message after each non-empty content block. A response with text and a tool call therefore yields multiple assistant envelopes. All blocks in one response share the same nested API `message.id`, and each repeats that response’s usage. The cost guide explicitly says to deduplicate by `message.message.id`; in the rare case that same-ID output counts differ, use the highest/final value and prefer the result aggregate. [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output), [cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)

With partial messages enabled, `SDKPartialAssistantMessage` has `type: "stream_event"`, `uuid`, `session_id`, `parent_tool_use_id`, and raw `event`. Event types include `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop`. Text and tool JSON arrive as deltas and must be accumulated; `message_delta` is where message-level usage/stop updates occur. Stream events are emitted for the main session only. [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)

## Usage authority and accounting grain

The final `SDKResultMessage` is one aggregate for one `query()` invocation. Both success and documented error variants carry `usage`, `modelUsage`, `total_cost_usd`, `num_turns`, `duration_ms`, `duration_api_ms`, `stop_reason`, and `session_id`; only the success variant carries the final text `result`. The result `usage` is cumulative across all model steps in that query. A resumed session has a separate result aggregate for each subsequent `query()` call. Therefore, an importer that receives both assistant receipts and a final result must choose the result for query-level totals and keep assistant rows as per-response evidence; summing both double-counts. `total_cost_usd` and per-model `costUSD` are client-side estimates, not authoritative billing. [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript), [cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)

The canonical TypeScript `Usage` shape is:

```ts
{
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
  server_tool_use: BetaServerToolUsage | null;
  service_tier: "standard" | "priority" | "batch" | null;
  speed: "standard" | "fast" | null;
  inference_geo: string | null;
  iterations: BetaIterationsUsage | null;
}
```

`input_tokens` is the non-cached portion after the last cache breakpoint. Total input is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. `output_tokens` is inclusive; for extended thinking, the API exposes a read-only `output_tokens_details.thinking_tokens` breakdown. The documented Agent SDK `Usage` has no `reasoning_output_tokens` field; such a field in a fixture should be treated as an extension/unknown unless the capture identifies its producer. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), [Create a Message API reference](https://platform.claude.com/docs/en/api/cli/beta/messages/create), [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

`modelUsage` is a per-model result breakdown with camel-case keys: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`, `costUSD`, `contextWindow`, and `maxOutputTokens`. Background task `usage` objects (`total_tokens`, `tool_uses`, `duration_ms`) are task progress/final-task metadata, not a second provider response receipt. [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

## Tool identity and subagents

At the Anthropic message level, a `tool_use` content block has a unique `id`; the matching `tool_result` block carries `tool_use_id` equal to that ID. Results are sent in the next user message and must immediately follow the corresponding tool use in message history. Claude Code hook inputs independently expose this same join key: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `PostToolBatch.tool_calls[]` include `tool_use_id`; `PostToolUse` also has `tool_response` and optional `duration_ms`, while `PostToolBatch.tool_response` is the serialized content seen by the model. [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [hooks reference](https://code.claude.com/docs/en/hooks)

Main-session messages have `parent_tool_use_id: null`. When subagent forwarding is enabled (`--forward-subagent-text`, or SDK `forwardSubagentText`), subagent assistant/user messages carry the spawning Agent tool call’s ID in `parent_tool_use_id`; nested subagents carry the immediate parent Agent call. By default, foreground subagent text/thinking is omitted from the stream while subagent `tool_use`/`tool_result` blocks are emitted. Separate subagent transcript files live below the session’s `subagents/` directory. [Headless/programmatic usage](https://code.claude.com/docs/en/headless), [subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents), [subagents](https://code.claude.com/docs/en/sub-agents)

## Internal transcript versus SDK/CLI stream

Claude Code stores local session transcripts as JSONL under `~/.claude/projects/<project>/<session-id>.jsonl`; the public sessions docs describe each line only as a JSON object for a message, tool use, tool result, or metadata entry. The transcript is written asynchronously and can lag the in-memory conversation. At `Stop`, the docs specifically say the transcript may not yet include the current final assistant message; use the supplied `last_assistant_message` when available. [Sessions](https://code.claude.com/docs/en/sessions), [Claude directory](https://code.claude.com/docs/en/claude-directory), [hooks reference](https://code.claude.com/docs/en/hooks)

The TypeScript SDK now offers `getSessionMessages()`, but this is a reader abstraction, not a published byte-level stream schema. It returns only top-level `type: "user" | "assistant"`, `uuid`, `session_id`, `parent_tool_use_id`, and `message: unknown` (the raw transcript payload). `listSessions()` exposes session-level `createdAt` and `lastModified` milliseconds; `createdAt` is derived from the first entry’s timestamp. Live SDK message types do not expose per-message timestamps, and the public docs do not define a stable per-line transcript timestamp or schema. Treat a transcript `timestamp` field as observed implementation data, preserve it when present, and do not require it for a valid SDK stream. [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript), [session storage](https://code.claude.com/docs/en/agent-sdk/session-storage)

The documented surfaces therefore have different top-level contracts: stream-json/`query()` emits SDK-style event envelopes (including result/system/partial events), while internal JSONL contains broader persisted entries and is normalized by `getSessionMessages()`. There is no official statement that a stream-json line can be copied verbatim into a persisted transcript or that every persisted entry appears in a live stream. An importer should identify the source surface and version, retain unknown rows, and avoid treating transcript-only metadata as a provider usage receipt.

## Local evidence and limits

`command -v claude` resolved to `/Users/awjre/.local/bin/claude`; `claude --version` reported `2.1.146 (Claude Code)`. `claude --help` exposed `--output-format` choices `text`, `json`, `stream-json`, plus `--include-partial-messages`, `--include-hook-events`, `--forward-subagent-text`, `--replay-user-messages`, `--no-session-persistence`, and `--session-id`. No `@anthropic-ai/claude-agent-sdk` package or public TypeScript declaration files were present in the project or the inspected local npm/workspace roots. The executable is older than the current docs and was not run against a provider.

The repository’s existing synthetic Claude fixture (`test/fixtures/adapters/claude.jsonl`) verifies only the adapter’s current assumptions: repeated assistant rows share a nested `message.id`, tool rows may be separate, and custom `subagent_completed`/`compaction` rows can be represented. It cannot establish current Claude Code wire shape, retries, result aggregates, transcript timestamp presence, compaction accounting, crash truncation, or SDK-versus-transcript equivalence. The fixture also includes noncanonical `reasoning_output_tokens`, which is not in the public Agent SDK `Usage` type.
