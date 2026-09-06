# Public Pi fixture through the common pipeline

`before-compaction.jsonl` is a content-free derivative of Pi's public legacy fixture at [revision 9767ba2](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/test/fixtures/before-compaction.jsonl). It is an unversioned historical fixture, not a fresh run of today's Pi release. Pi is MIT-licensed; this derivative retains structural facts and usage quantities without prompts, responses, tool arguments/results, summaries or paths. See [provenance.json](provenance.json) for source and derivative digests.

All 1,003 physical records remain in order so fallback line identities remain meaningful. The 484 assistant records include 471 positive recorded costs and 13 native zero-cost records. Two compactions have no usage/cost. IDs are hashed; source numeric monetary lexemes are preserved as decimal strings to avoid a new binary floating-point conversion. This is a sanitized native-shaped fixture; it is not byte-identical to the source.

The independently worked expectation is **42,595,907,500 nanoUSD ($42.5959075)** after rounding each recorded `cost.total` once to nanoUSD. Native cost is a model-price estimate under Pi's USD convention; it is not proof of billing. Zero usage on aborted/error records and missing compactions do not prove zero provider expenditure. Details and source interpretation are in the [capture research](../../../docs/research/pi-capture-fidelity.md).

```sh
node dist/cli.js import --harness pi --input examples/dogfood/pi/before-compaction.jsonl --agent pi --work-item public-fixture --out .local/pi/evidence.json
node dist/cli.js value --input .local/pi/evidence.json --mode recorded --out .local/pi/valuation.json
node dist/cli.js export --input .local/pi/evidence.json --valuation .local/pi/valuation.json --out-dir .local/pi
node dist/cli.js render --input .local/pi/profile.json --out-dir .local/pi
```

The graph is produced through the same valuation/profile/renderer path as the Codex demo. Work item and agent labels in these commands are analyst-supplied. This fixture demonstrates a second native harness and existing consumer compatibility; it does not establish an independent implementation of the interchange specification.
