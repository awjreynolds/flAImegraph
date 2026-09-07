# Operation Interchange, experimental 0.3.0

Operation Interchange records individual operations within agent work. It composes with the frozen [0.1 cost evidence](../0.1/README.md) and [0.2 context manifests](../0.2/README.md). The format does not require model calls, tokenization or semantic classification to record work.

## Capture contract

The [operation schema](schemas/operations.schema.json) defines `OperationBundle`. Each span has a stable ID, a producer stream and sequence, source references, an operation kind, classification evidence, status and explicit nullable timing, IO and model identities. `parent_id` represents execution containment only. Dependency, delegation and context production/consumption are separate links; a completed file read does not become the execution parent of a later model request merely because that request consumes its output.

Timing facts carry evidence, method and clock. A native event timestamp is not automatically an execution start. A logical producer stream is not an OS thread. Partial native captures cannot claim complete instrumentation. Unknown quantities are `null` with unknown evidence; zero is a measured or declared quantity. Requested line ranges, actual backing bytes read, returned bytes, bytes written and edit deltas are distinct. Reading a file does not prove it entered model context. The requesting model is separate from a model executing a task; ordinary IO has no executing model.

Routing records contain a workload policy ID/version, observed or declared condition facts, requested/selected models, reason and action. The profiler records decisions; it does not choose or redirect models. Optional semantic classifiers and summarizers are workload operations and must account for their own usage.

The reference validator enforces shape and semantic constraints: unique identities and stream sequences, resolved references, acyclic parentage, timing/measurement consistency, one operation binding per monetary observation, and complete loss accounting. `coverage` contains cumulative dropped-span and dropped-link counters by producer stream. Limits, running work, opaque native boundaries and metadata failures remain visible.

## Live capture and reconciliation

`OperationRecorder.run(spec, callback)` measures actual asynchronous nesting. Read, directory and write wrappers observe actual local IO and retain no contents or raw paths by default. Caller classifications default to declared; concrete IO wrappers mark observed facts. Optional safe labels are explicit publication choices. Capture caps preserve workload execution. [The recorder contract](../../docs/implementation-evidence/operation-recorder.md) describes loss, privacy and error behavior.

A live `snapshot()` is a replaceable inspection view. `reconcileOperationBundles` rejects any running span: merge only completed immutable captures. Completed scopes ignore late metadata/link updates and add a limitation. Identical captures replay once; conflicting immutable IDs fail rather than choosing a winner. Completed overlapping captures merge cumulative loss counters by per-stream maximum, not addition. Use distinct namespaces for distinct runs or producers.

Native import supports typed Codex/Pi lifecycle events with exact ID correlation. It does not parse arbitrary shell scripts or infer hidden filesystem work. Cost evidence joins require the identical native source digest and exact usage identity. Missing context manifests and unavailable child operations remain gaps. A live [Pi tool bridge](../../docs/implementation-evidence/pi-operations.md) supplies nested IO through the harness's injectable operation interfaces.

## Report and projections

`createOperationReport(operations, evidence, valuation, contextReport?)` constructs a self-contained `OperationReport`. `validateOperationReport` validates embedded inputs and recomputes the entire canonical report; altered nodes, totals, assumptions, samples and extra fields are rejected. The typed report contract is in [`src/operation-types.ts`](../../src/operation-types.ts). The reference semantic validator is authoritative; the standalone operation schema validates capture shape and requires semantic validation as well.

The execution tree retains all recorded work regardless of monetary cost. An operation's self state is priced, unknown or not applicable. Exact direct valued observations contribute once along recorded ancestry. Unbound observations stay visible and unpriced observations stay unknown. Positive charges and credits are exported separately; signed amounts are never converted to positive net widths.

Source allocation is a separate estimated information-flow projection. It reuses the selected 0.2 proportional input-coverage method, allocating whole request cost **including output**. It is neither a per-file invoice nor marginal savings. Repeated occurrences are distinct exposures. A producing operation is attached only with one unambiguous `produces_context` link and an exact matching consuming request/occurrence link. Missing or multiple producers leave the source amount without operation ancestry. Unallocated context and unknown costs remain visible. Summary transformations do not recursively charge later summary consumption to the original read: the summary producer receives that allocation, while its own model usage is charged independently.

`operation-export` writes folded stacks, gzip pprof profiles, Chrome Trace JSON and optional SVGs rendered with the bundled upstream FlameGraph. Operation count provides one unit per captured span, including unpriced IO. Cost profiles use exact integer currency nanos. pprof and SVG range limits fail explicitly; zero positive-width SVGs are skipped with a manifest reason. Elapsed time is not added across overlapping spans.

## Commands and examples

```sh
node dist/cli.js operation-import --harness codex --input native.jsonl --dataset-id work-1 --namespace root-run --evidence evidence.json --out operations.json
node dist/cli.js validate --kind operations --input operations.json
node dist/cli.js operation-report --input operations.json --evidence evidence.json --valuation valuation.json --out report.json
node dist/cli.js operation-export --input report.json --out-dir operation-views --svg true
node dist/cli.js operation-merge --inputs capture-a.json,capture-b.json --out operations.json
```

Use cost evidence from the exact same native bytes; import and value it using the existing 0.1 commands. Supplying `--context-report` to `operation-report` enables estimated source allocation when matching manifests and explicit links exist. Outputs cannot overwrite input artifacts, including through aliases.

[The v0.3 evidence collection](../../examples/dogfood/v03/README.md) contains a 5,000-file real IO workload, real Pi tool execution, a bounded sanitized Codex development capture, and a clearly synthetic summary-routing walkthrough. These establish different boundaries and must not be conflated with a paired live model experiment.
