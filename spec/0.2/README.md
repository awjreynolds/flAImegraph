# Context Interchange 0.2 (experimental)

Version 0.2 adds context evidence to the frozen [0.1 cost interchange](../0.1/README.md). Evidence, valuation and standard cost profiles keep their 0.1 contracts. Context bundles, harness profiles, reports and incremental capture state use 0.2.0. This is an experimental reference implementation, not a standards-body specification.

- [Context and harness profile contract](context.md): origins, representations, ordered occurrences, evidence, artifact references, profiles and transformation lineage.
- [Incremental capture](capture.md): append-only native capture, overlap reconciliation, stable identities and failure conditions.
- [Context report](context-report.md): composition, coverage and optional estimated allocation.
- [JSON Schemas](schemas): portable structural contracts. The reference runtime additionally verifies joins, digest identities, arithmetic and graph invariants.

A request manifest describes a named capture boundary. It does not certify the hidden provider prompt. Native transcripts may expose only partial history or usage accounting; unavailable context remains explicit. Repeated occurrences are retained; summary ancestors are not counted again as current input.

USD totals remain exact integer nano-USD under their declared valuation. Optional context allocation apportions an already-valued request by eligible input-token weights and an explicit unallocated remainder. It is an estimate of request cost, including any output component, and never extra cost or exact source billing.

Harness profiles record version, model, settings, instruction/tool declarations, policies and capture capabilities with fact-level provenance. Unknown facts remain null. Request-level observed overrides do not silently rewrite the base profile.

The independent Python producer in [tools/context-producer-python](../../tools/context-producer-python) exercises interoperability without importing the TypeScript SDK. It is a reference conformance proof using synthetic inputs; it does not establish independently maintained ecosystem adoption.
