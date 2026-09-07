# Operation recorder implementation evidence

`OperationRecorder` in `src/operation-recorder.ts` is the live, bounded capture seam for operation-level work. Its constructor accepts `{ dataset_id, namespace, max_spans?, max_links?, resource_key? }`. `run(spec, callback)` executes the callback inside a Node `AsyncLocalStorage` scope, records actual asynchronous containment, and returns or rethrows the callback's result or error unchanged. A callback can update its span through `OperationScope.bindObservation`, `setIO`, `setClassification`, `setRouting`, `setLabel`, and `update`; `linkContext` records a producing context revision and `link` records dependency, delegation, or consuming-context relations without turning those relations into execution parents.

Generic `run` classifications and links default to declared caller facts; concrete filesystem wrappers explicitly classify observed IO. Invalid empty context identities and self-dependencies are rejected with a capture limitation.

The recorder uses a per-instance monotonic sequence and `stream_id` equal to the caller's namespace. Start and end wall-clock timestamps are accompanied by timing classifications and a duration derived from `process.hrtime.bigint()` with a monotonic clock. `snapshot()` materializes running spans with their current elapsed duration and returns a detached structured clone, so changing a returned snapshot cannot change later snapshots. Live snapshots are replaceable inspection views: `reconcileOperationBundles` explicitly rejects running spans. Reconcile only completed immutable snapshots. After a scope finishes, its metadata mutators and links are ignored with a coverage limitation, preserving finalized operation identity. Every retained span and link cites the local `operation-recorder` source artifact. Caller-supplied link provenance is retained only when every reference resolves to that artifact; unresolved references fall back to the originating span's local reference and add a limitation. The artifact contains no workload payload, command, error, or filesystem path.

Filesystem wrappers use the normal async operations and preserve their ordinary results:

```ts
await recorder.readFile(path, { label?, start_line?, end_line? });
await recorder.readDirectory(path, { label? });
await recorder.writeFile(path, data, { label? });
```

File resource IDs are HMAC-SHA-256 values over the recorder namespace and a hex-encoded byte path. Equivalent UTF-8 strings, Buffers and file URLs share identity; distinct non-UTF-8 byte paths remain distinct. A caller-supplied `resource_key` makes those IDs stable across recorder instances with the same namespace; an omitted key is generated randomly. Default resource labels are opaque. A caller-supplied label is retained as an explicit publishing choice. Each IO quantity has its own evidence and method: file reads mark backing bytes as observed, excerpt bytes and the backing-byte SHA-256 as derived; directory scans mark returned and examined entry counts as observed; writes mark bytes written as observed and the written-byte SHA-256 as derived. Inserted and deleted counts remain unknown because a plain write does not establish an edit diff. Every omitted quantity remains `null` with an unknown measurement fact. Raw contents, paths, and filesystem error text are never copied into the bundle.

The span cap is fail-open for the workload. Once `max_spans` is reached, new spans are dropped and counted in both `coverage.dropped_spans` and the cumulative `coverage.dropped_spans_by_stream` counter, callbacks still execute, and callback scopes preserve the nearest retained ancestor for subsequent operations. Consequently a retained span never points to a dropped or unknown parent. The snapshot declares incomplete coverage and the cap in `coverage.limitations`. A zero span cap is valid and records an empty, explicitly incomplete bundle when work is attempted.

Links are independently bounded by `max_links` (default `min(max_spans * 4, 100000)`). Exact retained replay is deduplicated by a map without consuming capacity. New links beyond the cap return `null`, increment cumulative `coverage.dropped_links` and `coverage.dropped_links_by_stream`, and make coverage partial. Snapshots containing running spans or any capture limitation are also partial.

Focused public-seam tests in `test/operation-recorder.test.ts` exercise real temporary-directory reads, line ranges, writes, directory enumeration, missing-file errors, nested and concurrent scopes, caught inner errors, live snapshots, cap behavior, detached snapshots, stable and random resource identities, privacy, and context/dependency links. The recorder adds no model calls, prompts, tokenizer work, or policy decisions. Routing metadata can be recorded only as a workload policy fact with `origin: "workload_policy"`.

Validation used during implementation:

```text
npm run typecheck
node --import tsx --test test/operation-recorder.test.ts
node --import tsx --test test/operations.test.ts
```

The benchmark seam is intentionally recorder-only: create one recorder, perform 5,000 real temporary-directory reads through `readFile`, call `snapshot()`, and report elapsed wall time plus retained span count and `coverage.dropped_spans`. Do not add model calls or include file contents in the benchmark output.
