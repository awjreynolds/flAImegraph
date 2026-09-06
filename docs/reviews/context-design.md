# Context-aware 0.2 design review

Review scope: `docs/context-aware-plan.md`, `src/context-types.ts`, `CONTEXT.md`, and the frozen 0.1 evidence and valuation semantics. This review covers the proposed context contract and report/allocation seam. It does not propose changes to the 0.1 valuation or speculative forecasting features.

## Result

The model has the right primary separation: origin, representation, media, role, placement and treatment are independent; sources, revisions and ordered occurrences have different identities; profiles are snapshots; and context allocation is an estimate beside the exact valuation. The implementation should proceed after the invariants below are made normative. Without them, valid-looking 0.2 records can double-allocate one monetary line, overstate profile and request facts, or produce different IDs across languages.

## Typed-axis assessment

Each axis should answer only one question:

| Axis | Meaning | Required boundary |
| --- | --- | --- |
| origin | where or why the material entered context | `tool_schema` and `output_schema` are useful distinct origins; do not infer message role from them |
| representation | how the source material was represented | original, excerpt, truncated, summary, opaque or reference; transformation lineage explains changes |
| media | the content carrier | text, structured data, image, audio, video, document or unknown; it does not imply tokenizer support |
| role | the request-envelope role | system, developer, user, assistant, tool or unknown; it does not establish origin |
| placement | where the occurrence sat in assembly | instruction, history, current turn, tool result, tool definition, attachment, server state or unknown |
| treatment | what processing/cache treatment was evidenced | independent from repetition, origin and representation; a repeated occurrence is not proof of a cache hit |

`tool_schema` should be removed from `ContextRepresentation`. It duplicates an origin and breaks the stated independence: one tool schema can itself be original, truncated, opaque or a reference. Represent it with `origin: "tool_schema"`, usually `media: "structured"`, and the actual representation value. Apply the same rule to `output_schema`: its new origin is appropriate and does not require another representation value.

Do not derive one axis from another during validation. Unusual combinations can be real after harness assembly. Cache treatment in particular must have occurrence-level evidence; a profile's declared caching policy, repeated content or a provider aggregate cache token count cannot establish that a particular occurrence was a cache read or write.

## Required contract corrections

### [P1] Select one request boundary per valued observation before allocating cost

`RequestContext.observation_id` is correctly nullable, and more than one request record may reasonably refer to one observation: a final client request, a harness view and a transcript reconstruction can coexist. `ContextAllocation`, however, has no selection field beyond `request_id` and `observation_id`. Allocating every linked request would copy the same valuation line more than once.

Make allocation request selection explicit in `createContextReport` options. An allocatable request must:

- be explicitly named for allocation and have a boundary other than `unavailable`;
- have a non-null observation binding that resolves in the evidence bundle and to exactly one selected valuation line with a non-null amount;
- be the only selected request for that observation;
- use the exact amount, currency and basis already present in that valuation line, without revaluing or modifying the supplied valuation.

Prefer a `client_request` when it is available. A harness context or transcript reconstruction may be explicitly selected for a partial estimated allocation, but it retains its actual boundary and coverage and adds an assumption explaining that it is not the final client payload. Retain unlinked requests and non-selected boundaries in the context report without allocating them. Reject duplicate selected bindings rather than choosing by array order. `ContextAllocation.amount_nanos` should be named or documented as `selected_request_cost_nanos`; it includes the complete selected monetary line, including any output component. It must never be described as input cost, source billing or causal savings.

The report must preserve the supplied evidence and valuation semantically unchanged. Its monetary summary is the valuation's exact selected known subtotal. Allocation rows are a separate estimated view and must not be added back into that subtotal.

### [P1] Define the conserving allocation algorithm over the observed inclusive-input denominator

The intended method is sound if its denominator and failure cases are exact. For each selected request, use the linked observation's known `usage.input_tokens` as the denominator. This is inclusive input under 0.1: cache-read and cache-write quantities are subsets and must not be added again. Use only occurrence token measurements whose values are non-null, canonical nonnegative integers and whose evidence is `observed`, `derived` or `estimated`. Exclude `counterfactual` and `unavailable` measurements. Record the included methods and evidence classes as assumptions.

