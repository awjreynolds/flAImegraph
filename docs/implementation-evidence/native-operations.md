# Native operation importer evidence

The public native operation seam is `importNativeOperations` in `src/native-operations.ts`.
It accepts a Codex or Pi JSON/JSONL transcript and returns an operation sidecar with
`schema_version: "0.3.0"`. The caller supplies `dataset_id` and a privacy namespace;
an optional `resource_key` makes pseudonyms stable across processes, while the default
key is deterministic and domain-separated by namespace.

The importer is metadata-only. Operation IDs are HMACs of the namespace, native
session and exact native operation identity. Resource IDs and agent IDs are HMACs;
raw paths, commands, arguments, outputs, contents and error messages are never placed
in spans, artifacts, limitations or links. Tool names are retained only when they are
safe semantic labels. `functions.exec` and unrecognised tools remain opaque `tool`
operations. A local shell or Pi `bash` operation is an opaque `command`; the importer
does not inspect its command text or infer internal file work.

Codex legacy `response_item` call/output pairs and current rollout-trace lifecycle
records are paired only by exact native call identity within a session namespace.
Pi assistant entries, v4 usage rows, extension tool-call/tool-result records and the
legacy message shape use the same rule. Results may precede calls in a partial
snapshot; the importer keeps one operation and fills the explicit start when the call
arrives. Missing IDs are dropped with a cumulative loss counter. Exact replay is
counted once; conflicting reuse of an identity throws `NATIVE_OPERATION_DUPLICATE`.
Codex `message`, `reasoning` and `agent_message` response items carry output-item
IDs, so they are omitted from execution capture unless an explicit response,
inference or request ID allows an exact merge with a model operation. Legacy
`token_count` records are accounting snapshots rather than execution spans and are
skipped with a coverage limitation; an actual compaction lifecycle remains a
`summary` operation when its native identity is present.

The importer recognises a small exact-name table for `read`, `write`, `edit`, list,
search, test and shell tools. For recognised file tools it records only structured
requested ranges and resource pseudonyms. Native transcripts do not prove backing
bytes read, so `read_bytes` remains unknown. A result's UTF-8 byte length is kept as
`returned_bytes` when the result is present; it is independent of `read_bytes`. Write
and edit byte counts are derived only from explicitly named structured fields. Every
measurement has its own evidence classification. Native wall-clock envelope
timestamps are preserved as observed timing facts; monotonic `duration_ns` remains
unknown.

An optional `EvidenceBundle` is joined only for direct model observations whose source
reference resolves to a source with the exact native input SHA-256 and the same native
line. A source without a digest cannot authorize a join. No nearest-timestamp,
model-name or payload-content association is used. Ambiguous evidence remains
unbound. The importer creates no context links because a transcript alone does not
identify a `ContextRevision` manifest.

The conformance tests in `test/native-operations.test.ts` cover Codex call/result
pairing, opaque execution wrappers, output-first records, stable IDs under replay,
conflicting identities, missing IDs, digest-gated evidence joins, normalized session
identity, contradictory error/status flags, metadata-only malformed-input privacy,
per-measurement I/O evidence, response-item and token-count lifecycle handling, Pi v4
entry and usage-row merging, and 5,000 distinct repeated reads. The sanitized input
shapes are in `test/fixtures/operations-codex.jsonl` and
`test/fixtures/operations-pi.jsonl`. The importer tests pass with the operation
schema validator and the repository test suite.

The boundary is always reported as `native_transcript` and `complete: false` because
these persisted surfaces cannot establish hidden provider retries, internal shell or
filesystem operations, transient upstream usage, billing settlement, or complete
child-thread coverage. Current Codex rollout-trace support is source-shape support;
the presence of that source schema does not assert that every installed Codex binary
emits it.
