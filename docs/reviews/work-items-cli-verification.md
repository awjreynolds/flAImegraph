# Work-item and CLI repair verification

Verification scope: the six confirmed findings in `docs/reviews/work-items-cli-review.md`, current `src/work-items.ts` and `src/cli.ts`, and their focused tests. This was a read-only verification apart from this report. Reproductions used checked-in golden fixtures and temporary local outputs.

## Result

All six original repairs and every residual repair are independently verified. The work-item and CLI area is ready for release.

## Final re-verification

The exact two residual reproductions were rerun against the final implementation:

- A `pre_execution` estimate created at 12:00, with no Attempt timestamps and a linked observation timestamped 10:00, now fails with `WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION`.
- A later linked observation does not overstate certainty when the Attempt start is absent: the timing remains `unknown`. With no known boundary it also remains `unknown`; with a complete later Attempt start it becomes `verified`.
- Selections `[example-call-a]` and `[example-call-a, example-call-b]` now retain totals `125000000` and `200000000` and receive distinct valuation IDs.
- Replaying the ASCII two-observation selection with reversed Work Item observation IDs, reversed evidence order, and reversed valuation-line order produces the same valuation ID. An identical replay also produces the same ID.

The implementation checks known linked execution timestamps before classifying incomplete timing evidence as unknown. It also uses a locale-independent total code-unit order for all digest arrays. No residual defect remains.

## Final resolved finding

### [Resolved P1] Locale collation left selected valuation IDs dependent on line order

The defective digest sorted selected valuation lines with `left.observation_id.localeCompare(right.observation_id)`. `localeCompare` can return zero for distinct strings. The schemas permit any nonempty ID, so canonically equivalent Unicode spellings such as composed `é` (U+00E9) and decomposed `e` plus combining acute accent (U+0065 U+0301) are distinct valid observation IDs even though the comparator reports them equal.

I joined the same two observations and monetary lines twice, changing only the order of `valuation.observations`. Both inputs validate and contain exactly the same semantics, but their derived IDs differ:

```text
forward = valuation-unicode/work-item/ticket-7/19813293c9cb6603407f390b958e6c159fc02c4f26979b811169343f32f4dd3a
reverse = valuation-unicode/work-item/ticket-7/624bf595853d5524df77df41427deabb12424e89bebe5d7289fe0c5640bb0b51
```

The required correction was a locale-independent total string order for every canonically sorted digest array, using direct less-than and greater-than comparisons with an equality fallback. At that point, release signoff was withheld pending a regression using the two IDs above and reversed valuation-line order.

Resolution: the digest now sorts both observation lines and canonicalized issues with direct code-unit comparisons. The exact prior reproduction now returns the same ID for both line orders:

```text
valuation-unicode/work-item/ticket-7/624bf595853d5524df77df41427deabb12424e89bebe5d7289fe0c5640bb0b51
```

An independent replay that reverses the two Unicode-referenced issues also retains one stable ID. The focused regression reverses lines and issues independently.

## Original residual findings and resolutions

### [Resolved P1] Linked evidence did not disprove a false pre-execution estimate when Attempt timestamps were absent

The new timing logic correctly rejects contradictions when all Attempt start times are present. At join time, however, the `pre_execution` branch returns `unknown` as soon as an Attempt lacks `started_at` and never considers timestamps on the selected observations (`src/work-items.ts:360-377`).

I joined an Attempt with no time fields to an observation timestamped 10:00 and supplied an estimate created at 12:00 with `timing: "pre_execution"`. The join succeeded and emitted:

```json
{
  "timing": "pre_execution",
  "interpretation": "pre_execution_estimate",
  "temporal_status": "unknown"
}
```

The linked observation proves execution existed before the estimate. This is a known contradiction, not missing evidence, and the updated contract says a known contradiction fails the join. It still permits retrospective knowledge to enter a training row under `pre_execution_estimate`.

