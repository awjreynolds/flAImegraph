# Operation producers v0.3 independent review

Review scope: `src/operation-recorder.ts`, `src/native-operations.ts`, `src/pi-operations.ts`, their focused tests and implementation-evidence notes, the controlled 5,000-file corpus under `examples/dogfood/v03`, the live Pi verification artifact, and the synthetic routing walkthrough.

## Result

**Approved after corrections.** The initial producer pass found invalid observation binding, asymmetric native identity handling, inconsistent session identity, evidence and execution overstatement, privacy leakage through parser diagnostics, unbounded link capture, incomplete Pi filesystem interception, a divergent Pi image probe, and an unstated live-snapshot merge boundary. The implementation and public evidence were corrected during review and pass the independent gate below.

## Findings

### Resolved [P1] — Duplicate observation IDs could make recorder snapshots invalid

At span creation, the recorder initialized `observation_id` before updating its uniqueness index. Binding a second span to the same observation first deleted the first span's index entry, leaving both spans with the same ID. The resulting snapshot failed `validateOperationBundle` with “An observation may bind to at most one operation.”

The recorder now initializes the field to null, binds only after the span is retained, and removes an old index entry only when that span owns it. A duplicate keeps the first binding, omits the second, records a limitation, marks coverage incomplete, and still returns the callback result.

### Resolved [P1] — Native identity collisions depended on arrival order

The importer rejected a model event that reused an existing tool identity, but did not reject the reciprocal order. A model record followed by a tool call and result with the same session/native ID merged into one schema-valid `model` span carrying file I/O. This corrupted operation classification while appearing valid.

The corrected builder enforces operation-category coherence in both directions while preserving result-before-call enrichment for one tool attempt. Regression permutations cover model-first, output-first, and call-first collisions.

### Resolved [P1] — One native lifecycle could silently change parent, resource, or outcome

Call and result halves sharing an ID could disagree on explicit parentage, requester cell, tool classification, model metadata, or resource path. Later records overwrote some earlier facts. A separate status path could also turn `success: false` or `isError: true` back into `ok` when a contradictory textual status said success.

The importer now permits missing-to-known enrichment but fails closed when two present lifecycle facts conflict. Explicit error indicators dominate fallback status text. Duplicate signatures include the semantic facts that determine one immutable operation rather than only payload fingerprints and timestamps.

### Resolved [P1] — Legacy Codex session fallback split exact call/result pairs

A `session_meta` record stored a raw session ID, while later records that omitted their own session were prefixed again by `eventSession`. The same call therefore used `codex:session-1` when session was inherited and `session-1` when a result repeated it explicitly. A mixed implicit/explicit pair became two streams and two spans, and the default could become `codex:codex:default`.

Session identity is now normalized once. Exact native IDs pair within the same session regardless of whether each lifecycle record repeats the session field.

### Resolved [P1] — Native byte/count evidence overstated local derivations

The initial measurement helper labelled every non-null I/O value `observed`. Several values were instead computed by the importer: UTF-8 result length, structured write/edit field length, and array length. A requested write payload also does not by itself prove that those bytes reached storage.

The corrected importer assigns evidence and methods per measurement, distinguishes a derived result length from a directly observed native field, and does not infer a directory entry count from arbitrary content-block arrays. Unknown backing read bytes and missing usage remain unknown rather than zero.

### Resolved [P1] — Missing source digests could weaken cost/provenance joins

Observation binding normally required a source whose SHA-256 matched the exact native input. A source with the caller-selected ID and no digest bypassed that check. Line coordinates could then bind cost evidence to different bytes under a reused source name.

Native evidence joins now require the exact input digest. Direct model observations bind by their auditable source coordinates only; ambiguous or reused bindings remain unbound or fail closed rather than using timestamps, names, or proximity.

### Resolved [P1] — Transcript items were presented as extra model executions

Legacy Codex `message` and `reasoning` response items were initially promoted to observed model spans by their item IDs. Those IDs identify transcript content items, not inference executions. This added 129 apparent model operations to a window containing 103 direct usage records. Native `token_count` snapshots were also eligible to appear as summary work even though they describe accounting state rather than an executed summarization event.

