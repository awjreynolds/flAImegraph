# Adapter implementation evidence

The adapter layer is implemented behind the public `importEvidence` and `adapterCapabilities` seams in `src/adapters/index.ts`. Behavioral tests use literal independently specified fixtures in `test/fixtures/adapters/` and run with:

```sh
node --import tsx --test test/adapters.test.ts
```

The tests cover exact decimal-string quantities, inclusive and exclusive cache conventions, reasoning subsets, direct versus aggregate/snapshot scope, native identity deduplication, streaming revisions, tool/lifecycle evidence, parent relationships, cost provenance, malformed/unknown coverage policy, import-option propagation and the versioned `flAImegraph.*` OTLP round-trip binding.

## Source evidence and version boundaries

The adapter rules follow the source audits in `docs/research/`:

- Codex response-level authority is based on the sanitized Codex 0.153.4 capture validation. `token_usage_record.usage` is additive by response identity; legacy `event_msg:token_count` counters are snapshots. The checked-in dogfood fixtures reconcile 177 direct calls and the reported capture totals.
- Pi legacy and v4 rules follow the pinned `earendil-works/pi` source revision and its public fixture analysis. Durable v4 usage rows are preferred over assistant message duplicates, while cumulative totals remain snapshots. Oh My Pi operational and child aggregates remain separate.
- Claude and Copilot rules follow the pinned integration/source audits and documented native export surfaces. Claude streaming updates are selected by message identity; Copilot parent span usage is aggregate evidence.
- Gemini and OpenCode rules follow the pinned CLI/source audits. Gemini context breakdowns are estimates; OpenCode step tokens use exclusive cache/reasoning buckets.
- Generic OTLP rules follow the inspected OpenTelemetry GenAI and OTLP semantic sources. Transport stability does not establish stable GenAI semantics, complete sampling, physical provider consumption or invoice correspondence.

No provider call, local session scan, home-directory discovery, telemetry upload or content export is performed by these functions. Live installed-version validation remains an explicit limitation in each capability entry.

## Validation result

The adapter test file currently contains 17 behavioral tests covering the eight selected harness paths: Codex, Pi legacy, Pi v4, Oh My Pi, Claude Code, Gemini CLI, OpenCode, generic OTLP JSON and Copilot OTLP. The latest focused run passed all 17 tests. Actual Codex dogfood fixtures were also checked read-only: the parser recovered 88, 28, 33 and 28 direct response records respectively, preserving the reported combined totals of 21,155,141 tokens (21,092,039 input and 63,102 output) with 19,225,472 cached input tokens.

The matrix deliberately reports `partial` coverage. Unknown retries, crash/cancellation windows, hidden provider calls, exporter drops, exact context-source attribution, and invoice reconciliation cannot be inferred from these native records alone.
