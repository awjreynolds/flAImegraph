# Profile, OTLP, and renderer repair verification

Verification scope: every confirmed finding in `docs/reviews/profiles-render-review.md`, the CLI profile-validation boundary, and the subsequent deterministic-rendering and all-frame-tooltip corrections. This pass used the golden evidence fixture and focused synthetic inputs. No production source was changed during verification. Independent decoding with the official Collector Go pdata implementation was handled separately by the coordinating review.

## Result

All reviewed profile and renderer corrections are verified. I found no residual regression in these paths.

| Original finding | Verification result |
| --- | --- |
| `nameattr` injection through frame text | **Fixed.** The exact newline/tab payload containing `href`, `g_extra`, and `a_extra` produces no active link or event-handler attribute in the SVG. The generated `render.nameattr` has one record per line and exactly one tab delimiter per record. |
| OTLP string enum values | **Fixed.** Span kind and status codes are emitted as JSON integers (`kind: 1`; status unset/OK/error as `0`/`1`/`2`). The independent wire-decoder verification is outside this report. |
| Source attributes overwrite normalized OTLP fields | **Fixed.** A raw `gen_ai.usage.input_tokens: 999` is exported as `flAImegraph.source_attribute.gen_ai.usage.input_tokens`, while the normalized standard field retains the observed value `100`. Raw `service.name` is likewise namespaced, and duplicate output attribute keys are rejected. |
| Parent references cross OTLP trace boundaries | **Fixed.** A connected parent tree without native trace identity receives one deterministic trace ID and the child names the normalized parent span. When asserted parent and child source trace identities conflict, their trace IDs remain distinct, `parentSpanId` is omitted, and export diagnostics explain the conflict. A traceparent parent span is used only when its trace identity matches the selected span trace. |
| Profile IDs collide across projections | **Fixed.** Equal inputs reproduce the same SHA-256 profile ID. Changing grouping, root label, cost view, or allocation input produced five distinct IDs in the focused reproduction. `validateProfile` recomputes and verifies IDs that use the generated `profile:<sha256>` scheme. |
| Allocation inputs are discarded | **Fixed.** The profile retains a canonical allocation manifest containing each observation ID and its sorted `{ work_item_id, weight }` entries. A focused 2:1 allocation preserved both exact weights, participated in the profile ID, and passed semantic profile validation. |
| Folded and pprof exporters accept tampered totals | **Fixed.** Changing only `total_nanos` from the generated value to `999` now fails `validateProfile`, `exportFolded`, and `exportPprof` with `profile_total_mismatch`. `renderProfile` validates through the same boundary, and the CLI rejected the tampered artifact before writing a render. |
| Warning/error artifacts can remain complete | **Fixed.** A valuation marked complete while carrying an error produces a profile with `complete: false` and preserves the error issue. Warning-bearing evidence/valuation inputs also force incomplete output. Serialized generated profiles that claim completeness beside blocking issues fail semantic validation. |
| Local OTLP round trip loses accounting meaning and timestamp precision | **Fixed.** The local binding round-trips provider, model identity, operation, product, session, turn, work item, subject, inclusive input/output, cache-read, cache-write, reasoning, and recorded cost, then remains rateable. `2026-09-06T10:00:00.123456789Z` exports exactly as `1788688800123456789`, preserving all nine fractional digits. |
| Duplicate evidence IDs produce duplicate OTLP span IDs | **Fixed.** Identical replay is coalesced into one span. A duplicate observation ID with conflicting content fails at the OTLP boundary with `OBSERVATION_CONFLICT`; no duplicate span identity is emitted. |

## Renderer-specific checks

The golden two-call profile contained ten unique attribution prefixes. Its `nameattr` output contained eleven entries: one overall entry plus exactly one entry for every prefix. Every entry included an exact dollar amount and exactly one grammar delimiter. This verifies monetary labels on intermediate and leaf frames rather than only the graph root or selected leaves.

Rendering the same profile into two separate directories produced byte-identical SVG. The renderer now fixes the child Perl hash seed and perturbation mode and invokes the pinned FlameGraph renderer with `--hash`, so upstream hash iteration and color choice do not vary across replay in the supported runtime.

## Automated verification

```text
node --import tsx --test test/profile.test.ts test/render.test.ts test/cli.test.ts
36 tests passed

npm run typecheck
passed

npm test
84 tests passed
```

The full suite was green in the final concurrent workspace state, including semantic profile validation, OTLP export/import, adapter valuation, deterministic SVG rendering, CLI boundaries, and work-item joins.