Repeated occurrences each contribute weight because they represent repeated exposure in one request. A revision merely present as a transformation ancestor contributes nothing unless it is also an occurrence in the selected request. A summary receives its own weight; its weight is never distributed back to source revisions.

Let `D` be observed inclusive input, `W` the sum of eligible occurrence weights and `U = D - W`. If `W > D`, fail allocation with an overfull-measurement error. If `D` is unavailable or negative, omit or fail the allocation with an explicit incoherence issue; do not invent a denominator. If `D = 0` and `W > 0`, fail. If `D = 0`, `W = 0` and the selected line is an output-only nonzero cost, retain the entire amount as unallocated with no portions; there is no input-weight denominator for distributing it. Treat positive `U` as an explicit unallocated bucket. Allocate the signed absolute nano-cost across every occurrence weight and `U` using exact integer arithmetic and largest remainders, with a specified code-unit lexical tie-break; then restore the sign for credits. Require:

```text
sum(portion.amount_nanos) + unallocated_nanos = selected_request_cost_nanos
sum(portion.weight_tokens) + unallocated_weight_tokens = observed_input_tokens
```

Expose `denominator_tokens` and `unallocated_weight_tokens` on the allocation so conservation can be independently checked. `allocated_nanos` must equal the portion sum. A zero-cost line may produce zero-valued portions, but it does not make missing context complete.

### [P1] Give every profile fact fact-level provenance

`HarnessFact` distinguishes observed, declared and unknown values, but `HarnessProfile.harness_version`, `model.provider` and `model.name` are currently bare nullable strings. They can therefore look authoritative without saying whether they came from a captured request, configuration or a profile author's expectation. The same problem applies to profile identity claims if `profile_version` is confused with a detected harness version.

Represent harness version, provider, model name and each model setting as facts, or give each field an equivalent evidence and source-reference envelope. Enforce `unknown => value: null`; an observed or declared fact must have a non-null value and supporting references appropriate to its evidence class. A missing version or policy remains unknown and must not be filled from the current adapter's defaults.

Define the configured-versus-observed vocabulary precisely. If `declared` means a value read from or supplied as configuration, rename it to `configured` or state that meaning normatively. A vendor/documentation declaration is a different claim and must not silently become the effective configuration. Template policies with no evidence default to unknown.

A profile is an immutable, content-addressed snapshot of base configuration and capabilities. A request references that snapshot and records actual request overrides separately in `RequestContext.overrides`. Validation must not merge overrides back into the profile. The report may show an effective value only as a projection that preserves both the base fact and override fact; an observed override wins for that request, while a declared override remains declared rather than becoming observed.

Profile instruction and tool entries should reference immutable context source/revision snapshots where known. A tool name or instruction label alone is not proof of the exact delivered definition. A tool definition hash also needs evidence and method provenance, just like a content fingerprint. `context_capabilities` rows likewise need evidence and source references: `capture: "direct"` is a factual capability claim, not self-proving profile metadata.

### [P1] Separate context-artifact references from 0.1 evidence references

Every measurement correctly carries its own source references, but all context fields reuse the untagged 0.1 `SourceRef`. At the same time, `ContextBundle.artifacts`, `HarnessProfile.artifacts` and `EvidenceBundle.sources` are separate `Source[]` collections. The same `source_id` can therefore resolve to different records, or a consumer can silently resolve it against the wrong collection.

Use one bundle-owned context artifact registry and remove embedded duplicate `HarnessProfile.artifacts`, replacing it with artifact IDs. Give context provenance a tagged reference such as `{ namespace: "context_artifact" | "evidence_source", source_id, record }`, or normatively restrict all context `source_refs` to the context artifact registry and use `observation_id` for the 0.1 join. Do not rely on globally unique strings across unnamespaced collections. Duplicate artifact IDs must merge only when their semantics are identical; conflicts fail.

The provenance of `content_sha256` also needs its own evidence class and method. A supplied hash is not automatically observed. If the SDK receives raw bytes, it can derive SHA-256 and UTF-8 byte length locally and then discard the bytes. If it receives only a claimed hash, retain that weaker provenance. `identity_basis: "content_fingerprint"` requires a non-null, sufficiently evidenced fingerprint; `producer` requires a producer identity reference; `unknown` remains explicit.