The importer now creates Codex model spans only from records with an explicit response, inference, or request identity under the supported native lifecycle. Unidentified message and reasoning items are omitted with a coverage limitation. Token-count snapshots do not become operation spans; actual compaction lifecycle records remain eligible when they expose a stable native execution identity.

### Resolved [P1] — Malformed JSON could leak transcript text through coverage diagnostics

Node's `JSON.parse` error text may echo a prefix of the malformed input. The native importer copied the shared parser's message into `coverage.limitations`, so a malformed line beginning with private content exposed that content even though valid tool inputs and outputs were omitted.

Native parse diagnostics now retain only a sanitized code and coordinate. The privacy regression supplies a secret malformed fragment and confirms it does not occur in the bundle.

### Resolved [P1] — Recorder classification defaults overstated caller annotations

Generic `run({kind: ...})` labelled its caller-supplied semantic kind as observed. A no-op callback could therefore be presented as an observed model, test, or phase operation. Generic context links similarly defaulted to observed even though the caller declared the relationship.

Generic operation and link classifications now default to declared. Concrete filesystem wrappers explicitly mark their wrapper boundary observed, while locally calculated hashes and excerpt lengths remain derived. Caller-supplied classifications remain available when an integration has stronger evidence.

### Resolved [P1] — A span cap did not bound recorder links

`max_spans` bounded spans and indexes, but a retained callback could append an unlimited number of distinct links. Duplicate detection scanned the entire link array, making a large capture both unbounded and quadratic.

The recorder now has a finite `max_links`, constant-time exact replay detection, and cumulative `dropped_links_by_stream` counters. Link loss is fail-open for the workload and makes coverage incomplete. Validation and reconciliation check the counters and merge overlapping cumulative snapshots by the per-stream maximum.

### Resolved [P1] — Pi's injected filesystem probes were outside capture

The Pi bridge wrapped public tool methods but initially missed filesystem calls made by Pi's own tool implementations through injected `access`, `exists`, `stat`, and `mkdir` functions. A tool could therefore report complete coverage while these real operations were absent.

The bridge now records every injected probe as an `other` span with an opaque resource identity and truthful unknown byte quantities while preserving return and error behavior. Pi's separate native image MIME probe remains an explicit limitation because its bytes do not pass through the injected `readFile` boundary.

### Resolved [P1] — Pi image detection did not match the integrated runtime

The first bridge used a handwritten magic-signature check while claiming Pi-equivalent image behavior. Pi 0.67.2 uses `file-type`; the two approaches diverge on truncated signatures and formats such as APNG, so an instrumented read could return a different result from the native tool.

The bridge now pins the same `file-type` 21.3.4 implementation, 4,100-byte probe, and JPEG/PNG/GIF/WebP allowlist as the integrated Pi version. The installed-Pi verifier compares native and bridged behavior for a valid PNG, an extensionless image, a misleading suffix, a truncated PNG signature, and APNG.

### Resolved [P1] — Live and completed snapshots had no stated merge contract

A running snapshot and the later completed snapshot necessarily differ under one operation ID, so immutable reconciliation rejected them as a conflict. Completed scopes also remained mutable after `run` returned, allowing terminal semantics to change beneath an immutable ID.

The v0.3 boundary is now explicit: a live snapshot is a replaceable inspection view and reconciliation rejects any bundle containing running spans. Once an operation finishes, scope metadata and links are frozen; late mutation is ignored with an incomplete-coverage limitation. Completed captures remain immutable and replay-safe.

### Resolved [P2] — Opaque resource identity collapsed non-UTF-8 byte paths

The recorder converted Buffer paths through UTF-8, allowing distinct POSIX byte paths to collapse through replacement characters. It now canonicalizes string, file-URL, and Buffer paths to the same byte framing when they denote the same path, while preserving distinct invalid byte sequences. Only the HMAC is exported.

### Resolved [P2] — Generic links could corrupt an otherwise valid snapshot

The convenience `linkContext` method rejected empty IDs, but generic `link` accepted empty context, request, or occurrence IDs and self-dependencies. Those values were retained and made the next snapshot fail validation.

Invalid link targets are now omitted with a coverage limitation. They do not block or alter the recorded workload.

## Public evidence assessment

