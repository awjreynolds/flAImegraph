# Append-only native capture state

Version `0.2.0` adds an opt-in capture seam for Codex and Pi JSONL streams. The
seam is `advanceCapture(input, options, previous?)`. It consumes one complete
JSONL snapshot and returns a detached `CaptureState`; the state stores only
source metadata, cursor proofs, immutable snapshot descriptors, and the merged
Agent Cost Interchange evidence bundle.

## Capture contract

`CaptureOptions` requires `harness` (`codex` or `pi`), `capture_namespace`, and
`dataset_id`. The ordinary adapter settings `version`, `agent_id`, and
`work_item_id` may be supplied and are frozen when the stream starts. A caller
may supply a decimal `sequence` for each snapshot. Sequence values must be
canonical non-negative integer strings.

`source_id` is not a capture option. Capture artifacts always use the adapter's
digest-derived source ID; supplying `source_id` or another unknown option is
invalid.

The first snapshot is an anchor. Its UTF-8 byte length, SHA-256 digest, and
number of non-empty physical JSONL frames become the cursor. The input must
contain only complete JSON objects, and the adapter must not report an error.
The raw input is never put in the state.

Every later snapshot must contain the exact persisted UTF-8 prefix. The capture
path checks the prefix digest and byte length, checks that complete-frame count
does not decrease, and parses the whole candidate before changing state. A
shorter input, rewritten prefix, malformed or incomplete frame, and semantic
adapter error all fail before state mutation. A content extension must have a
sequence greater than the cursor sequence. When no sequence is supplied, the
next sequence is the previous sequence plus one. A byte-identical replay is
idempotent and does not add another descriptor. A caller supplied sequence is
required when it needs to distinguish two possible branches that extend the
same prefix; the byte proof alone cannot identify which branch was captured
first.

Each accepted artifact keeps its normal digest-derived `Source.id` and full
SHA-256. Observation IDs are re-keyed under the capture namespace, while native
identity hashes remain in lineage attributes and source references retain the
artifact and record coordinates. Native IDs are preferred. When an adapter has
no native ID, a physical prefix coordinate is trusted only because the cursor
proved that the earlier bytes are unchanged. Pi v4 transaction writes include
their nested ordinal in that coordinate, so equal writes on one physical line
remain separate observations. Payload equality is never used as identity.

Parent aliases are resolved after the current snapshot has been merged with
the prior evidence. A child in an early prefix can therefore resolve when its
native parent appears in a later prefix. Ambiguous, cyclic, and still missing
aliases remain hashed with an explicit coverage issue. The capture namespace
scopes canonical IDs and alias lookup, so a native provider identifier from a
different stream cannot silently become a parent here.

The capture seam deliberately does not claim support for OMP, Claude, Gemini,
OpenCode, OTLP, or Copilot. Their ordinary v0.1 importers remain available;
they require adapter-specific stream revision and retry contracts before an
append-only cursor can be trusted.
