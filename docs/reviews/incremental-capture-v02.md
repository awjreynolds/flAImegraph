# Incremental capture v0.2 independent review

Review date: 2026-09-06

Scope: `src/capture.ts`, `src/capture-types.ts`, `spec/0.2/capture.md`, `spec/0.2/schemas/capture-state.schema.json`, `test/capture.test.ts`, the incremental Pi-coordinate changes in `src/adapters/index.ts`, and the relevant validation/reconciliation behavior in `src/core.ts` and `src/adapters/common.ts`.

Verdict: **changes requested**. The append and reconciliation path is strong on byte-prefix safety, replay, stable call identity, and atomic failure. Two confirmed contract defects remain: the capture API exposes an unusable and non-frozen `source_id` option, and multi-node native-parent cycles abort capture instead of remaining unresolved with a coverage issue. A smaller persisted-state validation gap also permits internally impossible descriptor histories.

## Findings

### High — `source_id` is accepted as a stream option but is neither immutable nor usable for extensions

Locations: `src/capture-types.ts:7-13`, `src/capture-types.ts:35-40`, `src/capture.ts:135-151`, `src/capture.ts:341-348`, and `src/capture.ts:453-459`.

`CaptureOptions` inherits `ImportOptions.source_id`, `normalizeOptions` persists it under the documented frozen `import_options`, and `importedCapture` passes it to the ordinary adapter. However, `streamOptions` deliberately omits `source_id` from the equality check. A later call can therefore change or omit it without `CAPTURE_CONFIGURATION_MISMATCH`, while the returned state continues to claim the original `source_id` in `import_options`.

The original value is also unusable for a real extension. Reusing it gives the larger full snapshot the same `Source.id` but a different SHA-256, so reconciliation fails with `SOURCE_CONFLICT`. This conflicts with `spec/0.2/capture.md:34`, which says each accepted artifact keeps its normal digest-derived source ID.

Reproduction:

```ts
const first = advanceCapture(row("a"), {
  harness: "codex",
  capture_namespace: "source",
  dataset_id: "source",
  source_id: "first",
});

// Fails SOURCE_CONFLICT, although the options exactly match.
advanceCapture(row("a") + row("b"), {
  harness: "codex",
  capture_namespace: "source",
  dataset_id: "source",
  source_id: "first",
  sequence: "1",
}, first);

// Succeeds, although a persisted option changed; import_options still says "first".
advanceCapture(row("a") + row("b"), {
  harness: "codex",
  capture_namespace: "source",
  dataset_id: "source",
  source_id: "second",
  sequence: "1",
}, first);
```

Requested correction: remove `source_id` from the new capture option/state types and reject it at runtime, leaving ordinary v0.1 importer support unchanged. Capture artifacts should always use the adapter's digest-derived source ID. Add tests showing `source_id` is rejected on both anchor and extension calls.

### Medium — a native parent cycle of length greater than one aborts capture

Locations: `src/capture.ts:246-287`, especially the direct `parent_id` assignments at lines 267 and 280. Contract: `spec/0.2/capture.md:43-46`.

`resolveLineage` detects self-parenting, but it assigns every other unique alias immediately and relies on `validateEvidence` afterward. Two or more resolved aliases can therefore form a cycle. Core validation throws `RELATIONSHIP_CYCLE`; the capture is rejected instead of retaining the hashes and emitting `lineage_parent_cycle` as the v0.2 contract promises.

This also affects late resolution. An initial `a -> b` snapshot correctly records `lineage_parent_unresolved`, but extending the exact prefix with `b -> a` throws `RELATIONSHIP_CYCLE`.

Reproduction:

```ts
const a = event("a", "b");
const first = advanceCapture(a, {
  harness: "codex",
  capture_namespace: "cycle",
  dataset_id: "cycle",
  sequence: "1",
});

// Throws RELATIONSHIP_CYCLE.
advanceCapture(a + event("b", "a"), {
  harness: "codex",
  capture_namespace: "cycle",
  dataset_id: "cycle",
  sequence: "2",
}, first);
```

