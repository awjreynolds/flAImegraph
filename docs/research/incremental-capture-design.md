# Incremental native capture and overlap reconciliation

Status: bounded v0.2 design proposal. This document records the smallest
additional seam needed to import repeated snapshots of one append-only native
log without changing the frozen 0.1 evidence, valuation or profile contracts.
It is based on the v0.1 implementation at commit `c8c4f84` and the checked-in
Codex and Pi fixtures. It does not claim that an arbitrary pair of files is a
single log, or that a native record ID is globally unique outside its declared
producer/capture namespace.

## The current failure mode

The current source and observation identity layers intentionally use different
provenance facts, but they are coupled in the observation hash:

* `makeSource` hashes the complete input and uses the digest prefix as the
  default source ID (`src/adapters/common.ts:276-294`). An explicit
  `source_id` is still required to describe one immutable source; the source
  metadata includes the complete `sha256`.
* `observationId` hashes `source_id` and the adapter identity
  (`src/adapters/common.ts:320-322`). Therefore the same native response in
  two artifact snapshots receives different observation IDs when the default
  source IDs differ.
* `addModelObservation` puts the artifact source and a line-oriented record
  locator in `source_refs`, while using the same `identity` for the
  observation hash and native identity attributes
  (`src/adapters/common.ts:427-524`). The source reference is deliberately
  excluded from `observationContent` during merge
  (`src/core.ts:231-234`), so it is the right place to retain both artifacts
  after a canonical observation is found.
* `reconcileEvidence` merges only equal observation IDs. It unions source
  references for equal payloads and raises `OBSERVATION_CONFLICT` for a
  different payload (`src/core.ts:556-578`). Its source merge independently
  raises `SOURCE_CONFLICT` when one source ID has different metadata
  (`src/core.ts:542-554`). Reusing one explicit `source_id` for changed
  content therefore cannot solve overlap.

This is observable with the real Codex-shaped fixture: importing two prefixes
of `examples/dogfood/codex/coordinator.jsonl` without an explicit source ID
produces different digest-based source and observation IDs, so the overlap is
counted twice. Reusing one source ID instead fails source reconciliation. Both
outcomes are correct for the existing 0.1 contract; neither is an overlap
policy.

## Invariants for the new path

The opt-in v0.2 path should preserve these boundaries:

1. A source artifact is immutable. Every snapshot gets its own source ID and
   complete digest. `--source-id` remains an artifact name, not a mutable log
   or capture name.
2. A canonical observation identity is scoped to a producer and one declared
   logical capture namespace. It is derived from the adapter's existing
   identity token, not from usage values, timestamps, display names or an
   artifact digest.
3. A native response, entry, usage-row, step, span or equivalent stable ID is
   preferred when the adapter documents that it identifies one observation.
   Equal payloads without such an ID remain separate calls.
4. A line or byte coordinate may become a stable fallback only after an
   append-only prefix has been cryptographically proven. A line number from
   two unrelated fragments is never a correspondence key.
5. Repeated snapshots retain all artifact `source_refs` on one canonical
   observation. The snapshot digest, cursor and sequence do not enter the
   observation payload, because doing so would turn a valid replay into a
   conflict.
6. A changed payload under one canonical native identity remains a conflict.
   The generic merge does not silently select first, last, native or more
   detailed data. Streaming revision rules need an adapter-specific policy.
7. Parent resolution is performed after all snapshots are merged. A child
   must not conflict merely because its parent was absent from one snapshot.
   An unresolved or ambiguous parent remains hashed evidence with an explicit
   issue; no fabricated parent observation is created.

These rules are consistent with 0.1's identity requirements in
`spec/0.1/evidence.md:5-11`. The new behavior is an opt-in producer/reconciler
binding, not a reinterpretation of an existing 0.1 bundle.

## Smallest public seam

Keep `EvidenceBundle` at `schema_version: "0.1.0"`. Add a separately validated
v0.2 capture descriptor that is supplied to the adapter and capture-aware
reconciler. A context sidecar may record the descriptor, but mutable cursor
state should remain a small durable file so updating it does not rewrite an
immutable evidence or context artifact.

The shape below is illustrative; exact field spelling should be frozen in the
0.2 schema before implementation:

