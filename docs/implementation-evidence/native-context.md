# Native transcript context implementation evidence

The native reconstruction seam is `reconstructNativeContext` in
`src/native-context.ts`. It consumes an already validated Evidence Bundle,
the raw export and a Harness Profile. The `source_id` option selects the one
evidence artifact whose physical rows may be used. The implementation does
not contact a provider or discover a session.

Codex accounting rows contain usage identity but do not expose the final
assembled request. The adapter therefore emits one `unavailable` request
boundary with `unknown` coverage for each direct model observation. Nearby
events are never treated as prompt context. The boundary issue is retained
on every request so an allocator cannot mistake it for an empty complete
request.

Pi legacy rows are reconstructed as transcript ancestry preceding each direct
assistant response. When `id`/`parentId` records are present, only the target's
parent chain is used, so sibling branches cannot enter one another's context.
Legacy linear rows use the preceding transcript segment; an explicit native
compaction summary replaces earlier rows. A compaction index without explicit
entry ancestry produces an ambiguity issue and no invented transformation
lineage. Token measurements remain unavailable by default and cache treatment
remains unknown. Captured text and bytes are passed transiently to the common
capture seam, which retains only SHA-256, UTF-8 byte measurements and source
metadata in the returned bundle.

The checked-in sanitized Pi fixture contains 1,003 JSONL rows and 484 direct
model observations. It intentionally omits message and compaction content, so
the reconstruction returns 484 transcript-reconstruction requests with
`unknown` coverage, zero occurrences and unavailable token/byte measurements.
This is evidence of an honest metadata-only boundary, not a claim that the
provider prompt was recovered. A local run against the raw upstream fixture
produced 484 transcript-reconstruction requests and 105,425 ordered
occurrences; its compact JSON output is about 37.6 MB, so it is too large for
the context explorer. The bounded local proof uses the first 500 physical
JSONL records and is written under
`.local/native-context-proof/pi-context-prefix-500.json`, with its selected
line range and counts in `pi-context-prefix-500.summary.json`. That prefix
contains 239 direct observations, 46,323 ordered occurrences and a 16.6 MB
context bundle. Raw transcript content is not committed.

Focused tests cover Codex unavailable boundaries, transient content hashing,
legacy ancestry, explicit Pi parent branches, compaction ambiguity and the
sanitized metadata-only fixture, source digest matching and unresolved row
references.

A smaller public, metadata-only report is now included at `examples/context/pi-transcript-report.json`. It derives from the first 32 rows of the pinned upstream fixture: 13 partial requests, 26 sources and 231 occurrences. It fits comfortably in the explorer and contains neither raw message content nor inferred input token counts. Its native recorded amounts remain classified as model-price estimates. See the examples README for exact upstream provenance and regeneration.
