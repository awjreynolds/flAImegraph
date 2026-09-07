# Operation-level profiling v0.3 design review

Review scope: the proposed operation sidecar, `src/types.ts`, `src/context-types.ts`, `src/context-report.ts`, the profile construction in `src/profile.ts`, and the v0.2 context specifications. This review assumes the 0.1 evidence/valuation/profile and 0.2 context/report contracts remain immutable. It proposes no production edits.

## Result

Ship an append-only 0.3 operation sidecar and derive two explicitly different views from it:

1. an **observed execution view**, ordered by captured time and connected only by actual operation parentage; and
2. an **estimated source-exposure cost view**, joined through context occurrences and existing v0.2 allocations.

A single tree cannot soundly answer both questions. A file read normally finishes before a later model request consumes the resulting revision. Making the read the model call's execution parent invents nesting; making the model call the read's parent reverses time. Context lineage is also a DAG: one revision can appear repeatedly, a summary can have many inputs, and one operation can produce material consumed by several later requests. Those relations belong in typed links, not `actual_parent_id`.

The proposed sidecar is worthwhile because the current monetary profile selects direct valued observations and constructs synthetic grouping stacks. It cannot display unpriced directory scans, thousands of individual reads, edits, tests, hooks, or the actual nested work that surrounds model calls. Extending the frozen profile schema would also blur its documented attribution semantics. A new sidecar is the cheaper sound seam.

## Required corrections to the proposal

### [P1] Define one authoritative meaning for operation parentage

`actual_parent_id` means the parent operation asserted by the producing runtime. It is not context provenance, delegation, ownership, chronological adjacency, source attribution, or a parent guessed from overlapping timestamps.

The validator must require at most one parent, require the parent to exist, and reject self-edges and cycles. A missing parent stays null and may produce a coverage issue. Parent and child timestamps should be checked for impossible ordering when both are comparable, but temporal containment should not be required: asynchronous work can outlive the scope that launched it. Delegation may be a separate typed link when the operation parent alone does not express it.

Every parent claim needs evidence and a method. A native runtime parent ID can be `observed`; a producer-configured relationship can be `declared`; a deterministic reconstruction can be `derived`. The UI must retain that class. Calling a derived interval guess “actual parentage” would overstate the evidence, so timestamp-only nesting should remain a derived optional display, not populate `actual_parent_id`.

### [P1] Keep file I/O separate from model-context occurrence

One file operation record describes one attempt. Five thousand reads require five thousand operation IDs even when paths or returned bytes repeat. Directory enumeration does not imply that any returned entry was opened, and content equality does not deduplicate attempts.

A file descriptor must distinguish at least:

- requested range or request count;
- bytes actually read from the backing source;
- bytes returned to the caller after limits, filtering, or truncation;
- bytes inserted and deleted by a write/edit; and
- cache treatment for that attempt, with evidence and method.

Whole-file line count is metadata about a file revision, not a proxy for bytes read, bytes returned, tokens inserted into a request, or cost. Missing measurements remain null; they do not become zero. A directory scan should separately record entries examined and entries returned. Reads discovered inside a scan remain child or linked read operations rather than an aggregate count on the scan.

Only a `ContextOccurrence` establishes that a context revision appeared in a particular model request. A file-read operation may produce a revision without any later request consuming it. Conversely, a request may consume a revision reconstructed from logs even when no file-read operation was captured. These cases must remain representable.

### [P1] Count every valued model observation exactly once

The monetary operation projection must reuse the existing `Valuation` rather than create operation prices. A non-null amount is eligible only when its v0.1 observation has `accounting_scope: "direct"` and is linked to exactly one operation. The observation ID is the deduplication key. Duplicate operation links to one valued observation fail closed; an unlinked valued observation goes to an explicit unassigned bucket.

For each operation, expose direct and rollup fields with different names:

- `self_amount_nanos`: the selected direct amount assigned to this operation, or null when unknown/not applicable;
- `descendant_known_nanos`: the sum of known direct amounts strictly below it;
- `inclusive_known_nanos`: `self + descendant_known`; and
- `complete`: whether every monetarily applicable operation in that subtree has a known amount.

