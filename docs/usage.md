# Usage-first adoption guide

## Capture and import

The default `flaimegraph` CLI and package root implement Usage Interchange 0.4. No rates or currency are required. Build from source with `npm ci --ignore-scripts && npm run build`, or install the release archive with `npm install /path/to/flaimegraph-0.4.0.tgz`.

```sh
node dist/cli.js import --format codex --input session.jsonl --dataset-id work-1 --out usage.json
node dist/cli.js merge --inputs usage-a.json,usage-b.json --out combined.json
node dist/cli.js report --input usage.json --group-by task,model --out report.json
node dist/cli.js export --input report.json --meter input_tokens --out-dir profile --svg true
node dist/cli.js validate --kind usage --input usage.json
```

Formats include `usage`, `legacy`, `operations`, `codex`, `pi`, `openai`, `anthropic`, `gemini` and `otel`/`otlp`. Native adapters are conservative offline readers of supported records, not integrations that intercept every provider call. Unavailable facts stay unknown. Codex cumulative/token-count snapshots do not become additive request usage. Usage is canonicalized with explicit cache and reasoning subset relationships; totals never sum subsets into their parents.

A measurement is an exact nonnegative decimal string or null. Missing meters are not reported/applicable; explicit null means unavailable. Native JSON numbers have already passed through the source parser's IEEE-754 representation, so use decimal strings when long fractional precision or large counters must remain exact; unsafe integer numbers become unavailable. Only direct event/interval deltas enter additive totals. Incompatible counting bases fail rather than silently combine. The selected profile carries unknown/excluded observation IDs, and the report retains all evidence.

## Associate work with a ticket or custom string

`work_item_id` is a developer-defined string whose meaning is local to the dataset/project. It can be a Jira key, GitHub issue URL or a label such as `Customer A / cache repair`. No ticket-system connection or global registry is required. It identifies the overall work; `task_id` can still identify implementation, test and review tasks beneath it.

```sh
node dist/cli.js import --format codex --input session.jsonl --dataset-id my-repo --work-item "PROJ-142 / cache repair" --out usage.json
node dist/cli.js report --input usage.json --group-by work_item,model --out report.json
node dist/cli.js export --input report.json --meter input_tokens --group-by work_item,agent --out-dir ticket-profile --svg true
```

Set `default_work_item_id` on the recorder to tag its events, or set `work_item_id` per event when switching work. Native-log import accepts `--work-item`; it preserves a source mapping and rejects a conflicting assignment. The viewer offers **Work identifier for native log**, grouping and search. Already canonical usage reports retain their original immutable IDs and associations. If a session covers multiple tickets, attach the identifier at each work boundary or import separately bounded captures; a whole-log label does not discover those boundaries automatically. Work labels are metadata and may appear in exported graphs, so use a suitable public identifier when sharing a capture.

## Instrument a producer

```ts
import { createUsageRecorder, createUsageReport } from 'flaimegraph';

const recorder = createUsageRecorder({
  dataset_id: 'delivery-1', source_id: 'worker-capture-1',
  default_work_item_id: 'work-1', default_agent_id: 'worker-1',
});
const call = recorder.startModelCall({
  operation_id: 'request-1',
  request: { model: 'configured-model', service_tier: 'priority', reasoning: { effort: 'high' } },
});
// Execute the provider call in the application, then supply its actual response metadata.
call.end({
  response: { actual_model: 'response-model', actual_tier: 'standard' },
  measurements: {
    input_tokens: '1200', cache_read_input_tokens: '1000',
    output_tokens: '80', reasoning_output_tokens: '40',
  },
});
const report = createUsageReport(recorder.snapshot());
```

Use explicit parent observation IDs for relationships between usage events. The existing `OperationRecorder` provides asynchronous nested operation scopes, including filesystem IO. `operationUsage()` converts its bundle to usage observations while retaining parent ancestry; inclusive elapsed intervals remain non-additive. Node operation instrumentation does not expose the internals of an opaque shell command.

Producer event IDs are immutable at reconciliation. Finish a lifecycle before publishing that event; a running snapshot followed by a changed completed event is not an append-only replay. Use separate producer source IDs for independent capture streams. Loss counters are cumulative per source; merging takes each source maximum and sums independent sources. Multi-source captures with drops must provide `coverage.dropped_by_source`.

Keep raw prompts, results and credentials out of custom metadata. Built-in capture paths omit raw payloads and reject known sensitive metadata keys, but arbitrary caller-supplied labels/values remain a producer trust boundary.

## Analyze accepted work

```sh
node dist/cli.js analyze --input report.json --options analysis-options.json --out analysis.json
```

Options attach `work_items`, task/scope/acceptance cohorts, attempts, benchmarks, candidate policies and capacity snapshots. See the exported types in `flaimegraph/analysis` and [the efficiency input schema](../spec/0.4/schemas/efficiency-input.schema.json). Session totals remain visible without acceptance metadata; per-accepted efficiency does not exist until outcomes are supplied. Attempts can describe retries, escalation, review and rework, and shared observation ownership is rejected.

## External benchmark logs

```sh
node dist/cli.js benchmark-import --format inspect --input examples/dogfood/v04/inspect-log.json --options examples/dogfood/v04/inspect-options.json --out benchmark.json
node dist/cli.js benchmark --baseline baseline.json --candidate benchmark.json --out comparison.json
```

Inspect AI JSON exports are supported by `importInspectBenchmark` / `importInspectBenchmarkDetailed` from `flaimegraph/analysis`. Convert binary `.eval` logs with Inspect's `inspect log convert` first. Select a scorer and accepted values or numeric threshold explicitly, plus workload, scope revision and acceptance version. Missing/error scores remain unknown. Primary model usage and auxiliary grading-model usage remain separate. Raw prompts, messages and provider cost fields are not imported. Historical is the default evaluation basis; importing a log does not make it a controlled experiment. The detailed API and CLI summary expose missing-condition limitations.

Benchmark comparison preserves resource vectors, acceptance counts and mean sample latency, and includes declared analysis overhead in total benchmark demand. Matching metadata alone does not establish causal model superiority. See [the analysis contract](efficiency-analysis.md) for limits.

## Forecast runway

```sh
node dist/cli.js runway --input examples/dogfood/v04/runway-input.json --out runway.json
```

The input supplies resource snapshots, per-accepted demand and an explicit forecast horizon. Units, workload and scope must match. Unknown/stale capacity or resets within the horizon prevent an unsupported precise forecast. Source-backed derived demand produces a limited forecast. Declared or estimated demand requires the explicit `allow_unverified_demand` scenario option. An account subscription percentage is never silently converted into tokens. These deterministic calculations do not call an LLM or automatically change routing or repository settings.

## Migrate from 0.3

Use `flaimegraph/pricing` for the old valuation, context-report and cost APIs. The old CLI is `flaimegraph-pricing` (`node dist/pricing-cli.js` in a checkout). The [legacy guide](legacy-usage.md) retains working examples. Old evidence can be projected through `fromLegacyEvidence`; existing monetary artifacts remain readable by the optional consumer. The default viewer now opens usage; context and legacy cost routes remain available.
