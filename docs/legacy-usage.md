# Using and implementing Agent Cost Interchange 0.1

flAImegraph's reference CLI reads explicit files and writes local artifacts. It does not discover private session directories, contact model providers, or need credentials. Use Node.js 22+, install the locked dependencies with `npm ci --ignore-scripts`, and run `npm run build`. Perl renders SVG; optional `rsvg-convert` renders PNG. See the root README for the complete frozen demo.

## Import and combine evidence

```sh
node dist/pricing-cli.js capabilities
node dist/pricing-cli.js import --harness codex --input examples/dogfood/codex/coordinator.jsonl --dataset-id my-work --agent coordinator --work-item my-task --out .local/coordinator.json
node dist/pricing-cli.js import --harness codex --input examples/dogfood/codex/telemetry.jsonl --dataset-id my-work --agent telemetry --work-item my-task --out .local/telemetry.json
node dist/pricing-cli.js merge --inputs .local/coordinator.json,.local/telemetry.json --out .local/evidence.json
node dist/pricing-cli.js validate --input .local/evidence.json
```

Supported adapter names are `codex`, `pi`, `omp`, `claude`, `gemini`, `opencode`, `otel`, and `copilot`. Pi includes legacy transcripts and the inspected v4 storage export. Formats and coverage differ: inspect the [adapter matrix](adapters.md) before choosing a source. These are format/fixture-tested adapters, not a claim that every product/version has been live-tested.

Use the same `--dataset-id` when importing files that belong in one dataset. `merge` rejects different dataset IDs and conflicting observations. Its comma-separated list requires paths without commas; use the JavaScript API for arbitrary path names. An adapter's source identity is part of its observation namespace. Exact replays are idempotent, but unrelated exporters of the same provider call need an explicit identity/correspondence policy; equal quantities alone cannot deduplicate calls across sources.

The default native source identity includes the input artifact digest. **Do not sum overlapping snapshots of the same log as independent captures.** This version does not automatically reconcile overlapping files with different source identities. Use one capture per source scope, or an upstream producer that supplies canonical observation identities. Reusing `--source-id` for different file contents produces a source metadata conflict; it is not an overlap-resolution mechanism.

Missing values remain unavailable; retained snapshots, aggregates and tools are not automatically additional model charges. Errors are JSON objects on stderr, with exit status 1 for invalid data/execution and 2 for CLI usage. Successful commands write JSON summaries to stdout. Input/output aliases are rejected; output artifacts are replaced atomically, so use a distinct report directory when retaining previous runs.

## Value under an explicit basis

```sh
node dist/pricing-cli.js value --input .local/evidence.json --rate-card examples/rates/enterprise-astra-scenario.json --out .local/valuation.json
```

This card is an explicit public Enterprise scenario for the demo's recorded Astra/Codex setting. It is not a generic price list for other models or a historical bill. The [valuation specification](../spec/0.1/valuation.md) defines exact quantities, disjoint cache buckets, HALF_EVEN rounding, model/provider/product/date matching and incomplete prices. Create a versioned card for the scenario you intend; missing matches stay unpriced. A new valuation preserves the original recorded cost and source usage.

For a source with recorded monetary amounts, use `--mode recorded` instead of `--rate-card`. Recorded bases and currencies cannot be silently mixed into one profile. A known subtotal can remain useful when `complete` is false; inspect `issues` and `assumptions` in the valuation, not just the number.

## Export and inspect costs

```sh
node dist/pricing-cli.js export --input .local/evidence.json --valuation .local/valuation.json --out-dir .local/report
node dist/pricing-cli.js render --input .local/report/profile.json --out-dir .local/report
go tool pprof -top .local/report/cost.pprof
```

Default attribution is Work Item → agent → model → operation → observation. This is an attribution grouping, not an assertion that those categories are execution stack frames. Each leaf identifies a source observation that can be located in `evidence.json`. Set `--group-by work_item,agent,model` for a shallower graph or choose `session` and `turn` where the source supplies them. `--root-label` sets the root description. Unknown dimensions remain explicitly unknown.

Artifacts:

| File | Meaning |
| --- | --- |
| `profile.json` | Exact selected costs, attribution paths, basis, coverage, excluded IDs and frame identity manifest |
| `cost.folded` | Nonnegative integer nano-currency folded stacks for existing tools |
| `cost.pprof` | Gzip pprof with a declared cost sample type, unit, labels and binding metadata |
| `evidence.otlp.json` | OTLP span projection with standard GenAI fields and namespaced bridge metadata; not a lossless replacement for the evidence bundle |
| `export.json` | Profile/evidence/valuation identities and export digests |
| `cost.svg` | Interactive output from the pinned, unmodified Brendan Gregg FlameGraph renderer |
| `render.json` | Renderer provenance, monetary total and SVG digest |
| `render.folded`, `render.nameattr` | Renderer inputs, with per-prefix exact currency tooltips |

Keep `profile.json`, `evidence.json` and `valuation.json` with any shared graph: generic viewers may omit the coverage/basis metadata. The graph's horizontal position is not time; width is cost. Colors do not claim cost causality or model quality. The renderer uses nonnegative integer weights and rejects totals beyond its exact integer range; pprof separately enforces signed int64 bounds. Exact JSON remains available when a target format cannot represent a value. A zero-known-cost profile is valid interchange data but has no positive-width flame graph.

Shared work can be apportioned with `export --allocations allocations.json`. The file maps observation IDs to arrays of `{ "work_item_id": "task-a", "weight": "2" }`. Positive integer weights and deterministic largest remainders conserve every nano-currency unit. Preserve the allocation input with the report. `--cost-view charges` is the default; `credits` shows credit magnitudes, and `net` requires explicitly linked adjustments with a nonnegative resulting stack. See the [profile contract](../spec/0.1/profiles.md).

