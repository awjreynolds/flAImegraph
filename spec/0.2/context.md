# Context and Harness Profiles 0.2.0

**Status: experimental.** Version 0.2.0 records the context made available to a model request and the Harness Profile that describes the producing runtime. It composes with the frozen 0.1 evidence, valuation and profile contracts. A consumer MUST reject an unsupported required version or semantic rather than silently interpreting it as 0.1.

The machine-readable definitions are [context.schema.json](schemas/context.schema.json) and [harness-profile.schema.json](schemas/harness-profile.schema.json). The reference validators are `validateHarnessProfile`, `validateContextBundle` and `reconcileContextBundles`; they return detached values and do not read files, inspect a provider session or make network calls.

## Artifact registry and provenance

An exchange has a logical Context artifact registry. It is the union of the bundle's `artifacts` and every embedded profile's `artifacts`. Duplicate artifact IDs MUST have identical metadata. A standalone Harness Profile resolves its references against its own `artifacts`; an embedded profile may resolve them against the logical union. Context source, revision, measurement, treatment, request, override and transformation references MUST resolve to that registry. A reference is a pair of an artifact ID and an opaque producer record string. The validator never falls back to `EvidenceBundle.sources` for these references.

Profile artifacts make a profile portable. They describe the producer record that supports a profile fact, instruction source, tool, capability or policy. A `HarnessFact` keeps its value and evidence together:

- a non-null value has `declared` or `observed` evidence;
- a null value has `unknown` evidence; and
- an observed fact MUST carry at least one source reference. A declared fact MAY have an empty reference list when the producer is making an explicit declaration.

The same unknown discipline applies to measurements and capture classifications. A measurement has an exact non-negative digit string or a null value with `unavailable` evidence. `0` is a measured or derived zero only when its evidence says so; unavailable data MUST NOT be rewritten as zero. Token measurements use `tokens`; byte measurements use `utf8_bytes`. Each measurement retains its own method, evidence and references.

## Harness Profile

A Harness Profile is immutable configuration identified by `id` and `profile_version`. It records the harness, a `HarnessFact` for the harness version, `HarnessFact` values for model provider and model name, settings, instruction sources, tools, assembly/truncation/compaction/caching policies, context capabilities and portable artifacts. Configured facts and observed facts remain distinct. Unknown model versions, policies and capabilities remain unknown; a validator does not infer them from a harness name.

Instruction source origin, delivery, evidence and provenance are separate fields. Tool definition identity is an optional SHA-256 fingerprint with an explicit definition evidence class and method. A missing definition fingerprint is represented by a null fingerprint, unknown evidence and a null method. Capabilities have an origin, a capture class (`direct`, `reconstructed`, `unavailable` or `unknown`), evidence, references and an explanatory note. `output_schema` is a distinct origin from `tool_schema`.

## Context sources, revisions and occurrences

A `ContextSource` identifies an origin such as a system or developer instruction, user input, repository instruction or file, retrieved material, tool result or schema, conversation history, assistant output, memory, delegated context or attachment. The origin, its evidence and the identity basis are independent fields. `unknown` means unknown; it does not authorize a guessed class.

A `ContextRevision` is one representation of a source. It records whether the representation is original, an excerpt, truncated, summarized, opaque or a reference, and separately records media. A content fingerprint has explicit evidence and method: unknown fingerprints use a null hash and null method, while declared or derived fingerprints require both. Truncation and summarization do not overwrite the source revision.

A `ContextOccurrence` places a revision in one ordered request. Its role, placement and treatment are independent. Treatment is explicitly `fresh`, `cache_read`, `cache_write`, `mixed` or `unknown`, with its own evidence, method and references. Repeated occurrences are retained as repeated exposure. Repetition does not establish a cache hit, and the validator does not infer cache treatment from origin, placement, token counts or repeated IDs.

## Request boundaries

A `RequestContext` records a profile, an optional evidence observation, a capture boundary, coverage and ordered occurrences. The boundaries have distinct meanings:

- `client_request` is the final request sent by a client;
- `harness_context` is the context assembled by the runtime;
- `transcript_reconstruction` is a reconstruction from a transcript or related evidence; and
- `unavailable` records that the boundary was not captured.

Only `client_request` and `harness_context` may claim `complete` coverage. Transcript reconstruction and unavailable boundaries MUST remain `partial` or `unknown`. Coverage evidence is separate from coverage. A request may be prepared with `observation_id: null`; an absent final request capture stays unavailable rather than being synthesized from local text counts.

When an `EvidenceBundle` is supplied to validation, a non-null request observation link MUST match the bundle dataset and a known model observation. A tool or activity observation is not a request usage link. Multiple named boundary requests MAY reference the same model observation; a report or allocator that selects a cost view MUST choose at most one boundary for a given valued observation. This keeps boundary evidence available without allocating the same selected cost twice.

Request overrides retain effective per-request facts and their references. Their references resolve against the logical union, including artifacts embedded in the request's profile. An override does not rewrite the profile's declared configuration.

## Transformations

A `ContextTransformation` records an explicit lineage edge from one or more source revisions to one or more output revisions. Its kind, method, evidence, optional observation link and artifact references remain visible. All revision IDs MUST resolve, and the directed transformation graph MUST be acyclic. A summary or compacted revision does not receive an inferred attribution to every ancestor; no token count or monetary amount is automatically spread from an output to its inputs.

## Reconciliation

`reconcileContextBundles` accepts one or more bundles with the same dataset and validates each one before merging it. Entity IDs are unique within a bundle. Replaying an entity with the same semantic content is idempotent. Provenance references are unioned and deduplicated, while order-bearing arrays—especially request occurrences—are retained in their declared order. Replaying a request with two occurrences therefore retains two occurrences.

An entity with the same ID but different semantic content fails closed. This includes a changed Harness Profile configuration under the same profile ID, a changed revision measurement or fingerprint, and a changed request occurrence sequence. Artifact metadata conflicts also fail closed. Reconciliation orders non-order-bearing top-level entity arrays by their opaque IDs using a deterministic UTF-16 code-unit comparison; it does not use locale collation and does not sort occurrences or other order-bearing arrays. The resulting object keys and provenance reference sets are deterministic regardless of input bundle order.

Structural schema validity is necessary but not sufficient. A conforming producer and consumer MUST preserve unknowns, provenance, boundary semantics, transformation lineage and the separation between observed usage and any later estimated context cost allocation.