```ts
interface CaptureDescriptor {
  schema_version: "0.2.0";
  capture_namespace: string;       // one logical append-only stream
  harness: Harness;
  format: string;
  mode: "native_only" | "append_only_jsonl";
  sequence: number;                // monotonic producer/caller snapshot number
  snapshot: {
    sha256: string;                // complete artifact digest
    bytes: number;                  // UTF-8 byte length
    records: number;                // complete framed records
  };
  prior?: {
    sequence: number;
    prefix_sha256: string;          // digest of prior accepted bytes
    prefix_bytes: number;
    records: number;
  };
}

interface CaptureCursor {
  schema_version: "0.2.0";
  capture_namespace: string;
  harness: Harness;
  format: string;
  sequence: number;
  prefix_sha256: string;
  prefix_bytes: number;
  records: number;
}
```

`number` above is a compact sketch. The implementation should either enforce
safe integers or use canonical nonnegative decimal strings, as the 0.1
quantity fields do. Digests are SHA-256 over exact UTF-8 bytes. The cursor
contains no raw content, prompts or tool results.

The first snapshot is explicitly anchored at the empty prefix (`prefix_bytes:
0`, the SHA-256 of empty bytes, `records: 0`, sequence 0). A subsequent
snapshot is accepted only when all of the following hold:

```text
current.bytes >= cursor.prefix_bytes
SHA256(current.bytes[0:cursor.prefix_bytes]) == cursor.prefix_sha256
current.records >= cursor.records
current.sequence > cursor.sequence
```

An exact replay is allowed when sequence, byte length and complete artifact
digest all match the cursor; it produces no new canonical observations. A
caller that cannot provide a monotonic sequence must use `native_only` mode.
Without a sequence, two different longer extensions of the same prefix are
cryptographically indistinguishable, so accepting them would not provide a
general out-of-order guarantee.

The cursor advances only after the entire input has been framed, parsed and
validated. A malformed trailing line does not advance it. The next cursor
stores the current complete UTF-8 byte length and full-input digest as its
prefix digest. If the producer can emit partial writes, the parser must expose
the last complete record boundary and the cursor must stop there; it must not
pretend a partial record is part of the accepted prefix.

The capture descriptor should be carried by a `capture` field in the v0.2
context sidecar, or passed directly to the library API. It must not be hidden
in `Source.id` or in a mutable observation attribute. A practical library
surface is:

```ts
importCapturedEvidence(harness, input, importOptions, capture): {
  evidence: EvidenceBundle;       // still 0.1.0
  next_cursor: CaptureCursor;
}

reconcileCapturedEvidence(entries: Array<{
  evidence: EvidenceBundle;
  capture: CaptureDescriptor;
}>): EvidenceBundle;
```

The existing `importEvidence` and `reconcileEvidence` functions should retain
their 0.1 behavior. If the implementation instead adds optional capture data
to `ImportOptions`, it must still make the capture-aware path explicit and
must reject an append fallback that has no verified cursor. An ordinary
`reconcileEvidence` call must never infer a capture namespace from arbitrary
attributes.

## Identity derivation

The adapter needs two tokens, even if most 0.1 calls currently pass one string:

```ts
interface IdentityToken {
  adapter_key: string;              // existing prefixes such as response:, step:, tool:
  native_id?: string;               // provider/ledger ID, when present
  fallback_coordinate?: string;     // UTF-8 byte offset plus framed/nested ordinal
  basis: "native" | "append_prefix_coordinate" | "artifact_fallback";
}
```

For `basis: "native"` or a proven `append_prefix_coordinate`, the canonical
observation ID is conceptually:

```text
harness:observation:SHA256(capture_namespace + NUL + adapter_key + NUL + stable_token)
```

For `artifact_fallback`, retain the current source-scoped hash. This keeps an
unidentified record from two unrelated fragments from collapsing merely
because both happened to be line 3 or had equal usage. `adapter_key` retains
the existing category prefixes so a model record and a tool/activity record
with the same native ID stay distinct.

The native token and the canonical token must not be reused for lineage
metadata. `attachNativeIdentity` currently hashes its `nativeId` argument
(`src/adapters/common.ts:336-342`), but under this design that argument must
remain the raw/native token. If it were changed to the capture-qualified
canonical token, parent aliases from two snapshots would no longer match.
Likewise, source records remain artifact-local locators; they are never fed
into the canonical identity hash.

