---
status: accepted
---

# Record usage independently of pricing

On 7 September 2026, the project owner clarified that flAImegraph's capture and interchange tooling must preserve resource consumption and all available pricing dimensions without implementing the commercial rules that assign prices. Historical pricing, customer contracts, subscriptions and monetary flamegraphs belong to external consumers of that evidence. This replaces the assumption that monetary valuation is a prerequisite for inspecting a run; the same capture must remain useful under multiple pricing policies.

## Ownership

The core owns capture, validation, reconciliation, provenance, execution/context relationships and usage projections. It must work without rates, currency, a subscription configuration or a valuation. Usage must remain present for included, free, fixed-price and externally billed services alike.

External pricing tools own rate lookup, effective dates, contract selection, allowances, discounts, minimums, rounding, tax, currency conversion and allocation of fixed fees. They may produce a monetary profile for a renderer. That profile references the immutable usage evidence and identifies the policy used; producing it does not rewrite the capture.

For example, a subscription-covered model call and a metered external API call both retain their full usage and service identities. A customer's policy may assign zero incremental cash cost to the first call and a charge to the second. Allocating part of a monthly subscription to the first call is a separate policy choice. Neither zero incremental cost nor subscription membership means zero consumption.

## Capture requirements

The 0.4 contract provides these generic measurement and dimension fields. An adapter only populates facts present in its source; this is not a claim that every provider exposes every item.

| Evidence | Facts to retain when available |
| --- | --- |
| Usage time | UTC RFC 3339 usage timestamps with `Z`, retaining source precision and the meaning of each timestamp; start/end intervals for duration or storage measurements. Collection time is separate from the time of consumption. |
| Service identity | Provider, product/service, API operation, requested and actual model/version, and source-supplied SKU or meter identity. A model alias or harness name alone may be insufficient. |
| Processing conditions | Requested and actual service tier, batch membership, reasoning configuration, processing region and deployment class, each with its evidence. An option requested by the client does not prove the provider applied it. |
| Token usage | Input/output, cache reads/writes, reasoning and modality partitions, with explicit overlap/subset semantics, counting basis and measurement provenance. Preserve provider-native counters alongside their normalized interpretation. |
| Cache behavior | Reported cache hits/writes, retention class or lifetime, and measured storage intervals/quantities where available. Repeated content alone does not establish a cache hit. |
| Non-token usage | Tool/search requests, provider-specific credits or consumption units, image counts and processing parameters, audio/video duration, compute resource class and duration, storage quantity over time and network transfer. Each meter declares its unit and scope. |
| Correlation | Stable observation, request, attempt, session, operation and resource identities; retries, failures, cancellations and links between wrapper/native records. Opaque account or deployment references may support private external policy joins without exposing credentials or contract contents. |
| Evidence quality | Observed/declared/estimated/unknown status, source references, native counter meaning, sampling/loss and unsupported fields. Explicitly distinguish per-event deltas, cumulative snapshots, aggregates and overlapping subsets. |

Use an extensible meter and dimension representation with defined semantics and namespaced provider extensions. A permanently closed list of token fields cannot cover all pricing mechanisms. Preserve available relevant facts, identify unsupported capture, and never manufacture missing dimensions to make pricing succeed. Do not collect raw prompts or secrets merely to support pricing.

A UTC timestamp enables historical lookup but does not by itself identify a price. A consumer still needs the applicable service, customer policy and rule for choosing an effective time. If a usage interval spans a price change and the capture cannot resolve consumption within it, the pricing tool must retain that uncertainty or declare an allocation assumption.

Provider-reported monetary amounts already present in legacy captures can be preserved as separately identified source assertions for reconciliation. They are not resource meters or core-calculated prices, must not be required for a usage report, and must not silently replace usage evidence. New commercial records belong in a separate optional artifact.

## Implementation and migration

The 0.3 `OperationBundle` and recorder already operate without a valuation. The 0.1 evidence contract separates usage from rate cards, but includes optional `recorded_cost`; its usage fields are primarily token counters and its generic attributes do not define the full meter contract above.

The legacy `OperationReport` and `ContextReport` require `Valuation`. `createOperationReport` validates it and builds monetary nodes, and retain their existing monetary meaning through the compatibility consumer. The v0.3.1 dollar-first demonstration therefore illustrates one downstream use case rather than the intended core contract.

Version 0.4 implements the usage-only bundle, report, capture/import and profile export contracts. The default package entry point and CLI now operate independently of pricing, while `flaimegraph/pricing` and `flaimegraph-pricing` retain the existing consumers. The default viewer displays usage and downstream efficiency analysis. Historical captures cannot gain dimensions that their producers never recorded.

Completion requires evidence that:

- Capture, validation, reconciliation and usage profile export work with no pricing artifacts or pricing implementation dependency.
- Identical usage can be interpreted externally under subscription, historical public-rate and private-contract policies without changing the evidence.
- Zero-rated usage remains visible, unavailable measurements remain unknown, and aggregate/subset/retry reconciliation prevents double counting.
- Provider-specific meters, actual processing conditions and source timestamp precision survive import/export with declared coverage.

The v0.3.1 release and frozen contracts retain their historical meaning. The v0.4 package implements this migration without rewriting old monetary evidence.
