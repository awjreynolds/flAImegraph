# Operations core v0.3 independent review

Review scope: `src/operation-types.ts`, `src/operations.ts`, `src/operation-export.ts`, `spec/0.3/schemas/operations.schema.json`, and `test/operations.test.ts`. Recorder/native import, CLI and viewer behavior are outside this pass except where a core contract assumption depends on them.

## Result

**Approved after corrections.** The implementation preserves the main architectural separation: execution paths use only recorded parentage, direct valuation lines contribute once, charge and credit magnitudes remain separate, unbound/unknown costs remain visible, and the source view reuses conserving v0.2 allocations rather than changing the valuation.

The findings below were reproduced with independent edge fixtures, corrected, and rechecked.

## Findings

### Resolved [P1] — Source cost could be assigned to a producer without a recorded consumption link

Locations: `src/operations.ts:124-137` and `src/operations.ts:186-198`.

The report validated `consumes_context` links when they existed, but source-cost construction did not consult them. For each allocation portion it looked only for a `produces_context` link for the revision. I supplied a producer link, a valid selected v0.2 allocation, and no consumption link at all. `createOperationReport` still emitted an `estimated_source` sample under the producer operation.

This makes a typed consumption link optional precisely where the projection claims to show information flow. It can project cost back to a file even when the operation sidecar did not record that the bound model operation consumed that request occurrence.

The correction indexes validated request/occurrence consumption links and attaches a producer operation path only when that exact occurrence was recorded as consumed. A missing consumption link retains the context allocation and source identity but leaves `operation_ids` empty, so cost still conserves without inventing a producer path. The regression now removes all consume links and verifies this result.

### Resolved [P1] — One evidence flag could not describe independently nullable I/O measurements

Locations: `src/operation-types.ts:6-24`, `src/operations.ts:28-43`, and the I/O object in `spec/0.3/schemas/operations.schema.json`.

`OperationIO.measurements` supplied one evidence/method pair for read bytes, returned bytes, written bytes, inserted bytes, deleted bytes, entry counts, examined entries, and the content hash. Validation did not relate the envelope to the values. A `file_read` with `measurements.evidence: "unknown"`, `read_bytes: "10"`, and every other quantity null was accepted.

Real capture also mixes methods: bytes read may be reported by a filesystem call, returned bytes derived from the returned buffer, edit counts derived from a patch, and a hash locally derived while another measurement remains unavailable. One record-level flag either overstates the null fields or understates the known ones.

The correction gives every I/O field its own evidence/method entry, with provenance resolved through the owning span, and validates null exactly when that field's evidence is unknown. The hostile mixed-evidence fixture now fails. `entry_count` should be documented as returned entries in the prose specification so independent producers do not confuse it with `examined_entries`; this naming clarification does not block the corrected runtime semantics.

### Resolved [P1] — Reconciliation double-counted cumulative dropped spans across overlapping snapshots

Locations: `src/operations.ts:77-101`; the live recorder supplies its cumulative dropped count in `OperationRecorder.snapshot()`.

Exact replay was deduplicated by canonical bundle identity, but two overlapping snapshots were different bundle objects. Reconciliation summed both `coverage.dropped_spans` values. A first snapshot with one dropped span and a later snapshot from the same stream with the same prior drop plus one new retained span merged to `dropped_spans: 2`.

The correction defines cumulative per-stream loss counters, requires their exact sum to equal `dropped_spans`, and merges each named stream by its maximum. The overlapping replay fixture now retains one dropped span. A producer must therefore give independent streams distinct IDs; the stream ID is part of the loss-counter scope as well as the sequence scope.

### Resolved [P1] — A partial native transcript could claim complete operation coverage

Locations: `src/operations.ts:23-27` and `spec/0.3/schemas/operations.schema.json:652-684`.

The validator only rejected `complete: true` when `dropped_spans > 0`. It accepted `boundary: "native_transcript"`, `complete: true`, no limitations, and a supporting artifact whose own coverage was partial. That contradicted the stated boundary: a native transcript or one opaque shell operation does not establish that its internal file work was completely captured.

The correction permits complete operation coverage only for an instrumented boundary backed by complete artifacts and no dropped spans. Native-transcript and partial-artifact complete claims now fail.

### Resolved [P2] — Self-delegation and self-dependency links were accepted

Locations: `src/operations.ts:44-55`.

Execution self-parentage was rejected through the cycle check, but `{kind: "delegates", from_operation_id: X, to_operation_id: X}` and the corresponding `depends_on` link validated. These edges cannot describe useful delegation or dependency and make overlay traversal cyclic at one node. The validator now rejects both self-edge forms. It continues to keep dependency/delegation edges separate from execution ancestry.

### Resolved [P1] — Link and timing provenance were not enforceable in standard exports

Locations: `src/operation-types.ts`, `src/operations.ts`, `src/operation-export.ts`, and the matching 0.3 schema definitions.

The initial link shape had evidence and a method but no artifact references. Timing values had no evidence, method, or clock basis, and Trace labelled every non-null `duration_ns` as measured monotonic elapsed. This could upgrade a declared or derived external duration to an observed measurement, while a typed context/delegation edge could not cite the record supporting it.

The correction requires resolvable source references on every link. Start, end, and duration now have independent evidence/method facts; duration also records `monotonic`, `wall`, or `unknown` clock basis. Validation enforces null exactly for unknown timing and rejects a running span with an end time. Trace carries the original timing and parentage facts and uses the declared duration method/evidence/clock instead of upgrading them.

## Export assessment

The exporters recompute and validate the embedded report before use. Folded and pprof monetary samples select positive charges or credit magnitudes without dropping the opposite sign into the same width. Pprof checks its signed-int64 total. Operation-count folded output emits one self-count for every captured operation, so zero-priced and unpriced operations remain inspectable in a separate projection. The CLI export set includes the exact JSON report and a checksum manifest alongside the lossy standard formats.

Frame text is percent-encoded before entering folded/FlameGraph syntax, and opaque IDs are represented by a digest rather than raw path identifiers. The renderer uses argument arrays and stdin rather than a shell. The tested hostile label does not inject SVG markup. Trace export retains raw display labels and the full I/O descriptor by design; privacy therefore depends on the producer's explicit choice to place a raw path in `resource_label`, while the bundled recorder defaults to opaque labels.

One limitation should remain explicit in the export documentation: folded/pprof stacks do not carry parentage evidence per edge. Chrome Trace now includes the parentage and timing evidence/method facts, while the companion operation report remains authoritative for complete provenance. Bare folded or pprof files must not be treated as proof that every displayed edge was natively observed.

## Independent verification

- `node --import tsx --test test/operations.test.ts`: 10/10 pass after corrections.
- Targeted strict TypeScript check for `operation-types.ts`, `operations.ts`, and `operation-export.ts`: pass. The repository-wide typecheck was temporarily unavailable because a parallel native-import file outside this review contained an in-progress syntax error.
- Five additional edge fixtures now pass after initially reproducing the findings: absent consume link remains conserved with no producer path; contradictory per-field I/O evidence is rejected; complete partial-transcript coverage is rejected; self-delegation is rejected; cumulative dropped count remains one across overlapping snapshots.
- `git diff --check` for the reviewed implementation files: pass.
