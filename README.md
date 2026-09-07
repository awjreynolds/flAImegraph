# flAImegraph

Record AI resource usage and the conditions that produced it. Visualize tokens or operations, compare accepted work, evaluate alternative model configurations, and estimate delivery runway from explicit capacity evidence.

Version **0.5.0** adds opt-in durable lifecycle journals: save action starts before dispatch, recover interrupted captures, distinguish known waits from unexplained gaps, and keep failed/retried usage. The capture SDK, interchange and reports contain no rates, currency or subscription rules. Historical or customer-specific pricing is an optional consumer through `flaimegraph/pricing` and `flaimegraph-pricing`.

Usage profiles now start with tasks and their operations. The viewer shows input and output with their declared cache and reasoning subsets, alongside per-task quantities. Models remain available as an explicit grouping and as observation details. Missing task associations stay unassigned.

Measurements retain exact decimal quantities, UTC timing, provenance, requested versus confirmed model/tier/reasoning settings, and unknown values. Input, cache and reasoning meters remain separate with declared subset relationships. The downstream analyzer distinguishes measured findings, candidate policies and unsupported conclusions. It does not infer that a model choice was wrong from token counts alone.

## Run locally

Requires Node.js 22+ and Perl for the upstream FlameGraph renderer. These commands use committed metadata-only examples; no model provider account is needed.

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js demo --out-dir .local/usage-demo
node dist/cli.js analyze --input .local/usage-demo/report.json --out .local/analysis.json
```

Open `.local/usage-demo/usage.svg` for the interactive flame graph. Width represents input tokens. The export also includes exact report/profile JSON, folded stacks and gzip pprof. Use `go tool pprof -top .local/usage-demo/usage.pprof` with an independent consumer.

The demo migrates **584 recorded development observations** from the existing native capture. A separate **5,130-operation file workload** retains actual nested ancestry. Both are partial observations of the work; neither establishes model suitability or a complete account total. The benchmark and runway examples are explicitly illustrative.

## Capture, inspect and compare

```sh
node dist/cli.js import --format codex --input session.jsonl --dataset-id work-1 --out usage.json
node dist/cli.js report --input usage.json --group-by task,operation --out report.json
node dist/cli.js export --input report.json --meter output_tokens --out-dir output-profile --svg true
node dist/cli.js benchmark --baseline examples/dogfood/v04/baseline.json --candidate examples/dogfood/v04/candidate.json --out comparison.json
node dist/cli.js runway --input examples/dogfood/v04/runway-input.json --out runway.json
```

The [local viewer](viewer/README.md) loads sessions in the browser, inspects measurements and processing conditions, shows session findings, compares benchmark configurations and explores capacity scenarios. Existing context and monetary views remain available.

- [Usage guide and SDK examples](docs/usage.md)
- [Durable capture and interruption recovery](docs/lifecycle.md), [Lifecycle Interchange 0.5](spec/0.5/README.md)
- [Usage Interchange 0.4](spec/0.4/README.md)
- [Efficiency, benchmarks and runway](docs/efficiency-analysis.md)
- [Reproducible examples and their limits](examples/dogfood/v04/README.md)
- [Legacy pricing and migration](docs/legacy-usage.md)
- [Architecture decision](docs/adr/0001-separate-usage-from-pricing.md), [domain glossary](CONTEXT.md) and [project plan](docs/project-plan.md)

Operation Interchange 0.3, Context Interchange 0.2 and Cost Interchange 0.1 remain supported through their existing types and optional legacy tooling. Context Points remain a proposed human-facing sizing scale, requiring calibration; no universal conversion to tokens, money or capacity is claimed.

Research and design index:

- [Cost baseline](docs/research/cost-baseline.md), [interoperable export contract](docs/research/interoperable-export-contract.md), and [profile projection](docs/research/profile-projection.md)
- [Enterprise valuation and delivery-forecast roadmap](docs/research/enterprise-valuation-and-forecast-roadmap.md), [accounting coverage](docs/research/accounting-coverage.md), and [ACEM/AI-delivery forecasting](docs/research/ai-delivery-cost-forecasting.md)
- [Software sizing and AI work](docs/research/software-sizing-and-ai-work.md) and [token-estimation practice](docs/research/token-estimation-practice.md)
- [Codex capture validation (177 response records)](docs/research/codex-capture-validation.md), [context attribution limits](docs/research/context-attribution-limits.md), and [telemetry coverage](docs/research/telemetry-coverage.md)
- [Cross-harness profiler landscape](docs/research/cross-harness-profiler-landscape.md), [Pi and Oh My Pi capture fidelity](docs/research/pi-capture-fidelity.md), [Claude and Copilot profilers](docs/research/claude-copilot-profilers.md), and [Gemini and OpenCode profilers](docs/research/gemini-opencode-profilers.md)
- [Existing Pi estimator audit](docs/research/pi-cost-estimator-prior-art.md), [profiler reuse evaluation](docs/research/profiler-reuse-evaluation.md), and [LangSmith/Codex reuse](docs/research/langsmith-codex-reuse.md)
- [Implementation route](docs/research/implementation-route.md), [standards assessment](docs/research/standards-gap-assessment.md), [readiness](docs/research/deep-analysis-readiness.md), and [ecosystem and validation](docs/research/ecosystem-and-validation.md)
- [Implementation backlog](docs/implementation-backlog.md) and [adapters overview](docs/adapters.md)

Public prototypes and wayfinding:

- [Monetary-width demonstration with the existing FlameGraph renderer](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/cost-baseline)
- [Enterprise-rate scenario for the frozen capture](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/enterprise-valuation)
- [Throwaway capture-depth prototype](https://github.com/awjreynolds/flAImegraph/tree/codex/prototype-capture-depth/prototypes/capture-depth)
- [GitHub wayfinding map](https://github.com/awjreynolds/flAImegraph/issues/1)
