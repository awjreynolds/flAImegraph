# Pi and Oh My Pi capture fidelity

Research date: 2026-09-06. Scope: public source inspection and public fixture analysis only; no installation, provider invocation or personal session access.

## Finding

Pi-family systems already contain substantial tokenomics infrastructure. A model-call transcript importer is feasible, but a single generic “Pi JSONL” parser would be incorrect. Current Pi source contains legacy transcript storage alongside a newer durable usage ledger; Oh My Pi adds separate operational model-usage records, agent aggregation, estimated-cost telemetry and subagent ancestry. Their overlapping records are exactly the sort of accounting problem flAImegraph should test before proposing a standard.

Repository identities are explicit here: **Pi** means `earendil-works/pi`, at [`9767ba275f3e9a5ee0f5c5342249b629ab1b2282`](https://github.com/earendil-works/pi/commit/9767ba275f3e9a5ee0f5c5342249b629ab1b2282), committed September 5, 2026. **Oh My Pi (OMP)** means `can1357/oh-my-pi`, at [`1adcef9762b065c0cef15703fd3e78ecaaa52a3b`](https://github.com/can1357/oh-my-pi/commit/1adcef9762b065c0cef15703fd3e78ecaaa52a3b), committed September 6. These revisions came from GitHub's commit API; cited source was downloaded at those hashes. “MyPi” is ambiguous and is not silently treated as either repository. Search also surfaced another independently named `Changhochien/oh-my-pi`; it is outside this comparison.

## Capture surfaces are different

| Surface | Concrete shape | Import implication |
|---|---|---|
| Pi legacy transcript | `type:message`, entry `id/parentId`, nested `message.role`, model and usage; separate compaction/branch-summary entries | Count usage-bearing records across the intended work scope, not just current context. |
| Pi new harness storage | Header `v:4, kind:header, storageVersion:1`; transaction lines can contain arrays; separate entry and usage writes | Read the durable usage stream as authority, linking back to entries. Do not count both. |
| Pi new harness events | `entry_added` and `usage`; the latter includes a usage `row` and cumulative `totals` | `row.usage` is an individual observation; `totals` is a snapshot. |
| OMP transcript | Assistant usage, `model_usage` entries, and `toolResult.details.usage` for task results | Non-conversation work and delegated aggregates require explicit handling. |
| OMP OTel spans | `invoke_agent → chat/execute_tool`, with separate `pi.gen_ai.agent.*.total` aggregate keys | Existing self/aggregate separation is useful prior art. |

Sources: [Pi legacy format](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/docs/session-format.md), [Pi v4 storage](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/session/jsonl/storage.ts), [Pi response settlement](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/runtime/drive/response.ts#L319), [OMP session accounting](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/src/session/session-manager.ts#L174), [OMP telemetry](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/agent/src/telemetry.ts).

## Model-call measurements and normalization

Pi's current `AssistantMessage` carries `api`, `provider`, `model`, `usage`, terminal reason and timestamp. Optional fields include concrete `responseModel`, provider `responseId`, and provider-native `providerThinkingLevel`. `Usage.reasoning` is explicitly a subset of output; `cacheWrite1h` is a subset of cache-write. The documentation's shorter usage example is less complete than the current TypeScript definition. [Pi types](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/ai/src/types.ts#L383).

For ordinary Pi conversation usage, the additive buckets are `input + output + cacheRead + cacheWrite`. An OTel input total therefore needs noncached input plus both cache buckets. Reasoning must not be added to output again. Pi's cost calculator multiplies bucket counts by model-configured per-million-token rates, including tier handling. Thus a stored monetary number is generally a model-rate calculation, not proof of an invoice charge or subscription marginal cost. Preserve its recorded value and provenance. [Pi cost calculation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/ai/src/models.ts#L891).

OMP extends this shape. It distinguishes occupied `contextTokens` from billable buckets, can include provider-side `orchestration` tokens, and reports optional fractional `premiumRequests`, reasoning, cache retention and server-tool request counts. These are not interchangeable units. Its current usage type explicitly allows `totalTokens` to exceed the four conversation buckets because orchestration contributes additional consumption. [OMP catalog types](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/catalog/src/types.ts#L101).

A source-owned test provides an exact counterexample:

```json
{
  "input": 0,
  "output": 29,
  "cacheRead": 180224,
  "cacheWrite": 0,
  "totalTokens": 185882,
  "orchestration": {"input": 5629}
}
```

Here the four familiar buckets sum to 180,253; the extra 5,629 explains the reported total. A validator declaring every such record malformed would reject valid OMP usage. The same tests cover fractional premium requests and auxiliary calls that never become conversation messages. [Usage-statistics tests](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/test/session-manager/usage-statistics.test.ts).

## Real public fixture: what can actually be recovered

A Python standard-library parser read the public `before-compaction.jsonl` fixture from each pinned repository. The fixtures have identical counts and usage arithmetic, but differ in some message contents: they are not byte-identical or independent provider validation datasets. The Pi fixture SHA-256 is `56f9cf221541c09091cf082ad2ed0c4b4931ef5e8857a42dc623afae35a2e59c`.

| Result from each fixture | Value |
|---|---:|
| JSONL records | 1,003 |
| Assistant messages | 484 |
| Tool-result messages | 448 |
| Tool-call content blocks | 454 |
| Compaction records | 2 |
| Input / output | 3,689 / 187,895 |
| Cache-read / cache-write | 54,693,675 / 1,685,320 |
| Sum of recorded `totalTokens` | 56,570,579 |
| Sum of recorded `cost.total` | 42.5959075 |

All 484 assistant records satisfy the four-bucket total equation. Terminal reasons comprise 434 tool-use, 31 stop, 18 aborted and one error; 13 records have zero reported total usage. No assistant has `responseId`. Both compactions lack usage. The header has no version, and message records lack the modern entry IDs, making this a legacy fixture. These numbers describe recorded observations; neither zero usage nor absent compaction usage proves zero provider consumption. [Pi fixture](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/test/fixtures/before-compaction.jsonl), [OMP fixture](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/test/fixtures/before-compaction.jsonl).

For reproducibility, the arithmetic was equivalent to:

```python
rows = [json.loads(line) for line in fixture.read_text().splitlines()]
assistant = [r["message"] for r in rows
             if r.get("message", {}).get("role") == "assistant"]
fields = ("input", "output", "cacheRead", "cacheWrite")
assert all(m["usage"]["totalTokens"] ==
           sum(m["usage"].get(k, 0) for k in fields) for m in assistant)
tokens = sum(m["usage"]["totalTokens"] for m in assistant)
cost = sum(m["usage"]["cost"]["total"] for m in assistant)
```

No repository tests or live agent calls were executed. The public tests discussed elsewhere were read as source evidence, not reported as newly passing.

## Compaction, tools and retries

A legacy Pi session's statistics sum assistant usage, optional tool-result usage, and optional compaction/branch-summary usage across `getEntries()`. They do not derive expenditure from the active compacted context. This is the right distinction between historical consumption and current prompt occupancy. [Session statistics](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/agent-session.ts#L3330).

Current compaction code can make separate history and turn-prefix summarization calls, then combine their usage into one summary result. Consequently a compaction usage record may aggregate multiple calls. `tokensBefore` is context sizing, not summarizer consumption. Retained messages embedded in a checkpoint are copied context, not new calls. [Compaction implementation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/compaction/compaction.ts#L752).

Tool starts/updates/ends expose `toolCallId`, names, arguments and outcomes; stored tool results correlate with assistant tool-call blocks. A tool-result's optional usage describes nested LLM work. Counting a tool's returned text length as generated model tokens would invent an unsupported measurement. [Agent event types](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/types.ts#L432).

Pi's legacy runtime preserves retryable assistant errors in history while removing them from active retry context. However, its reusable retry helper returns only the terminal response; callback events announce retries without accumulating every attempt's usage. Source-level provider/SDK retries form another boundary. Therefore “one assistant message equals one physical provider attempt” is not a universal contract. [Legacy retry path](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/agent-session.ts#L2891), [Retry helper](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/ai/src/utils/retry.ts#L145).

OMP also separates normal error recovery from compaction recovery. Its instrumented one-shot helper starts one chat span outside the optional retry loop and finishes using the returned message. Even live OTel spans therefore do not automatically reveal each physical summarization attempt's usage. [Retry policy](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/docs/non-compaction-retry-policy.md), [One-shot implementation](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/agent/src/telemetry.ts#L1699).

## Pi's newer ledger changes the importer design

The newer harness declares a version-4 JSONL header and transactional storage, distinct from the coding-agent documentation's v3 transcript. A line may contain multiple committed writes. Its `UsageRow` includes `id`, `seq`, `usage`, optional `entryId`, `adjustment` and optional details. Storage exposes `scanUsage()` separately from entry scans. [v4 types](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/session/jsonl/types.ts), [Ledger types](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/session/types.ts#L378).

Actual response settlement atomically inserts both the assistant entry and its linked usage row, then emits `entry_added` and `usage` events. The usage event carries both the row and cumulative session totals. An importer summing the message, row and totals would count the same work repeatedly. This is concrete pre-existing separation of observations, history and totals, not merely a proposed schema. [Settlement implementation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/src/harness/runtime/drive/response.ts#L319).

The newer telemetry documentation explicitly identifies itself as design input, says much runtime and cross-process tracing remains unfinished, and says the current telemetry contract lacks links. A generated `pi.ai.request`/harness schema is therefore not proof that every installed CLI invocation exports those spans. Whether a particular release uses the old core, newer harness, or a hosted adapter must be established per capture source. [Telemetry status notes](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/docs/telemetry.md), [Generated schema](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/docs/telemetry-schema.md).

## Delegation and existing observability

Pi's bundled example subagent extension launches `--mode json -p --no-session`. It captures child messages and sums assistant usage into each result, then returns results inside tool-specific details. Child work can thus survive in parent result details without an independent child session file. The example's accumulator does not cover every newer auxiliary-usage surface; extension-specific parsing is required. [Subagent example](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/examples/extensions/subagent/index.ts#L300).

OMP's task executor instead supports persisted child sessions, carries `parentToolCallId`, derives child telemetry identity and conversation ID, and emits a handoff under the parent's active task-tool context. This supports detailed delegation ancestry when telemetry is configured. It does not make arbitrary shell-spawned agents automatically traceable. [Task executor](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/src/task/executor.ts#L3284), [Persisted child-session test](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/test/session-manager/subagent-breadcrumb.test.ts).

OMP already places aggregate usage under different keys from call usage and exposes estimated cost versus unavailable reasons. Its OTLP exporter is opt-in through configured endpoints and supports HTTP/protobuf, declining unsupported protocol choices. Its `AgentRunCoverage` refers to available/invoked/unused tools, not a certificate of complete provider-billing capture. [Telemetry implementation](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/agent/src/telemetry.ts#L1980), [Export bootstrap](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/src/telemetry-export.ts), [Collector definition](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/agent/src/run-collector.ts#L105).

OMP also attaches late `model_usage` to its initiating branch without moving the active leaf. Forks can intentionally zero inherited monetary attribution while retaining token history. This means all-branch scans, child aggregates, fork copies and monetary fields require separate provenance rules. Summing every assistant in every session is not defensible accounting. [Session implementation](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/src/session/session-manager.ts#L2324), [Fork cost reset](https://github.com/can1357/oh-my-pi/blob/1adcef9762b065c0cef15703fd3e78ecaaa52a3b/packages/coding-agent/src/session/session-manager.ts#L2894).

## Consequence for the way forward

Build the next comparison around versioned source adapters and reconciliation rules, with a declared authority order: durable usage rows where present; otherwise source-defined call and auxiliary observations; aggregate records as checks or opaque residuals. Preserve source identities, branch/fork lineage, measurement basis and unknowns. Test both legacy history and newer ledgers. Pi and OMP are implementation partners and prior art to learn from, not blank canvases awaiting a tokenomics model.

Still unverified: target installed release paths, every provider's hidden retry behavior, durability under process loss, complete child-to-parent reconciliation, and invoice correspondence. The public fixture proves reproducible arithmetic over recorded usage; it cannot prove complete epic cost.
