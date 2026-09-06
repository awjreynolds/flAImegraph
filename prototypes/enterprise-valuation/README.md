# Selected public enterprise-rate scenario

**$41.046242 USD for 177 observed calls. This is an analytical model-token subtotal, not an actual bill, subscription charge or negotiated enterprise price.** The frozen partial run ends at `2026-09-06T16:36:00.000Z`. Separate feature/tool fees and hidden or later usage are excluded and unknown. A complete enterprise bill cannot be inferred.

The selected public [OpenAI Enterprise token rate card](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing), retrieved **2026-09-06**, gives Astra Codex rates of **$10 fresh input / $1 cached input / $50 output per million tokens**. The card excludes additional Astra Codex long-context and Codex cache-write charges; reasoning effort does not change the rate. Its stated commercial scope is new Enterprise agreements specifying USD usage billing, with contract terms controlling actual pricing. No agreement was supplied.

The scenario assumes standard speed, no regional-processing uplift, and that the model recorded in `turn_context` identifies the model that executed each call. **The model is setting-derived, not response-verified.** The source does not establish rate-validity start/end dates or historical applicability; those fields remain null. Applying this selected rate card to the snapshot is a comparison, not a determination of past charges.

## Exact arithmetic

| Token category | Quantity | Scenario USD |
| --- | ---: | ---: |
| Fresh input (`input − cached`) | 1,866,567 | 18.665670 |
| Cached input | 19,225,472 | 19.225472 |
| Output, including reasoning | 63,102 | 3.155100 |
| **Total** | **21,155,141** | **41.046242** |

The source input count is 21,092,039, including cached input. Its 7,445 reasoning-output tokens are already contained in output; they receive no extra charge. Recorded cache-write tokens are zero.

| Agent | Calls | Scenario USD |
| --- | ---: | ---: |
| coordinator | 88 | 20.669904 |
| telemetry | 28 | 6.530018 |
| accounting | 33 | 9.110380 |
| profiles | 28 | 4.735940 |
| **Total** | **177** | **41.046242** |

Each observation contributes once. Agent totals contain their own calls; the coordinator subtotal does not recursively include delegated workers. Root and agent widths in the chart are inclusive summaries, not additional charges. The chart's turn labels are inherited from the sanitized evidence. They are grouping labels, not measured ticket, feature or epic identifiers.

## Files and reproduction

- `usage.json`: byte-identical copy of `../capture-depth/evidence.json`, preserving its sanitized observations, source-thread hashes and usage quantities. SHA-256: `bfc3ac2e38eaaf7308a0dea1e8ec4f57fb0590aee4d3d781676076c6b0f1edef`. The script refuses to price modified evidence under this scenario.
- `ratecard.json`: selected public scenario, citation, exact rates, assumptions, exclusions and pinned renderer identity.
- `reprice.cjs`: local arithmetic only. It reads evidence without modifying it and uses integer nanoUSD per observation. These rates require no rounding: fresh/cached/output are 10,000/1,000/50,000 nanoUSD per token.
- `output.json`: each observation's original token quantities, billable categories and priced components, plus agent and overall reconciliation.
- `cost.folded`, `cost-flamegraph.svg`, `cost-flamegraph.png`, `render.json`: cost projection, independently rendered vector/static charts and renderer provenance. Width represents scenario USD, not elapsed time, chronology or difficulty.

From this directory, reproduce arithmetic with Node.js:

```sh
node reprice.cjs
```

Reproduce the chart using the already downloaded, **unmodified** Brendan Gregg renderer, Perl, and installed `rsvg-convert`:

```sh
node reprice.cjs --renderer /private/tmp/flaimegraph-profile-sources/flamegraph-flamegraph.pl
```

The renderer is pinned at commit `41fee1f99f9276008b7cd112fca19dc3ea84ac32`; its bytes are checked before use. On another machine supply a local copy matching the URL and SHA-256 in `ratecard.json`. No download, installation, browser automation, provider call or data upload is performed by this script. Frame labels replace spaces with underscores because a trailing numeric call label otherwise resembles FlameGraph's two-weight differential format. Perl `-CA` preserves the Unicode title without modifying the renderer.

## Verification

Execution checks unique observation and response identifiers; nonnegative safe integer quantities; cache/reasoning subset rules; input/output totals; source thread and overall totals; every priced observation's contribution to its agent; agent and category conservation; and unchanged usage hash. Rendering additionally verifies the exact SVG root subtotal, every call's leaf value exactly once, each agent subtotal and the PNG signature. The PNG was visually inspected. An independent Decimal calculation reproduced the exact overall subtotal and each agent's value. These checks establish arithmetic and projection consistency, not telemetry or billing completeness.
