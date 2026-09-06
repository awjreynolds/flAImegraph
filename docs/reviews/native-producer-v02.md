# Native context and independent producer v0.2 review

Review date: 2026-09-06

Scope: `src/native-context.ts`, `test/native-context.test.ts`,
`docs/implementation-evidence/native-context.md`,
`tools/context-producer-python/producer.py`, `test/context-producer.test.ts`,
`examples/context/independent-producer-report.json`, and the native public export
in `src/index.ts`. The already approved core context, request-capture, report and
incremental-capture implementations were treated as dependencies rather than
re-reviewed. The public 32-row Pi report was checked after its separate handoff.

Verdict: **approved after corrections**. Codex reconstruction remains explicitly
unavailable. Pi now binds every direct observation to an exact native row, uses
only the target response's preceding ancestry, preserves branch isolation and
unknowns, labels native summaries honestly, requires an exact source digest,
exports no raw text, and gives effective model/provider overrides row-level
provenance. The independent Python producer is a valid, genuinely separate
producer of the v0.2 context/profile contract, and its published report is an
exact detached rendering of its current output.

## Findings

### Resolved High — Pi v4 transactions were joined by physical line instead of durable usage identity

Locations: `src/native-context.ts`, in transaction flattening, the Pi entry/usage
index, and direct-target selection.

A Pi v4 transaction can commit several entries and usage rows on one JSONL line.
The initial implementation grouped records by that physical line and selected
the first message-like candidate. A counterexample containing two independent
user/assistant branches and two linked usage rows on one transaction line
produced two direct evidence observations, but both reconstructed requests had
unknown coverage, zero occurrences and no model override. Native transaction
ordinals also started at `0`, `1` while the adapter's established coordinates
were `0.0`, `0.1`.

The correction mirrors the adapter's recursive ordinal construction, indexes
durable usage by the identity encoded in the observation source reference, and
then follows that row's `entryId`. An explicit but absent usage identity now
fails closed as an unavailable row; it cannot fall back to another write on the
same line. The two-branch regression returns one prompt occurrence per request
and the correct per-response provider/model values.

### Resolved High — Pi v4 model and provider override pointers named the usage row that did not contain them

Location: `src/native-context.ts`, override extraction.

For a normal v4 stream with an assistant entry on one row and its durable usage
on another, the implementation correctly read `model` and `provider` from the
linked assistant entry but marked them observed through the usage-row source
reference. That row contained neither value, so the effective overrides could
not be independently audited.

Override provenance now points to the exact linked entry coordinate while the
request itself retains the usage observation reference. The shared-transaction
regression also proves the nested entry coordinates independently for both
overrides.

### Resolved High — a cyclic Pi parent chain could include the current response in its own input context

Location: `src/native-context.ts`, parent-chain traversal.

With assistant `a` parented to user `u` and `u` parented back to `a`, traversal
initially appended `a` as an ancestor before detecting the next repeated edge.
The resulting request contained an assistant occurrence for its own current
response, despite also reporting an ancestry-cycle warning.

Traversal now seeds its visited set with the target entry. Cycles remain explicit
coverage issues, but the target response can never enter the reconstructed
ancestry. The regression checks the absence of the target's context source as
well as the cycle issue.

### Resolved High — source matching was bypassed when the Evidence Source omitted its digest

Location: `src/native-context.ts`, source-artifact verification.

The Evidence Source schema permits an omitted `sha256`, and reconstruction
initially returned early in that case. Removing the digest from a valid Evidence
Bundle and supplying unrelated transcript bytes was therefore accepted; line
coordinates from the evidence could be resolved against a different artifact.

Native reconstruction now requires a selected source SHA-256 and fails with
`NATIVE_SOURCE_DIGEST_MISSING` when it is absent. A present digest is still
matched against the exact input bytes and mismatches fail with
`NATIVE_SOURCE_DIGEST_MISMATCH`.

### Resolved Medium — native compaction summaries were represented as original assistant output

Location: `src/native-context.ts`, summary materialization and block capture.

An explicit Pi compaction summary was temporarily converted into a fabricated
assistant message. The resulting source said `assistant_output` and its revision
said `original`, obscuring that the native record was a summary of conversation
history.

Summary records now carry an internal summary marker, produce a
`conversation_history` source and a `summary` revision, and use unknown role with
history placement. Their source references identify the actual native summary
field. No transformation edge is invented because the transcript record does
not explicitly identify the exact input revisions; the independent synthetic
producer, by contrast, emits its declared full-history-to-summary edge.

