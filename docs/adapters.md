# Native evidence adapters

This page describes the legacy `importEvidence` API. For the current usage CLI
and `importUsage`, including the separate `claude`, `claude-transcript` and
`codex-exec` formats, see [native capture](native-capture.md) and the
[v0.6.0 support matrix](ga-readiness.md#release-support-matrix). Legacy fixture
coverage below is not an additional live harness support claim.

`importEvidence(harness, input, options?)` is a pure parser. The caller supplies the complete JSON or JSONL string; adapters do not read local files, scan a home directory, call a provider, or export prompts and results. Each adapter returns an `EvidenceBundle` with source references, normalized observations, relationships and explicit coverage issues.

Every source is marked `partial` in this experimental release. A capability entry describes the inspected format and fixture contract; it does not claim support for every installed or future product version.

| Harness | Accepted format | Direct usage authority | Important normalization |
| --- | --- | --- | --- |
| `codex` | `codex-rollout-jsonl` | `token_usage_record.payload.usage` keyed by response identity | `input_tokens` is inclusive; cached input and reasoning are subsets. `event_msg.token_count` is retained as snapshot/aggregate evidence and is never added as another call. |
| `pi` | `pi-legacy-transcript-jsonl`, `pi-v4-storage-jsonl` | Legacy assistant message usage, or v4 durable `usage.row` when present | Pi `input` is cache-exclusive; normalized input adds `cacheRead` and `cacheWrite`. v4 cumulative `totals` remain snapshots. |
| `omp` | `oh-my-pi-session-jsonl` | Assistant model usage | Cache buckets are normalized like Pi. Orchestration is `unclassified_tokens`; operational `model_usage` and child/task totals are aggregate observations. |
| `claude` | `claude-code-transcript-jsonl` | Latest usage-bearing assistant row per native message identity | Anthropic input adds cache read and cache creation to the inclusive total. Repeated streaming rows update one message; different message IDs remain separate calls. |
| `gemini` | `gemini-cli-chat-jsonl` | Latest usage-bearing model message per native message identity | Native prompt/input counts are treated as inclusive when cached content is reported. Thoughts are an output subset. Context breakdowns are estimates and remain activity evidence. |
| `opencode` | `opencode-step-jsonl` | `step-finish` token parts | OpenCode input adds exclusive cache read/write; output adds exclusive reasoning. Session totals are aggregate checks. |
| `otel` | `otlp-json` | GenAI inference spans | Standard GenAI input/output include overlapping cache/reasoning subsets. Agent/workflow spans are aggregate; duplicate span conflicts are issues. OTLP epoch-nanosecond times are normalized to RFC3339, and the `flAImegraph.*` local binding is read for round-trip accounting fields. |
| `copilot` | `copilot-otlp-json` | Native per-call model spans | Uses the OTLP mapping plus Copilot conversation/turn/response IDs, cost and AI-unit attributes. Parent agent usage remains aggregate; `flAImegraph.*` local accounting fields are retained on re-import. |

Normalized quantities are nonnegative decimal digit strings. Unsafe JavaScript numbers, negative counts, malformed decimals and invalid JSONL rows create issues. `"0"` is retained as known zero; missing fields remain `null`. No adapter invents one token or zero cost for missing evidence.

`accounting_scope: "direct"` is reserved for model-call usage selected by the v0.1 direct-only valuation policy. `aggregate`, `snapshot` and `unknown` observations remain available for reconciliation and analysis but are not silently charged alongside their direct descendants. Failed or cancelled rows with measured usage retain their usage and status.

Observation IDs are deterministic hashes of the adapter namespace, source ID and native identity. Native IDs are represented in attributes as hashes where a raw identifier is not needed for the normalized field. Re-importing identical data is stable. Equal duplicate records are counted once; conflicting duplicate identities produce an error issue and are not resolved by last-write-wins. Native streaming updates are collapsed only for adapters whose source contract identifies them as updates to the same message.

Tool names, lifecycle events, subagent ancestry and parent/link relationships are retained without prompt or result content. A tool event without usage is still useful activity. A context estimate or compaction marker does not establish model-token expenditure; the adapter records an explicit unknown/estimate issue.

Use `adapterCapabilities()` for the machine-readable matrix. Its `tested_versions` values identify the checked adapter/fixture contracts and source pins, not a promise about all versions of the harness.
