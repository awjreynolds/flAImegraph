# flAImegraph context

This context names the concepts used to describe the size, evidence, valuation and outcome of AI-assisted work.

## Work and planning

**Work Item**:
A versioned unit of specified work with a declared scope and Acceptance Outcome. A Work Item may have multiple Attempts and observations.
_Avoid_: ticket when the acceptance boundary is different.

**Scope**:
The work and conditions included in a Work Item at a stated revision or time.
_Avoid_: everything an agent happened to touch.

**Acceptance Outcome**:
The declared condition that determines whether a Work Item is accepted.
_Avoid_: successful attempt, done, complete.

**Context Points**:
A versioned, human-facing relative estimate of AI effort for a Work Item and its Acceptance Outcome under stated working conditions. Context Points are experimental planning measures; they have no universal conversion to tokens, money or context-window occupancy.
_Avoid_: Token Points, context-window units, AI points.

**Context Point Scale**:
The versioned anchors and comparisons used to assign Context Points. A scale can be recalibrated when evidence shows that its repeatability or predictive value is insufficient.
_Avoid_: universal scale, fixed exchange rate.

**Human Estimate**:
A Context Points value or range assigned by a person or team before or during work, with its scale and basis recorded. It remains distinct from what an Attempt later observes.
_Avoid_: actual points, measured points.

## Evidence and resources

**Attempt**:
One bounded effort to advance a Work Item under stated working conditions, whether accepted, failed, cancelled or capped.
_Avoid_: delivery when acceptance has not been verified.

**Observation**:
A provenance-backed record of something seen about an Attempt or Work Item. An Observation retains its source and coverage and is distinct from a forecast or valuation.
_Avoid_: estimate, unscoped total.

**Observed Metric**:
A measured or explicitly estimated quantity associated with an Observation, such as tokens, calls, duration, human time or tool activity. Its category and availability remain visible.
_Avoid_: points, cost.

**Resource Usage**:
The observed consumption of model, harness, human or infrastructure resources attributable to an Attempt or Work Item. It describes what was consumed, not what the Work Item delivered.
_Avoid_: effort points.

**Coverage**:
The declared included, excluded, missing and uncertain portions of an Observation or report. Coverage describes the evidence supporting a quantity; it does not certify completeness.
_Avoid_: completeness certificate.

**Forecast**:
A versioned prediction of Resource Usage, an Acceptance Outcome or both, made for a stated stage and working condition.
_Avoid_: promise, budget cap.

**Calibration Record**:
A linked Context Points estimate, Observation, valuation, Scope, working condition and Acceptance Outcome used to evaluate a scale or Forecast.
_Avoid_: training example when the record's provenance is not known.

## Valuation and views

**Valuation**:
A versioned application of declared rates or a commercial scenario to a quantity, with its currency, date, source and assumptions. A Valuation can describe a scenario or contract basis without being an invoice.
_Avoid_: bill, actual charge when billing evidence is absent.

**Cost Profile**:
A reproducible grouped view of valued Resource Usage in which a selected monetary measure can be compared across Work Items, Attempts, agents, models or other declared groups. It preserves the link to source evidence and the chosen Valuation.
_Avoid_: invoice, raw usage total.

**Attribution**:
The declared relation between Resource Usage and the Work Items, Attempts, agents or models to which it is assigned, including any shared allocation and uncertainty.
_Avoid_: ownership when the relation is only an allocation.

**Harness**:
The agent runtime and surrounding tools that produce an Attempt's observations, distinct from the model and Work Item.
_Avoid_: model, provider.

**Projection**:
A declared grouping of evidence into a report or view, with its selected paths, allocation rules and known losses kept visible.
_Avoid_: ground truth, complete ledger.

## Context and harness behavior

**Harness Profile**:
A versioned description of a harness configuration, its instruction and tool sources, context policies and capture capabilities. A run references the profile it used and retains any observed overrides.
_Avoid_: adapter, model profile, proof of effective configuration.

**Context Source**:
An identified origin of material made available to an agent, such as an instruction, skill, repository file, tool result or earlier model output. Identical content does not by itself establish identical provenance.
_Avoid_: message role, billed category.

**Context Revision**:
A particular representation of a Context Source, with a declared fingerprint and measurements where available. Truncation or summarization creates a new revision or source with explicit transformation lineage.
_Avoid_: the original file when only an excerpt or summary is present.

**Context Occurrence**:
One ordered appearance of a Context Revision in a particular request context. Repeated appearances describe repeated exposure, not duplicate evidence or proof of a cache hit.
_Avoid_: unique source, additional model call.

**Request Context**:
The ordered material recorded at a stated request boundary, with its Harness Profile, measurement provenance and Coverage. A client request, assembled harness context and transcript reconstruction are distinct boundaries.
_Avoid_: complete provider prompt, billed partition.

**Context Transformation**:
A recorded relation between input and output Context Revisions, such as truncation, compaction, summarization or delegation. It preserves lineage without assigning exact output shares to its inputs.
_Avoid_: measured token savings, causal attribution.

**Context Treatment**:
The declared processing or caching treatment of a Context Occurrence, separately evidenced from its origin and representation.
_Avoid_: source type, cache hit inferred from repetition.

**Context Cost Allocation**:
An explicitly estimated, conserving distribution of a request's selected cost under a declared allocation method. It does not establish per-source billing or the effect of removing a source.
_Avoid_: exact source cost, causal savings.
