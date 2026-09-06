# Standard cost-profile bindings

A `CostProfile` is a reproducible projection of selected monetary lines, not a second cost ledger. It references the dataset and valuation, states currency/basis, path grouping, cost view, exclusions, assumptions and coverage issues, and lists samples with exact integer values.

## Accounting and paths

Each monetary line contributes once to a chosen attribution path, or to explicitly allocated paths whose sum equals that line. Parent inclusive values are derived from descendants. Grouping by work item, agent, model, operation, observation, session or turn MUST preserve the selected total. The default grouping includes observation after operation to provide a per-call leaf for drilldown. Missing labels use named unassigned/unknown frames; missing amounts do not become zero-width assurances.

Frame identity and display name are distinct. The synthetic hierarchy describes attribution, not a sampled runtime call stack or elapsed-time order. Different frames with equal display names MUST NOT merge accidentally. Export labels MAY use a compact identity suffix for readability, but the complete frame IDs MUST remain available in the profile manifest. The leaf retains the observation reference. Monetary values alone do not identify duplicate evidence.

Default charge view includes positive amounts; credit view shows magnitudes of negative amounts. Excluded observations and the selected view MUST be explicit. A consumer MUST NOT represent a negative monetary line as an ordinary folded-stack width. Unsupported netting policies fail with a diagnostic rather than silently dropping credits.

## Folded stacks

Each line is a root-first sequence of encoded frames separated by semicolons, a single ASCII space, and a nonnegative decimal integer. The weight is nano-currency units. The reference renderer is the unmodified pinned Brendan Gregg `flamegraph.pl`.

The JSON profile manifest MUST accompany the folded file. Bare folded numbers do not specify currency, scale, valuation basis or coverage. Encoders MUST avoid frame ambiguity from semicolons, whitespace, control characters and trailing numeric labels; they MUST preserve distinct frame IDs. The exact reference encoding and examples are supplied by the conformance corpus. Consumers SHOULD use frame IDs from the manifest rather than reconstruct evidence from display labels.

For example, two illustrative direct amounts of $0.125 and $0.075 produce weights `125000000` and `75000000`, totaling `200000000` nanoUSD. The renderer derives the shared parent width of $0.20; a separate parent sample would double count.

## Pprof

The wire format is the upstream `profile.proto`, gzip compressed for the reference CLI. The selected sample type is producer-defined `cost` with unit `nanoUSD` for USD; other currencies require the analogous explicitly documented unit. This binding does not assert that currency names are upstream-standard pprof or UCUM units.

Pprof location sequences are leaf-first, reversing the manifest's human-readable root-first path. Samples carry observation/dataset/valuation references as documented string labels. Stable frame identities map to functions/locations; equal display names remain distinct identities. The profile's documentation URL identifies this versioned binding. Human-facing comments are not a machine extension protocol.

Every sample value and identifier conversion MUST respect the target integer range. In particular, monetary sample values must fit signed 64-bit pprof integers; JavaScript number precision MUST NOT truncate larger exact values. Overflow is an explicit export error. A decoded pprof must reproduce the expected selected total and sample paths.

## OTLP bridge

OTLP JSON export uses the existing resource/scope/span envelope and standard GenAI fields where their meaning matches the source. Additional observation identity, scope and coverage bindings are namespaced local attributes. They MUST NOT be described as upstream-standard fields. Where native trace/span identity is unavailable, a deterministic bridge identity is labeled as generated. The original observation identity remains recoverable.

The JSON Protobuf encoding uses numeric enum values: `Span.kind` is `1`
(`INTERNAL`), and `Status.code` is `0` (`UNSET`), `1` (`OK`) or `2`
(`ERROR`). Source attributes are always copied under
`flAImegraph.source_attribute.<encoded-key>` so they cannot replace an
exporter-owned accounting field. The local binding retains
`flAImegraph.observation_id`, `subject_id`, `model_identity`, `grain`,
`count_basis`, model/provider/session/turn/work-item values, exact source
timestamps, and recorded-cost fields. Extended usage buckets remain under
`flAImegraph.usage.*`.

Parent observations in one evidence tree receive one trace ID when no native
trace identity is available. If native identities disagree, the exporter
keeps each source identity, omits the invalid cross-trace `parentSpanId`, and
records the limitation under `flAImegraph.export_diagnostics` and the
affected span's `flAImegraph.export_diagnostic` attribute. Duplicate replay
with equal observation content is coalesced before export; conflicting
duplicate IDs fail closed.

OTLP import/export is not guaranteed lossless for all future or provider-specific payloads. Capability declarations and conformance fixtures identify the supported mappings. This export does not turn a logical model operation into a proven physical API attempt.