### [P1] Specify language-neutral identities and reconciliation

The contract requires idempotent merges and ordered repeated occurrences, but it does not yet define IDs. Specify canonical JSON and hashing as part of 0.2, including UTF-8 encoding, object-key ordering by Unicode code units, array ordering, omission versus null, canonical integer strings, JSON-number serialization for profile facts, and no locale collation or implicit Unicode normalization. Use strings when a numeric setting needs precision beyond the cross-language number rule. Otherwise JavaScript, Python and Rust producers can hash the same record differently. Conformance fixtures should include composed `é` and decomposed `e` plus combining acute accent as distinct IDs.

A practical deterministic identity scheme is:

- source ID: producer identity, or a fingerprint identity scoped by producer/artifact namespace and origin when provenance is unavailable;
- revision ID: hash of source ID, representation, media, content fingerprint and measurement semantics;
- request ID: producer request identity or a hash of the capture boundary and immutable capture identity;
- occurrence ID: hash of request ID, zero-based ordinal and revision ID;
- transformation ID: hash of kind, ordered or canonically sorted endpoint IDs as the contract declares, evidence, method and source references.

Including the ordinal makes two appearances of one revision distinct. Including request identity makes replaying the same capture idempotent. A content fingerprint must not globally merge identical bytes from different origins or producer namespaces; equal content alone does not establish equal provenance. Reconciliation must compare the full semantic payload for any repeated ID, merge only exact-compatible records and source references, reject rewritten prefixes, and never treat an overlapping incremental snapshot as another request. Array order is semantic for request occurrences and must be preserved; collection order elsewhere must not alter identity.

### [P1] Make measurement evidence and units mutually consistent

`ContextMeasurement` permits every combination of nullable value and evidence class. Define these invariants:

- `unavailable` requires `value: null`; every other evidence class requires a canonical nonnegative value;
- `observed` means the value was reported or captured for the stated boundary and unit, not that it was billed by a provider;
- `derived` means a deterministic method was applied to captured material or another cited measurement;
- `estimated` states an approximation; `counterfactual` states a hypothetical value and is excluded from actual allocation;
- `method` is a versioned method identifier, with tokenizer name/version and rendering assumptions for token counts;
- source references resolve and support this particular measurement, rather than only the containing revision.

A local tokenizer count of captured text is normally `derived`, not observed provider input and never observed billing. Agreement with an aggregate does not upgrade its evidence class. Token measurements combined in one allocation must declare compatible counting semantics, or the report must retain the mismatch as an estimation assumption and fail when their sum exceeds observed inclusive input.

The `characters` unit is cross-language ambiguous because implementations count UTF-16 code units, Unicode scalar values or grapheme clusters differently. Replace it with a precise unit such as `unicode_scalars`, or normatively define its counting algorithm and add Unicode fixtures. `utf8_bytes` should always mean the byte length of the exact captured representation.

### [P2] Keep capture boundaries and coverage claims evidence-backed

The generic capture SDK should consume explicitly provided request blocks, calculate permitted fingerprints and byte measurements, and emit no raw content. Supplying blocks does not prove that the caller supplied the provider's final payload. Default generic capture coverage to `unknown` or `partial` unless a versioned adapter can evidence completeness at the named client-request boundary. Coverage itself needs evidence and source references.

`transcript_reconstruction` must always remain partial or unknown and must not claim `client_request`, final payload or hidden server state. Locally reconstructed instructions, messages and tool results can still be useful revisions and occurrences. An absent final request manifest is `unavailable`, not an empty complete request; an unavailable request has no occurrences and cannot be selected for allocation.

`ContextBlockInput.content` supports exact local handling of text and structured text. For image, audio, video and document media, either accept raw bytes transiently or require a caller-supplied fingerprint and byte measurement with their real provenance. Do not hash a textual path, URL or base64 spelling and describe that as the attachment's content hash unless that representation is explicitly what was captured.

### [P2] Constrain transformation lineage without inventing attribution

Every transformation endpoint must resolve to a revision, endpoint lists must be nonempty and duplicate-free, and self-edges or transformation cycles must fail. Add a versioned method and per-transformation provenance so an inferred transcript relationship remains distinguishable from an observed harness event.

