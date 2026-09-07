# Usage-first v0.4 implementation evidence

The default package/CLI now captures and profiles resource usage without pricing artifacts. Optional pricing consumers preserve the older contracts. The analyzer is deterministic, makes no provider calls, and offers evidence-qualified comparisons/scenarios rather than automatic routing or repository edits.

## Reproducible data

`tools/dogfood-usage-v04.ts` projects the committed native development and filesystem operation evidence using the public APIs. Native retains 584 observations and 11,993,223 known input tokens; snapshots/aggregates remain excluded. File capture retains 5,130 operations with seven actual operation levels, plus the profile root. Both retain source coverage and missing metadata. These are migrations of the existing recorded work, not fresh benchmark claims.

The generator also writes declared illustrative baseline/candidate benchmarks, analysis overhead, capacity scenarios and an Inspect-shaped import fixture. Invented models and capacity are explicitly labelled. There is no inference about the user's selected model, subscription allowance or ticket outcome.

## Contract and integration boundaries

- Exact decimal usage and meter subsets remain separate from money. Explicit unknowns and non-additive snapshots survive reports and profile sidecars.
- Reconciliation detects immutable conflicts and deduplicates producer loss counters. Coverage cannot be made complete after loss.
- Requested versus applied model/tier/reasoning and UTC event/interval/collection timestamps remain distinguishable.
- Custom `work_item_id` strings can identify a Jira/GitHub ticket or local work label. Separate tasks and agents group under that work identifier without changing their identities. Native import and SDK defaults provide assignment; conflicting existing assignments fail.
- Public usage, operation conversion, CLI import/export, browser modules and the optional analysis entry point are exercised directly. A bundled dependency graph verifies the capture SDK does not import valuation or efficiency consumers.
- The viewer uses the generated browser core, real-data upstream SVGs, exact ratio displays and local file handling. The scenario editor retains explicit units, time horizon and provenance.

## Verification limits

The verification Mac is locked, so no new interactive browser pass is claimed for v0.4. Viewer lint, TypeScript and static prerendering are checked; static SVG rasterization is inspected separately. Prior v0.3 interaction verification applies only to the earlier routes and behavior. Current benchmarks do not provide statistical confidence intervals or establish general model rankings. Provider fields absent from a capture, unknown capacity conversion and undisclosed provider work remain limitations.

Independent review and correction evidence is recorded in [usage-first-v04.md](../reviews/usage-first-v04.md). Final verification passed: 282 tests, TypeScript and package build; viewer lint, TypeScript and static export of all four application routes; installed-package usage demo, analysis, benchmark, runway and legacy conformance; all three SDK entry points with a custom decimal meter and work identifier. Two generator runs produced identical hashes for every v0.4 example and viewer usage asset. Public validators accepted all generated bundles, profiles and analysis/benchmark artifacts. Go’s independent pprof consumer decoded both native input usage and the 5,130-operation file profile. Package inspection found no hosting metadata, credentials, local capture directories or dependency directories. The illustrative runway is explicitly limited and yields 11 accepted tasks; it is not a measured subscription forecast.