## Record Context Points and acceptance

A Work Item sidecar preserves scope revisions, versioned estimates, Attempts and the Acceptance Outcome. Start with `examples/work-items/golden.json`, which is explicitly synthetic. Declare your local point scale and method; use `null` when an estimate is unavailable. Estimates retain their creation time and whether they were made before, during or after execution. Known timestamps must support that declaration, and missing timing evidence remains explicit.

```sh
node dist/pricing-cli.js validate --kind work-item --input examples/work-items/golden.json
node dist/pricing-cli.js value --input examples/golden/evidence.json --mode recorded --out .local/golden-valuation.json
node dist/pricing-cli.js work-item --input examples/work-items/golden.json --evidence examples/golden/evidence.json --valuation .local/golden-valuation.json --out .local/work-item-evidence.json
```

The joined record reports only the selected observations' valuation, preserving the full dataset valuation separately. The real Codex demo includes a retrospective Work Item record with an unavailable point estimate and unknown Acceptance Outcome; it is not a calibration example. See the [Work Item contract](../spec/0.1/work-items.md) for scope history, timing checks and interpretation.

## Use the library or implement another consumer

```ts
import { importEvidence, validateEvidence, valueEvidence, createCostProfile, exportPprof } from "flaimegraph/pricing";

const evidence = validateEvidence(importEvidence("pi", nativeJsonl, {
  dataset_id: "delivery-42", work_item_id: "task-42",
}));
const valuation = valueEvidence(evidence, { mode: "recorded" });
const profile = createCostProfile(evidence, valuation);
const gzipPprofBytes = exportPprof(profile);
```

The package archive can be installed from the GitHub release with `npm install /path/to/flaimegraph-0.1.0.tgz`; registry publication is not required. The CLI can then be run with `npx flaimegraph-pricing`. The library seams do no provider I/O. Filesystem/rendering helpers belong to the CLI implementation.

An independent producer can start with [the worked evidence JSON](../examples/golden/evidence.json) and the [versioned schemas](../spec/0.1/schemas/). Follow the semantic contracts as well as structural schemas. The portable [accounting vectors](../spec/0.1/fixtures/accounting.json) contain literal expectations and invalid cases; compare your consumer with them. `node dist/pricing-cli.js conformance` executes those vectors against this reference implementation and checks profile/folded conservation. `npm run check` also runs adversarial adapter, allocation, identity and profile tests. Independent Go pprof and upstream FlameGraph checks exercise existing consumers; they do not establish independent implementation of this bridge specification.

Propose changes through a repository issue with a concrete failing example and compatibility impact. Declare conformance classes, source versions and limitations. Experimental version changes follow the [evolution policy](../spec/0.1/conformance.md); external adoption and calibration are separate evidence gates. Context Points remain a [versioned local planning proposal](context-points.md), with no universal points-to-token or points-to-dollar conversion.

## Context and harness profiles (0.2)

A context report joins 0.1 usage and valuation with a 0.2 context sidecar. Open a report in the Context Explorer to inspect request order, context origin and representation, repeated source revisions, summaries, capture gaps, effective harness settings and exact request cost. Report loading happens in the browser; file contents are not uploaded.

```sh
node dist/pricing-cli.js harness-profile --harness codex --version 0.153.4 --out .local/harness.json
node dist/pricing-cli.js capture --harness codex --input session.jsonl --namespace my-run --dataset-id my-work --out .local/capture.json --evidence-out .local/evidence.json
# Repeat after complete JSONL records have been appended; exact replay is idempotent.
node dist/pricing-cli.js capture --input session.jsonl --state .local/capture.json --out .local/capture.json --evidence-out .local/evidence.json
node dist/pricing-cli.js value --input .local/evidence.json --mode recorded --out .local/valuation.json
```

A supplied version or model in `harness-profile` is a producer declaration. Observed facts need source references. Recorded valuation leaves missing prices unvalued; a zero known subtotal does not mean free work.

`context-import` reconstructs a bounded Pi transcript history, or explicit unavailable Codex context, from the exact input artifact named by `--source-id` in an imported EvidenceBundle. It checks the artifact SHA-256. Capture state's merged evidence can reference several immutable prefixes; select the exact matching source, or use `import` for a single input. Pi transcript history is partial and is not a certified final provider request.

```sh
node dist/pricing-cli.js context-import --harness codex --input session.jsonl --evidence .local/evidence.json --profile .local/harness.json --source-id EXACT_SOURCE_ID --out .local/context.json
node dist/pricing-cli.js context-report --evidence .local/evidence.json --valuation .local/valuation.json --context .local/context.json --out .local/context-report.json
node dist/pricing-cli.js validate --kind context-report --input .local/context-report.json
```

For instrumentation, call `captureRequestContext` at the boundary you control, or `captureProviderRequest` for OpenAI Responses, Anthropic Messages or Gemini content request objects. These are pure capture functions: they send no provider requests. Raw text/bytes are hashed transiently; exports contain metadata. Annotate known repository instructions, skills or files explicitly; roles alone do not prove semantic origin. Unsupported request fields downgrade coverage. Local byte counts and supplied token estimates are separately classified.

Optional `--allocate-requests id-a,id-b` selects at most one context request per model observation. It estimates portions of the existing whole-request cost using token weights and preserves an unallocated remainder. It does not measure exact per-source billing. Allocation is off by default.

See the [0.2 contract](../spec/0.2/README.md), [capture SDK evidence](implementation-evidence/context-capture.md), [native import evidence](implementation-evidence/native-context.md), and [report examples](../examples/context/README.md). The [viewer source](../viewer/README.md) supports a local build. Standard FlameGraph, pprof and OTLP cost exports continue to work independently.