For append-only fallback coordinates, use byte offsets in the exact UTF-8
input and a nested write ordinal. `parseJsonInput` currently returns only a
line number (`src/adapters/common.ts:58-101`). Add a separate framed JSONL
scanner for the new mode rather than changing 0.1 line behavior. A top-level
Pi transaction can contain several writes, so its transaction line alone is
not a unique fallback coordinate. A coordinate should include at least
`record_start_byte` and `nested_write_index`; a top-level JSONL record can use
its byte offset and framed record ordinal. Pretty-printed JSON and JSON arrays
are valid 0.1 inputs but are not append-only JSONL and must use native IDs only.

## Fail-closed state transitions

The capture-aware importer/reconciler should expose distinct diagnostics. The
names are suggestions, but the conditions must remain separate:

| Condition | Required result |
| --- | --- |
| `current.bytes < cursor.prefix_bytes` | `CAPTURE_TRUNCATED`; reject the append and do not advance the cursor. This also catches an older snapshot delivered after a newer one when its sequence was omitted by a caller that uses only the lower-level validator. |
| Prefix digest differs at the stored byte count | `CAPTURE_PREFIX_REWRITTEN`; reject. Never subtract, repair or choose a last-write-wins payload. |
| Sequence is lower than or equal to the cursor without an exact full-artifact replay | `CAPTURE_OUT_OF_ORDER`; reject. |
| Current framing/parser has an invalid or incomplete row | `CAPTURE_INCOMPLETE`; retain an error-bearing diagnostic if an evidence bundle is returned, but do not reconcile or advance the cursor. |
| Record count falls despite a matching byte prefix | `CAPTURE_RECORD_REGRESSION`; reject because parser framing or format semantics changed. |
| Same native key has different semantic fields | Existing `OBSERVATION_CONFLICT` (or an adapter-specific revision error); reject authoritative merge. |
| Parent aliases match zero or several observations | Existing unresolved/ambiguous lineage issue; keep the parent hash and omit `parent_id`. |

An exact replay with a different artifact source is safe only if the bytes,
sequence and normalized payload are identical. It should merge source refs and
keep one observation. A source with the same `source_id` but a different
complete digest remains `SOURCE_CONFLICT`; the capture namespace never
weakens that invariant.

## Codex first

The Codex adapter has a clean first implementation boundary
(`src/adapters/index.ts:831-995`):

* `token_usage_record`, `response_usage` and `usage_record` use
  `nativeIdentity` and prefer `response_id` (`:868-891`). The inspected real
  capture supplies response IDs, so canonical IDs can be stable across
  snapshots without fallback coordinates.
* `event_msg.token_count` is deliberately emitted as `snapshot` or
  `aggregate` and is never direct usage (`:928-990`). It must not become a
  second direct record merely because two snapshots contain the same counter.
  If snapshot identities are eventually reconciled, use the existing
  thread/turn identity plus a snapshot sequence; do not use an arbitrary line
  offset as a response identity.
* `turn_context` is mutable parser state (`:835-858`). Snapshot provenance or
  cursor fields must not be placed in the observation payload. If a context
  row can differ between snapshots for one response, the adapter needs a
  declared revision rule; otherwise merge must report a conflict.
* Native `parent_id`/`parent_thread_id` is retained through the common helper
  and `finalizeBundle` (`src/adapters/common.ts:348-420`). In a capture-aware
  import, leave parent resolution deferred when the target may be in another
  snapshot; resolve it once the merged bundle contains every candidate.

The first Codex tests should use two prefixes of the checked-in real task
fixture and a small synthetic no-ID row:

1. Import prefix A and longer prefix B with the same dataset and capture
   namespace, distinct default source artifacts, and sequences 1 and 2.
   Reconciliation yields each direct response once, the suffix responses once,
   two sources, and two source refs on an overlapping response. It does not
   raise `SOURCE_CONFLICT`.
2. Add two distinct response IDs with identical usage and metadata. Both
   remain direct observations. Change one payload under an existing response
   ID and assert `OBSERVATION_CONFLICT`.