### Resolved Medium — fully unvalued evidence could not be wrapped in a Context Report

Locations: `src/profile.ts`, report-input validation; `src/context-report.ts`;
and `test/context-report.test.ts`.

The real-work capture exposed a composition problem outside native parsing. A
recorded-mode valuation with no monetary amounts correctly has null observation
amounts, a zero subtotal, incomplete coverage, mixed basis and, unless a display
currency was supplied, `UNKNOWN` currency. Context Report creation reused the
stricter monetary-profile input validator, which rejected that honest valuation
before the context could be inspected.

Context Reports now use a narrowly scoped join validator that relaxes mixed basis
and `UNKNOWN` currency only when every valuation amount is null. Dataset,
selection, source/observation references, direct scope, completeness and exact
subtotal checks still run. `createCostProfile` and its public input validator
remain strict and continue to reject the same unvalued mixed-basis input. The
regression covers both an unspecified currency and explicitly requested USD,
then round-trips each report through semantic validation.

## Native reconstruction verification

- Every Codex direct model observation produces an `unavailable` boundary with
  unknown coverage and no occurrences. Nearby user events are not inferred as
  request context.
- Legacy Pi requests contain records strictly before each assistant response.
  Pi v4 requests use only the exact target entry's parent chain. Sibling branches
  remain isolated, including when entries and usage rows are nested in one
  transaction.
- Missing native rows, missing linked entries and metadata-only sanitized rows
  produce unknown coverage with no invented occurrences. The checked-in
  sanitized fixture still yields 484 unknown requests and zero occurrences.
- Token measurements and cache treatment remain unavailable/unknown. Captured
  text is used transiently for SHA-256 and UTF-8 byte length only; targeted secret
  strings do not occur in serialized output.
- Explicit compaction content is retained as a summary revision, without inferred
  transformation lineage or backward token attribution.

## Independent producer verification

`tools/context-producer-python/producer.py` uses only the Python standard library
and manually implements the published interchange shape. It does not import or
invoke the TypeScript capture SDK. Its embedded Harness Profile validates both
standalone and inside the Context Bundle through the public validators.

The output is consistently identified as dataset
`independent-producer-fixture-v02`. Sources, operations, descriptions and the
bundle issue all state that the values are synthetic and do not represent a
provider call, bill or accepted user task. This identity is distinct from the
project's WorkItem evidence.

The four synthetic content fingerprints and tool-definition fingerprint match
independent SHA-256 calculations. Raw system, user, full-history and summary text
do not appear in the emitted Context Bundle. Unknown byte/token measurements
remain unavailable, estimated token values retain estimated evidence, repeated
occurrences remain repeated, and the one compaction transformation names its
exact input and output revisions. The generated Context Bundle is structurally
identical to the context embedded in
`examples/context/independent-producer-report.json`; the detached report validates
and its 101 nanodollar allocation conserves exactly.

## Public Pi report verification

`examples/context/pi-transcript-report.json` validates as a joined Context
Report and regenerates exactly from the first 32 rows of the fixture pinned at
upstream commit `9767ba275f3e9a5ee0f5c5342249b629ab1b2282`. An independent hash of
the normalized prefix is
`95a3d3f529ebc07fe4cee3d62e96d5115ec75e331460aec1ae03a50a9121c9bf`,
matching the report's Evidence Source.

The report contains 13 partial requests, 26 context sources, 32 revisions and
231 ordered occurrences. Its known subtotal is $1.590658 with native
`model_price_estimate` basis, valuation remains incomplete, and no allocation is
claimed. None of the 21 non-empty source text segments in that prefix occurs in
the report JSON.

## Packaging and checks

The in-progress root integration now exports `reconstructNativeContext` through
`src/index.ts`, and the package's root export covers that compiled entry point.
The CLI also exposes the native import route. This was checked as current source
integration rather than used as a finding while the root integration was being
edited concurrently.

Independent focused verification: `node --import tsx --test
test/native-context.test.ts test/context-producer.test.ts` passes 14/14;
the context-report/profile regression suite passes 25/25;
`npm run typecheck` passes; public-root import exposes the native function and
validates the independent context/profile; and `git diff --check` reports no
whitespace errors in the reviewed surfaces. No native or independent-producer
finding remains open.