The controlled file workload executes ordinary `node:fs/promises` operations through the recorder. Its retained capture contains 5,130 unique spans: 5,001 file reads over 5,000 distinct opaque resources, 11 directory scans, one write, one test command, and the declared wrapper scopes. All 5,130 outcomes are `ok`, maximum execution depth is seven, no spans or links were dropped, and there are no model operations or routing facts. The reported timed median compares the same warmed 5,000-file scan and excludes fixture creation, recorder construction, later edit/test work, serialization, and export. It is an environment-specific overhead measurement, not a performance guarantee.

The public JSON contains no scratch path, source body, subprocess test path, or filesystem error text. Folded, Trace, SVG, and decompressed pprof outputs were checked for the same private markers. User-selected labels expose only generated corpus names. The operation bundle, report, and replay validate; all parent and source references resolve.

The bounded native run selects 837 real transcript rows and 3,459,484 UTF-8 bytes under the published snapshot digest. It produces 207 spans: 103 model, 69 command, 33 tool, one file read, and one file write. All 103 direct model observations join by exact source digest and line; 94 are priced and nine with an unknown model remain unpriced. The known scenario subtotal is 15,179,758,000 USD nanos. Three lifecycle records without stable call identities are counted as dropped. There are no observed execution parents, so the truthful maximum depth is one. Exact re-import, replay merge, standard profiles, and the generator's raw-input privacy scan pass.

The installed-Pi 0.67.2 verification compares bridged and native results across text, image edge cases, write, edit, list, failure, and injected filesystem-probe paths. It retains 40 spans, including 30 nested spans; 38 outcomes are `ok` and two are `error`. No spans or links are dropped. The artifact is partial only because Pi's native image MIME probe occurs outside the injected read boundary. The verifier makes no model request, and result equivalence and privacy checks pass.

The routing walkthrough is explicitly synthetic. It executes no model or filesystem workload and marks all operation classification, routing, usage, token, and cost facts as declared or invented. Its direct route is 101,000,000 USD nanos and its two-model summary route is 70,000,000 USD nanos; both are scenario inputs, not measured savings. Execution self-cost and both alternative source allocations independently conserve 171,000,000 nanos. The shared original revision has two recorded producers, so its 80,800,000- and 24,000,000-nano portions retain empty operation paths. The uniquely produced summary carries 20,000,000 nanos to `summary-op`; request residuals retain the remaining 46,200,000 nanos. The artifacts repeatedly state that quality, cache behavior, rework, latency, bytes, provider rates, and savings were not measured.

## Remaining boundaries

These producers create no profiler policy hook of their own. In the reviewed recorder, cap exhaustion, invalid links, duplicate observation bindings, and late scope updates do not change callback results; filesystem failures and callback exceptions are rethrown as the original workload errors. Routing is recorded only as a declared workload-policy fact. The Pi bridge likewise observes and forwards tool behavior without applying workload policy.

Native transcript coverage remains partial by construction. It cannot establish internal shell/file work, provider retries, child work absent from the source, or complete billing. Tool result bodies, paths, commands, arguments, and error messages remain outside the bundle. Model cost becomes exact only when a separately validated evidence source with the same native digest supplies one direct observation at an exact source coordinate; otherwise cost stays unbound or unknown.

## Independent verification

- Focused recorder, native, core-operation, and Pi suites: 44 tests passed. The final native-only suite contributed 13 tests, including response-item and token-count regressions.
- `npm run check`: TypeScript passed and all 205 tests passed.
- `npm run build` and `git diff --check`: passed.
- Public files, native, Pi, and routing operation bundles validate. Files, native, and routing reports validate; their evidence, valuations, and routing context artifacts validate through the public CLI.
- The installed Pi 0.67.2 verifier reports native/bridged result equivalence and privacy success for its complete matrix, including truncated-PNG and APNG branch regressions.
- Immutable self-replay reproduced 5,130 file spans, 207 native spans, 40 Pi spans, and 13 routing spans without duplication.
- Textual JSON, folded, Trace, SVG, and decompressed pprof projections were scanned for the controlled scratch path, source fixture body, subprocess fixture name, private home path, and temporary-workload prefix; none occurred.
