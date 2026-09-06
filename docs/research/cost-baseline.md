# Monetary cost as the flame-graph baseline

User clarification, 6 September 2026: cost must drive the flame graph. The primary acceptance criterion is **rectangle width proportional to an additive monetary quantity**, rather than time, token count, or a cost annotation beside a timeline. Token and duration views are useful secondary projections.

## What existing systems enable

**Skiagram already implements monetary-width flamegraphs.** Its inspected exporter accepts tokens or estimated micro-USD. This verifies the visualization path, not universal correctness of its harness adapters. The audit found specific accounting/lineage gaps and rounding on grouped cost emission; an adapter and rounding contract must be validated before trusting a money-width profile. [Source audit and pinned implementation](profiler-reuse-evaluation.md).

**Existing flamegraph/profile formats can carry monetary weights.** Folded stacks accept nonnegative scalar weights; pprof can hold multiple named measures with integer values. A chosen measure can be integer nano-USD or another declared fixed-point currency unit. OTel Profiles uses one sample type per profile, while Speedscope does not natively name currency units. No new renderer format is required. [Format analysis](profile-projection.md).

**LangSmith, Langfuse and native inspectors can supply relevant execution and cost evidence, but are not automatically the final monetary-width viewer.** A trace waterfall uses elapsed time for layout even when it shows costs. A cost table or trace tree is not proof of a cost flamegraph. The cross-harness evaluation must test actual exported values, hierarchy, completeness and a cost-width renderer; backend integration alone does not pass. [Cross-harness comparison](cross-harness-profiler-landscape.md).

## Required accounting and geometry

For one selected cost basis and currency:

```
node inclusive cost = node direct cost + sum(child inclusive costs)
node width / root width = node inclusive cost / root inclusive cost
```

Every directly attributed cost observation appears once in a chosen profile. Parent totals are derived, not extra samples. A model response's cache/input/output prices can form disjoint cost components where the valuation supports them; inclusive input and its cache subset must not both be priced as fresh input. A tool's standalone service charge is distinct from model input incurred when consuming its output.

Use a versioned basis such as **recorded model-price estimate (USD)**, **local API-price estimate (USD)**, or **billed cost (USD)**. They are different profiles, not interchangeable values in one “cost” field. Subscription-equivalent API valuation is not the actual per-call price of a subscription.

Unknown or missing charges remain visible in a coverage panel; they receive no invented zero-dollar assurance. Multi-currency profiles require an explicit conversion basis or separate views. Signed credits/corrections need an appropriate ledger or comparison view; a positive-width flamegraph cannot honestly represent a negative charge as a normal rectangle. Rates and cost-per-token ratios are not additive width measures.

Apply fixed-point conversion once at the observation boundary, preserving the original decimal value and rounding policy, then group integers. Rounding each regrouped subtotal independently can change the displayed total. Profile metadata must state the currency, scale, valuation basis, capture interval, included scope and missing coverage.

## Evidence status

The first Codex prototype is **token-weighted**, so it does not satisfy this monetary-baseline requirement. It proves response reconciliation and regrouping only. That capture contains no invoice or direct monetary charge data, and this research has not invented a subscription-session charge.

A separate [cost-baseline demonstration](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/cost-baseline) uses the public Pi fixture's recorded model-price estimates with Brendan Gregg's existing FlameGraph renderer. It demonstrates monetary-width projection over recorded cost evidence. Missing compaction usage and unknown actual invoice correspondence remain limitations. See that artifact's README for fixed-point scale, rounding and provenance.

The [enterprise-valuation demonstration](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/enterprise-valuation) applies a selected public Enterprise rate scenario to the frozen 177-call Codex capture. Its model-token subtotal is **$41.046242**, conserving per-observation, category and agent sums. Model identity is setting-derived; standard speed and no regional uplift are scenario assumptions. Missing feature fees, hidden usage and later work are excluded. Rate validity dates and contractual applicability are unknown. It demonstrates subscription-origin usage being valued under a separate enterprise scenario without treating the result as an invoice. Both static charts have been visually inspected.

The [open export contract](interoperable-export-contract.md) makes the next requirement explicit: these harness-specific evidence examples must converge on independently implementable semantic bindings and pprof/folded mappings, with a common converter and conformance evidence.

The [representative-workflow validation](https://github.com/awjreynolds/flAImegraph/issues/20) must now prove both trusted cost attribution and money-proportional widths. Cost valuation is a prerequisite to the primary profile, rather than a later optional feature. The user has not yet reviewed the resulting profile.
