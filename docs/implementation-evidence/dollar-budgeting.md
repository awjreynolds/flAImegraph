# Dollar budgeting, implementation 0.3.1

The operation-count default demonstrated execution depth but did not answer the budgeting question. The viewer now opens the saved native development capture with dollar-weighted token-cost frames. The first monetary grouping is token category, so total cached-input, uncached-input and output contributions are visible before drilling into recorded activities. This grouping is not an execution-parent claim; the separate activity-cost graph retains execution ancestry. Monetary SVG labels start with an exact currency amount; integer nano-currency remains the interchange/export unit. Parent amounts include children and are not additive across layers.

`createOperationBudget` provides a whole-run or selected-subtree projection. It retains direct selected amounts, unknown observations and credits. A matching supplied rate scenario splits priced token usage into uncached input, cached input, cache writes and output only when the combined calculation reconciles to the selected valuation line. Independent category rounding is reconciled by an explicit signed adjustment. Missing rates or unsplittable known totals remain unattributed. The supplied card is declared input, not proof of provider-billed category prices.

Input is inclusive of disjoint cache-read and cache-write subsets; both are removed to calculate uncached input. Reasoning is an output subset and is not charged twice. Independently known token quantities remain visible when another category is unavailable. Token totals include unpriced observations, while dollar category totals are known subtotals only. No model calls are needed for this analysis.

The frozen native example's saved scenario yields:

| Category | Known dollar subtotal |
| --- | ---: |
| Uncached input | $2.088610 |
| Cached input | $9.906048 |
| Cache writes | $0.000000 |
| Output | $3.185100 |
| Total | $15.179758 |

Nine additional model observations remain unpriced. The synthetic routing example contains recorded invented totals without category rate identities, so its monetary token view retains unsplit costs. The filesystem-only example has no model calls and therefore no model spend to plot.

The browser offers grouping by activity, model and agent, two-group comparison, category cost cards, matching-rate-card loading and selected-operation cost details. A comparison of observed or scenario costs does not establish equal outcomes or causal savings. Estimated source allocation remains separate from execution and token-category pricing.

SVG generation uses the unchanged upstream FlameGraph renderer and its name attributes. Public folded and pprof samples are unchanged. A token-category SVG represents positive selected charges; credits stay in the budget/report, and an observation with a negative rounding correction remains unsplit in the SVG so widths still conserve. Desktop and narrow-screen SVG variants have recorded intrinsic dimensions; the containing iframe is scaled, keeping upstream zoom coordinates intact.

Validation covers the public budget and SVG/CLI boundaries, including category arithmetic, partial usage, rate mismatch, conservation, credits, rounding, hostile labels, full-path amounts and input overwrite protection. Independent review is recorded in [the review](../reviews/dollar-budgeting.md). Verification passed: 216 reference tests, 22 focused budget/export tests, root TypeScript/build, viewer lint/TypeScript/static build, an HTTP 200 preview response, exact native category totals through the generated offline browser bundle, XML parsing and dimension checks for all 18 SVGs, and an installed-package CLI export with its matching rate card. The 400-pixel native SVG was rasterized and inspected: aggregate category dollar labels are visible and the total remains $15.179758. Browser interaction verification for this update is unavailable because the verification Mac was locked; no mobile interaction or final deployed browser pass is claimed.
