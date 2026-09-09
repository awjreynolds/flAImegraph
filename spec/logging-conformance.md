# Portable logging conformance

The usage 0.4 and lifecycle 0.5 contracts have self-contained JSON Schema Draft
2020-12 schemas. A consumer can validate them offline, with no remote references.
Obtain a schema with `flaimegraph schema --kind usage --out usage.schema.json`.
Other kinds are `lifecycle`, `lifecycle-event` and `journal-frame`.

Passing JSON Schema is **structural validation only**. Accepting evidence also
requires the normative rules in the usage and lifecycle specifications:

- Check real UTC calendar dates, identity relations, dataset consistency,
  source and meter references, graph cycles and conflicting redeliveries.
- Preserve decimal quantities as strings; do not round them through a floating
  point number. Null means unknown, and requires unknown evidence.
- Verify journal framing, its byte limits, digest and previous-digest chain.
  A syntactically valid digest does not establish integrity.
- Apply accounting scopes, subset relationships and coverage before totaling
  measurements. Missing receipts do not establish zero consumption.
- Enforce the usage contract's exclusion of monetary/pricing fields, including
  prohibited extension keys. Schema-valid extensions are not exempt.

`flaimegraph validate --kind usage|lifecycle|lifecycle-event --input FILE`
performs the reference semantic validation. Journal recovery additionally
checks the on-disk framing and integrity contract. Lifecycle projection checks
replay and action-graph invariants; validating a capture alone is not replay.

`spec/fixtures/logging/conformance.json` is a language-neutral corpus with
separate expected structural and semantic verdicts. It includes documents that
deliberately pass syntax but fail semantics. `tools/logging/verify.py` validates
syntax with Python's independent jsonschema implementation; it is not a second
implementation of all semantic rules. Run it with `uv run tools/logging/verify.py`.
Use `uv run --frozen tools/logging/verify.py` to retain the locked dependency set.
The TypeScript tests apply both verdicts. Existing journal tests cover framing,
partial writes, restart, corruption and redelivery.

Schema files are generated from `src/logging-schema.ts`. After edits run
`node --import tsx tools/logging/generate-schemas.ts`; use `--check` to check
drift. The checked-in schemas ship in the package. Version fields are exact:
consumers must reject unsupported versions instead of silently downgrading.
Any change that invalidates a previously conforming document requires a new
contract version and migration notes. Additive optional fields also require a
new version because existing contracts reject unrecognized fields.
