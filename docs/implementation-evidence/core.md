# Core implementation evidence

The v0.1 core seams are implemented in `src/core.ts`:

- `validateEvidence` and `validateRateCard` run the pinned Ajv 8.20.0 schemas and then enforce exact quantities, decimal rates, real ISO dates, source references, observation references, subset bounds and acyclic hierarchy relationships.
- `reconcileEvidence` validates every input, requires one dataset identity, merges equal observations idempotently, unions their source references, and raises `OBSERVATION_CONFLICT` for different semantic payloads under one observation ID. Sources, relationships and issues are deduplicated and emitted in stable order.
- `valueEvidence` applies `direct-only-v1`. Aggregate, snapshot and unknown-scope records remain in the valuation with unavailable lines and coverage warnings. Inclusive input is partitioned into fresh, cache-read and cache-write quantities; reasoning output remains inside output. Explicitly unavailable or positive unclassified quantities are unpriced; an omitted optional category prices the declared partitions while recording incomplete hidden-category coverage. No missing quantity is invented as zero.
- Monetary lines use BigInt exact decimal arithmetic and are rounded once per observation to integer nano-currency units with nearest, ties-to-even. Recorded cost bases and rate-card bases remain explicit, while mixed currencies and bases fail closed. Dated rules use inclusive-start/exclusive-end matching and overlapping matches remain unavailable.
- Valuation IDs are deterministic SHA-256 derivations of the normalized evidence, selected mode/currency and rate card, so the original usage strings remain unchanged and the derivation is replayable.

Validation evidence from this checkout:

```text
node --import tsx --test test/core.test.ts       # 5 passing
node --import tsx --test test/valuation.test.ts  # 7 passing
npx tsc --noEmit --ignoreConfig --types node \
  --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --strict --esModuleInterop --skipLibCheck --resolveJsonModule \
  --noUncheckedIndexedAccess src/core.ts         # passing
```

The repository-wide check can include failures from modules owned by other implementation slices while those slices are still in progress.
