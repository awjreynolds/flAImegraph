# Profile and renderer review

Review scope: `src/profile.ts`, `src/render.ts`, `test/profile.test.ts`, and the experimental 0.1 profile/evidence contracts. Reproductions used synthetic local objects, the vendored FlameGraph renderer, and checked-in tests. No provider calls or publication were performed.

## Confirmed findings

### [P1] Schema-valid frame names can inject an active link into the rendered SVG

`renderProfile` encodes control characters for the folded function name but retains the raw `frame.name` as `prefix.label` (`src/render.ts:33-43`). It then inserts that raw label into a tab/newline-delimited `nameattr` file after applying XML escaping only (`src/render.ts:49-57`). XML escaping does not protect the line-oriented `nameattr` grammar. A newline and tab in one frame name can therefore add attributes for another generated function name. The CLI schema check does not prevent this because the profile schema allows arbitrary nonempty frame names.

A two-sample profile with the later frame name:

```text
mal\nvictim_[1]\thref=javascript:alert(1)\ttitle=Injected
```

generated this entry and SVG output:

```text
victim_[1]  href=javascript:alert(1)  title=Injected: $0.000000001 (50.00%)
<a xlink:href="javascript:alert(1)" target="_top">
```

This is reachable through `flaimegraph render` with a schema-valid profile artifact. Encode or reject tabs/newlines before constructing the `nameattr` value, and restrict the generated attribute set to `title`. A robust fix should avoid representing untrusted labels in the `nameattr` grammar at all, or validate the final SVG to ensure no caller-controlled link/event attributes were introduced. Add a renderer test using hostile newlines, tabs, `href`, `g_extra`, and `a_extra` tokens.

### [P1] The OTLP JSON exporter emits forbidden string enum values

The exporter emits `kind: "SPAN_KIND_INTERNAL"` and status codes such as `"STATUS_CODE_OK"` (`src/profile.ts:854-871`). OTLP JSON Protobuf Encoding requires enum fields to be integer values and explicitly forbids enum name strings. The correct numeric values here are span kind `1`, status unset `0`, status OK `1`, and status error `2`.

