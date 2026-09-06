# Evidence and deterministic selection

An `EvidenceBundle` identifies a dataset and contains sources, observations, typed relationships and coverage issues. Schema version is exactly `0.1.0`. Sources identify the harness, source format/version and known capture coverage. An observation asserts activity or quantities about an execution subject; source references identify where the assertion was obtained.

## Identity

Observation IDs MUST be stable within the declared producer namespace and source identity policy. Native response/entry IDs SHOULD be preferred to file offsets where their semantics are known. A fallback source-location identity MUST be marked/documented by its adapter, and MUST NOT deduplicate separate equal-valued records. Display names, token totals and timestamps alone are not identities.

Reimport of the same evidence is idempotent. Identical observations with the same ID can merge source references. The same ID with conflicting semantic content MUST produce an explicit conflict. Generic consumers MUST NOT apply last-write-wins or prefer a source simply because it is native, OTLP or more detailed. An adapter may select the terminal update of a native streaming record only when its source contract establishes that these updates describe the same observation.

Source references MUST resolve to sources present in the bundle. Relationships reference observations; external relationships must be represented explicitly as incomplete coverage rather than fabricated local observations. Execution ancestry is distinct from `delegates`, `context_from`, `adjusts`, and evidential `corresponds_to` links. Cyclic parentage cannot define a tree and MUST be rejected for hierarchical attribution.

## Quantities and scope

Normalized `input_tokens` includes `cache_read_input_tokens` and `cache_write_input_tokens`. Those two cache categories are disjoint subsets. Their sum MUST NOT exceed known input. `reasoning_output_tokens` is a subset of `output_tokens` and MUST NOT be added again. Extra provider categories that cannot be placed in these partitions remain `unclassified_tokens`; their cost is not silently zero. This optional field's absence means no additional category was separately reported, not proof that hidden work is absent. An explicit null means an additional category exists but its quantity is unavailable. Producers MUST NOT omit a known extra category to make valuation appear complete.

A known quantity is a nonnegative integer string. `null` means unavailable, and differs from `"0"`. Missing native fields become zero only when the documented source semantics define absence as zero. Provider-native quantities MUST NOT be relabeled billed or physically consumed without evidence. An optional count basis and grain distinguish known operation, physical-attempt and session semantics; absence means unknown.

`accounting_scope` is `direct`, `aggregate`, `snapshot` or `unknown`. In v0.1, direct-only-v1 selects direct observations for valuation; the other scopes remain evidence and create coverage issues. An aggregate and its descendants MUST NOT both be charged as direct amounts. Failed/cancelled records with measured usage remain chargeable observations; failure or missing usage does not establish zero cost.

## Coverage

Each source declares `complete`, `partial` or `unknown` for its specified capture scope. This is an assertion about that scope, not the provider's hidden work. Issues preserve unknown usage, rejected/unmapped rows, omitted aggregates, missing prices and incomplete lineage. A single percent-complete figure is not defined because different dimensions generally have different or unknown denominators.

Activity and tool observations remain useful even without direct monetary charges. A tool's output can affect a later model request without itself being a priced model call. Context-source relationships record provenance; they do not assign exact billed token shares or prove usefulness.

## Work correspondence

An observation may identify a work item; explicit projection allocations can partition its amount among several work items. This does not change execution ancestry. Manual work assignments and later reassignments are valuation/report inputs and MUST be retained with the generated artifact, rather than rewriting the original source evidence. The reference projection uses the work mapping supplied for that export, not an inferred event-time ownership history.
