# Integrated reference implementation evidence

Verified on 6 September 2026. This report concerns the experimental 0.1 reference implementation and the published sanitized fixtures. It does not claim a live run of every supported harness, a provider bill, or an independently implemented Agent Cost Interchange producer.

## Existing consumers

The independently maintained **Go 1.27.1 pprof reader** consumed `cost.pprof` from the worked two-call example and the full Codex demo. It reported exact totals of `200000000 nanoUSD` ($0.20) and `41046242000 nanoUSD` ($41.046242). The demo's per-agent cumulative values matched the independently calculated accounting baseline. The synthetic profile has no executable binary, so pprof's `Main binary filename not available` notice is expected.

The official **OpenTelemetry Collector pdata v1.66.0** JSON decoder accepted all **784 spans** in the demo projection. Its protobuf encoder and decoder then preserved the same span count. This exercises the upstream wire implementation locally; it is not a network export to a deployed Collector. The small verifier and dependency lock are in [tools/verify-otlp](../../tools/verify-otlp/).

```sh
go tool pprof -top .local/demo/cost.pprof
cd tools/verify-otlp
go run . ../../.local/demo/evidence.otlp.json 784
```

The pinned, unmodified **Brendan Gregg FlameGraph renderer** consumed integer nano-USD folded stacks. `rsvg-convert` produced a PNG, which was visually inspected. The four agent rectangles match their cost fractions within 0.101 pixels, and the graph contains 177 positive observation leaves. All prefix tooltips contain exact decimal dollar values. Replaying the same profile produces identical SVG bytes in the supported runtime. Browser interaction behavior was not exercised. The [published graph and geometry evidence](../demo/README.md) make this check inspectable.

## Contract and native evidence

`npm run check` runs strict TypeScript checking and the automated suite. `node dist/pricing-cli.js conformance` passes all **10 portable accounting vectors**, including exact HALF_EVEN rounding, incomplete quantities, duplicate identities and invalid cache subsets. The adversarial suite additionally covers allocations, corrections, scope changes, estimate timing, output aliases, OTLP identities and renderer label injection. Independent reviews and repair verifications are retained in [docs/reviews](../reviews/).

All eight adapter names have version/format-specific fixtures: Codex, Pi, OMP, Claude, Gemini, OpenCode, OTLP and Copilot. A cross-harness test maps equivalent Codex and Pi token partitions to the same `150750000 nanoUSD` valuation and folded representation. The public legacy Pi fixture preserves 484 model calls and reproduces **$42.5959075** in recorded model-price estimates. The Codex demo reproduces the separate **$41.046242 enterprise-scenario subtotal**. These values have different declared bases and are not summed.

## Packaging and automation

The CI workflow checks Node.js 22 and 24, builds the package, runs the conformance CLI and demo, invokes Go pprof and the Collector decoder, then installs the packed npm archive into an isolated directory and repeats the conformance/demo commands. The package contains the compiled CLI/library, schemas, fixtures, documentation and pinned renderer/profile schema with their licenses. No npm registry publication is required to install the release archive.

## Explicit remaining limits

Native adapter support is demonstrated against the declared formats and fixtures, not every current product release or a newly instrumented live provider session. Different source identities do not reconcile overlapping snapshots automatically. OTLP and pprof are projections; retain the evidence, valuation and profile manifest. Missing usage, human/infrastructure cost and hidden provider work remain unavailable. Context Points have a versioned record and evidence join, but no calibrated universal scale, validated forecast, or points-to-dollar exchange rate. Independent producer adoption and held-out calibration remain follow-up work.
