# Pi cost estimator prior art: what is implemented and what is calibrated

Research date: 2026-09-06. Scope: read-only inspection of public npm metadata, published tarball bytes, pinned source, calibration assets and test code. The package was **not installed or executed**, and no private session store was accessed. This report evaluates the package's evidence, not the accuracy of any estimates it would generate for our work.

**Conclusion:** `@blackbelt-technology/pi-dashboard-cost-estimator` implements a reusable spec-driven estimation engine, including an ACEM-inspired token/cost path and local-session calibration utilities. It is relevant adoption-first prior art. Its published calibration material does **not** establish that it accurately predicts tokens or monetary cost from a new specification through accepted delivery. The useful next step is to evaluate the existing engine against independently captured completed work, rather than create another estimator from scratch.

## Version and source pins

| Artifact | Verified pin |
| --- | --- |
| Requested npm version | `0.7.0`, published 2026-08-17; registry `gitHead` [`fa69fa268e165e428fcb53d51f7d8ebff6b1da61`](https://github.com/BlackBeltTechnology/pi-agent-dashboard/tree/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator) |
| Current npm `latest` when checked | `0.8.0`, published 2026-08-26; registry `gitHead` [`9373dfa416660a285475febc0383608fe14270b1`](https://github.com/BlackBeltTechnology/pi-agent-dashboard/tree/9373dfa416660a285475febc0383608fe14270b1/packages/cost-estimator) |
| Publication metadata | [npm registry packument](https://registry.npmjs.org/@blackbelt-technology/pi-dashboard-cost-estimator), including tarball URLs and integrity hashes |
| Package license/interface | MIT; engine subpath exports, CLI launchers and dashboard integration in [package.json](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/package.json) |

I verified each version's published archive against its npm SHA-512 integrity value and compared member-file SHA-256 hashes in memory, without extracting or executing the archives. Both have 38 files. Only `package.json`, `src/server/index.ts` and `src/telemetry/sessions.ts` differ. The latter changes are a logger call signature and an additional TypeScript cast. The estimator engine and published calibration assets are byte-identical between these versions. Detailed citations below use 0.7.0's registered source revision.

## Does it estimate agentic delivery from specifications?

Yes, through a structured estimation workflow rather than an empirically learned specification-to-token predictor. The input contains use cases, transaction counts, actors, technical/environmental factors, NFR routing, stack/context, work-item AI classes, team and rates. The engine derives Use Case Points, applies a COCOMO-inspired scale adjustment, distributes human effort across roles, and compares four modes: human-only, human with AI, human-steered agents, and agentic HITL. Missing judgments receive defaults; they are not discovered by a tokenizer or trained model. [Input types](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/types.ts), [pipeline](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/estimate.ts), [effort calculation](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/effort.ts).

The agent cost path is selected in this order:

1. **Subscription, the default:** seat price × seat count × utilization allocation × estimated calendar months. A supplied metered rate produces a comparison, not additional subscription spend.
2. **Metered with `cost_per_steering_hour`:** estimated agent-run hours × supplied monetary rate. This rate supersedes the token reconstruction.
3. **Metered without that rate:** `tokens = UCP × tokens_per_ucp × revision_factor × context_factor × agentShare`; input/output fractions are priced at two configured token rates. `agentShare` is 0.5 for the steered mode and 1 for agentic HITL. Infrastructure and applicable licences are additional terms.

This is implemented arithmetic, not just a skill description. The reconstruction has no distinct cache-read/cache-write tariff, despite the calibration material emphasizing cache traffic. [Delivery-mode and ACEM calculation](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/modes.ts).

The ACEM paper's own abstract describes symbolic constants pending empirical grounding. The package adds local assumptions and measurements; publishing an implementation does not resolve the paper's calibration problem. [ACEM v2](https://arxiv.org/abs/2608.02582v2).

## What calibration evidence exists?

### A completed-project effort reference

A WMS reference input supplies 24 use cases, six actors, stack/context and an asserted completed effort of 479 person-days, or 3,832 hours. Its reference-class table reports a fitted coefficient of 12.97 hours/UCP after the model's adjustments. The calibrator solves a ratio: previous coefficient × actual hours / modeled hours. This is a useful local fit of **human effort**, not evidence for the UCP-to-agent-token coefficient. The inspected assets contain one reference-class row, not a held-out sample of agentic deliveries. [WMS input](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/.pi/skills/software-cost-estimator/assets/calibration/wms-reference.yaml), [reference classes](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/.pi/skills/software-cost-estimator/assets/calibration/reference-classes.md), [calibrator](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/bin/calibrate.ts).

### Aggregate local-session measurements

The reference document asserts 542 substantive sessions, 737.5 activity hours, monetary cost of $7,676, approximately $10.41/hour, context factor 5.10, observed revision proxy 1.05, 0.38% output-token share and 95.5% cache-read share. It also reports a repeat measurement of 424 hours versus an earlier 465-hour snapshot. These are **author-reported summaries**. The published package provides no underlying 542-session corpus, per-project prediction/outcome pairs, invoices or independent verification. [Reported measurements](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/.pi/skills/software-cost-estimator/assets/calibration/reference-classes.md#measured-from-session-telemetry).

The implementation lets us assess what those summaries actually measure:

| Parameter | Implemented proxy | Limit for forecasting accepted delivery |
| --- | --- | --- |
| Activity/“steering” hours | Sum consecutive message-timestamp gaps, each capped at 15 minutes; default excludes sessions below 0.25 hours or three assistant turns | Measures session activity, not independently observed human attention; concurrent sessions can overlap |
| Cost/hour | Sum session metadata cost divided by summed activity hours | Inherits metadata completeness and cost basis; missing cost defaults to zero |
| Context factor | Cache reads per assistant turn in long sessions (≥60 turns) divided by short sessions (≤20) | Cohort ratio, not a controlled causal cost-growth measurement |
| Revision factor | `1 + tool-error rate + human-correction rate`, detected with text regexes | Counts events, not revised/rejected token cost; the “lower bound” label is a heuristic |
| Grouping | Project path, with a conventional worktree suffix removed | No specification ID, use-case ID, acceptance result, delivery artifact or completion outcome |

These observations are derived directly from [the session adapter](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/telemetry/sessions.ts). In particular, it cannot fit tokens/UCP because its session record has no UCP or delivered-scope field.

The source uses inconsistent monetary language: some comments call metadata cost “billed,” whereas the calibration CLI explicitly distinguishes theoretical meter-equivalent amounts from subscription cash out. The latter interpretation is safer unless separate billing evidence exists. No invoice reconciliation appears in the inspected adapter. [Calibration CLI](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/bin/calibrate-sessions.ts), [metadata type/reader](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/shared/src/session-meta.ts).

### Which constants remain assumptions?

The engine retains `tokensPerUcp = 250000`; no empirical fitting method for it was found. Revision factor is set to 1.25 above the reported proxy floor, context factor to 5.1 and output share to 0.004. Codebase/seniority magnitudes, review/rework overhead, agent leverage and correlated-risk shape are explicitly marked uncalibrated. Therefore the existence of a large session count does not make all model coefficients empirically established. [Defaults and provenance annotations](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/defaults.ts).

The declared default rate of $10.41/hour is not automatically used by the mode-selection code: metered-rate costing requires the input's `ai.cost_per_steering_hour`. An adoption evaluation must record its actual selected path and inputs.

## Validation and maturity

The source contains formula tests, synthetic session fixtures, accounting-path guards and a deterministic Monte Carlo implementation. Tests check such things as gap capping, counter extraction, subscription allocation and replacement of token reconstruction by a measured rate. These establish intended arithmetic and plumbing; I did not execute them. They do not demonstrate prediction error on unseen accepted work. [Tests](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/__tests__/estimator.test.ts).

The pipeline simulates uncertainty over **human-baseline work-item hours**. It does not propagate distributions for revision factor, context factor, tokens/UCP or model tariffs through an agentic monetary forecast. Consequently its P50/P85/P95 outputs should not be presented as empirically calibrated probability bounds on LLM spending. [Simulation](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/simulate.ts), [pipeline](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/engine/estimate.ts).

No held-out forecast evaluation, MAE/MAPE-style prediction report, interval-coverage study, or dataset linking pre-work specs to accepted delivery was found in the inspected package, its calibration assets or tests. That is a bounded negative finding, not a claim that the authors possess no additional private evidence. Maturity is best described as **implemented estimation workflow with local heuristic calibration, not a validated agentic-delivery forecasting model**.

## Reuse recommendation

Reuse candidates are concrete: the engine's structured inputs, sizing/effort decomposition, separation of subscription and metered costs, NFR double-counting guard, deterministic simulation and report generation. The source deliberately isolates the engine from the session adapter and guards that boundary in tests. Its MIT license and engine subpath exports make an evaluation or adapter practical. However, “zero-dependency engine” does not mean dependency-free package execution: CLI launchers spawn `npx tsx`, and the dashboard/telemetry package declares workspace dependencies. [Engine boundary test](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/src/__tests__/engine-purity.test.ts), [launcher](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/bin/estimate.mjs), [package interfaces](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/fa69fa268e165e428fcb53d51f7d8ebff6b1da61/packages/cost-estimator/package.json).

An adoption-first evaluation should freeze the input specification and estimate before work begins; attach actual observations to the same work-item identity; require an explicit accepted outcome; and distinguish recorded tariff estimate, subscription allocation and billed charge. Fit coefficients on one set of deliveries and evaluate on later held-out deliveries, retaining failed/abandoned work and missing-cost indicators. Compare this existing engine against simple local reference-class baselines before extending it.

For flAImegraph, the immediate reusable boundary is an **actual-cost evidence adapter feeding an existing estimator**, plus accepted-outcome linkage for calibration. The package's session summaries are useful features, but cannot substitute for the reliable monetary observations and outcome labels that prediction validation needs.
