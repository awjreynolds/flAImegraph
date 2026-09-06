# Monetary valuation

A valuation references one evidence dataset, the direct-only-v1 selection policy and one currency. Each selected observation yields an exact nano-currency amount or an explicitly unavailable amount. Observations and their original usage remain unchanged.

## Bases

- `model_price_estimate`: a model-price calculation, including one recorded by a harness.
- `provider_reported`: a provider-supplied monetary observation whose invoice correspondence is not established.
- `billed`: an asserted actual billed monetary observation with qualifying source evidence; importing a number alone does not independently verify that assertion.
- `enterprise_scenario`: analytical valuation under a selected enterprise schedule and assumptions.
- `contract_estimate`: a calculation under supplied contractual rates, before invoice reconciliation.

These names are local basis identifiers. In particular, scenario/contract estimates MUST NOT be exported as FOCUS BilledCost, EffectiveCost, ListCost or ContractedCost without meeting FOCUS's definitions. Different currencies or bases MUST NOT silently form one additive monetary profile. Currency conversion and capacity/subscription allocations require an explicit separate policy; v0.1 does not infer either from tokens.

## Rate matching

A rate card includes an ID, source URL, retrieval time, basis, currency, assumptions and model-specific rules. Rules can constrain provider, product and execution date. Validity intervals are UTC instants with an inclusive start and exclusive end. Retrieval time is not a substitute for historical validity. Overlapping eligible rules are ambiguous and MUST NOT be resolved by array order.

An unconstrained dimension is a deliberate rule wildcard, not evidence that the dimension cannot affect price. Scenario assumptions MUST describe omitted speed, region, fees or eligibility constraints where relevant. When a rule requires a dimension that an observation lacks, the amount is unavailable. Unknown model aliases are not silently replaced with a similar model.

Rates are exact nonnegative decimal currency amounts per a positive integer `unit_tokens`. Input prices apply to fresh input, computed from inclusive input minus the two cache subsets. Cache-read, cache-write and output prices apply to their own partitions. Missing quantities/rates needed to compute a component leave the total unknown; a zero rate can make a known category free under that schedule but cannot establish missing usage was zero. Reasoning is already contained in output.

## Exact arithmetic

Sum exact rational component costs for one observation, then round once to integer billionths of the declared currency using nearest, ties-to-even. Implementations MUST preserve the original decimals and rate-card reference. Rounding every grouped subtotal or category separately is nonconforming. Positive integer allocation weights use largest remainders after observation-level rounding; ties are resolved by work-item ID in a deterministic lexical order, preserving the original integer total.

`total_nanos` sums known signed monetary lines. `complete` can only be true when selected usage/pricing and declared source coverage support it; all unresolved records remain named issues. A subtotal remains a subtotal even when it exactly reconciles to captured counters.

Recorded negative monetary values can represent credits. They are retained as signed evidence/valuation lines. Ordinary positive-width graph exports use separately declared charge and credit-magnitude views; negative width is invalid. Replacement/correction delivery formats require explicit source-specific normalization. The reference implementation does not infer that two different ledger rows replace each other merely because they have the same amount or description.