At join time, compare a pre-execution estimate with every available execution lower bound: known Attempt starts and selected observation timestamps (or an end time when that is the only known evidence time). If the estimate is at or after any such bound, fail with `WORK_ITEM_ESTIMATE_TIMING_CONTRADICTION`. Retain `temporal_status: "unknown"` only when the available bounds neither verify nor contradict the claim. Add a test with missing Attempt times and a linked observation earlier than the declared pre-execution estimate.

Resolution: `assessEstimateTiming` now checks known Attempt starts and selected observation timestamps or end times before returning `unknown`. The exact reproduction fails closed, while consistent incomplete evidence remains explicitly unknown.

### [Resolved P1] Different work-item valuation selections received the same artifact ID

`subsetValuation` derives the selected valuation ID only from the dataset valuation ID and `work_item_id` (`src/work-items.ts:167-199`). The selected observation IDs, lines, subtotal, issues, and completeness do not participate. Two versions of the same Work Item can therefore produce different valuations with the same ID.

Using the golden valuation and stable Work Item ID `ticket-7`:

```text
selection [example-call-a]                 total = 125000000
selection [example-call-a, example-call-b] total = 200000000

both ids = val-a2f4...a6d29/work-item/ticket-7
```

This breaks artifact identity for an append-only Work Item as Attempts gain or change links. A cache, manifest, or downstream record keyed by valuation ID can silently conflate two monetary artifacts.

Derive the selected valuation ID from canonical selected valuation semantics, including the source valuation identity, Work Item ID, selected line content, filtered issues, subtotal, and completeness. Equal semantic selections should replay to the same ID, while any selected observation, amount, issue, or completeness change must change it. Add a test that joins the same Work Item ID with one versus two selected observations and asserts distinct IDs as well as distinct totals.

Resolution: `subsetValuation` appends a SHA-256 digest over selected valuation semantics. Different subsets receive different IDs, while ASCII and Unicode ordering-only replays preserve the ID.

## Verified repairs

### Dataset valuation is scoped to the selected Work Item

The join now preserves the original input as `dataset_valuation` and derives `valuation` from only the Attempt-selected observations. The original golden reproduction now yields one line for `example-call-a` and `total_nanos: "125000000"`, while `dataset_valuation.total_nanos` remains `"200000000"`. Separate Work Items selecting calls A and B receive subtotals `125000000` and `75000000` respectively.

### Valuation semantics fail closed at library and CLI boundaries

`validateValuation` now checks schema, unique lines, canonical amounts, line and aggregate basis, issue references, completeness, and exact subtotal conservation. `joinWorkItemEvidence`, CLI `work-item`, CLI `export`, and `validate --kind valuation` use that semantic boundary. Changing the golden total to schema-valid `"999"` now fails with `VALUATION_TOTAL_MISMATCH` instead of writing a joined artifact.

### Historical scopes and linear estimate versions are retained safely

The schema now supports `scope_history`; every estimate scope must resolve to the current or a historical snapshot. A version-1 estimate for scope 1 and a version-2 estimate for current scope 2 validate together. Reversed timestamps, gaps, and a version that branches from a non-immediate predecessor fail with `WORK_ITEM_ESTIMATE_ORDER` or the corresponding missing-reference error.

### Malformed PNG values fail before output

Both `render` and `demo` use an explicit boolean parser. The original `--png ture` reproduction now exits 2 with machine-readable `USAGE`, reports `--png must be true or false`, and leaves the output directory empty.

## Automated verification

```text
node --import tsx --test test/work-items.test.ts test/cli.test.ts
31 tests passed

npm run typecheck
passed
```

The focused suite above records the first verification pass.

Final independent rerun:

```text
node --import tsx --test test/work-items.test.ts
17 tests passed

npm run typecheck
passed

independent residual reproduction matrix
timing contradiction rejected; consistent incomplete = unknown; no bound = unknown; complete bound = verified
subset totals distinct; subset IDs distinct; ASCII reordered and identical replay IDs stable
Unicode composed/decomposed IDs: reordered lines and issues retain stable IDs
```

The final focused suite covers every former residual reproduction, and the separate matrix confirms the timing and identity boundaries. Release signoff is granted for this area.
