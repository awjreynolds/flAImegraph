# Operation instrumentation and native harness capture

Research date: 2026-09-07. This note turns the operation-depth requirement into an implementation boundary for flAImegraph. It uses the repository's operation sidecar draft in [`src/operation-types.ts`](../../src/operation-types.ts), the operation acceptance plan in [`docs/operation-depth-plan.md`](../operation-depth-plan.md), and public source code from Pi and Codex. Pi source references are pinned to [`9767ba275f3e9a5ee0f5c5342249b629ab1b2282`](https://github.com/earendil-works/pi/tree/9767ba275f3e9a5ee0f5c5342249b629ab1b2282), inspected on September 6, 2026. Codex links point at the current public `main` source as inspected on September 7, 2026; an installed Codex binary must report its own version and capture format before it is treated as equivalent.

## Finding

The profiler can record a useful execution trace with ordinary deterministic code and zero additional model tokens. A filesystem wrapper can record a directory enumeration followed by 5,000 individual read attempts. Tool, edit, test, hook and delegation boundaries can be recorded from runtime callbacks. Model usage and context can then be joined as separate evidence. No classifier, tokenizer request or summary call is required for the operation-only trace.

The representation needs two structures:

1. An **observed execution tree**. `parent_id` means execution containment asserted by the producer. A directory scan can contain the read calls it starts; a model turn can contain the tool call it executes; a code cell can contain the terminal operation it starts. Missing parentage remains missing. Timestamps, shared files and textual nesting do not create a parent.
2. An **evidence and context graph**. `delegates`, `depends_on`, `produces_context`, `consumes_context` and `corresponds_to` links connect work that is related without pretending that it ran inside the same call stack. A read can produce a revision that no later request consumes. A model request can consume a reconstructed revision for which the read was not captured.

This is the distinction already reflected in the operation sidecar and the v0.2 context contract. A monetary flame graph may select direct valued model observations and roll them up through the execution tree. A source-exposure view may allocate a request's cost through context occurrences. The latter is an estimated information-flow projection and must never be presented as the observed call stack or added to the execution charge view. [`Operation design review`](../reviews/operation-design-v03.md) records the required separation.

## What one operation means

One operation record represents one attempt at one runtime boundary. Five thousand reads therefore produce five thousand operation IDs, even when all five thousand use the same path, range or content. A repeated attempt, retry, cache hit, failed read or cancelled process remains a distinct operation. A count on a parent directory scan is a measurement about enumeration; it is not a substitute for child read records.

The minimum record should contain:

| Field | Meaning | Evidence rule |
|---|---|---|
| `id`, `sequence` | Stable operation identity and capture order | Prefer a producer ID; otherwise derive from an append-only namespace and source coordinate. A timestamp or content hash is not an attempt ID. |
| `parent_id` | Actual execution containment | Set only from an explicit runtime scope or producer relationship. Record evidence and method. Reject self-edges and cycles. |
| `kind`, `label` | `directory_read`, `file_read`, `file_write`, `search`, `test`, `command`, `model`, `tool`, `hook`, `delegation`, `summary` or another source-defined kind | Preserve whether the value was observed, declared or derived. A phase heuristic must not claim model intent. |
| `status`, start/end, duration | Outcome and timing | Wall-clock time is for display. Use monotonic duration only when the recorder owns a compatible clock. An unfinished operation is `running` or `unknown`, not successful. |
| `agent_id` | Owning runtime agent | Use a native thread or agent identity when available. A nickname is a display label. |
| `requesting_model`, `executing_model` | Model that requested work and model that actually executed it | A model that requests a shell tool is not the model executing the shell. Model identity from configuration is not response identity. |
| `io` | Resource fingerprint, range, bytes read/returned/written, entry counts and cache treatment | Missing measurements are `null`, never zero. Do not store raw paths or content in the export by default. |
| `source_refs` | Source artifact and record location | References resolve against the operation artifact registry. Cross-contract joins use typed IDs, not coincident artifact names. |

