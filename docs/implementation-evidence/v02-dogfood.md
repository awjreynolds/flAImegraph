# v0.2 real-work dogfood

This record covers the bounded Codex capture published under dataset
`context-producer-proof-v02`. The frozen cutoff is `2026-09-06T21:03:01.300Z`.
The root accounting stream starts at `2026-09-06T19:51:07.000Z`; the
independent producer attempt is recorded separately as
`2026-09-06T20:46:09.000Z` through `2026-09-06T20:56:45.879Z`. Its end is
derived from the last included native usage row. The producer self-reported
completion at `2026-09-06T20:56:13.000Z`; that earlier declaration remains
separately recorded and does not truncate observed completion/accounting work.

The generator was rerun with:

```text
node --import tsx tools/dogfood-v02.ts
```

It reads the two bounded source streams, projects only the documented native
metadata and numeric counters, and writes the current artifacts in
[`examples/dogfood/v02/`](../../examples/dogfood/v02/). The older
`*-context-report-attempt.json` files were removed after the reports became
available through the public report API.

## Capture and accounting results

| stream | selected usage rows | sanitized rows | direct / snapshot / aggregate observations | capture extension | model |
| --- | ---: | ---: | ---: | --- | --- |
| root accounting | 134 | 286 | 134 / 148 / 148 | 143 → 286 | `gpt-6-astra` |
| independent producer | 33 | 68 | 33 / 33 / 33 | 34 → 68 | `gpt-5.6-luna` |

The root stream selected usage from `2026-09-06T19:51:07.217Z` through
`2026-09-06T21:01:30.839Z`. The producer stream selected usage from
`2026-09-06T20:46:09.996Z` through `2026-09-06T20:56:45.879Z`; the source
continues beyond the producer's self-reported completion. The attempt end
includes all 33 selected responses, while both observed and self-reported
boundaries remain explicit in the provenance record. One compaction
row was retained for the root stream and none for the producer stream.

Direct token totals are preserved as observed:

| stream | input | cache read | cache write | output | reasoning | native total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| root accounting | 17,224,994 | 16,815,488 | 0 | 89,139 | 31,749 | 17,314,133 |
| independent producer | 3,568,501 | 3,446,528 | 0 | 29,857 | 16,002 | 3,598,358 |

Each stream used two captures: a prefix followed by the full extension. An
exact replay produced the same two-capture state, and one-shot import produced
the same direct count and category sums. No duplicate response IDs were found.
The same proof is recorded in [`provenance.json`](../../examples/dogfood/v02/provenance.json).

Recorded USD valuation remains partial: both streams have `mixed` basis,
`total_nanos: "0"`, `complete: false`, and zero priced direct lines. All 167
direct lines retain unavailable cost rather than receiving an invented model
rate or provider bill. Non-direct snapshots and aggregates are retained for
coverage and excluded from direct cost totals.

`reconstructNativeContext` produced 134 root requests and 33 producer
requests, each linked to its direct observation. Every request boundary is
`unavailable`; the reports therefore preserve the accounting and honest
coverage gaps without claiming a reconstructed final prompt. Both
`*-context-report.json` files validate through `createContextReport` and
`validateContextReport`.

## Work-item join

[`context-producer-proof.json`](../../examples/work-items/context-producer-proof.json)
records the independent producer outcome as `accepted` and joins 33 selected
observations. Its initial ordinal estimate remains value `3`, created at
`2026-09-06T20:16:42Z` with `pre_execution` timing. The join verifies that the
estimate preceded the reported producer attempt; the accepted outcome and
the estimate are kept as separate facts.

## Privacy boundary and validation

The published JSONL payloads contain only the per-type allowlist: hashed
identifiers, model and effort metadata, timestamps, compaction metadata, and
numeric usage counters. The current 12 generated artifacts plus the Work Item
sidecar passed a focused scan with zero raw identifier hits and zero raw values
from content-bearing source fields. No raw prompt or message text, tool
argument or result payloads, source paths, or un-hashed native identifiers are
published.

Focused validation passed for both capture states, evidence bundles, profiles,
context bundles, reports, valuations, and the Work Item join. Integrated
repository verification subsequently passed the full TypeScript check and all
161 reference tests.