3. Submit a shorter snapshot, a same-length rewritten prefix, an older
   sequence, and a malformed/incomplete suffix. Assert the respective
   fail-closed diagnostics and that the persisted cursor is unchanged.
4. Put a child in one prefix and its native parent in a later prefix. The
   merged child resolves to the canonical parent once; importing the child
   alone leaves the existing hashed unresolved lineage issue.

The source and observation counts should be asserted rather than only checking
the final token sum. A sum can accidentally pass while duplicate non-model
activities or snapshots remain in the bundle.

## Pi second

The Pi adapter has two separate authority paths
(`src/adapters/index.ts:671-829`):

* v4 durable usage rows are keyed by `row.id`, `usageId`, `usage_id` or linked
  `entryId` (`:716-725`, `:773-784`). Those are the preferred canonical keys.
  Cumulative `totals` remain `snapshot` observations and remain non-additive.
* Legacy assistant messages use an entry/response ID when present and then
  fall back to `line:N` (`:795-805`). The public
  `examples/dogfood/pi/before-compaction.jsonl` has 1,003 ordered records and
  484 assistant records, but no assistant entry or response IDs in the source
  shape used for the fixture. Its fallback can therefore be reconciled only
  with a verified append-only prefix, using a byte coordinate. The checked-in
  `examples/dogfood/pi/README.md` explicitly preserves physical order for this
  purpose; that fact must not be generalized to unrelated fragments.
* v4 transaction writes are flattened by `appendPiWrite` (`:680-687`) and
  currently inherit the transaction line. The new scanner must retain a
  nested write index in the fallback coordinate, or two equal writes in one
  transaction could collapse.
* Legacy parent IDs come from the entry and v4 rows can link through
  `entryId` (`:743-767`). As with Codex, parent resolution must not be decided
  separately in each snapshot. A missing entry in one artifact is not evidence
  that its child has no parent.

Pi tests should first use `test/fixtures/adapters/pi-v4.jsonl` to prove durable
row IDs and then split the public legacy fixture at complete JSONL boundaries.
The legacy test must assert that an overlapping prefix is counted once, two
equal assistant payloads at different physical coordinates remain two calls,
and a transaction containing two equal writes keeps both nested coordinates.
Repeat the truncation, rewrite, sequence and malformed-tail tests from Codex.

## Parent and relationship normalization

`finalizeBundle` currently builds one unscoped alias map from
`native_id_hash`/`flAImegraph.lineage.native_id_hashes`, resolves a parent only
when there is one target, and otherwise leaves hashed attributes plus an issue
(`src/adapters/common.ts:348-420`). This is a sound 0.1 fail-closed rule, but
capture namespaces introduce two required adjustments in the v0.2 path:

1. Keep native alias hashes separate from canonical observation IDs. A
   capture-qualified identity must not replace the native hash used by a
   parent reference.
2. Scope alias lookup by capture namespace. The same provider-native parent
   string can occur in two independent captures. An unscoped hash that maps to
   two canonical observations must produce `lineage_parent_ambiguous`, never a
   guessed link. A scoped alias can resolve after cross-snapshot merge.

The easiest safe implementation is to extract lineage indexing/resolution from
`finalizeBundle` into a reusable post-merge operation. Capture-aware imports
should record a stable, namespaced parent-native alias and leave `parent_id`
unset until that operation runs. The operation then validates parent existence
and acyclicity through the existing core checks. This avoids a payload mismatch
in `mergeObservations`: `parent_id` is part of `observationContent`, so one
snapshot resolving a parent locally while another leaves it unresolved would
otherwise look like a conflicting observation.

OTLP/Copilot also need post-merge relationship treatment if they are enabled
for incremental mode. `importOtlp` maps spans to observations within one
bundle, then emits parent and link relationships only when both span IDs are
present in that bundle (`src/adapters/index.ts:523-669`). For the bounded first
release, either permit only stable native span IDs and defer cross-artifact
relationship rebuilding, or reject append mode for these adapters. Do not use
`traceId:index` as a cross-fragment identity.

## Impact on each existing adapter

