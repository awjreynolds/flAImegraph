# flAImegraph

flAImegraph is an open experimental project for understanding AI-assisted software delivery: preserve evidence of the work, value model usage under a declared scenario, and make the result inspectable in monetary flame graphs and other existing profile views.

The project also adopts **Context Points** as a human-facing way to size and compare anticipated AI effort, alongside the familiar ideas of T-shirt sizing, story points and function points. A Context Points estimate belongs to a specified Work Item and Acceptance Outcome. It remains separate from observed tokens, calls, context-related measurements, human or infrastructure resources, selected USD valuation and the result that was accepted. The scale and estimation method still need empirical calibration; this repository does not declare a universal points-to-token or points-to-dollar conversion.

The [experimental 0.1 contract](spec/0.1/README.md) has a working offline reference implementation. The [project plan](docs/project-plan.md) describes the route from complete work evidence to a calibrated planning measure. The [Context Points proposal](docs/context-points.md) explains the vocabulary and boundaries, and the [domain glossary](CONTEXT.md) keeps the terms consistent. See the [integration evidence](docs/implementation-evidence/integration.md) for verification and its limits.

Start here:

- [Context Points proposal and GitHub issue draft](docs/context-points.md)
- [Project plan and acceptance gates](docs/project-plan.md)
- [Agent Cost Interchange experimental specification 0.1](spec/0.1/README.md)
- [Implementation contract](docs/implementation-contract.md)
- [Dogfooding on this project's own work](docs/dogfooding.md)

## Run the reference implementation

Requires Node.js 22 or newer and Perl for SVG rendering. Everything below runs locally using the published, sanitized fixtures; no provider account or API key is required.

```sh
git clone https://github.com/awjreynolds/flAImegraph.git
cd flAImegraph
npm ci --ignore-scripts
npm run build
node dist/cli.js conformance
node dist/cli.js demo --out-dir .local/demo
```

Open `.local/demo/cost.svg` in a browser. Frame width represents cost; hover for exact dollars, click to zoom, and use Ctrl+F to search. The demo imports four native Codex evidence fixtures, reconciles 177 direct model observations, applies the declared enterprise scenario, and reproduces a **$41.046242 known subtotal**. It also writes the evidence, rate card, valuation, profile manifest, folded stacks, gzip pprof, OTLP projection, and coverage summary.

The cost view represents a selected pricing scenario with incomplete capture. It is not an invoice or the cost of all work on this repository. The [fixture provenance](examples/dogfood/README.md) describes its frozen cutoff and sanitization.

[![Dollar-weighted flame graph of the frozen four-agent capture](docs/demo/cost.png)](docs/demo/README.md)

The [checked-in demonstration](docs/demo/README.md) includes the SVG, PNG and rendering evidence. Each agent's width is proportional to its selected dollar cost; the uppermost row contains individual observations.

For a PNG, install `rsvg-convert` and append `--png true` to the demo command. An independent pprof viewer can inspect `.local/demo/cost.pprof`, for example `go tool pprof -top .local/demo/cost.pprof`. Nano-USD is the exact integer interchange unit; the SVG presents decimal USD in its title and tooltips.

See the [usage and adoption guide](docs/usage.md) for other harnesses, rate cards, shared work allocations and the TypeScript API. Run `node dist/cli.js capabilities` for accepted formats and tested coverage. This release is experimental and has no independently maintained producer adoption claim.

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

Research checked on 6 September 2026. Reports distinguish observed records, source-code behavior, draft standards and unverified runtime coverage. The current public enterprise scenario is a partial, reproducible $41.046242 model-token subtotal; it is a demonstration baseline, not a total project cost or a calibrated dataset. The reference CLI, independent pprof/OTLP decoding and static SVG/PNG rendering are verified. Browser interaction testing remains unverified. No raw conversations or tool-result contents are published.
