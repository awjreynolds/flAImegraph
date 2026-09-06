# Context capture implementation evidence

The v0.2 capture seam is implemented by `captureRequestContext` and
`captureProviderRequest`. Both functions consume caller supplied values only;
they do not contact a provider, inspect local files, discover a session, or
read a conversation transcript.

`createHarnessProfile` builds a detached, content-addressed Harness Profile.
String values supplied for the harness version, provider, and model are
retained as `declared` facts. Omitted values and policy settings stay
`unknown`. Callers that already have a fact can provide its evidence and
artifact references. Request overrides are kept on `RequestContext` and never
merged into the profile snapshot.

Generic capture accepts ordered `ContextBlockInput` records. Text is encoded
as UTF-8 and raw bytes are hashed with SHA-256; binary input uses a separate
raw-byte length method. The input buffer is copied only while deriving the
fingerprint and byte measurement and is absent from the resulting bundle.
The canonical SHA-256 for the text `abc` is
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
Caller supplied fingerprints are retained as `declared`; they are never
upgraded to `derived` without raw content. A URL or path supplied as text for
non-text media is treated as a reference, so it is not misreported as the
binary content hash. Token counts remain unavailable unless the caller
supplies a canonical per-measurement count and a non-empty method.

Source and revision identity is deterministic. A revision ID includes the
source identity, representation, media, fingerprint and measurement
semantics, while provenance references are merged separately. An occurrence
ID includes the request ID, zero-based ordinal and revision ID. Thus two
ordered appearances of one revision remain two occurrences, while captures of
the same source and revision in different requests retain their identity and
gain distinct artifact references. Equal content under different source IDs
does not merge. Replaying one capture produces the same IDs and serialized
semantics without any process-global deduplication state.

The provider adapter accepts `openai-responses`, `anthropic-messages`, and
`gemini-content` payloads through the following explicit options:

```ts
captureProviderRequest(format, input, {
  dataset_id,
  namespace,
  request_id,
  profile,
  artifact,
  producer_annotations?,
  source_annotations?,
})
```

The adapter records instructions, messages, tool definitions, output schemas,
typed text/media parts, and opaque server-state references when those fields
are present in the supplied request. Per-field JSON pointers are retained in
artifact references. Optional producer annotations can assign a stable source
ID and an origin such as `repository_file`, `skill`, or
`retrieved_document`; role and origin remain independent. The adapter accepts
`producer_annotations`, `source_annotations`, or the shorter `annotations`
alias; entries must use JSON-pointer keys and conflicting aliases fail closed.
Unsupported fields
produce an issue and downgrade request coverage to `partial`. Provider cache
configuration is not converted into occurrence cache hits, and repeated bytes
do not establish a cache treatment.

The capture bundle uses the v0.2 context artifact registry, including profile
artifacts, for every context provenance reference. Equal artifact metadata is
merged; an artifact ID with conflicting metadata fails closed. The result is
validated through the public context validator before it is returned. Context
capture does not claim that a caller supplied payload is the provider's final
assembled request unless the caller or versioned adapter supplies that
coverage claim. Transcript reconstruction and unavailable boundaries retain
their weaker coverage semantics.

Focused tests cover deterministic profile IDs, UTF-8 and binary hashes,
transient raw-content handling, unavailable and explicit token measurements,
repeated occurrences, replay and reused-source identity, declared hashes,
reference media, pointer provenance, observed request overrides, typed media,
tool/output schemas, opaque server state, unsupported-field coverage, and all
three provider payload shapes. These tests exercise the same public functions
used by downstream callers; they do not place raw conversation content in an
exported fixture or documentation artifact.

The implementation deliberately leaves provider tokenizer semantics, hidden
server-side context, cache-hit attribution, transformed-source token shares,
and complete transcript recovery unavailable unless an upstream capture
supplies explicit evidence. A content hash identifies the captured
representation, not an underlying remote object when only a URL or opaque
reference was provided.