Inclusive and descendant fields are derived rollups, never new valuation lines or additive samples. The bundle-wide sum of all operation `self_amount_nanos` plus the unassigned bucket must equal the selected v0.1 valuation total. Summing inclusive fields is invalid because it repeats descendants.

The projection also needs a direct-cost state such as `valued`, `unvalued`, or `not_applicable`. A null price is not a measured zero. A priced zero is valid and remains distinguishable from an operation outside the valuation's scope.

### [P1] Do not hide unpriced work in a USD graph

The chronological execution result includes every captured operation, regardless of price. Standard folded and pprof widths cannot make a zero-width rectangle visible. The USD projection should therefore carry `zero_value_operation_ids`, `unvalued_operation_ids`, `not_applicable_operation_ids`, and `unassigned_observation_ids` in its manifest. A native viewer may overlay markers or a synchronized timeline, but the exported monetary width must stay exact.

This is preferable to inventing a minimum display cost. A directory scan, edit, test, or hook with no direct model charge still matters operationally; it simply has no additive USD width under the chosen valuation.

### [P1] Label source exposure as an alternative estimated projection

The source-exposure view should consume the existing v0.2 `ContextAllocation` rows. It must not allocate a valued request a second time or mutate the observed monetary profile. Each allocation portion joins:

`valued model observation -> selected RequestContext -> ContextOccurrence -> ContextRevision -> optional producing operation`.

This permits a portion to be displayed under the operation path that produced the directly consumed revision. The path is an attribution path, not an observed call stack. Its root and metadata should say `estimated-source-exposure`, include the allocation method, and preserve the consuming observation and occurrence IDs.

Transformation ancestors do not inherit a summary's allocation. When a later request consumes summary revision S, S receives the eligible weight. Source revisions A and B remain navigable through `ContextTransformation`, but copying S's allocated amount to both A and B would multiply cost; spreading it between them would introduce another estimated allocation method. Neither behavior belongs in the minimum contract.

The existing proportional weights distribute the whole selected request cost, including output. They show exposure under a declared weighting rule. They are not input billing, causal contribution, or marginal savings. The UI must not label the difference between a direct-file portion and a summary portion as money saved.

### [P2] Make classification facts evidence-bearing

Operation `kind` and optional labels such as `phase: research`, `phase: edit`, or `phase: test` need `value`, `evidence`, `method`, and source references. Native tool names may support an observed kind; a path/command rule may derive a phase; user configuration may declare a label. Unknown stays unknown.

Phase classification is optional. A heuristic may say that a command matches a configured test rule, but it must not claim that the model intended to test, research, summarize, or edit. The classifier/configuration version belongs in the record so later rule changes do not rewrite old runs.

### [P2] Scope provenance and identity to the sidecar

Operation `source_refs` must resolve only against the operation bundle's artifact registry. They must not fall back to the v0.1 evidence sources or v0.2 context artifacts. Cross-contract joins use the typed observation, request, occurrence, and revision IDs in `OperationLink`; coincident artifact IDs do not create a join.

Prefer a native producer operation ID. Otherwise derive identity from a capture namespace plus an immutable source coordinate or append-only sequence. Timestamps, path names, command text, content hashes, and equal payloads are not unique attempt identities. Replaying the same immutable operation is idempotent; presenting different semantics under one operation ID fails closed. These rules are necessary for repeated reads, retries, and append-only snapshots to remain distinct without multiplying exact replays.

### [P2] Keep profiler hooks observational and fail open

The profiler should record a hook decision but never become the policy engine. In v0.3 its decision field should have only `allow`, accompanied by `reason` and `config_version`. Capture, parsing, or persistence failures emit issues and still return allow. If a harness separately blocks an action, the sidecar may observe the denied operation and name the external policy source; it must not represent that denial as a profiler decision.

This contract requires no tokenizer, token-count request, model call, or additional LLM turn. Model, usage, valuation, and request-context joins are optional enrichments. An operation-only bundle remains valid and supports the complete chronological view.

## Minimal shipping contract

