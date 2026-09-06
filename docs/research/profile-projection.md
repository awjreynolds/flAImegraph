# Existing profile formats as tokenomics projections

Research date: 6 September 2026. Question: can folded stacks, pprof, Speedscope, or OpenTelemetry Profiles faithfully exchange and visualise token- and cost-weighted agent work?

**Provisional finding:** existing formats are sufficient to draw useful tokenomics flame graphs. They do not, by themselves, establish an interoperable accounting model for ticket ownership, shared work, incomplete capture, corrections, or the evidential status of cost. Treat the flame graph as a projection of measurements whose accounting meaning is defined elsewhere. This is a bounded specification and source-code audit, not a claim that token flame graphs are novel or that no broader convention exists.

## What profiling contributes

Brendan Gregg's documented workflow separates stack capture, stack folding, and rendering. The folded input combines a path with its accumulated count; its source can be sampled execution or traced resource events. Thus an instrumented model-call usage record can supply the weight without pretending it came from CPU sampling. The graph is not the collector. [FlameGraph workflow](https://github.com/brendangregg/FlameGraph/blob/41fee1f99f9276008b7cd112fca19dc3ea84ac32/README.md)

Pprof explicitly leaves profile semantics to the producer. It defines flat values at a location and cumulative values including descendants; reports select one measure at a time. Its function-level accounting handles recursion by counting a sample once per location. These existing ideas provide useful terminology, but the producer still determines what a token measurement means. [Pprof documentation](https://github.com/google/pprof/blob/d6c3cb2f37ec22719bbaf5eb031d9a46635cb5b2/doc/README.md)

Proposed tokenomics interpretation: use an attribution path such as `epic → ticket → agent → model call`. It is a synthetic hierarchy, so label it as an attribution view rather than an observed language-runtime call stack. Vertical ancestry may describe accounting ownership, delegation, or a chosen grouping; those are different relationships and should not silently substitute for one another.

## Capability matrix

“Can encode” below means the generic format permits a representation. It does not establish that existing consumers understand its AI meaning. The linked sections below qualify each entry.

| Concern | Folded stacks / Gregg renderer | pprof protobuf | Speedscope JSON | OTel Profiles |
| --- | --- | --- | --- | --- |
| Measures | One weight; optional comparison column | Typed vector per sample | One weight per sampled profile; several profiles per file | One sample type per Profile; several Profiles per batch |
| Token/cost units | External renderer label | Producer-defined type/unit strings | No token/currency enum; use `none` plus an external convention | Type/unit strings; requires agreed conventions |
| Numeric representation | Decimal text; renderer arithmetic and rounded SVG | Signed 64-bit integer values | JSON/JavaScript numbers | Signed 64-bit integer values |
| Self/inclusive | Leaf weights accumulate through path | Flat/cumulative reports | Self/total weights in profile builder | Stack-associated observations; projection defines accounting |
| Provenance | Names and external metadata | Sample labels, documentation URL | Exporter/name and frame source coordinates | Resource/scope, attributes, profile ID, optional original payload |
| Trace correlation | External convention | Labels could carry identifiers | No dedicated field in inspected schema | Native sample-to-trace/span link |
| Shared/DAG work | Must choose or split paths | Samples contain paths; call graph does not allocate a shared execution | Stack paths; balanced event nesting | Stack per sample plus one linked span; allocation remains separate |
| Signed adjustments | Negative single weights rejected by parser | Signed values and differential reports | Sample builder rejects negative weights | Signed wire values; adjustment meaning not specified here |
| Unknown usage | No numeric unknown weight | No nullable element in sample vector | No nullable sampled weight | Empty values with timestamps means unit observations, not unknown |

## Format-specific findings

### Folded stacks and the reference renderer

The renderer accepts semicolon-separated frames followed by a nonnegative integer or decimal count. A second count is a comparison: width follows the second series and colour represents its difference from the first. It is not an input/output vector. Counts can be relabelled; SVG rectangles are rounded and narrow frames may be pruned. The inspected parser does not accept negative standalone counts or scientific notation. A name-attribute file and SVG notes are presentation features, not a typed usage-evidence schema. [Renderer source](https://github.com/brendangregg/FlameGraph/blob/41fee1f99f9276008b7cd112fca19dc3ea84ac32/flamegraph.pl)

Consequently, folded exports should carry one named measure and a sidecar reference to the projection definition. For example, `Ticket A;Agent;Call 42 1200` is ambiguous without knowing whether 1,200 means input tokens, output tokens, or millionths of a currency unit. The rendered SVG cannot safely be the record from which accounting is reconstructed.

### Pprof

The protobuf provides parallel `sample_type` descriptors and signed `int64` sample values; all samples have the same vector length. A location sequence is leaf first. Labels supply sample context, while `doc_url` can identify documentation for the profile type. Comments are explicitly human-facing, not a machine-readable extension mechanism. No nullable numeric component or native billing-correction relationship appears in this schema. [Pprof protobuf](https://github.com/google/pprof/blob/d6c3cb2f37ec22719bbaf5eb031d9a46635cb5b2/proto/profile.proto)

A candidate encoding could define `[input_tokens, output_tokens, estimated_cost]` with an explicit integer currency scale. That is practical, but the names, scale, currency, pricing revision and estimate status need a contract. A missing output measure cannot silently become zero merely to satisfy the vector shape; separate profiles or explicit availability metadata would be needed.

Pprof's differential flame graph uses absolute changes for width and shading for net change. Therefore a difference export cannot be assumed to display net expenditure as rectangle width. Its graph visualisation can merge functions across callers, but that does not establish that two paths refer to the same billable event. [Pprof comparison behaviour](https://github.com/google/pprof/blob/d6c3cb2f37ec22719bbaf5eb031d9a46635cb5b2/doc/README.md#diff-mode)

### Speedscope

Speedscope specifies sampled stacks with weights and evented profiles with balanced open/close events. Each profile has one unit, drawn from `none`, time units, or `bytes`; a file can contain several profiles sharing frames. The declared frame fields are name, file, line and column, with exporter metadata at file level. There is no dedicated token unit, currency unit, trace identity, or per-measure provenance field in the inspected types/schema. [Format types](https://github.com/jlfwong/speedscope/blob/fe804e6281cf847713448c2c3e0faec3e1f62b2d/src/lib/file-format-spec.ts), [published JSON schema](https://www.speedscope.app/file-format-schema.json)

The sample builder rejects negative weights and ignores zero-weight samples. It adds a sample's weight to the terminal node's self weight and the nodes' total weights. Thus a zero-width marker cannot reliably preserve an unknown call in an exported profile. [Profile builder](https://github.com/jlfwong/speedscope/blob/fe804e6281cf847713448c2c3e0faec3e1f62b2d/src/lib/profile.ts)

Using `none` and naming profiles “input tokens” or “estimated USD” can make a useful human-facing export. This is an application convention, not schema-level interoperability. Sampled profiles avoid inventing model-call durations from token totals. Evented profiles have a nesting contract; concurrent sibling operations require an appropriate separate-track representation rather than false nesting.

### OpenTelemetry Profiles

The current specification marks Profiles **Alpha**. Its goals include correlation with other telemetry and compatibility with existing profiles; resources, instrumentation scope, dictionaries and generalized attributes add useful context. Optional original payload retention exists for conversion losses. This makes Profiles promising for telemetry-connected exports, but status and deployed consumer support must be checked before promising stable interoperability. [Pinned Profiles overview](https://github.com/open-telemetry/opentelemetry-specification/blob/238e0e201c71d8e92a3e08202c9a02f2517dec52/specification/profiles/README.md)

Crucially, current `Profile.sample_type` is singular. `Sample.values` is a series of observations of that measure, not pprof's measure vector. Samples can carry timestamps and signed integers; timestamps alone imply a value of one each. A profile ID supports deduplication/correlation, but does not identify every underlying billable event. The dropped-attributes counter describes attribute loss, not missing calls. [Pinned Profiles protobuf](https://github.com/open-telemetry/opentelemetry-proto/blob/bb8796bff67cf6e1c7f218e21de6eaec0841871e/opentelemetry/proto/profiles/v1development/profiles.proto)

Samples reference one stack, attributes and one trace/span link. Dictionaries deduplicate representation; they do not decide whether two observations describe duplicate evidence. Attribute units use UCUM notation, so any monetary convention needs care rather than assuming arbitrary currency text has standard unit semantics. [Profiles data model](https://github.com/open-telemetry/opentelemetry-specification/blob/238e0e201c71d8e92a3e08202c9a02f2517dec52/specification/profiles/data-format.md)

Pprof round-trip conversion is documented as lossless through explicit conversion, not wire compatibility. Compatibility conventions preserve such information as original sample-type order; reverse conversion of OTel-native data is limited to equivalent target capabilities. A claim that every enriched OTel profile becomes a lossless pprof export would overstate this. [Compatibility statement](https://opentelemetry.io/docs/specs/otel/profiles/pprof/), [compatibility attributes](https://opentelemetry.io/docs/specs/semconv/general/profiles/#compatibility-with-pprof)

## Accounting examples that the encoding cannot decide

These are constructed counterexamples and provisional requirements, not statements of existing standard behaviour.

1. **Inclusive totals.** An agent's own model calls consume 100 input tokens and its subagent consumes 40. The two leaf contributions are 100 and 40; the parent inclusive total is 140. Exporting the already-inclusive 140 as another leaf would produce 180. A renderer cannot infer which interpretation the producer intended.
2. **Shared research.** One 100-token research call benefits two tickets. Copying all 100 under both yields 200. Choosing an owner, splitting 60/40, or keeping an unallocated shared bucket are possible policies. A causal link to both tickets is not itself a cost-allocation rule. Allocation precision also differs from measured-token precision: a 101-token call split equally produces fractional allocated units even though observed usage is integral.
3. **Missing evidence.** A call reports 80 input tokens while another completed call has no usage response. The known sum is 80, and total usage is unknown. A graph containing only 80 needs a visible coverage statement. Drawing a guessed 20-token missing segment would manufacture evidence; omitting the second call without a warning manufactures completeness.
4. **Corrections.** A recorded $1.00 charge later receives a $0.20 credit. The ledger can preserve both and derive $0.80 net. Ordinary positive-width flame graphs cannot draw the credit as negative area. Net, gross-charge and credit views need explicit definitions; a differential visualisation has different width semantics again.
5. **Overlapping categories.** Suppose 1,000 input tokens includes 600 cached tokens. Stacking “input 1,000” and “cached 600” creates a false total of 1,600. Either show the subset separately or derive an explicitly justified partition, such as cached 600 plus uncached 400.
6. **Parallelism.** Two calls running simultaneously consume 500 and 700 tokens. Token width correctly totals 1,200 independent of overlap. Summing their elapsed durations does not establish wall-clock completion time. A cost flame graph is not a critical-path analysis.

## Precision, export losses and a provisional route

Signed 64-bit integer encodings permit exact stored integers within their range. Decimal currency estimates require a declared scale and rounding policy. Speedscope's JavaScript-number implementation adds a precision boundary: integers above 2^53−1 cannot all be represented exactly. This follows ECMAScript's numeric definition; JSON text alone does not confer decimal accounting guarantees. Keep exact arithmetic upstream and label display rounding. [ECMAScript safe-integer definition](https://tc39.es/ecma262/#sec-number.max_safe_integer)

A proposed conformance exercise should begin with evidence records and expected totals, then test each export against a declared loss manifest: selected measure; excluded records; missing-usage status; removed metadata; grouping/allocation policy; currency and scale; rounding; retained source references. Regrouping by epic must not erase the execution identity needed to detect duplicates. Model names or effort settings are attributes, not additive widths.

Provisionally prefer **pprof as an early rich analysis export**, folded stacks as a simple inspectable interchange with existing FlameGraph tools, and Speedscope as an accessible viewer export with documented unit limitations. Evaluate OTel Profiles as a correlation-rich target as its Alpha schema evolves. This ranking is about present projection capability; it does not select the authoritative event transport or ledger storage.

The plausible standardisation work is a profile contract that binds trustworthy usage evidence to defined measures and conservation rules, plus reproducible projections into existing formats. No new renderer or universal file format is justified by this investigation alone. The next decision should compare those requirements with the separate GenAI telemetry and financial-accounting audits, then test a small set of real exports. This report implements nothing and makes no claim of ecosystem novelty.
