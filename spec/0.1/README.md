# Agent Cost Interchange — experimental specification 0.1.0

This open specification describes how to exchange evidence of agent work, derive a declared monetary valuation and project that valuation into existing profile formats. It can be implemented independently of flAImegraph. The reference implementation and conformance corpus are supplied in this repository under the MIT license; third-party tooling retains its own license.

**Status: experimental.** This is a complete versioned implementation target, not a claim of industry adoption or endorsement. Breaking changes before stability receive a new minor version and migration notes. A consumer MUST reject unsupported required semantics rather than silently interpret them using an older version.

- [Evidence and selection](evidence.md)
- [Monetary valuation](valuation.md)
- [Profile bindings](profiles.md)
- [Work Items, acceptance and Context Points sidecars](work-items.md)
- [Conformance and evolution](conformance.md)
- Machine-readable schemas: [schemas/](schemas/)

The key words MUST, MUST NOT, SHOULD and MAY describe requirements on conforming implementations. Schema validity is structural validation; semantic conformance also requires the invariants and golden outcomes in this specification.

## Reuse and the scope of this profile

OTLP and OpenTelemetry GenAI conventions remain the preferred live telemetry transport and execution vocabulary. FOCUS owns financial cost and allocation meanings. Pprof and folded stacks own the profile encodings. This specification adds an offline bridge and deterministic accounting/projection rules for heterogeneous sources. Its JSON evidence bundle is explicitly a bridge format, not a claim that arbitrary local fields are OTLP or FOCUS attributes.

The reference v0.1 selection policy is conservative: **direct-only-v1**. It values direct observations and retains aggregate/snapshot evidence as uncovered reconciliation context. It MUST NOT invent hidden calls or subtract unrelated partial totals to manufacture an exact residual. Producers that derive direct deltas from a well-defined native snapshot sequence MUST document that derivation and its coverage. Other selection policies require separately versioned semantics and conformance cases.

The result can be a useful, correct known subtotal while total expenditure remains unknown. Neither a successful graph nor arithmetic agreement establishes complete capture, actual invoice correspondence, exact per-source context cost or a model's causal usefulness.

## Artifacts

An exchange comprises an evidence bundle, optionally a rate card, a valuation, and one or more cost profiles. Each profile travels with its JSON manifest, and can be encoded as folded text or gzip-compressed pprof protobuf. Artifact identities and content digests support reproducibility; none is a replacement for source-observation identity.

Tokens and money are represented as decimal strings where exactness matters. A consumer MUST NOT coerce values to IEEE-754 numbers if precision would be lost. Raw prompts, tool results, secrets and reasoning text are not required for any core operation.