| Adapter | Current identity/fallback | Capture-aware disposition |
| --- | --- | --- |
| Codex | Response IDs through `nativeIdentity`; token-count rows are line-keyed snapshots; native parent fields | First implementation. Native IDs use the namespace; append cursor is required for any missing-ID fallback. Keep snapshots non-additive. |
| Pi | v4 usage/entry IDs; legacy message line fallback; transaction writes share a line | Second implementation. Use row/entry IDs; use byte plus nested ordinal only after prefix proof. |
| OMP | Assistant message/response IDs where present, otherwise line; model-usage and task aggregates have their own identities; parent session/tool IDs (`:87-167`) | Native-only namespace may be added later. Do not enable append fallback until aggregate revision and parent scope rules are tested. |
| Claude | Streaming rows are deliberately revised and latest row wins inside one import (`:181-242`) | Native namespace alone is insufficient for overlapping snapshots: a later stream revision changes the payload. Require an adapter revision policy or fail on conflict; do not apply generic last-write-wins. |
| Gemini | Streaming message map selects the latest usage-bearing row (`:281-337`) | Same restriction as Claude. Native IDs can identify the message, but cross-artifact revision selection needs its own versioned rule. |
| OpenCode | `messageID:stepID` is stable where supplied; line fallback; parent IDs and aggregate session totals (`:366-419`) | Native-only first. Append fallback needs byte coordinates and a test that session totals remain non-additive. |
| OTLP | `observation_id`, then `spanId`, then `traceId:index`; parent/link relationships are built per bundle (`:523-669`) | Native observation/span IDs only until cross-artifact span coordinates and relationship rebuild are specified. Never reconcile by array index across unrelated JSON. |
| Copilot | Same OTLP path with native Copilot IDs and parent aggregate spans | Same OTLP restriction; parent aggregate usage remains non-additive. |

The adapter helper changes should therefore be additive and explicit:

* `src/types.ts`: add the v0.2 capture descriptor/cursor types and an
  optional capture input, without changing `Source`, `Observation` or the
  0.1 schemas.
* `src/adapters/common.ts`: add a structured identity result, a
  capture-qualified observation ID helper, a framed JSONL coordinate helper,
  and separate `canonicalIdentity`/`nativeIdentity` arguments to
  `addModelObservation`, `addToolObservation` and `addActivityObservation`.
  Preserve the old overload/default path exactly.
* `src/adapters/index.ts`: thread the descriptor only through Codex and Pi
  initially. Keep per-adapter prefixes and source record locators unchanged;
  mark whether each key was native or cursor-proven fallback.
* `src/core.ts` (or a new `src/capture.ts`): validate cursor transitions,
  expose `reconcileCapturedEvidence`, merge by canonical ID using the existing
  payload/source-reference rules, and run scoped post-merge lineage. Leave
  `reconcileEvidence` unchanged for ordinary 0.1 bundles.
* `src/context-types.ts`, `src/context.ts` and the `spec/0.2` context schema:
  if the context sidecar stores capture metadata, add a namespaced immutable
  capture descriptor and validate its artifact references. Keep the mutable
  cursor external or version it as a separate state object.
* `src/cli.ts` and `docs/usage.md`: add an opt-in capture import flow with
  separate `--capture-namespace`, `--capture-sequence`, cursor input/output
  and source artifact options. Refuse to write an evidence artifact when the
  cursor or parser fails. Retain the current warning that ordinary 0.1 merge
  has no overlap reconciliation.
* `src/index.ts`: export only the new validated capture types/functions as the
  public v0.2 seam.

Suggested tests live in `test/adapters.test.ts`, `test/core.test.ts` and
`test/cli.test.ts`. Add a small synthetic fixture for missing native IDs and a
multi-write Pi transaction; use the real Codex task fixture and public Pi
fixture for the end-to-end cases. No test should use equal quantities as a
correspondence proof.

## What this deliberately does not solve

This design does not derive deltas from cumulative token snapshots, assign
context or source-level token shares, infer provider billing, expose hidden
retries, or reconcile streaming revisions. It does not make one response ID a
proof of one physical provider attempt. It also cannot distinguish two
different valid branches that extend the same byte prefix unless the producer
or caller supplies a monotonic sequence; the safe mode rejects missing order
evidence rather than guessing.

The implementation should land Codex native-ID overlap first, then Pi v4 row
IDs and the cursor-gated legacy fixture. Only after those tests pass should the
other adapters opt into the namespace, each with its own revision and
relationship contract.
