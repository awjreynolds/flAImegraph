# Incremental capture review fixes

The v0.2 append-only capture seam now derives every accepted artifact source ID
from its harness and SHA-256 digest. `CaptureOptions` and the persisted
`CaptureImportOptions` contain only the ordinary frozen adapter settings
`version`, `work_item_id`, and `agent_id`; `source_id` is rejected at runtime,
as are other unknown capture options. The ordinary v0.1 importer API still
accepts caller-supplied `ImportOptions.source_id`.

Lineage resolution now builds all unambiguous native parent candidates before
assigning any `parent_id`. A graph walk marks every node in each cyclic
component. Those edges stay absent from normalized observations and receive a
`lineage_parent_cycle` warning, including cycles that become visible only when
a later prefix adds the missing parent. Unresolved and ambiguous aliases keep
the existing hashed attributes and coverage issues. The final evidence bundle
still passes the core validator because only acyclic parent edges are exposed
as hierarchical relationships.

Persisted descriptor validation recomputes each descriptor ID from the capture
harness, namespace, sequence, and artifact digest. It rejects duplicate
descriptor or source IDs, source IDs that are not digest-derived, and historical
decreases in `prefix_bytes` or `record_count`; the final descriptor must still
match the cursor exactly. These checks enforce the invariants that are
inspectable in a detached state. They do not authenticate a state against a
missing external log or prove that an otherwise self-consistent persisted
history was produced by a trusted capture process.

Focused regressions in `test/capture.test.ts` cover source option rejection on
anchor and extension calls, replay followed by a byte-exact extension, unknown
options, initial and late two-node parent cycles, descriptor ID and source ID
tampering, and non-monotonic historical byte and record counts.

Validation run in this checkout:

```text
node --import tsx --test test/capture.test.ts
npm test
npm run typecheck
```

All 14 capture tests and all 142 repository tests pass, and TypeScript
type-checking passes.
