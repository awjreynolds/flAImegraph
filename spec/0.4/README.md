# Usage Interchange 0.4 (experimental)

The [usage schema](schemas/usage.schema.json) defines a pricing-independent capture bundle. The TypeScript validator adds cross-reference, calendar, exact arithmetic, ancestry and accounting invariants. JSON Schema alone is not complete semantic validation.

`work_item_id` is an opaque developer-supplied string scoped to the dataset: a ticket key, issue URL or custom work label. Multiple tasks, agents and attempts may share it. It is independent of the task/operation identity and does not imply an accepted outcome or access to a ticket system.

A bundle has immutable dataset/source/observation identities, meter definitions, observations, coverage and issues. Each observation retains source references, actual parent observation, operation/agent/session/work/task joins, status, UTC event/start/end/collection facts, processing dimensions and independent measurements.

Quantities are exact nonnegative decimal strings. Null explicitly means unavailable. A measurement records evidence (`observed`, `declared`, `derived`, `estimated`, `unknown`), method, source references, counting basis, delta/cumulative aggregation and temporal grain. Direct event/interval deltas are additive. Aggregates and snapshots remain visible but excluded. Unknown evidence cannot establish a known quantity. Subset quantities must not exceed known parents, and overlapping/subset meters must not be treated as independent amounts.

Known dimensions distinguish requested versus actual model, provider, processing tier, reasoning and region, alongside product/service/API operation, cache conditions, deployment and SKU. Provider extensions use namespaced keys and the same fact/provenance structure. A configured model or tier is not proof of the provider's applied choice. Extensions cannot introduce commercial interpretation into canonical usage fields.

All retained known timestamps use UTC `Z` with valid calendar values and fractional precision. The importer can normalize valid source offsets; missing or invalid timestamps remain unknown rather than silently choosing collection time. Start/end and collection time are different facts.

Reconciliation requires equal dataset IDs and immutable matching identities, merging only provenance for exact replay. Conflicting measurements are errors. Parent cycles are errors; missing external parents stay explicit. `coverage.dropped_by_source` is a map of cumulative counters; independent sources sum and replay uses each maximum. An unattributed single-source loss count can be upgraded; ambiguous lossy multi-source merges fail.

A report carries the validated bundle, selected meters, grouped totals and real ancestry. Totals keep observed/estimated and unknown/excluded coverage separate. A profile selects one meter and scales exact decimals into integers for folded/pprof interchange. The upstream FlameGraph renderer is reused. Integer export limits are checked instead of rounding silently; zero/unknown-only profiles do not generate a positive-width graph.

The optional [efficiency input schema](schemas/efficiency-input.schema.json) and `flaimegraph/analysis` consume this evidence with declared outcomes, benchmark conditions and capacity snapshots. Pricing is separate under `flaimegraph/pricing`. See [the usage guide](../../docs/usage.md) for executable commands and API examples.