A one-source truncation can create a new revision of the same source. A merge, compaction or summary over multiple sources should create a new source/revision when assigning one original source would imply false ownership. Multiple input revisions may lead to one output revision, but that does not assign token shares to the inputs. Source revisions remain immutable; a transformed payload never overwrites its predecessor.

Role and placement should remain independent and should not be forced into a brittle validity matrix. A server-held system instruction and a tool result carried in history are legitimate combinations. Validation should reject structurally impossible references, while unusual semantic combinations can remain explicit and issue-bearing.

### [P2] Split report completeness into assessable claims

`ContextReport.summary.complete` is ambiguous: it could describe valuation completeness, context capture coverage or allocation coverage. Expose these separately, for example `valuation_complete`, counts by request coverage/boundary, and `allocation_complete` or an allocated/unallocated total. Rename or define `known_cost_nanos` as the exact selected valuation subtotal; it is not proof of total expenditure when the 0.1 valuation is incomplete.

Report issues should say which layer they affect. A partial transcript does not make an otherwise exact valuation arithmetically incomplete, and a complete client-request manifest does not prove invoice completeness.

## Worked scenarios

### Output-inclusive selected request allocation

A selected valuation line is 101 nanos and the linked observation reports 100 inclusive input tokens. Two actual request occurrences carry eligible weights 30 and 20. A counterfactual 10-token revision and an unavailable measurement are excluded. The residual weight is 50. Largest remainders allocate 30 and 20 nanos to the occurrences and 51 nanos to `unallocated`:

```text
selected_request_cost_nanos = 101
denominator_tokens          = 100
eligible weights            = 30 + 20
unallocated weight          = 50
allocated_nanos             = 50
unallocated_nanos           = 51
conservation                = 30 + 20 + 51 = 101
```

The 101 nanos may include output cost. The result describes an estimated distribution of selected request cost by input-context weight; it does not say the first source was billed 30 input nanos. If the eligible weights sum to 105, allocation fails instead of normalizing away the contradiction.

### Multiple boundaries and nullable bindings

Observation `call-7` has one final client request, one harness-context snapshot and one transcript reconstruction. All remain visible, but options select only the final client request for allocation. Selecting both the final request and reconstruction for `call-7` fails as a duplicate monetary binding. A transcript request with `observation_id: null` remains a useful partial context record and receives no monetary allocation.

### Compaction without backward token attribution

Source revisions A and B contain 60 and 40 locally derived tokens. A compaction transformation produces summary revision S with 25 tokens. A later request contains only occurrence S. Its eligible weight is 25; A and B receive no occurrence weight and no share of S. The report can navigate S back to A and B through transformation lineage without asserting that S contains 15 tokens from A and 10 from B.

### Profile snapshot with an observed override

Profile P declares model `model-a`, temperature `0.2` and an unknown harness version. Request R references P and records an observed model override `model-b` from the captured client request. The profile remains unchanged. The report displays declared base `model-a`, observed request override `model-b`, and effective request projection `model-b`, retaining both provenance trails. It does not infer a harness version from the adapter package installed during analysis.

### Generic capture versus reconstruction

A client adapter is explicitly handed final text blocks. It computes content SHA-256 and UTF-8 bytes, then discards raw text. Token measurement remains unavailable unless the caller supplies a count with an explicit evidence class and versioned method. The adapter's completeness claim is limited to its client-request boundary, and unsupported or opaque request fields keep it partial. A local transcript adapter later reconstructs similar messages but lacks assembled instructions and tool schemas; it emits partial transcript reconstruction. Matching hashes or token totals do not promote the reconstruction to a final client request.

## Minimum conformance cases

Before freezing 0.2, cover: nullable and dangling observation bindings; two selected requests for one valuation line; null, zero, counterfactual and mismatched measurement evidence; inclusive-input overfill; output-only and signed-cost allocation; largest-remainder ties; repeated occurrences; identical replay and overlapping incremental snapshots; rewritten prefixes; summary lineage without backward allocation; conflicting artifact namespaces; unknown profile versions; observed overrides; transcript coverage limits; binary attachments; and locale-independent identities with Unicode-equivalent strings.

With these corrections, the proposed model can explain context composition and transformation history while leaving the 0.1 monetary artifact exact, immutable and clearly separate from estimated allocation.
