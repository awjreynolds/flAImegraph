# Profile implementation evidence

This note records the implementation evidence for the experimental 0.1 profile
projection. The public seams are `createCostProfile`, `exportFolded`,
`exportPprof`, and `exportOtlp`.

## Accounting projection

`createCostProfile` accepts a valuation whose selection policy is
`direct-only-v1`. Every non-null valued direct observation is selected once;
aggregate, snapshot, and unknown-scope observations cannot contribute a
subtotal. A missing amount remains excluded and is reported in both
`excluded_observation_ids` and a `missing_cost` issue. A recorded zero remains
a profile sample of value `0` and is also listed in `metadata.zero_observation_ids`.
The numeric total is exact `BigInt` arithmetic over decimal integer strings.

The profile rejects mixed valuation bases, dataset or currency mismatches,
unknown references, duplicate observation/value lines, invalid subtotals, and
invalid allocation weights. Source coverage other than `complete`, an
incomplete valuation, or missing direct costs makes `complete` false. Tool and
activity observations receive no inferred charge.

The default view is positive charges. `credits` emits the magnitude of negative
lines, while `net` requires an explicit `adjusts` relationship from each credit
to exactly one positive charge and applies that adjustment to the target. An
unlinked or over-sized credit is rejected; no renderer receives a negative
width. The metadata carries exact `charges_nanos`, `credits_nanos`,
`net_nanos`, and a signed net summary for all views.

Manual work-item allocation uses positive integer weights and exact largest
remainder arithmetic. Remainders are ordered descending, with equal remainders
tied by ascending `work_item_id`; a 101-unit 1:1 allocation therefore assigns
51 to the lexically first work item and 50 to the second. The metadata records
this policy and tie rule, plus a sorted allocation manifest retaining every
observation-to-work-item weight used to derive the samples.

Frame paths are synthetic attribution paths. A profile stack is root-first;
the default dimensions are work item, agent, model, operation, and observation,
and callers may choose session or turn as additional dimensions. Frame names
retain a readable label while encoding semicolons, percent signs, whitespace,
and controls as `%XX` UTF-8 bytes. Exported labels carry a compact stable-ID
prefix; the complete UTF-16-derived identity remains in `metadata.frame_manifest`
and in each frame's `id`, so long labels stay readable without allowing equal
display text to merge distinct frames. Folded output has one nonnegative
decimal integer per path and omits zero-width lines.

## pprof binding

The exporter parses the official Google pprof `profile.proto` vendored at
commit `d6c3cb2f37ec22719bbaf5eb031d9a46635cb5b2`. It emits one sample type:
`cost / nanoUSD` for USD (or the corresponding `nano<ISO>` producer binding
for another single currency), sets `doc_url` to the versioned profile binding,
and adds
string labels named `observation`, `valuation`, and `dataset` plus namespaced
projection context. Profile stacks are reversed to pprof's required
leaf-first `location_id` order. All integer fields are constructed through
protobufjs `Long` values and `fromObject`; sample values are range checked
against signed int64 before encoding. The final protobuf bytes are gzip
compressed with `node:zlib`, as required by the vendored schema comments.

The pprof comments field is intentionally unused for machine-readable metadata.
Coverage, allocation policy, and signed correction summaries remain on the
logical profile object and in the profile schema; a pprof consumer can still
decode the selected cost samples and their evidence labels.

## OTLP binding

`exportOtlp` emits a valid OTLP JSON `resourceSpans` envelope with one
`scopeSpans` scope. Model observations use the established
`gen_ai.operation.name`, provider/model, and input/output usage attributes;
cache, reasoning, accounting scope, source references, and project-specific
identity are namespaced under `flAImegraph.*`. Tool and activity evidence is
retained as spans without inventing GenAI usage or cost attributes.

Valid trace and span IDs are preserved. Invalid or missing IDs are replaced by
deterministic non-zero hexadecimal IDs derived from dataset and observation
identity; original IDs, normalized IDs, and source `traceparent` values remain
in namespaced attributes. A valid traceparent can provide the parent span when
no explicit parent observation is available. OTLP JSON enum fields use their
required integer values (`kind: 1`, status `0/1/2`), and every output
attribute key is checked for duplicates. Raw source attributes always use the
encoded `flAImegraph.source_attribute.*` namespace, so they cannot replace
normalized usage, model, provider or operation fields. The local binding also
carries observation subject/grain/count-basis/model identity, provider/model
aliases, original IDs, exact RFC3339 timestamps and recorded cost fields for
the reference importer.

Parent-connected observations share one generated trace ID. Conflicting source
trace identities keep their source traces, omit invalid cross-trace
`parentSpanId` links, and record an explicit local diagnostic. Evidence is
reconciled before export so equal replay is coalesced and conflicting duplicate
identities fail closed. All local attributes use the `flAImegraph.` namespace;
`service.name` is the standard OTLP resource field.

## Test evidence

The focused suite `test/profile.test.ts` currently exercises:

- the independent `$0.125 + $0.075 = $0.20` golden case;
- the default per-observation drilldown leaf and full frame identity manifest;
- missing costs, recorded zero, and unknown source coverage;
- deterministic 101-unit largest-remainder allocation;
- mixed bases, invalid references, non-direct subtotals, and invalid weights;
- charges, credit magnitude, explicit net adjustment, and rejection of an
  unsupported negative net line;
- hostile semicolon, whitespace, control, and trailing-number frame labels;
- gzip pprof decoding, labels, documentation URL, leaf-first paths, and
  signed-int64 overflow failure;
- OTLP model/tool spans, GenAI usage attributes, namespaced local fields, and
  deterministic ID normalization.

Each behavior was introduced through a failing assertion followed by the
smallest implementation change that made that assertion pass. Independent Go
pprof, Collector OTLP decoding and FlameGraph consumer compatibility are
verified in the [integration report](integration.md); this module's own tests
decode the official protobuf and verify the folded contract.