The tree is intentionally narrower than a general dependency graph. An asynchronous child may finish after its launching scope has ended, so temporal containment is useful for a warning but is not a prerequisite for a valid parent edge. Concurrent siblings retain their own starts, ends and IDs. In Pi's parallel tool mode, `tool_execution_end` is emitted in completion order while final tool-result messages are emitted in assistant source order; a recorder must retain both the event sequence and the source index rather than sorting by arrival and losing the distinction. [Pi's agent-loop execution code](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/agent-loop.ts#L407-L552).

## Capturing 5,000 individual reads

The operation count is a requirement on the recorder, not a guarantee supplied by a high-level agent transcript. A native `read` tool event proves that the tool was called; it does not prove how many filesystem calls its implementation made. A shell command proves that a process was requested; its transcript does not prove every `open`, `read`, search or child process inside it.

For the acceptance case, instrument the filesystem boundary used by the workload. The wrapper must create the child span before calling the real operation and close it in `finally`, including errors and aborts. `AsyncLocalStorage` or an equivalent async context carries the explicit current parent across `await`, `Promise.all` and callbacks. The parent is passed explicitly when work is handed to a queue or another process; it is never reconstructed from overlapping intervals.

The following is intentionally pseudocode. It shows the important ordering and accounting behavior without introducing a model or tokenizer dependency:

```ts
const recorder = new OperationRecorder({
  datasetId,
  namespace: "workload-run",
  resourceId: (path) => sha256(`${namespace}\0${canonicalPath(path)}`),
  maxOperations: 10_000, // at least 5,000 for the conformance case
});

await recorder.withOperation({ kind: "work", label: "repository-inspection" }, async () => {
  const entries = await recorder.withOperation(
    { kind: "directory_read", label: "enumerate-source", io: { resource: root } },
    () => fs.readdir(root, { withFileTypes: true }),
    (span, result) => span.setIO({
      examined_entries: String(result.length),
      entry_count: String(result.length),
    }),
  );

  await Promise.all(entries.map((entry) =>
    recorder.withOperation(
      { kind: "file_read", label: "read-file", io: { resource: entry.path } },
      async () => {
        const requested = requestedRange(entry.path);
        const bytes = await fs.readFile(entry.path); // one attempt, one span
        return { requested, bytes };
      },
      (span, result) => span.setIO({
        requested_range: result.requested,
        read_bytes: String(result.bytes.byteLength),
        returned_bytes: String(result.bytes.byteLength),
        content_sha256: sha256(result.bytes),
      }),
    ),
  ));
});
```

The real implementation should reserve the operation ID and append a `running` record before invoking the effect. It should append the terminal record after the effect settles, rethrow the original workload error, and make recorder failures fail open. A crash between those records leaves an explicit incomplete operation. If the append queue or size budget drops data, increment `coverage.dropped_spans`, preserve the sequence gap and issue a coverage problem; silently collapsing 5,000 reads into one aggregate is not an acceptable fallback.

The IO descriptor needs separate values for:

- the requested range or request count;
- bytes obtained from the backing source;
- bytes returned after limits, filtering or truncation;
- bytes inserted and deleted for a write/edit;
- directory entries examined and returned; and
- cache treatment, when the source actually reports it.

Line count, whole-file size and a content fingerprint describe a revision. None proves the bytes returned from one call, the number of tokens inserted into a later request or a model charge. Hashing a canonical path with a capture namespace gives a stable resource identity without publishing the path; the raw path can remain a local display-only label if the user explicitly enables it.

## Zero-token operation capture

The operation recorder should depend on the platform clock, async context, filesystem/process wrappers and a bounded append-only writer. It should not import a model client, estimate tokens, ask a provider for a count or classify text with an LLM. Deterministic classification is allowed when its rule version and evidence are recorded. For example, a command matching a configured test executable can be labelled `test` with `evidence: "derived"`; it cannot be labelled “the model intended to test.”

The capture path can later be enriched with the existing `EvidenceBundle` and `ContextBundle`:

```text
operation-only capture
  ├─ execution spans: reads, writes, edits, searches, tests, hooks, delegation
  ├─ execution links: explicit parentage and delegation
  └─ coverage issues and loss markers

optional enrichment
  ├─ model observations and usage rows
  ├─ request contexts and context occurrences
  └─ direct valuation and estimated source-exposure allocation
```

The optional enrichment must not change the operation IDs or retroactively turn an unpriced operation into a priced one. It is valid to produce an operation report with no model observations and zero model tokens. It is also valid for a model observation to exist without a complete operation trace; the report then exposes an unbound or unknown operation link.

## Pi: practical live integration

Pi has two useful capture levels. The coding-agent layer exposes immediate tool interception and agent events. The lower agent core exposes typed tool hooks, message/turn lifecycle events and context transformation points. The newer harness adds durable usage settlement and named request/tool/compaction hooks. These surfaces are richer than a transcript importer, but they are versioned implementation surfaces rather than a promise that every installed CLI has every hook.

### Tool and lifecycle hooks

At the agent-core boundary, [`AgentLoopConfig`](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts#L149-L293) defines:

- `beforeToolCall`, called after arguments have been validated, with the requesting assistant message, raw tool call, validated arguments and current context;
- `afterToolCall`, called after execution and before the tool-end/result events, with the result and error state, and able to override result content, details, error state, usage or termination;
- `toolExecution: "sequential" | "parallel"`, with per-tool execution-mode overrides; and
- context/turn controls such as `transformContext`, `shouldStopAfterTurn` and `prepareNextTurn`.

[`AgentTool.execute`](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts#L361-L412) receives `(toolCallId, params, signal, onUpdate)` and returns a promise. This is the exact boundary for a wrapper around a custom tool. The core emits `agent_start`, `turn_start`, `message_start/update/end`, `tool_execution_start/update/end`, `turn_end` and `agent_end` events with tool call IDs, names, arguments, results and error flags. [`AgentEvent`](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts#L431-L446) is the source of those event shapes.

At the coding-agent extension boundary, `AgentSession` installs the extension `tool_call` and `tool_result` events through the same core hooks. The `tool_call` payload contains `toolName`, `toolCallId` and validated `input`. The `tool_result` payload contains those fields plus content, details, `isError` and optional nested `usage`. [The hook installation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/agent-session.ts#L478-L539) is the practical place for an extension recorder.

An observational extension must catch its own errors and return `undefined`. Throwing from the `tool_call` hook is interpreted by `AgentSession` as an extension failure and can block the tool. Throwing from a recorder would therefore change the workload, which violates the profiler's role. The hook should record an issue and allow the workload to proceed. If an independent workload policy blocks a call, capture the policy decision and resulting error operation as source-owned behavior; do not claim that the profiler performed the block.

Illustrative extension shape:

```ts
export default function register(pi: ExtensionAPI) {
  const recorder = new OperationRecorder({ namespace: "pi-run" });
  const pending = new Map<string, OperationHandle>();

  pi.on("tool_call", async (event) => {
    try {
      const parentId = recorder.currentParentId();
      pending.set(event.toolCallId, recorder.begin({
        kind: "tool",
        label: event.toolName,
        parentId,
        attributes: { tool_call_id: event.toolCallId },
      }));
    } catch (error) {
      recorder.issue("hook_capture_failed", error);
    }
    return undefined; // do not mutate, block or replace the tool call
  });

  pi.on("tool_result", async (event) => {
    try {
      pending.get(event.toolCallId)?.end({
        status: event.isError ? "error" : "ok",
        nestedUsage: event.usage ?? null,
      });
    } catch (error) {
      recorder.issue("hook_capture_failed", error);
    }
    return undefined; // preserve the original result
  });

  pi.on("agent_end", async () => {
    await recorder.flushBestEffort();
  });
}
```

The extension events provide the outer tool lifecycle. To record every file operation performed by Pi's built-in tools or by a command, instrument the actual filesystem/process abstraction as well. A `tool_call` for `bash` cannot establish the internal reads performed by the shell. `AgentSession.executeBash` accepts a custom `BashOperations` implementation, making that boundary suitable for a remote or instrumented executor; otherwise the shell is one opaque `command` span. [`executeBash`](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/agent-session.ts#L2978-L3022) also shows that bash output may be recorded into agent context, subject to the command's context setting. A bash output record is not a proof of internal filesystem calls.

Pi's high-level `Agent.subscribe()`/`AgentSession.subscribe()` lifecycle is useful for a run and turn parent span. A low-level event stream is observational and should be drained into the recorder's queue rather than used as a synchronous persistence barrier. The recorder must retain its own monotonic sequence and close spans from explicit start/end IDs; it must not assume that an asynchronous listener has changed the agent's execution ordering. The core event type comments also make `agent_end` settlement and awaited listeners part of the high-level agent lifecycle. [`AgentEvent` lifecycle comments](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts#L427-L429).

### Model and context hooks

Pi's `transformContext` runs before `convertToLlm` for each provider request. In the newer harness, `before_request` runs after context is read, `transform_context` can replace messages/system prompt, and `before_payload` sees the provider-facing payload before the model stream. The request is then started with a session ID and telemetry context. [`generation.ts`](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/runtime/drive/generation.ts#L101-L224).

Capture in this order:

1. Open a model operation at `before_request`; record the configured provider/model, turn/attempt and parent operation.
2. At `transform_context`, record an ordered, privacy-reduced request manifest. Each context source has a fingerprint, representation, role, placement and measurement boundary. Do not serialize raw messages by default.
3. At `before_payload`, record the final provider-boundary fingerprint and any native payload size/token facts. This is the strongest client-side statement about what was submitted, but it does not reveal provider-side hidden instructions or canonicalization.
4. On the terminal response, record response model, response ID, stop reason, status and native usage. Close the model operation once.
5. Link the model observation to exactly one direct usage row or response completion. A cumulative total is a snapshot and is not another usage line.

Pi's generated telemetry schema names `pi.ai.request` attributes for provider/model/API, response model/ID, stop reason, usage buckets, stream chunks, time to first chunk and cost, as well as harness spans for runs, turns, tools and hooks. The schema is valuable source vocabulary, but the telemetry documentation describes parts of it as design input and says cross-process links are unfinished. A generated schema therefore does not prove that a deployed CLI exported those spans. [Pi telemetry schema](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/docs/telemetry-schema.md), [telemetry status](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/docs/telemetry.md).

### Pi durable usage and retries

The newer harness writes a v4 JSONL header (`v: 4`, `storageVersion: 1`) and can commit multiple writes in one transaction. A `UsageRow` has its own ID and sequence, optional `entryId`, an `adjustment` flag and optional details. The storage API exposes `scanUsage()` separately from entry scans. [JSONL header](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/session/jsonl/types.ts#L1-L18), [usage ledger types](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/session/types.ts#L378-L404).

Response settlement inserts the assistant entry and its linked usage row in one commit, then emits an `entry_added` event and a `usage` event. The usage event contains the row and cumulative session totals. An importer that sums assistant-message usage, usage rows and cumulative totals counts one response multiple times. Use the durable usage row as the authority where it exists; use totals for checks; preserve adjustments separately. [Pi response settlement](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/runtime/drive/response.ts#L319-L404).

Retries need attempt identity. A logical turn can have multiple provider attempts, including an error or aborted attempt that consumed tokens before the final response. Persist one model observation per source-defined attempt when the source exposes it. If the source exposes only a terminal response, say that retry coverage is partial. A retry helper that returns only the terminal result cannot prove that earlier transport attempts were free. Missing usage is unknown, not zero.

`AgentToolResult.usage` is explicitly usage from nested LLM work performed by a tool and is not the main LLM context accounting. Create a separate nested model observation when provider/model identity and a direct usage boundary are available. Otherwise retain the tool-result usage as an aggregate or opaque detail rather than adding it to the parent assistant request. [Pi tool result type](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts#L361-L412).

## Codex: native persisted shapes and limits

Codex has two materially different native surfaces. The older persisted rollout is a JSONL history designed for replay and UI/session recovery. The current `rollout-trace` source defines a richer append-only raw trace and deterministic reducer. A conservative adapter must identify which surface it received instead of treating every JSONL line as one universal schema.

### Legacy rollout JSONL

Public Codex tests construct legacy rollout lines with an envelope containing `timestamp`, `type` and `payload`. `session_meta` carries session identity, working directory, CLI/source/provider and optional parent information. `event_msg` carries runtime events such as token counts. `response_item` carries model-facing messages, reasoning, local shell calls, function/custom tool calls and their outputs. The persistence policy also names `token_usage_record`, `turn_context`, `world_state`, `compacted`, `retained_context` and `session_meta` as persisted rollout families, while some transient events are excluded. [Codex rollout fixtures](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs), [persistence policy](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/policy.rs#L623-L723).

The public response-item schema gives these exact call/output shapes:

| Response item | Required evidence | Safe operation interpretation |
|---|---|---|
| `function_call` | `type`, `call_id`, `name`, `arguments`; namespace and ID may be present | A model-visible requested tool. `arguments` is a string in this schema. It is not a proof that the implementation started. |
| `function_call_output` | `type`, `call_id`, `output` | The output paired by exact `call_id`. The output body is a string or an array of supported content items. It closes the model-visible boundary only. |
| `custom_tool_call` | `type`, `call_id`, `name`, `input`; namespace/status may be present | A model-visible custom tool request. `input` is a string; internal runtime work may be opaque. |
| `custom_tool_call_output` | `type`, `call_id`, `output`; name may be present | Output paired by exact `call_id`; no child operation is inferred from its text. |

[Codex's `RawResponseItemCompletedNotification` schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/RawResponseItemCompletedNotification.json) owns those required fields and the `FunctionCallOutputBody` string/array union. A conservative importer should preserve unknown response-item types as opaque records and mark coverage partial rather than coercing them into a file read, command or nested agent operation.

For legacy rollouts, use the following mapping:

- map a model-facing `function_call`, `custom_tool_call` or local-shell call to a requested/planned operation at its source record; close it only when a matching result or explicit runtime terminal event is present;
- pair call and output only by exact `call_id` (or the source's exact call ID equivalent); never pair by name, order or nearest timestamp;
- treat `token_usage_record` and `event_msg` token-count payloads according to their declared grain. Codex token-count events commonly contain a per-update `last_token_usage` and a cumulative `total_token_usage`; the cumulative object is a snapshot and must not be summed as a second call;
- use `turn_context`, `world_state` and compaction records to describe state/context boundaries. They are not model operations unless a model request and usage observation are explicitly linked; and
- preserve `ordinal`/sequence-like source coordinates when present so duplicate replay and partial files can be detected.

Legacy rollout history is enough to show an outer tool request and its model-visible output. It is not enough to claim that a shell command performed each of its internal reads, that a custom tool spawned a child agent, or that a model request's full provider prompt was persisted. Those claims require a runtime trace or direct instrumentation.

### Current `rollout-trace`

The public current source defines an append-only `RawTraceEvent` envelope with `schema_version`, contiguous writer `seq`, `wall_time_unix_ms`, `rollout_id`, optional `thread_id`, optional `codex_turn_id` and a tagged payload. Sequence is the causal/order primitive; wall time is for display and latency. The envelope is deliberately uniform so partial replay and corruption checks can run before event-specific reduction. [`RawTraceEvent`](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/raw_event.rs#L856-L892).

The typed payload includes:

- rollout, thread and Codex-turn start/end events;
- `InferenceStarted` with inference ID, thread/turn, model, provider and request payload reference;
- `InferenceCompleted`, `InferenceFailed` and `InferenceCancelled`, with response/upstream IDs, response or partial-payload references and errors where known;
- `ToolCallStarted`, `ToolCallRuntimeStarted`, `ToolCallRuntimeEnded` and `ToolCallEnded`;
- `CodeCellStarted`, initial response and end events for model-authored code;
- compaction request start/completion/failure/install events; and
- `AgentResultObserved` with an edge ID, child thread/turn and parent thread, plus protocol events and an opaque `Other` escape hatch.

At the raw tool boundary, `ToolCallStarted` distinguishes `requester: Model` from `requester: CodeCell { runtime_cell_id }`. This is the evidence needed to put a code-mode tool beneath a code-cell span instead of directly beneath the inference call. [`RawTraceEventPayload`](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/raw_event.rs#L904-L1074), [compaction and agent-result payloads](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/raw_event.rs#L1155-L1248).

The reduced model keeps model-visible conversation items separate from runtime objects. It has `InferenceCall`, `CodeCell`, `ToolCall`, terminal sessions/operations, compaction requests and interaction edges, all pointing back to raw payload references. The README explicitly describes the distinction: a code-mode nested tool has runtime JSON at the JavaScript boundary, while the model-visible transcript contains the surrounding custom execution call and its output. [Reduced Codex model](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/model/conversation.rs#L612-L879), [rollout-trace README](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/README.md#raw-evidence-vs-reduced-graph).

Multi-agent lineage is explicit in the current reduced model. `AgentThread` has a stable `agent_path`, an execution window and an `AgentOrigin::Spawned` containing `parent_thread_id`, `spawn_edge_id`, task name and role. `AgentResultObserved` records child and parent thread/turn IDs. A child thread can therefore become an `agent` operation with a `delegates` link and a real parent only when those fields are present. [Codex thread model](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/model/session.rs), [Codex raw agent-result event](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/raw_event.rs#L1204-L1223).

The current README says spawned child threads share the root trace writer for multi-agent v2, while top-level independent threads get independent bundles. A collector must not merge independent files merely because their timestamps overlap or their names look related. [Codex multi-agent trace behavior](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/README.md#multi-agent-v2).

The richer `rollout-trace` source is evidence of a supported schema in current source, not proof that a particular installed CLI emitted `trace.jsonl`. Check the trace manifest/file names and schema version. If only the older rollout is available, import only the older evidence and report the missing runtime coverage.

### Genuine nested `exec` execution

The strongest nested shape is:

```text
InferenceCall(thread, turn)
└─ model-visible custom_tool_call (execution wrapper)
   └─ CodeCell(model-authored code, explicit runtime window)
      ├─ ToolCall(requester = CodeCell)
      │  └─ TerminalOperation / MCP / other runtime object
      └─ additional wait or nested tool calls
```

The outer custom tool call alone does not establish the inner tree. With only a legacy `custom_tool_call` and `custom_tool_call_output`, import one opaque outer operation and retain the payload reference. With current raw trace events, use `CodeCellStarted`/`CodeCellEnded`, `requester: CodeCell`, runtime tool IDs and terminal operation IDs to construct the actual nested spans. Do not create a child file read from a JavaScript string, shell output, command name or elapsed interval.

The public current trace documentation uses `exec` as the model-visible code-mode wrapper. A local capture probe did not establish a universal persisted name for the generic execution tool across all Codex surfaces, so the importer must accept an adapter-configured alias set and retain the original name. It must not hard-code a claim that the exact string `functions.exec` is present in every rollout. If the configured alias is absent, the call remains an opaque custom tool operation; no nested execution is inferred.

## Conservative Codex importer algorithm

The importer should be a source adapter, not a heuristic transcript parser:

1. Detect the artifact family from its header/manifest and known envelope fields. Freeze the detected source format/version in `Source`.
2. Validate JSON and required IDs record by record. Preserve malformed/unknown records as coverage issues with a source coordinate; do not discard them silently.
3. Emit model-visible call/output operations only for typed response items. Pair outputs by exact call ID. Emit a running/unknown terminal when the matching output is absent at the accepted prefix.
4. Prefer current trace runtime objects for inference, code-cell, tool, terminal, compaction and child-thread spans. Use explicit sequence, IDs and requester fields. Do not infer parentage from JSON nesting, file order outside the writer sequence or timestamps.
5. Join token usage to an inference/turn only by explicit response, inference, turn or source-owned observation ID. A nearest preceding token event is a partial reconstruction and must be labelled `derived` with a coverage issue, never `observed`.
6. Treat aggregate token totals, thread totals and UI summaries as snapshots/checks. They do not become additional direct model observations.
7. Preserve raw payload references as source references or hashed local coordinates. The operation export can expose summaries and fingerprints without serializing prompts, command arguments, file contents or tool results.
8. Set `coverage.boundary` to `native_transcript` for a legacy rollout and `mixed` when direct runtime instrumentation is combined with a native file. Set `complete: false` whenever a source surface cannot observe internal shell/file work, transient usage or child lineage.

The importer should expose an opaque operation for every known outer boundary even when its internals are unknown. This is more useful than dropping the boundary, and it prevents the UI from presenting an incomplete tree as if it were complete.

## Context, caching and cost

Operation cost is a join, not a price assigned to a read. The existing valuation contract selects direct valued observations. A selected model observation may be linked to at most one operation self-cost sample. Parent inclusive totals are derived rollups and are not additional valuation lines. An unlinked valued observation belongs in an explicit unassigned bucket; an operation with no direct model charge remains visible in the chronological view with `not_applicable` or `unknown` cost state.

The common usage contract has to retain the source's count basis and subset relationships:

- Pi's native assistant usage and cost fields should be preserved with their provider/model identity. In the legacy Pi shape, `input`, `cacheRead`, `cacheWrite` and `output` are separate accounting buckets and `totalTokens` is the source total. When mapping to a contract whose `input_tokens` is inclusive, derive inclusive input from the documented native partition and retain each cache bucket as a subset/detail. Do not copy a cache-exclusive native `input` into an inclusive field without recording the mapping.
- Codex's native token shape distinguishes input, cached input, cache-write input, output and reasoning output. Reasoning is a subset of output. Cached input and cache-write input are subsets/treatment categories according to the source's usage semantics; do not add them to an already inclusive input total. Preserve the native values before deriving a normalized view. [Codex reduced token usage fields](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/model/conversation.rs#L859-L929).
- Pi's `reasoning` is a subset of output and must not be added again. OMP-style auxiliary/orchestration usage and context occupancy, where present, are different quantities and need their own fields or opaque residuals. [`Pi and Oh My Pi capture fidelity`](pi-capture-fidelity.md) documents these source-specific differences.
- A recorded model cost is normally a provider/model-rate calculation or a source estimate. It is not automatically an invoice amount, subscription marginal cost or enterprise charge. Preserve `RecordedCost.basis`, rate-card version and assumptions.

Context capture answers a different question from operation capture. A read operation establishes that bytes were obtained. A `ContextOccurrence` establishes that a representation appeared in a particular model request, with a role, placement and treatment such as fresh, cache-read or cache-write. A content fingerprint can show reuse, but a repeated fingerprint does not prove a provider cache hit or a saved charge. [`Context attribution limits`](context-attribution-limits.md) and [`ContextBundle` types](../../src/context-types.ts) define these boundaries.

Compaction is also two observations: the context state before/after the transformation, and any model request used to create the summary. `tokensBefore` is occupancy information, not summarizer consumption. A reused summary entry is not a fresh model call. Conversely, a compaction request can consume tokens even while reducing the next request's context. Import the summary/compaction operation and the model observation separately.

Retries and cancellation matter for cost. If a provider returns usage for a failed or cancelled request, retain it as a direct attempt observation. If the request started but usage is absent, retain an unknown-cost attempt and a coverage issue. Do not convert missing usage to a priced zero. Provider or SDK retries below the harness boundary remain an explicit limitation unless the provider request ID or native trace exposes them.

Source-exposure allocation is an alternative estimated view. If a request's context occurrences are measured, a v0.2 proportional allocation can place an output-inclusive portion under the operation that produced the consumed revision. That portion is not per-file billing, causal responsibility or money saved by removing the file. Summary transformation parents remain navigable but do not inherit the later summary's allocation without a separate declared backward-allocation method.

## Routing and hook decisions

Routing belongs in evidence. Record requested model, selected model, policy ID/version, action, reason and source references. Pi can change model/context in `prepareNextTurn`, and its tool hooks can block or override results. Codex's current app-server source documents `model/rerouted` notifications. These are workload/harness policy facts, not profiler decisions. [Codex app-server notifications](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

The profiler's own capture hook should be observational and fail open. It should record `allow` when capture succeeds, and record a capture issue plus continue when persistence fails. If the workload's policy redirects, blocks or falls back, record that external action as a separate `hook`/`routing` operation. This keeps a profiler outage from changing which tools run or which model is selected.

## Codex usage surfaces and exact availability limits

| Surface | Strong evidence | Not established by the surface alone |
|---|---|---|
| Legacy Codex rollout JSONL | Session identity, model-visible response items, call IDs, persisted event/token families and some thread/turn metadata | Internal shell reads, exact provider prompt, every physical retry, transient upstream usage and arbitrary nested code execution |
| Current Codex `rollout-trace` | Ordered raw event envelope; inference/tool/code-cell/terminal/compaction lifecycle; explicit requester and multi-agent edges; raw payload refs | Availability in every installed binary; billing/invoice correspondence; provider work outside the recorded runtime |
| App-server `rawResponse/completed` with experimental raw events | One exact upstream usage payload per Responses API completion, with thread/turn/response identity when enabled | Persistence or replay: the notification is transient and not accumulated, estimated, persisted or replayed |
| Pi extension `tool_call`/`tool_result` | Immediate outer tool call/result IDs, validated input, result/error and optional nested usage | Internal operations inside a tool or shell; hidden provider transformations |
| Pi core agent events | Tool lifecycle and turn/message order, including parallel completion behavior | Filesystem syscalls inside tools; durable provider attempt identity unless request/usage hooks are also captured |
| Pi v4 harness ledger | Durable usage row linked to assistant entry, explicit sequence and cumulative totals for checks | Provider retries hidden below the model stream; guaranteed telemetry export from every deployed release |
| Direct filesystem/BashOperations wrapper | Each instrumented read/write/enumeration attempt and actual byte counters | Work performed by an uninstrumented subprocess, remote host or kernel path |

Codex's app-server README explicitly says `rawResponse/completed` is internal-only, enabled through an experimental raw-events setting, contains exact upstream usage mapped to the app-server breakdown, and is transient rather than persisted. This is the best live usage surface when available, but it cannot repair an imported legacy rollout after the notification was lost. [Raw response completion behavior](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

## Conformance cases

The first implementation should demonstrate these cases with deterministic fixtures and no provider calls:

- a directory enumeration with 5,000 distinct same-path/range read attempts, including concurrent reads and one failed read;
- a scan whose returned entries are not opened, proving that enumeration does not imply reads;
- bytes read greater than bytes returned because of a limit/truncation, plus an edit with independent inserted/deleted byte counts;
- a test command represented as an outer command and, when the runner wrapper is available, nested test subprocess operations;
- a tool call whose hook result is blocked by the workload policy, and a recorder failure that still returns `allow`;
- Pi sequential and parallel tool batches, with completion order different from assistant source order;
- Pi `transformContext`/`before_payload` capture showing that a read is not a context occurrence until the request manifest contains the revision;
- a Pi v4 response entry and usage row committed together, with cumulative totals ignored as additive rows;
- a retry, a cancellation and an error with missing usage, all retaining unknown/partial coverage honestly;
- Codex legacy function/custom call/output pairs, duplicate call IDs, missing outputs and unknown item types;
- Codex current raw trace inference → model-visible custom execution call → code cell → code-requested tool → terminal operation, with sequence and explicit requester links;
- a current trace with a spawned child thread and `AgentResultObserved`, plus an independent rollout that must remain a separate bundle;
- an outer execution call with no code-cell/runtime events, which must remain opaque and must not create file reads;
- direct cost conservation, unassigned observations, priced zero versus null price, and a separate source-exposure allocation; and
- an operation-only report with zero model observations and no model/tokenizer dependency.

The shipping bar is met when the operation-only trace can explain the captured work chronologically, the Pi integration records immediate outer lifecycle boundaries without altering execution, and the Codex importer produces nested spans only where native IDs and runtime events prove them. Context/cost enrichment must conserve the selected direct valuation and keep estimated source exposure visibly separate.

## Sources and related repository decisions

- [Operation depth, version 0.3](../operation-depth-plan.md)
- [Operation-level profiling v0.3 design review](../reviews/operation-design-v03.md)
- [Pi and Oh My Pi capture fidelity](pi-capture-fidelity.md)
- [Context attribution limits](context-attribution-limits.md)
- [Interoperable export contract](interoperable-export-contract.md)
- [Pi legacy session format](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/docs/session-format.md)
- [Pi agent types and lifecycle](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts)
- [Pi agent loop](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/agent-loop.ts)
- [Pi newer harness generation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/runtime/drive/generation.ts)
- [Pi newer harness response settlement](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/runtime/drive/response.ts)
- [Codex response item schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/RawResponseItemCompletedNotification.json)
- [Codex legacy rollout persistence policy](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/policy.rs)
- [Codex raw trace envelope and payloads](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/raw_event.rs)
- [Codex reduced trace model](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/model)
- [Codex rollout-trace README](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/README.md)
- [Codex app-server README and transient raw usage notification](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
