# Work-item join and CLI accounting review

Review scope: `src/work-items.ts`, `spec/0.1/work-items.md`, the work-item schema and tests, and the related CLI, file-writing, conformance, and renderer seams. This was a read-only implementation review apart from this report. Reproductions used checked-in fixtures and local temporary files only.

## Confirmed findings

### [P1] A joined Work Item receives costs from observations it did not select

`joinWorkItemEvidence` selects observations from the Work Item's Attempts (`src/work-items.ts:340-358`), but then copies the entire dataset-level Valuation into the row (`src/work-items.ts:360-376`). It checks only that each valued observation exists somewhere in the EvidenceBundle. It never requires the valuation lines to belong to `selectedObservationIds`, and it does not derive a selected subtotal.

Using the golden two-call evidence, a Work Item whose sole Attempt referenced only `example-call-a` produced:

```json
{
  "selected": ["example-call-a"],
  "valuation_observations": ["example-call-a", "example-call-b"],
  "valuation_total": "200000000"
}
```

The resulting calibration/training row therefore assigns the cost of `example-call-b` to work that did not select it. This becomes especially damaging when one EvidenceBundle contains several Work Items: every joined row can receive the whole dataset total. Filter the valuation to the selected observations and recompute its total and completeness, or require a separately generated work-item-scoped valuation and reject extra lines. Add a test with two Work Items in one dataset and assert that each row conserves only its own selected monetary lines.

### [P1] The CLI writes semantically invalid valuations into joined records

The `work-item` command performs structural JSON Schema validation through `checkedArtifact` (`src/cli.ts:239-250`), while `joinWorkItemEvidence` checks only dataset identity and whether valuation observation IDs exist (`src/work-items.ts:360-376`). It does not verify canonical amounts, unique valuation lines, basis and currency consistency, selection policy, completeness, or that `total_nanos` equals the line sum. The library path is weaker still because a caller can pass a wholly malformed runtime object without even the CLI's schema check.

I generated the valid golden valuation, changed only its schema-valid `total_nanos` from `200000000` to `999`, and passed it to `flaimegraph work-item`. The command exited successfully and wrote:

```text
declared total_nanos = 999
sum of amount_nanos = 200000000
```

Extract a public semantic valuation validator and use it at every artifact boundary, including `work-item`, `export`, and `joinWorkItemEvidence`. A schema-valid nonconserving subtotal should fail before any joined artifact is written.

### [P1] A scope revision makes the required estimate history impossible to retain

The specification says that a later scope change receives a new revision, the earlier estimate remains in the record, and estimates retain the scope revision they describe (`spec/0.1/work-items.md:19`, `:58`). The validator instead requires every estimate's `scope_revision` to equal the one current `scope.revision` (`src/work-items.ts:230-235`).

Changing the research example's current scope revision to `scope-2` while retaining its version-1 estimate for the original revision fails with:

```text
WORK_ITEM_SCOPE_MISMATCH: estimate research-context-points-estimate-1 belongs to scope 2026-09-06, not scope-2
```

This prevents the append-only history required for scope-change calibration and encourages callers to rewrite or discard the original estimate. Permit historical estimate revisions. If their scope descriptions must remain locally resolvable, add a versioned scope-history collection rather than forcing all estimates onto the latest revision. Add a fixture containing a pre-change estimate and a later re-estimate for the new scope.

### [P1] Declared estimate timing is trusted even when known timestamps disprove it

The validator checks each RFC3339 string and each Attempt's start/end interval, but never compares `estimate.created_at` with Attempt boundaries (`src/work-items.ts:198-201`, `:236`). `joinWorkItemEvidence` then turns the caller's unchecked `timing` enum directly into the training interpretation (`src/work-items.ts:315-318`, `:396-400`). A `pre_execution` estimate created at 12:00 was accepted for an Attempt that ran from 10:00 to 11:00 and was labeled `pre_execution_estimate` in the joined row. The inverse post-execution leakage is accepted as well.

This defeats the contract's central protection against presenting retrospective knowledge as a forecast (`spec/0.1/work-items.md:35-41`). When relevant boundaries are present, require pre-execution estimates to precede the first Attempt start, during-execution estimates to fall within an Attempt, and post-execution estimates to follow the linked evidence or Attempt end. When timestamps are unavailable, retain that uncertainty explicitly rather than emitting a verified-looking interpretation. Add boundary and missing-time cases to the join tests.

### [P2] Estimate versions can run backward in time

Supersession checks only that the referenced estimate exists and has a lower numeric version (`src/work-items.ts:264-285`). A version 1 created at 12:00 and a version 2 created at 09:00 that supersedes it validate successfully. Branching is also possible because multiple later versions may supersede the same predecessor. This undermines the specified append-only version history and makes it unclear which information was available at each re-estimate.

Require each superseding estimate's `created_at` to be no earlier than its predecessor and define whether the history is a single chain or a DAG. If versions are intended as a sequence, require each version after 1 to supersede the immediately preceding version and reject gaps/branches. Cover reversed timestamps and competing successors.

### [P2] Mistyped boolean CLI values silently change requested output

The generic flag parser accepts every non-option token as a value (`src/cli.ts:29-38`), and both render paths enable PNG only when the value is exactly `"true"` (`src/cli.ts:187`, `:216`). Running `demo --png ture` exited successfully, reported the normal output, and produced no `cost.png`. Values such as `1`, `yes`, and `falsee` behave the same way.

Parse boolean options explicitly and reject values other than `true` and `false` with the machine-readable `USAGE` error. Add CLI cases for both valid values and a typo so automation cannot silently omit a requested artifact.

## Verification and limitations

The focused work-item and CLI suite passed:

```text
node --import tsx --test test/work-items.test.ts test/cli.test.ts
21 tests passed
```

The full suite was also run against the concurrent workspace state: 63 of 68 tests passed. The five failures were in adapter ancestry/OTLP assertions and renderer profile-ID fixtures introduced by other in-progress changes; none exercised the work-item findings above. The symlink overwrite test passed, and I found no confirmed same-file overwrite bypass in `protectInputs`. The renderer now neutralizes control characters before creating `nameattr` data and invokes semantic profile validation through `exportFolded`; the focused CLI render test passed.
