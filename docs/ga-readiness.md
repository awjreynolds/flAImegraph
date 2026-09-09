# GA execution and evidence gate

This document tracks release evidence for the local logging contract and CLI. The working scope covers Codex CLI, Claude Code and Pi. Hosted services and desktop-specific capture are outside this release candidate.

GA is a tested product/support contract. Publication by this project does not establish industry-standard status or independent adoption. Existing OpenTelemetry semantics/transport and pprof/profile consumers remain integration boundaries; the versioned usage/lifecycle contracts must document their additional evidence semantics rather than silently treating arbitrary OTLP data as equivalent.

## Release gates

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Portable logging contract | Machine-readable schemas, normative framing/identity/usage/coverage rules, compatibility policy and independent valid/invalid fixtures | Four Draft 2020-12 schemas; 23 shared syntax fixtures; reference semantic verdicts and independent Python validation pass. See [conformance](../spec/logging-conformance.md). |
| Useful harness coverage | Source identity, usage semantics, tools and explicit limitations; no invented response or retry relationships | Codex exec and Pi live probes completed. Claude stream importer and failure path tested; successful Claude live validation remains pending. Internal Claude transcript compatibility is experimental. |
| Durable capture | Partial writes, failures, restart, redelivery, duplicate and aggregate evidence tested; capture health remains visible | Lifecycle journal suite passes. Native capture writes atomic metadata snapshots and preserves failure status; it explicitly does not claim power-loss durability or complete in-flight deltas. |
| Privacy | Metadata defaults, bounded inputs, no undisclosed export, input preservation | Capture writes no raw stdout; CLI reads bounded to 64 MiB; existing output protection and content-omission tests pass. Harnesses retain their own configured access and retention. |
| Tooling | Capture/import, schema validation, inspectable report and standard profile export work from an installed package | Isolated npm package install, schema export, lifecycle validation, report and SVG/pprof export pass. Installed capture wrapped a successful Pi run. |
| Independent validation | Independently expected quantities and an independent consumer | Python jsonschema passes shared corpus; Go pprof reads the live Pi export as 72 tokens. |
| User-facing evidence | Report interaction answers what a harness did and shows unknowns/partial work | Local browser loaded live Pi metadata, switched input/output, opened provenance and verified corrected UTC timestamp. Synthetic interruption view exposes failed usage, known waits, unexplained gaps and missing completion. |
| Release engineering | Clean install, supported Node/platform CI, package contents, migration notes, licence notices and reproducible checks | Local source tests and viewer build pass; patched viewer audit reports zero advisories. [All six remote jobs passed](https://github.com/awjreynolds/flAImegraph/actions/runs/34411455196), including Linux/macOS Node22/24. Final support scope remains pending. |

Do not call the release GA until all applicable gates have evidence. Research conclusions, synthetic component tests, full mocked-transport tests, actual harness runs and UI checks are different evidence levels. A source field or installed package is not proof that the claimed end-to-end behavior works.

## Execution order

1. Finish Headroom mocked-provider validation to decide the transport reuse boundary.
2. Stabilize the existing logging contracts with portable schemas, conformance corpus and validation commands.
3. Complete the local capture/import workflow and per-harness capability checks, including error and resume cases.
4. Verify installed CLI and report interaction with the representative corpus; resolve gaps found.
5. Run the supported platform/package release matrix and publish only the evidence-supported readiness level.

Efficiency inspection may operate without an outcome. Claims of improvement require comparable acceptance evidence; absent effort or outcomes remain unknown. The earlier minimum-evidence proposal remains a proposal until confirmed, so these are conservative implementation defaults, not a falsely recorded user decision. Capture-health errors are separate from efficiency advice or automatic model routing.

## Current readiness

This is a release candidate, not a completed three-harness GA certification.
Claude's available sign-in expired during the live probe. flAImegraph itself needs
no Claude account. A successful run can be supplied by an existing Claude user;
alternatively the first release can explicitly keep Claude experimental while
supporting the validated Codex/Pi surfaces. That support-scope decision is pending.
See [live probe evidence](../examples/ga-validation/README.md) and
[native capture behavior](native-capture.md) for the exact boundaries.
