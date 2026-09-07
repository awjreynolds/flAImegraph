# Usage, Context and Operations Explorer

The default route displays Usage Interchange 0.4 captures and Lifecycle Interchange 0.5 journals. Tasks and work are primary: a token breakdown shows input/output and their declared cache/reasoning subsets, and task rows retain coverage and links to receipts. The dynamic flame graph follows the selected meter for built-in and locally loaded captures, defaults to task → operation, and can switch to recorded parent actions. A frame selector makes tiny frames accessible. Models remain an optional grouping and observation detail. Missing task associations stay unassigned; the frozen development capture has no task or parent IDs.

Custom work identifiers can be supplied when importing a native log. Source provenance, interruption/recovery evidence and efficiency analysis remain available. The Benchmarks & runway tab loads external benchmark artifacts and explicit capacity/demand inputs. Its built-in optimization example is illustrative. `/context` retains the 0.2 ContextReport explorer. The `/operations` route opens a dollar-cost flamegraph of the saved native development capture. Its token-cost layer separates uncached input, cached input, cache writes and output when matching declared rates are available. Cost comparison groups activities, models or agents, supports selecting two groups, and exposes a selected operation's token mix. The paged execution tree, chronology, IO/evidence, routing and producer/consumer links remain available.

Requires Node.js 22.13 or newer. From this directory:

```sh
npm ci
npm run dev
# Or create the static export:
npm run build
for route in usage context operations; do mkdir -p "dist/client/$route"; cp "dist/client/$route.html" "dist/client/$route/index.html"; done
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist/client
```

Open the localhost URL in a browser. Select **Load a session** on the default usage route (50 MB limit), or **Open report** in a legacy route. Loading is local to the browser, with a 20 MB context-report limit and 32 MB operation-report limit and the same embedded report validator as the CLI. There is no report upload, backend data store or browser persistence. Keep sensitive reports under your own control.

The built-in real capture is the frozen Codex research demonstration: observed usage with task association and prompt context unavailable. Legacy cost views add a declared enterprise pricing scenario. The Usage interruption example contains synthetic lifecycle events and declared token receipts; the Context lifecycle example contains estimated token weights and summary transformations. Neither synthetic example is real provider usage or billing.

This directory mirrors the validated Sites source without account-specific hosting metadata. To publish your own Site, register your own project and configure the static output as `dist/client`. The original private deployment is for its owner; the source and GitHub release archive are public.

After changes to the usage/analysis modules, run `npm run build && node tools/viewer/build-usage.mjs` from the repository root. `node --import tsx tools/dogfood-usage-v04.ts` regenerates usage examples and graphs.

The bundled `lib/validator.js` is generated from the root runtime and JSON Schemas. After changing those contracts, run `node tools/viewer/build-validator.mjs viewer/lib/validator.js` from the repository root, and copy updated `src/context-types.ts`, `src/operation-types.ts` and `src/types.ts` into `viewer/lib/` before rebuilding.

Dollar analysis uses that same browser bundle. The saved Enterprise scenario is included for the native example; local reports may load a matching rate card. Rates are a declared scenario, not a live quote or invoice. Token counts include unpriced observations, whose dollar contribution remains unknown. Recorded totals without matching rates are not divided by token proportions.

After `npm run build` at the repository root, run `node tools/viewer/build-operation-graphs.mjs` to rebuild the bundled upstream SVGs and their dimension manifest. The viewer scales fixed-size iframe containers to preserve upstream zoom coordinates; 400-pixel variants give narrow screens a readable base font. User-loaded reports cannot supply executable SVGs. Cost comparison works with local reports; interactive SVGs for them are produced by `operation-export --rate-card ... --svg true`.

Validation includes static export, TypeScript, lint and consumer-validator tests. Operation browser QA verified seven-level drilldown, individual measurements, whole-run search and 75-row paging over 5,000 files, flamegraph zoom/reset, routing facts, source allocation and producer/consumer navigation. Optional WebMCP report-state and operation-selection tools were exercised for valid and invalid inputs in the in-app browser. See [v0.3 verification evidence](../docs/implementation-evidence/operations-v03.md) for final scope and remaining limits.
