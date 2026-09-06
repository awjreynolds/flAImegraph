# Capture-depth throwaway prototype

Question: can a real conversation be regrouped to individual response usage while preserving totals and exposing the limits of context attribution?

Open `capture-depth.prototype.html` directly; it is one file with all data and scripts inline. No server, installation, remote assets, or persistence is required. The companion `evidence.json` contains only sanitized usage/provenance and operation metadata. It freezes this conversation and its three linked agents at 2026-09-06 16:36 UTC. These are partial-run quantities, not an invoice.

`extract.cjs` is a deliberately narrow Codex 0.153.4 evidence extractor. It accepts explicit files only:

```sh
node extract.cjs evidence.json 2026-09-06T16:36:00.000Z coordinator=/path/to/root.jsonl telemetry=/path/to/linked-child.jsonl
node build-demo.cjs
```

The extractor removes content, raw session/response IDs and paths; preserve original evidence separately if you need to audit line references. Do not feed unrelated files or assume this is a general cross-version importer. First-observation deduplication does not implement corrections. The fixed explanatory text in the HTML reflects the supplied frozen fixture; replace that text if using a different capture.

Verified: JavaScript/JSON parsing, response sums against thread counters, category containment, and conservation at every profile level across six measures and three groupings. Not verified: browser rendering or interactions; the browser URL policy blocked the local file. User feedback is still pending.

The prototype demonstrates projection arithmetic and makes capture gaps inspectable. It is not production ingestion, exact per-source context attribution, or an accepted UI design. See the main branch research reports and [depth-demonstration ticket](https://github.com/awjreynolds/flAImegraph/issues/9).
