# v0.6.0 logging toolchain support and evidence

Version 0.6.0 makes the local logging toolchain generally available for the
supported surfaces below. Claude support remains experimental. Hosted services,
desktop-specific capture and Windows are outside this release's support scope.

## Release support matrix

| Surface | Support level and evidence | Boundary |
| --- | --- | --- |
| CLI and SDK on Linux/macOS, Node 22/24 | Supported; platform CI, installed-package checks, 361 reference tests | Perl is required for SVG rendering; no Windows validation |
| Usage 0.4 and lifecycle 0.5 validation, schemas, reports and profile export | Supported reference toolchain; independent Python syntax validation and Go pprof consumption | Syntax alone does not prove semantic conformance; no external producer adoption claim |
| Codex native rollout import | Supported for recognized receipt shapes; frozen native capture and fixture evidence | Internal format changes may require adapter updates; missing relationships remain unknown |
| Codex exec JSON capture/import | Supported aggregate surface; live Codex CLI 0.153.4 | Turn totals have no response identity and are excluded from direct consumption; tool-item details are not imported |
| Pi session and JSON-mode capture/import | Supported recognized legacy/durable formats; live Pi 0.67.2 with Ollama validates settled JSON-mode receipts | Other providers and every durable-ledger producer version were not live-tested |
| Claude stream-json and internal transcripts | Experimental; fixtures and real authentication-failure path only | Successful live Claude execution remains unverified; internal transcript format has no stable public contract |
| Other native/legacy adapters | Existing fixture-tested compatibility | No additional live support is implied by this release |

The package version is independent of document schema versions. Existing usage
0.4 and lifecycle 0.5 shapes are unchanged. See [migration notes](../CHANGELOG.md)
and [installation and release assets](releases/v0.6.0.md).

GA is a tested product/support contract. Publication by this project does not establish industry-standard status or independent adoption. Existing OpenTelemetry semantics/transport and pprof/profile consumers remain integration boundaries; the versioned usage/lifecycle contracts must document their additional evidence semantics rather than silently treating arbitrary OTLP data as equivalent.

## Release gates

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Portable logging contract | Machine-readable schemas, normative framing/identity/usage/coverage rules, compatibility policy and independent valid/invalid fixtures | Four Draft 2020-12 schemas; 23 shared syntax fixtures; reference semantic verdicts and independent Python validation pass. See [conformance](../spec/logging-conformance.md). |
| Useful harness coverage | Source identity, usage semantics, tools and explicit limitations; no invented response or retry relationships | Codex exec and Pi live probes completed. Claude stream and internal transcript support are explicitly experimental and outside the GA support claim. |
| Durable capture | Partial writes, failures, restart, redelivery, duplicate and aggregate evidence tested; capture health remains visible | Lifecycle journal suite passes. Native capture writes atomic metadata snapshots and preserves failure status; it explicitly does not claim power-loss durability or complete in-flight deltas. |
| Privacy | Metadata defaults, bounded inputs, no undisclosed export, input preservation | Capture writes no raw stdout; CLI reads bounded to 64 MiB; existing output protection and content-omission tests pass. Harnesses retain their own configured access and retention. |
| Tooling | Capture/import, schema validation, inspectable report and standard profile export work from an installed package | Isolated npm package install, schema export, lifecycle validation, report and SVG/pprof export pass. Installed capture wrapped a successful Pi run. |
| Independent validation | Independently expected quantities and an independent consumer | Python jsonschema passes shared corpus; Go pprof reads the live Pi export as 72 tokens. |
| User-facing evidence | Report interaction answers what a harness did and shows unknowns/partial work | Local browser loaded live Pi metadata, switched input/output, opened provenance and verified corrected UTC timestamp. Synthetic interruption view exposes failed usage, known waits, unexplained gaps and missing completion. |
| Release engineering | Clean install, supported Node/platform CI, package contents, migration notes, licence notices and reproducible checks | Local source tests and viewer build pass; patched viewer audit reports zero advisories. [All six remote jobs passed](https://github.com/awjreynolds/flAImegraph/actions/runs/34411799724), including Linux/macOS Node22/24. Release support scope is the matrix above. |

Do not call the release GA until all applicable gates have evidence. Research conclusions, synthetic component tests, full mocked-transport tests, actual harness runs and UI checks are different evidence levels. A source field or installed package is not proof that the claimed end-to-end behavior works.

## Execution order

1. Finish Headroom mocked-provider validation to decide the transport reuse boundary.
2. Stabilize the existing logging contracts with portable schemas, conformance corpus and validation commands.
3. Complete the local capture/import workflow and per-harness capability checks, including error and resume cases.
4. Verify installed CLI and report interaction with the representative corpus; resolve gaps found.
5. Run the supported platform/package release matrix and publish only the evidence-supported readiness level.

Efficiency inspection may operate without an outcome. Claims of improvement require comparable acceptance evidence; absent effort or outcomes remain unknown. The earlier minimum-evidence proposal remains a proposal until confirmed, so these are conservative implementation defaults, not a falsely recorded user decision. Capture-health errors are separate from efficiency advice or automatic model routing.

## Remaining evidence work

Claude's available sign-in expired during the live probe. Successful live capture
and installed-package checks with working provider access are required before
promoting Claude support. flAImegraph itself needs no Claude account. Complete
provider-attempt capture, invoice reconciliation, external producer adoption and
forecast calibration remain separate research goals. See [live probe evidence](../examples/ga-validation/README.md)
and [native capture behavior](native-capture.md) for the observed boundaries.
