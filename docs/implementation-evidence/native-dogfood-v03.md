# v0.3 native operation dogfood

This is a bounded run of the native Codex operation importer over one real
rollout capture. The raw capture is supplied at regeneration time and is not
committed. The public generator requires `--input`, selects the frozen window
below, and passes one identical in-memory JSONL snapshot to both
`importEvidence` and `importNativeOperations`.

```text
node --import tsx tools/dogfood-native-v03.ts \
  --input "$CODEX_CAPTURE" \
  --output examples/dogfood/v03
```

The inclusive selection window is `2026-09-06T23:29:51.200Z` through
`2026-09-07T00:17:07.300Z`. The final selected snapshot contains 837 physical
JSONL rows and 3,459,484 UTF-8 bytes, from source line 5,960 through 6,796.
Its selected-snapshot SHA-256 is
`6a583e367d5564421e2af955dc5617335befc5111ca797fb0626b4fe58fd7396`.
The complete source-file SHA-256 is recomputed on every regeneration and is
recorded in `native-benchmark.json`; it can change when the live source file
grows after the frozen window without changing the selected snapshot.

The selected rows produce the following evidence and operation counts:

| measure | result |
| --- | ---: |
| Evidence observations | 584 |
| Evidence model observations | 321 |
| Direct model observations | 103 |
| Direct `gpt-6-astra` / unknown model observations | 94 / 9 |
| Evidence activity observations | 263 |
| Native operation spans | 207 |
| Native model / command / tool spans | 103 / 69 / 33 |
| Native file read / file write spans | 1 / 1 |
| Exact evidence-to-operation joins | 103 |
| Dropped native spans | 3 |
| Dropped links | 0 |
| Observed execution parents | 0 |
| Actual maximum operation depth | 1 |

The direct usage totals are preserved as exact native quantities: input
`11,993,223`, cache-read input `11,761,792`, cache-write input `0`, output
`70,124`, and reasoning output `20,579`. Reasoning remains a subset of output,
and cache buckets remain subsets of input.

The existing public Enterprise scenario rate card prices the 94 direct
`gpt-6-astra` observations. The resulting known subtotal is
`15,179,758,000` nanoUSD (`$15.179758`). Nine direct observations have an
unknown model and remain unpriced. The other 481 valuation lines are
non-direct snapshot or aggregate evidence and remain excluded by
`direct-only-v1`. The valuation and operation report are therefore partial;
the amount is a scenario subtotal, not an invoice.

The native operation view has depth 1 because this window exposes outer
transcript lifecycle records without explicit execution-parent identities.
The 129 selected `message`, `reasoning` and `agent_message` response items
carry output-item IDs rather than model execution IDs, so they are omitted with
an explicit coverage limitation; the 103 usage rows remain the model-operation
anchors. Token-count snapshots are likewise accounting metadata and are skipped
without creating summary spans or dropped-span loss. Shell internals, provider
retries, hidden model work and filesystem work inside a shell call remain
opaque. The controlled filesystem run in
`files-operations.json` separately demonstrates measured nested execution
with maximum depth 7; its fixture work is not mixed into this native capture.

The generated directory contains `native-operations.json`,
`native-evidence.json`, `native-valuation.json`, `native-report.json`,
`native-benchmark.json`, and `native-trace.json`. It also contains operation
count, execution-cost and source-cost folded, gzip pprof and SVG projections:
`native-count.*`, `native-execution.*` and `native-source.*`.

The evidence sanitizer retains exact quantities and the hashed observation IDs
needed for joins. It reduces source references to line-only coordinates and
hashes native session, turn, subject, agent and work-item identifiers. Raw
paths, commands, arguments, results, message text and prompts are omitted.
The generator scans every textual projection and the pprof payloads against
raw ID/body values from the selected input plus the caller input path; the
published run reports zero leaks. Exact importer replay and replay merge are
also checked before any artifact is written.

The capture boundary remains `native_transcript` with `complete: false`. The
window starts after a call whose request is outside the window and ends after
a call whose result is outside it, so the importer retains unknown lifecycle
facts rather than inventing them. Native transcript records do not establish
monotonic elapsed time, complete child-thread coverage, hidden retries,
provider billing settlement or final prompt/context contents.
