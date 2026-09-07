# Dollar budgeting independent review

Status: approved after corrections. This review covers the dollar budgeting projection, operation cost SVGs, and the viewer surfaces added for the budgeting work. No correctness findings remain open.

## Review invariants

- Each direct valued observation appears once in a whole-run budget and once in any enclosing subtree. Parent operations do not add another copy of a child's value.
- Inclusive input is partitioned into uncached input, cache reads, and cache writes. Cache subsets are not added on top of inclusive input.
- Reasoning output remains a subset of output and is never priced as a second category.
- For every observation and aggregate scope, `known_total_nanos` equals category amounts plus unattributed amount plus the explicit rounding adjustment. Unknown amounts remain outside that equation and retain their observation identities.
- Positive charges and credits are reported separately. A credit is not presented as a negative token-category rate unless the evidence actually declares such a rate model.
- A category split is derived only from declared rates. It must reconcile to the selected valuation line; missing, ambiguous, or mismatched pricing leaves the known amount unattributed rather than allocating it by token proportions.
- The viewer identifies a loaded rate card as a supplied, saved scenario. Matching identifiers and arithmetic reconciliation do not prove provider billing composition.
- Dollar SVG frame text and titles show inclusive monetary amounts for actual path prefixes. Mobile output is rendered at a mobile width by the unchanged upstream renderer, rather than relying on clipping a desktop SVG.

## Findings during implementation

- The first whole-run activity grouping risk was checked against the shipped native capture, which has multiple real root activities and therefore presents directly comparable rows. Scopes with a containing operation retain an explicit drill-down action rather than silently flattening ancestry.
- Omitted `unclassified_tokens` has established core semantics: the valuation covers the declared categories and records an assumption that hidden coverage was not reported. The budget split should follow that declaration while surfacing the limitation. A null or nonzero unclassified count must remain unsplit.
- Exact rendered SVG assertions are required because folded samples alone do not prove that path-prefix dollar labels survive renderer escaping, hidden identity suffixes, and title generation.
- The first token SVG placed categories below 94 flat native operation paths, reducing most category frames to a few pixels. The final graph groups by category first and places recorded execution ancestry below. Its top-level frames now directly show $2.08861 uncached input, $9.906048 cached input, and $3.1851 output; each descendant dollar value is that category's contribution through the recorded path. The UI and SVG subtitle state that this first layer is monetary grouping rather than runtime parentage.
- A first version of the category-first graph reported descendant percentages relative to each category. That made identical dollar frames carry ambiguous percentages and was inconsistent with the graph's whole width. The final implementation uses the whole selected positive charge total for every percentage; the regression fixes a $0.05 path contribution at 25% of a $0.20 graph.
- The budget's initial local rate matcher could accept a generic rule when provider, product, or timestamp evidence was unavailable even though plausible specific or dated rules existed. It now mirrors the core valuation policy by checking possible rules across missing dimensions and filtering date applicability independently. Known-timestamp provider/product regressions and missing-timestamp bounded-rate coverage keep these cases unattributed.
- The saved `public-enterprise-astra-codex-2026-09-06-standard` scenario matches the cited OpenAI Enterprise token rate card as checked on 2026-09-07: GPT-6 Astra in Codex is USD $10 uncached input, $1 cached input, and $50 output per million tokens; Codex cache writes and the Astra Codex long-context uplift are $0. The artifact also correctly declares standard speed, no regional uplift, and excluded feature fees as assumptions rather than facts about the user's bill. Source: [OpenAI Enterprise token-based rate card](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing).
- Applying that saved scenario to the native example produces a known $15.179758 subtotal: $2.08861 uncached input, $9.906048 cached input, $0 cache writes, and $3.1851 output. Nine further observations remain explicitly unpriced. The four category amounts sum exactly to the known subtotal.

## Verification

Independent checks passed on 2026-09-07:

- `npm run check` (216 tests, including TypeScript)
- `node --import tsx --test test/operation-budget.test.ts test/operations.test.ts` (22 focused tests)
- `git diff --check`
- XML parsing for every checked-in mobile operation SVG and both token-cost desktop SVGs
- Dimension-manifest agreement for all 18 checked-in operation SVG variants
- Browser bundle declaration and generated `operation-budget.d.ts` agreement with the public TypeScript implementation
- Canonical viewer lint, TypeScript, and production build; the built `/operations` route returned HTTP 200
- A rendered 400-pixel native SVG showed the $9.906048 cached-input aggregate and $15.179758 selected root total without clipping

The focused tests cover cache partitioning, reasoning as inclusive output, exact row and aggregate conservation, credits, unknown costs, partial quantities, omitted versus unknown unclassified coverage, mismatched and dimension-ambiguous rate cards, subtree selection, half-even category rounding, CLI artifact/input protection, visible SVG category amounts, nested inclusive path amounts, global percentages, unsplit recorded costs, hostile labels, and 400-pixel upstream rendering.

Interactive browser QA was unavailable because the verification Mac was locked. This approval therefore relies on source review, generated-artifact inspection, the root test suite, the canonical viewer build, a live HTTP smoke check, and static/rasterized SVG validation; it does not claim a manual mobile interaction pass.