Requested correction: resolve candidate parent edges as a graph, detect every cyclic component before assigning `parent_id`, and leave the affected cyclic edges unassigned with `lineage_parent_cycle` issues. Add initial-snapshot and late-parent two-node cycle tests.

### Low — persisted descriptor history is not validated as an append-only history

Locations: `src/capture.ts:361-423` and `spec/0.2/schemas/capture-state.schema.json` under `$defs.capture`.

`validateCaptureState` checks increasing descriptor sequences, checks only the last descriptor against the cursor, and checks each descriptor digest against a source. It does not validate descriptor ID derivation or uniqueness, nor monotonic historical `prefix_bytes` and `record_count`. Starting from a valid two-capture state, each of these independent mutations is accepted:

```ts
state.captures[0].id = "garbage";
state.captures[0].id = state.captures[1].id;
state.captures[0].prefix_bytes = "999999"; // greater than the later prefix
state.captures[0].record_count = "999";    // greater than the later count
validateCaptureState(state);               // succeeds in every case
```

The current cursor remains protected, so this does not permit a prefix rewrite during the next advance. It does mean the public persisted-state validator can certify an impossible or ambiguously identified audit history.

Requested correction: recompute every descriptor ID from harness, namespace, sequence, and digest; require unique descriptor/source IDs as intended; and require `prefix_bytes` and `record_count` to be nondecreasing across captures. Add one tampered-history test per invariant.

## Tested strengths

- `node --import tsx --test test/capture.test.ts`: 10/10 passing.
- `npm test`: 130/130 passing, including all existing v0.1 adapter, core reconciliation, CLI, profile, context, valuation, and export tests.
- `npm run typecheck`: passing.
- Codex dogfood overlap reconciles two full snapshots to 88 direct calls and retains both source references on replayed observations.
- Pi legacy overlap reconciles 1,003 framed rows to 484 direct calls; the Pi v4 nested ordinal keeps two equal writes on one transaction line distinct. The adapter diff preserves ordinal-zero fallback spellings and existing fixtures remain green.
- Equal-valued calls at different native or verified coordinates remain distinct, while a repeated native identity with changed usage fails closed as `OBSERVATION_CONFLICT`.
- Exact replay is detached, deeply frozen, descriptor-idempotent, and leaves the cursor sequence unchanged. Content extensions advance the sequence; explicit regressions are rejected.
- Truncation, rewritten prefixes, malformed/incomplete JSON, semantic adapter errors, configuration changes for `version`/`work_item_id`/`agent_id`, and non-increasing extension sequences fail before the prior state is mutated.
- A Unicode counterexample (`🔥 café`, plus non-ASCII response IDs) confirmed that `prefix_bytes` uses exact UTF-8 byte length and both anchor and extension SHA-256 values match independent `Buffer` hashing.
- Recursive inspection found no stored raw input. Nested evidence attributes and source references are frozen at runtime.
- A non-cyclic child-before-parent case resolves after the later full snapshot is merged, with no dangling `parent_id`; unresolved and ambiguous aliases remain hashed with explicit issues.

The two higher-severity findings should be corrected before treating the v0.2 capture contract as implemented. The lower-severity descriptor checks can be fixed in the same persisted-state validation pass.

## Resolution verification — 2026-09-06

All three findings are resolved in the current checkout.

- Capture no longer exposes `source_id`; runtime calls that supply it or another unknown option fail with `CAPTURE_INVALID_OPTIONS`. Ordinary v0.1 `ImportOptions.source_id` remains unchanged, while v0.2 capture artifacts use digest-derived source IDs.
- Lineage resolution now builds candidate edges before assigning parents, identifies every node in a cyclic component, leaves those edges hashed, and emits `lineage_parent_cycle`. Both initial and late two-node cycle regressions pass.
- Persisted-state validation recomputes descriptor IDs, rejects duplicate descriptor and source IDs, and enforces nondecreasing byte and record histories.

Independent verification: `node --import tsx --test test/capture.test.ts` passes 14/14. The new source-option, initial/late cycle, descriptor-ID/source-ID, and non-monotonic-history counterexamples all fail or degrade exactly as requested. No capture finding remains open.
