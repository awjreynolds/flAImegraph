# Operation-depth release verification

Version 0.3 adds the operation sidecar, bounded live recorder, conservative native importer, live Pi tool bridge, report validator, standard exports and browser explorer. [The specification](../../spec/0.3/README.md) defines execution ancestry, evidence and immutable reconciliation. [The acceptance plan](../operation-depth-plan.md) records the intended boundaries; [core review](../reviews/operations-core-v03.md) and [producer review](../reviews/operation-producers-v03.md) contain independent findings and corrections.

## Actual execution evidence

The [generated-corpus workload](../../examples/dogfood/v03/files-report.json) records 5,130 spans at seven execution levels: work, worker, declared fact-finding phase, actual `indexRepository`, actual `scanShard`, actual `readBatch`, and each real file read. It reads 5,000 distinct files, then reads one again, writes an edit and runs a passing Node acceptance-test subprocess. The final capture contains 5,001 file-read spans, 11 directory reads, one write and no dropped spans or links. Fixture creation, comparison rounds and subprocess internals are explicitly outside the retained capture.

The benchmark uses the same functions, batching, warmed files and results with and without the recorder in three alternating rounds. The measured medians were 80.155 ms baseline and 199.258 ms recorded, a 119.103 ms increase. This excludes construction, serialization, export and the subsequent edit/test. The workload and instrumentation make no model requests. This measures local CPU/IO overhead and demonstrates no required model-token overhead; it does not establish a universal overhead ratio.

The [Pi bridge artifact](../../examples/dogfood/v03/pi-tool-operations.json) comes from installed Pi 0.67.2 tools. Native and instrumented results were compared for ordinary text reads, binary image reads, an extensionless image, plain text with an image suffix, a truncated PNG, an APNG, write/edit/ls and a failed read. All injectable filesystem calls, including access/exists/stat/mkdir probes, receive spans. The final artifact contains 40 spans, 30 nested. Pi's separate MIME-probe reads remain explicitly outside backing-read byte measurements, so that capture is partial. No Pi model session or model request was made.

The [native Codex evidence](native-dogfood-v03.md) documents a fixed development window, strict same-source cost joins, pseudonymization and native coverage limitations. Native transcripts without explicit parents cannot establish a deep execution tree. The profiler preserves that absence instead of constructing semantic ancestry from nearby timestamps.

The [routing walkthrough](../../examples/dogfood/v03/routing-report.json) is wholly synthetic. It illustrates a 350-line policy, preprocessing model, downstream model and source/summary links. Its $0.101 direct route and $0.070 summary route are invented accounting examples, not observed savings. Shared raw-source producers stay ambiguous; later summary consumption is attributed only to the summary producer. There was no authenticated live Pi model comparison, matched quality evaluation or calibrated Context Points experiment.

## Verification performed

- `npm run check`: 205 tests passed, including public-seam regressions for identity conflicts, provenance, quantities, timing, concurrency, cap behavior, immutable finalization, native joins, privacy, exact totals, CLI input protection and Pi forwarding.
- `npm run build`: passed. Frozen 0.1 accounting conformance: 10 cases passed.
- Targeted TypeScript check for the dogfood/routing/Pi verifier scripts: passed.
- Public operation bundles and reports: semantic validation and immutable replay passed.
- Independent Go `pprof` decoded the 5,130-operation gzip profile and retained the named seven-level stacks. Profile display cutoffs are consumer settings and do not remove samples from the artifact.
- Viewer lint and TypeScript: passed. The browser validator embeds the schemas and uses no dynamic code evaluation or remote schema loading.
- Privacy scan of new public production code, docs and artifacts found no private home path, raw session identifier or account identifier. Native capture additionally checks raw-input-sensitive candidates before publishing metadata.

Browser QA on the local viewer verified seven-level drilling, file byte/evidence detail, global search, 75 visible data rows per page across 5,002 file-related operations, page advancement, and locating the final file. The upstream SVG loaded, zoomed a 50-file batch and reset. Only fixed bundled SVGs are rendered; user-loaded reports cannot supply executable SVGs. The frame is sandboxed with scripts enabled. A host search field passes the query through the upstream renderer's existing URL search parameter, avoiding the native prompt that stalled the in-app browser. Zoom/reset were verified; the host search field received static/type validation after the browser stalled, and its browser interaction remains unverified. The routing view showed the policy's 400-line request and 350-line threshold, model selection, separate route totals, six allocation/residual rows, and producer-to-consumer navigation. WebMCP read-state and valid operation selection succeeded; unknown operation IDs were rejected. Context navigation, the existing lifecycle fixture and its source/summary lineage also worked. Read-byte totals now show unknown when no backing-byte measurement exists. Filtering an allocation table does not claim the capture itself is empty.

## Decisions and remaining limits

Execution profiles show observed containment; source allocation is a separate estimated view of whole request cost including output. Unpriced IO remains inspectable through the execution tree and operation-count profile. Known monetary subtotals preserve the selected valuation and do not represent complete billing. The profiler records workload policies and does not apply its own summarization policy or infer internal reasoning.

Live recorder snapshots are replaceable inspection views. Reconciliation accepts completed immutable captures; it rejects running spans explicitly. Late changes to finished scopes are ignored and recorded as a limitation. This release does not define an evolving distributed-span protocol.

Standalone local report selection is validated in the browser with a 32 MB operation-report cap. Mobile viewport behavior and the native file chooser were not independently exercised in this browser pass. Final deployed browser rechecking was unavailable after the native prompt stalled the verification session; publication does not imply that check passed. Shell internals, hidden model retries, missing native parents and unavailable provider context require additional instrumentation. Semantic phases remain declared unless an integration provides evidence.
