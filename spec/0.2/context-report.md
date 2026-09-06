# Context report and conserving allocation — experimental 0.2.0

A Context Report embeds a validated 0.1 Evidence Bundle, a 0.1 Valuation and a 0.2 Context Bundle for the same dataset. Consumers must validate the evidence/valuation join as well as context references. `createContextReport` retains those inputs without mutation. Summary cost is the valuation's exact signed `total_nanos`; summary context coverage is a count of complete, partial and unknown request manifests. Valuation completeness does not establish context completeness.

`allocations` defaults to empty. A producer must explicitly select request IDs, with at most one request per valued observation. This matters when a transcript reconstruction and a final client request describe the same call. An unavailable boundary, missing request or missing direct model valuation cannot be selected. Partial captures at an available boundary may be selected, retaining their boundary and coverage as assumptions.

## proportional-input-coverage-v1

The amount being distributed is the **whole selected request cost**, including any output component. This is an estimated view of that cost. It is neither per-source provider billing, an input-only invoice, a causal attribution, nor the savings available from removing a source. It is never added to the valuation or monetary profile.

Let `D` be the selected model observation's inclusive input-token usage. For every ordered occurrence, its directly referenced revision's token measurement supplies a weight if its evidence is observed, derived or estimated. Counterfactual and unavailable token measurements supply no weight. Repeated references to one revision remain separate occurrences. Transformations do not implicitly give weight to ancestors. Byte counts are not substituted for missing token counts.

Let `W` be the sum of eligible weights and `U = D - W` the unallocated weight. If `W > D`, allocation fails instead of rescaling contradictory measurements. If `D` is unavailable, all cost remains unallocated and a coverage issue is emitted. If `D = 0` and `W = 0`, all cost likewise remains unallocated, including output-only calls. The report exposes `denominator_tokens` and `unallocated_weight_tokens` rather than implying complete source coverage.

For nonzero `D`, distribute the absolute integer amount over each occurrence plus the unallocated bucket using `floor(abs(amount) × weight / D)`. Distribute the residual nanounits by descending fractional remainder; ties use ascending UTF-16 lexical bucket keys, `occurrence:<occurrence_id>` and `unallocated`. Restore the original amount's sign, including credits. All arithmetic is integer arithmetic. Zero-weight buckets cannot receive a residual unit: any positive residual is smaller than the number of positive-remainder buckets.

For a cost of 101 nanounits, `D = 100` and occurrence weights 30 and 20, the portions are 30 and 20, with 51 unallocated. Normalizing only to the known 50 tokens would conceal missing context and is prohibited. For signed amounts, the sum of portions plus unallocated always equals the original amount exactly.

## Reading and transport

Reports may be written with `context-report --evidence … --valuation … --context … --out …`. `--allocate-requests request-a,request-b` opts into the separate allocation view. Imported JSON remains data; consumers must not execute embedded labels, render arbitrary HTML/SVG strings, follow untrusted file paths, or silently treat summary fields as proof of validation. Source references identify logical capture artifacts, not files to fetch automatically.

A report also accepts fully unvalued recorded evidence. When every valuation line has a null amount, the existing 0.1 valuation may carry `basis: "mixed"` and `currency: "UNKNOWN"` (or a declared target currency). The exact known subtotal is zero, valuation completeness remains governed by the null lines, and there is no priced allocation. This permits context inspection without inventing rates. The stricter monetary-profile export continues to reject mixed basis or unknown currency; this report exception does not alter that contract.