The external module should stay deep: append/reconcile one sidecar, validate it, then ask for a named projection. File-system adapters, harness hooks, classification rules, and renderer-specific formats remain behind that seam.

An illustrative TypeScript shape is:

```ts
interface OperationBundle {
  schema_version: "0.3.0";
  dataset_id: string;
  evidence_schema_version: "0.1.0";
  context_schema_version: "0.2.0";
  artifacts: Source[];
  operations: OperationSpan[];
  links: OperationLink[];
  issues: OperationIssue[];
}

interface OperationFact<T extends string> {
  value: T | null;
  evidence: "observed" | "derived" | "declared" | "unknown";
  method: string | null;
  source_refs: SourceRef[];
}

interface OperationSpan {
  id: string;
  actual_parent_id: string | null;
  parent_evidence: "observed" | "derived" | "declared" | "unknown";
  parent_method: string | null;
  name: string;
  kind: OperationFact<
    "work" | "agent" | "model_request" | "tool" | "directory_scan" |
    "file_read" | "file_write" | "edit" | "test" | "hook" | "other"
  >;
  labels: Array<{ key: string; fact: OperationFact<string> }>;
  status: "ok" | "error" | "cancelled" | "running" | "unknown";
  started_at: string | null;
  ended_at: string | null;
  timing_evidence: "observed" | "derived" | "declared" | "unknown";
  agent_id: OperationFact<string>;
  model: OperationFact<string>;
  source_refs: SourceRef[];
  descriptor?: FileReadDescriptor | FileChangeDescriptor |
    DirectoryScanDescriptor | HookDecisionDescriptor;
}

type OperationLink =
  | { kind: "corresponds_to_observation"; operation_id: string; observation_id: string }
  | { kind: "produces_context_revision"; operation_id: string; revision_id: string }
  | { kind: "consumes_context_occurrence"; operation_id: string; request_id: string; occurrence_id: string }
  | { kind: "delegates"; operation_id: string; target_operation_id: string };
```

For every `OperationFact`, `evidence: "unknown"` requires a null value and other evidence classes require a non-null value. An observed fact requires supporting source references. This applies to the model identity too: a configured model is not silently upgraded to the model observed on a request.

The concrete descriptors should use the v0.2 discipline for quantities: exact canonical integer strings or null, precise units, evidence, method, and source references. `FileReadDescriptor` should name the logical locator, requested range, `bytes_read`, `bytes_returned`, and cache fact. `FileChangeDescriptor` should retain per-file `bytes_inserted` and `bytes_deleted`. `DirectoryScanDescriptor` should retain root/pattern/recursion plus entries examined and returned. `HookDecisionDescriptor` should contain `decision: "allow"`, reason, and configuration version.

The minimum public operations are conceptually:

```ts
advanceOperationCapture(snapshot, options, previous?): OperationCaptureState
validateOperationBundle(value, evidence?, context?): OperationBundle
createOperationExecutionView(bundle): OperationExecutionView
createOperationCostProjection(bundle, evidence, valuation, options?): OperationCostProjection
createSourceExposureProjection(bundle, contextReport, options?): SourceExposureProjection
```

Only introduce adapter interfaces where there are real producer and test adapters. Renderer exporters can consume these returned projections without becoming part of capture.

## View invariants

### Observed execution view

- Contains every operation exactly once.
- Sorts by comparable observed start time, then a stable producer sequence when available, then operation ID. Missing or incomparable time is visible, not synthesized.
- Uses only `actual_parent_id` for tree nesting. Delegation, context, and transformation links are overlays.
- Shows duration only when both endpoints and their clock basis are compatible. It does not sum overlapping child durations into wall time.
- Preserves operation attempts, repeated reads, cache observations, errors, cancellations, and running/incomplete spans.

### Monetary operation projection

- Selects v0.1 direct valuation lines under the existing cost-view rules.
- Associates each selected observation with at most one operation and emits it as one self-cost sample.
- Conserves exact integer nanocurrency, including the explicit unassigned bucket.
- Carries rollups as derived fields; exporters emit leaf/self contributions rather than inclusive totals.
- Preserves priced zero, unvalued, not applicable, and missing-operation states separately.
- Never uses elapsed time, file counts, line counts, bytes, or context weights as substitute prices.

