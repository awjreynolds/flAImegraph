# Capture and import local harness logs

flAImegraph runs locally and needs no account. A harness needs its usual provider
access only when it runs a model. Importing saved logs, validating them, creating
reports and exporting profiles need no provider credentials or network access.

For v0.6.0, Codex and Pi have the supported surfaces listed in the
[release matrix](ga-readiness.md#release-support-matrix). Both `claude` and
`claude-transcript` are experimental; the examples below do not imply successful
live Claude validation.

Build the CLI with `npm ci --ignore-scripts && npm run build`, or use the installed
`flaimegraph` command in place of `node dist/cli.js` below.

## Record a new structured run

The capture command launches the exact command after `--` without a shell. It
does not install hooks, change provider routing, or modify harness configuration.
Pass the harness's structured-output flags explicitly:

```sh
node dist/cli.js capture --format pi --dataset-id ticket-142 --out pi-usage.json -- \
  pi --mode json --no-session -p "Perform the requested work"

node dist/cli.js capture --format claude --dataset-id ticket-142 --out claude-usage.json -- \
  claude -p --output-format stream-json --verbose "Perform the requested work"

node dist/cli.js capture --format codex-exec --dataset-id ticket-142 --out codex-turns.json -- \
  codex exec --json "Perform the requested work"
```

These are noninteractive structured runs. The child retains its normal settings,
tools, permissions and billing. flAImegraph consumes its stdout; stderr remains
visible, and the command returns the child's exit code. The capture command is
the exception to the import/report commands' offline behavior: the child can
contact whichever provider the user configured.

Output must be a new path. Captures retain identifiers, model/provider settings,
quantities, provenance and coverage, while omitting message text, arguments,
tool-result bodies and price estimates. Raw stdout is bounded to 64 MiB in memory
and is not saved. Content-inclusive upstream logs require a separate, explicit
harness logging choice; the metadata capture command has no content switch.

As complete lines arrive, the command periodically replaces an atomic metadata
snapshot. A killed wrapper leaves the last written snapshot marked running and
incomplete. A normal or failed child exit writes a final status; a truncated JSON
tail becomes visible loss evidence. A capture/import failure retains the last
valid snapshot with a failure issue when the output remains writable. Disk write
failure cannot guarantee another status write.

Snapshots are mutable views of one capture: **replace the older snapshot; do not
merge successive snapshots**. They do not guarantee power-loss durability or
capture every in-flight streaming delta. Use the [lifecycle journal SDK](lifecycle.md)
when dispatch-before-write ordering, restart and hash-chain integrity are needed.

## Import an existing file

```sh
node dist/cli.js import --format codex --input rollout.jsonl --dataset-id ticket-142 --out usage.json
node dist/cli.js import --format pi --input pi-session.jsonl --dataset-id ticket-142 --out usage.json
node dist/cli.js import --format claude --input claude-stream.jsonl --dataset-id ticket-142 --out usage.json
```

`--format claude-transcript` recognizes assistant/user messages in an internal
transcript, with an explicit compatibility limitation: that on-disk format is
not a stable public contract. `claude` targets documented SDK/CLI stream-json.
`codex` targets native rollout receipts; `codex-exec` targets the public exec
stdout stream. Pi accepts legacy session entries, recognized durable ledger rows
and settled `message_end` events from JSON mode.

Input files are read-only, must be regular UTF-8 files and are bounded to 64 MiB.
Imports reject attempts to overwrite an input. Use `--work-item` for a ticket or
other work label; missing task, agent, timing and response associations stay unknown.
Retain source logs separately if their content is needed for an audit; flAImegraph
does not delete or manage their retention.

## Inspect and exchange

```sh
node dist/cli.js validate --kind usage --input usage.json
node dist/cli.js report --input usage.json --out report.json
node dist/cli.js export --input report.json --meter input_tokens --out-dir profile --svg true
node dist/cli.js schema --kind usage --out usage.schema.json
```

The [local viewer](../viewer/README.md) can open `usage.json` with **Load a session**.
The report and export retain unknown coverage; no pricing input is required.
See [portable conformance](../spec/logging-conformance.md) for syntax validation,
semantic validation and independent fixtures.

## Accounting boundaries

| Surface | Direct consumption | Non-additive evidence and limits |
| --- | --- | --- |
| Codex native rollout | Recognized response usage receipts | Legacy cumulative snapshots remain separate; hidden retries and exact context attribution are unknown |
| Codex exec stdout | No per-response receipt identity | Turn usage remains an aggregate check; direct totals exclude it, and tool-item details are not imported |
| Claude stream-json | Deduplicated provider `message.id` receipts | Repeated counters retain their maximum; final result usage remains a query aggregate, excluded from direct sums; synthetic error zeros are omitted |
| Pi session/JSON mode | Durable usage rows where present, otherwise recognized settled assistant receipts | Session totals remain snapshots; message updates and repeated turn/agent-end wrappers are not additional consumption |

Claude query aggregates may cover steps or subagents absent from the assistant
stream. Direct totals therefore describe captured response evidence, not the
authoritative whole-query total. Tool calls and their results have separate
identities and link only through recorded call IDs. A tool call is not proof of
success. Neither a successful child exit nor a final result establishes complete
provider billing or an accepted work outcome.

Current validation levels and remaining release gates are in [GA readiness](ga-readiness.md).