The current test only inspects selected fields and does not decode or submit the result to an independent OTLP consumer (`test/profile.test.ts:238-280`). Emit numeric enums and add validation through the pinned OTLP trace protobuf or an independent Collector/SDK decoder. Primary contract: [OpenTelemetry Protocol JSON Protobuf Encoding](https://github.com/open-telemetry/opentelemetry-proto/blob/main/docs/specification.md#json-protobuf-encoding).

### [P1] Source attributes can overwrite normalized OTLP accounting fields

`sourceAttributeName` lets any input key beginning with `gen_ai.`, `otel.`, or `service.` pass through unchanged (`src/profile.ts:724-727`). These raw attributes are appended after the exporter-derived accounting attributes (`src/profile.ts:774-840`), and the final `Map` keeps the last value for each key (`src/profile.ts:853`). Thus an observation whose normalized usage says 10 input tokens but whose free-form attributes contain `"gen_ai.usage.input_tokens": 999` exports 999; the same mechanism can replace `gen_ai.operation.name`, provider, or model fields.

Synthetic reproduction:

```text
normalized usage.input_tokens = "10"
source attribute gen_ai.usage.input_tokens = 999
exported gen_ai.usage.input_tokens = { intValue: "999" }
```

All source attributes should be namespaced under `flAImegraph.source_attribute.*`, including names that resemble standard attributes, unless an explicit, validated mapping owns that standard field. Reject duplicate output keys rather than resolving accounting conflicts by append order.

### [P1] Valid parent relationships can become cross-trace OTLP parent links

Trace IDs are generated independently from each observation's session or observation ID (`src/profile.ts:741-753`), while `parentSpanId` is copied from the referenced parent observation without reconciling trace IDs (`src/profile.ts:844-861`). A valid evidence pair with `child.parent_id = "parent"`, no native trace IDs, and no shared session exports the child and parent under different generated trace IDs while the child names the parent's span ID. OTLP parentage is trace-local, so this is not the execution tree represented by the evidence.

Observed output:

```text
child  traceId=7d24...bad7 parentSpanId=cface8cec69c7009
parent traceId=20ad...0309 spanId=cface8cec69c7009
```

Generate one trace ID per connected parent tree when source trace identity is absent. If supplied trace IDs conflict across an asserted parent relation, preserve the relationship as namespaced evidence and omit the invalid OTLP `parentSpanId`, with an explicit diagnostic or export manifest limitation.

### [P1] Profile IDs collide across different projections

`createCostProfile` sets `id` to `profile:${valuation.id}` (`src/profile.ts:397-405`). Root label, grouping, cost view, allocations, and resulting samples do not participate. Profiles derived from the same valuation with `group_by: ["operation"]` and `group_by: ["model"]`, or charge and credit views, therefore have the same artifact ID while containing different paths and totals.

This breaks artifact identity and makes caches/manifests unable to distinguish reproducible projections. Derive the ID from a canonical serialization of the valuation ID, projection options, allocation input, and resulting profile semantics. Add a test that equal inputs reproduce the ID and every material projection change changes it.

### [P1] Allocation inputs required for reproducibility are discarded

The generated profile records only `{ policy: "largest_remainder", tie_break: ... }` (`src/profile.ts:457-460`). It does not retain the observation-to-work-item weights passed in `options.allocations`. The resulting samples show rounded amounts, but those amounts do not uniquely recover the original weights; different weight vectors can produce the same integer split.

The evidence contract requires manual work assignments and projection allocations to be retained with the generated artifact (`spec/0.1/evidence.md`, Work correspondence). Preserve a canonical allocation manifest containing each observation ID, work-item ID, and exact weight. Include it in the profile schema and profile identity.

### [P1] Folded and pprof exporters accept a profile whose declared total was tampered

`exportFolded` and `exportPprof` validate individual samples but never compare their sum with `profile.total_nanos`, nor do they semantically validate the rest of the profile (`src/profile.ts:468-496`, `584-667`). Starting with a valid two-nano profile, changing only `total_nanos` to `"999"` still exported a folded weight of 2 and a pprof sample value of 2. The profile manifest now declares 999 while both standard artifacts encode 2, violating the requirement that a decoded profile reproduce the selected total.

`renderProfile` has a conservation check (`src/render.ts:20-26`), so the three public exporters apply inconsistent trust boundaries. Introduce one semantic `validateProfile` path used by folded, pprof, and renderer exports. It should check canonical integers, nonnegative sample values for the chosen view, sample/total conservation, frame identity consistency, metadata consistency, and issue/completeness invariants.

### [P2] Error-bearing artifacts can still be declared complete

`createCostProfile` derives completeness from `valuation.complete`, source coverage, and missing monetary lines only (`src/profile.ts:380-420`). It does not check the severities of `evidence.issues` or `valuation.issues`. A schema-valid valuation with `complete: true` and an error issue produces `profile.complete: true`; the error is copied into the profile beside that completeness claim.

Reject an internally inconsistent input valuation or force profile completeness false whenever either artifact contains a warning/error relevant under the v0.1 completeness rule. A semantic validator should also verify the input schema versions and required identity fields rather than relying only on TypeScript types at runtime.

### [P2] The project's OTLP exporter/importer round trip loses current 0.1 accounting meaning

The exporter writes cache-read, cache-write, reasoning, and original identity under `flAImegraph.*` attributes and writes the provider as `gen_ai.provider.name` (`src/profile.ts:774-836`). The current OTLP adapter does not read those local fields or `gen_ai.provider.name`. Exporting and immediately importing a model observation with inclusive input 10, cache-read 4, cache-write 1, reasoning 2, and provider `openai` produced:

```text
provider = "flAImegraph"
usage = {
  input_tokens: "10",
  output_tokens: "5",
  cache_read_input_tokens: null,
  cache_write_input_tokens: null,
  reasoning_output_tokens: null
}
original observation identity was not restored
```

The specification permits documented OTLP loss for future/provider-specific payloads, but this is loss across the reference implementation's own current exporter and importer and makes the returned usage unpriceable under normal rate cards. Add an export/import conformance fixture for the versioned local binding, or state clearly that the OTLP output is one-way and provide a separate round-trip decoder for `flAImegraph.*` attributes. Preserve sub-millisecond RFC3339 precision as well; `timestampToUnixNano` currently goes through `Date.parse` milliseconds (`src/profile.ts:710-722`).

### [P2] Duplicate evidence IDs produce duplicate OTLP span identities

`exportOtlp` does not validate or reconcile evidence before building its maps (`src/profile.ts:733-764`). When two observations have the same ID, the first pass generates distinct temporary span IDs but stores both under the same map key. During span emission both observations read the last stored span ID. A synthetic two-row duplicate produced two spans with identical ID `10ad916e744ee237`.

Fail on conflicting duplicate identities and coalesce identical replay before export. This should be part of the common evidence validation performed at the `exportOtlp` boundary.

## Verification and limitations

The complete local suite passed after the concurrent CLI work landed:

```text
npm test
46 tests passed
```

The normal `createCostProfile` path conserved charge, credit, and explicit net totals in the focused cases. Exact BigInt largest-remainder allocation, signed-int64 pprof sample rejection, frame-ID disambiguation, and prefix monetary tooltip amounts behaved correctly for generated profiles. The SVG issue requires a caller-supplied profile artifact; that is a supported CLI input path and the artifact remains schema-valid. OTLP wire validity was checked against the upstream encoding rule and constructed output, not against a live Collector.
