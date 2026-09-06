# Codex capture validation: this conversation

Checked 6 September 2026 against the local records for this conversation and only its three explicitly linked research agents. This is primary evidence from **Codex 0.153.4**, not a published cross-version export contract. Capture was frozen at **16:36:00 UTC** while the work was still running. No configuration changes, extra provider requests, unrelated session scans, or raw transcript publication were needed.

The sanitized evidence and extractor are on [the capture-depth prototype branch](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/capture-depth). Original prompts, commands, tool results, reasoning contents, credentials, paths and raw response/session identifiers are excluded. Each source has a SHA-256 fingerprint over the included JSONL lines, and each sanitized response retains its source line and ordinal. Original local records are required for a full independent source audit.

## What was measured

| Agent | Distinct response usage records | Sum of reported total tokens | Matches its final included thread total |
| --- | ---: | ---: | --- |
| Coordinator | 88 | 10,811,928 | Yes |
| Telemetry research | 28 | 3,147,637 | Yes |
| Accounting research | 33 | 4,475,390 | Yes |
| Profile research | 28 | 2,720,186 | Yes |
| **Combined** | **177** | **21,155,141** | Sum of four distinct thread totals |

Input is **21,092,039**, of which **19,225,472** is reported cached input. Output is **63,102**, of which **7,445** is reported reasoning output. Cache-write input is zero in these records. Cache/read and reasoning subsets are not added to their containing totals. These quantities include repeated input across requests; they are not the size of the conversation, unique source tokens, physical compute, paid subscription usage, or a monetary bill.

There are **235 selected operation events**: command execution, web/extension work, file changes, subagent activity, MCP calls, and context compaction. User-facing message and reasoning content is excluded from the activity projection. These are harness events, not a guarantee of all OS activity or provider-side operations.

## Authoritative additive surface in this build

`token_usage_record` supplies `thread_id`, `turn_id`, `session_id`, `root_turn_id`, `response_id`, `usage`, `turn_token_usage`, and `thread_token_usage`. The extractor sums **only `usage`**, deduplicating by thread plus response ID. Turn and thread aggregates validate the scope; they are never additional samples.

Every captured response satisfies input + output = total. Cached input plus cache-write input remains within input, and reasoning remains within output. There are no duplicate response IDs in the selected additive records. All six captured quantity sums match the corresponding final included thread counters, not merely the grand total.

The same files also contain **186 `event_msg:token_count` snapshots**. Their count exceeds the 177 response usage records. These carry `last_token_usage` and cumulative totals, and cannot each be treated as a new billable response. The compaction checkpoint also embeds a previously observed usage record. Counting that checkpoint again duplicates prior work.

This authority order is specific to inspected data. A legacy file without `token_usage_record` needs a separate, tested snapshot reconciliation strategy. A repeated response ID with different values requires conflict/correction handling; the throwaway extractor's first-observation deduplication is not a production correction policy.

## What can be joined

| Requested detail | Evidence and defensible interpretation |
| --- | --- |
| Response usage and model | Direct usage record plus current `turn_context.model`/effort. Model is a harness setting, not independently confirmed provider response-model identity. |
| Delegation | `SubAgentActivity.agent_thread_id`/path, child session `parent_thread_id`, and shared session/root-turn IDs. Child response usage remains in child files; the parent's own thread total excludes it in this capture. |
| User-turn rollup | `root_turn_id` on each usage record groups delegated work under its initiating root turn, including a later follow-up to the same agent. |
| Tool execution | Completed items expose type, call/item identity, status, and where available start/end timing; top-level call/output records also have call IDs. |
| Call-to-tool association | Chronological intervals are shown as chronology. This prototype has not proven a complete response-ID-to-tool-call join and does not assign response tokens to the preceding tool. |
| Compaction | A `compacted` checkpoint and `ContextCompaction` item expose the boundary. The checkpoint's `compaction_response_id` is null and its embedded usage repeats an earlier response. |
| Request composition | Transcript and replacement history exist locally, but final client request serialization per response is not captured by this extractor. Exact per-file/tool-result shares are unavailable. |
| Retries/cancellation | No complete physical-attempt accounting is demonstrated. One recorded response is not proof of one provider attempt. |
| Work ownership | No real ticket/epic IDs were in the capture. One-conversation membership is known; demonstration workstreams are analyst labels. |
| Cost | No invoice or direct charge evidence in this capture. No price estimate is manufactured. |

The coordinator's last input before the compaction marker is **236,561 tokens**; the first input afterward is **31,758**. The observed adjacent difference is **−204,803**. It is evidence of a change across the boundary, not standalone summarization usage, exact removed-content attribution, or counterfactual savings. Other request changes can occur across the same boundary.

## What the prototype verifies

The self-contained HTML supports agent/turn/response grouping, root-turn/agent/response grouping, and explicitly illustrative epic/workstream grouping. It provides six selectable token measures, a response-input sequence with a compaction marker, response-level provenance, and a separate operation table. Guided checks expose category overlap, regrouping, compaction and unavailable attribution.

The inline JavaScript and JSON parse successfully. A direct calculation check verifies that every parent equals its children, every root equals the selected measure sum, and all six measures conserve quantities across all three groupings. The browser URL policy blocked loading the local HTML; **visual and interaction verification was not completed**. No product usability claim or user acceptance is inferred from source checks.

## Conclusion

Detailed retrospective response-level profiling is feasible for this build, with genuine delegation and context-transition evidence. That is substantially richer than per-agent spend. It does not establish complete provider billing, exact context-source attribution, semantic usefulness, or a universal Codex parser. The first implementation should preserve these boundaries rather than hide them under detailed-looking rectangles.