### Estimated source-exposure projection

- Starts only from explicitly selected, conserving v0.2 allocations.
- Emits each allocation portion once and preserves its observation, request, occurrence, revision, amount, evidence, method, and unallocated bucket.
- May attach a portion to the producing operation path for that exact revision. This is a synthetic attribution path and does not alter actual parentage.
- Does not allocate summary amounts backward through transformation lineage in the minimum method.
- Is alternative to, and never additive with, the monetary operation projection.

## Exact conservation example: direct read and summary route

Assume all operations are siblings under one root in actual chronological order unless native parentage says otherwise.

### Direct route

Operation `read-F` reads source revision F and returns 240 bytes. This byte count says nothing about request tokens. The later request contains an occurrence of F measured at 60 tokens, another occurrence at 20 tokens, and 20 input tokens not covered by captured occurrences. Model observation `answer-direct` has 100 inclusive input tokens and a direct valuation of 101 nanos.

The v0.2 largest-remainder allocation is:

```text
F occurrence:       floor(101 * 60 / 100) = 60, remainder .60 -> 61
other occurrence:   floor(101 * 20 / 100) = 20, remainder .20 -> 20
unallocated:        floor(101 * 20 / 100) = 20, remainder .20 -> 20
conservation:       61 + 20 + 20 = 101 nanos
```

The execution view shows `read-F` and `answer-direct` in time order. The monetary operation view gives `answer-direct` self cost 101 and `read-F` no direct monetary width. The estimated source-exposure view may place the 61-nano portion under the producer path for F, labelled estimated and output-inclusive. The two 101-nano views are alternatives; adding them would double count.

### Summary route

Operation `summarize-F` consumes a 60-token occurrence of F and produces summary revision S. Its model observation is directly valued at 30 nanos, so the allocation for that request is 30 nanos to F. A later `answer-summary` request has 100 inclusive input tokens: S is 15, another occurrence is 65, and 20 remain uncovered. `answer-summary` is directly valued at 101 nanos.

```text
summarize-F request:
  F occurrence      = 30
  conservation      = 30 nanos

answer-summary request:
  S occurrence      = floor(101 * 15 / 100) = 15, remainder .15 -> 15
  other occurrence  = floor(101 * 65 / 100) = 65, remainder .65 -> 66
  unallocated       = floor(101 * 20 / 100) = 20, remainder .20 -> 20
  conservation      = 15 + 66 + 20 = 101 nanos

whole route:
  direct model self costs = 30 + 101 = 131 nanos
  source-exposure buckets = 30 + 15 + 66 + 20 = 131 nanos
```

The transformation F -> S remains visible. The 15 nanos attach to S and its producing operation, not automatically to F. Assigning it to F as well would make the source view 146 nanos; moving it from S to F would require a new, explicitly estimated backward-allocation policy for summaries with potentially many inputs.

This comparison does not establish that summarization saved 46 nanos, 45 tokens, or any other marginal amount. The allocated shares contain output cost, the summary route adds its own 30-nano model call, and the two requests need not have identical output, cache treatment, formatting, success, or acceptance outcome. A savings claim requires a separate counterfactual method and outcome evidence.

## Minimum conformance cases

Before freezing 0.3, cover: five thousand distinct same-path reads; a directory scan whose returned entries are not opened; bytes read greater than bytes returned; edit insert/delete counts; a cache hit with repeated requests; missing timestamps; concurrent siblings; an asynchronous child ending after its parent; parent cycles; subagent delegation distinct from parentage; a model observation linked to two operations; an unlinked valued observation; priced zero versus null price; all-unpriced operation capture; direct revision consumption; repeated occurrences; one revision consumed by two requests; a many-to-one summary; a transformation lineage cycle inherited from invalid context; exact signed-cost conservation; and a hook capture failure that still records/returns allow.

The shipping bar is met when an operation-only trace can explain all captured work without any token instrumentation, and enrichment with existing evidence/context produces exact model-cost conservation plus a separately labelled estimated source-exposure view.
