# Independent Python producer evidence

This bounded proof was completed by task `01a07878-1e54-7d20-b427-708c0b34b5dd`.
The implementation started at `2026-09-06T20:46:09Z` and ended at
`2026-09-06T20:56:13Z`. The synthetic dataset is
`independent-producer-fixture-v02`; it is separate from the pre-execution Work
Item record.

[`tools/context-producer-python/producer.py`](../../tools/context-producer-python/producer.py)
is a standalone Python standard-library producer. It emits a v0.2 Context
Bundle on stdout, including its v0.2 Harness Profile. It does not import or
call the TypeScript capture SDK. SHA-256 fingerprints and the tool definition
fingerprint use `hashlib`; no third-party package or network access is needed.

The producer's bundle uses separate `context-capture` and `profile-manifest`
artifacts. Profile facts are declared against the profile artifact. The
request keeps observed `temperature` and `compaction` overrides against the
capture artifact, so effective per-request values do not rewrite declared
profile configuration. The request is a partial `harness_context` boundary.

The request occurrence order is `system`, `user`, `history-summary`, then the
same `revision-user` again. The repeated revision remains two occurrences and
its second treatment is explicitly unknown; repetition is not treated as a
cache hit. `revision-history-full` is linked to
`revision-history-summary` by the declared `summarize` transformation
`transformation-history-summary`. The system token measurement is null with
`unavailable` evidence, while the user and summary token measurements are
`estimated`; unavailable byte measurements remain null rather than becoming
zero.

The TypeScript integration test
[`test/context-producer.test.ts`](../../test/context-producer.test.ts) starts
the producer as a subprocess, validates the profile and bundle through the
public validators, values an independently authored 0.1 evidence line, and
creates and validates a report through `createContextReport` and
`validateContextReport`. The evidence records one direct synthetic model
observation with an exact `0.000000101 USD` `model_price_estimate` amount, or
`101` nano-USD. The selected allocation has an observed input denominator of
`100` tokens, counts the repeated occurrence separately, leaves twenty weight
tokens unallocated, and conserves the exact `101` nano-USD total. The test also
corrupts an artifact reference and a transformation revision reference; both
fail through the public validator with explicit reference errors.

[`examples/context/independent-producer-report.json`](../../examples/context/independent-producer-report.json)
is the checked-in report snapshot produced from the independent bundle and the
same synthetic evidence line. It validates detached through the public report
validator and retains the profile, overrides, repeated occurrences,
transformation, allocation assumptions and provenance.

Validation performed:

```text
node --import tsx --test test/context-producer.test.ts
  2 tests passed; 0 failed

npx tsc --noEmit --ignoreConfig --types node --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck \
  test/context-producer.test.ts
  passed for the producer test and its public consumer imports

npm run typecheck
  an earlier run passed; a later repository-wide rerun reached three
  unrelated concurrent errors in src/request-context.ts (lines 773, 801, 830)

python3 tools/context-producer-python/producer.py | node -e '...'
  dataset_id independent-producer-fixture-v02; profiles 1; revisions 4; occurrences 4

node -e '...run producer twice and compare stdout...'
  deterministic output bytes: 14844

git diff --check
  passed
```

The full repository test command was not used for this proof because the
independence boundary excludes calling the TypeScript capture SDK; the focused
test exercises only the public context and report consumer seam. The fixture's
context measurements and monetary line are illustrative. They do not assert a
provider bill, real workload, accepted user task, tokenizer truth, cache hit,
complete assembled prompt, hidden server context or causal source cost.

Integrated release verification subsequently passed the full TypeScript check and all 160 reference tests, including the two independent-producer cases. This supersedes the transient concurrent type errors noted above. The integrated run does not change the Python producer's independence: its process still emits the contract without importing the TypeScript capture implementation.
