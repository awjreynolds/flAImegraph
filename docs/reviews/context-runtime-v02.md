# Context runtime v0.2 independent review

Review date: 2026-09-06

Scope: `src/context-types.ts`, `src/context.ts`, `src/context-capture.ts`, `src/request-context.ts`, `src/context-report.ts`, the context additions in `src/cli.ts` and `src/index.ts`, the v0.2 context/profile/report schemas and specifications, the offline browser validator, and their focused tests. Native context discovery is outside this review.

Verdict: **approved after corrections**. The core context contract, validation, reconciliation, capture, provider adaptation, conserving allocation, package exports, browser validation, and CLI integration implement the design review's material invariants. The findings below were corrected and independently rechecked.

## Findings

### Resolved Medium — media parts could silently lose request semantics while retaining complete coverage

Locations: `src/request-context.ts:668-718` and `src/request-context.ts:908-918`.

The typed media branches return as soon as they have captured bytes or an opaque reference, without checking the remaining fields on the part or nested media object. Because no `UNSUPPORTED_PROVIDER_FIELD` issue is emitted, the provider capture defaults to `coverage: "complete"` even though request fields were omitted.

Confirmed examples across the supported formats:

```ts
// OpenAI: `detail` is omitted.
{ input: [{ role: "user", content: [
  { type: "input_image", image_url: "https://example.test/image", detail: "high" }
] }] }

// Anthropic: `cache_control` is omitted.
{ messages: [{ role: "user", content: [
  { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" },
    cache_control: { type: "ephemeral" } }
] }] }

// Gemini: the part's `thoughtSignature` is omitted after inline data is captured.
{ contents: [{ role: "user", parts: [
  { inlineData: { mimeType: "image/png", data: "YWJj" }, thoughtSignature: "signature" }
] }] }
```

Before correction, each produced no issue and a complete request. OpenAI image detail can affect image processing and token use; Anthropic cache control records request treatment; and Gemini thought signatures are provider state that may be required on a later request. A complete claim was therefore materially misleading even though the primary media bytes or reference were retained.

The correction checks image, audio, video, document, and inline/file-data branches for unrepresented outer and nested keys before returning. Those fields now emit `UNSUPPORTED_PROVIDER_FIELD` and downgrade complete coverage to partial. The regression covers all three providers and nested media objects.

### Resolved Low — CLI help omitted the implemented v0.2 commands and validation kinds

Locations: `src/cli.ts:8-23`, compared with the handlers at `src/cli.ts:103-120` and `src/cli.ts:146-228`.

Before correction, `flaimegraph --help` still labeled the workflow as experimental 0.1.0. It did not list `capture`, `harness-profile`, `context-capture`, `context-merge`, or `context-report`, and its `validate --kind` list omitted `capture-state`, `harness-profile`, `context`, and `context-report`. The commands worked, but the CLI's only built-in discovery surface said they did not exist.

The help banner now identifies the 0.2 context interchange, lists every context and incremental-capture command with its core options, and lists every implemented validation kind. The existing CLI and focused context-CLI tests remain green.

## Verified behavior

- The six context axes remain independent. Tool and output schemas are origins, while representation, media, role, placement, and treatment retain their own evidence.
- Profiles are immutable, content-addressed snapshots. Fact-level provenance is enforced, unknown values stay null, and request overrides do not rewrite the base profile.
- Context provenance resolves only through the logical union of bundle and embedded-profile artifacts. It does not fall back to the v0.1 evidence-source registry, and conflicting artifact identities fail closed.
- Generic capture hashes transient UTF-8 or binary content, records exact byte measurements, retains declared hashes at their weaker evidence level, and exports no raw content.
- Source, revision, request, occurrence, and transformation identities are deterministic. Repeated occurrences remain ordered and distinct; replay is idempotent; semantic ID conflicts and lineage cycles fail closed.
- Anonymous provider source identities are scoped by request ID. Explicit source annotations are the opt-in mechanism for cross-request identity. Provider pointers now identify actual payload locations, including OpenAI native items and Gemini's snake-case system-instruction alias.
- Provider fields and nested settings that are not represented now issue and downgrade coverage in the non-media paths. Scalar overrides retain observed values and artifact pointers.
- Report allocation is opt-in and selects at most one boundary per valued observation. It uses inclusive observed input as the denominator, excludes unavailable and counterfactual weights, retains uncovered weight, conserves signed integer nanocost exactly, and leaves output-only or unknown-input cost unallocated.
- Native and offline-browser validators agree on the checked fixtures. The browser bundle embeds schemas, uses no dynamic evaluation, and creates the same report as the native implementation.
- Public package exports include the v0.2 context, capture, provider-capture, and report entry points.

Independent verification after the provider identity, pointer, unsupported-field, and media-coverage fixes: `npm run typecheck` passes; the focused browser/context/capture/provider/report/CLI suite passes 43/43; and the complete repository suite passes 154/154. The earlier three incremental-capture findings were separately rechecked and are recorded as resolved in `docs/reviews/incremental-capture-v02.md`.
