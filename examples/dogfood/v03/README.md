# Operation-depth demonstrations

These artifacts exercise four different capture boundaries. JSON reports embed their evidence and declared valuation and can be opened locally in the Operations viewer. Folded, pprof and SVG artifacts use the existing profile formats and upstream FlameGraph renderer.

| Dataset | What ran | What it establishes |
| --- | --- | --- |
| `files-*` | Real filesystem operations over 5,000 generated files, followed by a read/write edit and a passing Node test subprocess | 5,130 spans, seven nested levels, 5,001 reads, 11 directory reads, one write, zero dropped spans/links and zero model calls |
| `pi-tool-operations.json` | Installed Pi 0.67.2 built-in read, image read, write, edit, ls and failure paths | Actual outer tools and injected child IO, preserved results/errors, actual byte counts and derived edit deltas |
| `native-*` | Bounded real Codex development work | Typed native lifecycle structure and usage, exact same-source evidence binding, and explicit limits where the transcript lacks internal IO/context boundaries |
| `routing-*` | Nothing executed; all operations, tokens and prices are synthetic | How a 350-line hook, low-cost summarizer, consuming model and context links can be represented without mixing execution ancestry with estimated source allocation |

`files-benchmark.json` records three alternating warm-cache baseline/instrumented rounds. The current local median scan is about 80 ms baseline and 199 ms recorded: about 119 ms added for this workload. The timer excludes fixture setup, recorder construction, subsequent edit/test, snapshot serialization, validation and export. Results depend on the machine, cache and concurrent load. Zero model calls means zero instrumentation model-token overhead; it does not mean zero CPU, memory or elapsed-time overhead.

Regenerate the controlled corpus and synthetic walkthrough from the repository root:

```sh
node --import tsx tools/dogfood-v03.ts
node --import tsx tools/demo-operation-routing.ts
```

The real Codex capture has separate [provenance and boundaries](../../../docs/implementation-evidence/native-dogfood-v03.md). Raw conversations, tool contents and private file paths are excluded from published captures.

The synthetic direct route totals $0.101. The synthetic summary route totals $0.030 for preprocessing plus $0.040 for the consuming model, or $0.070. These invented values explain accounting; they do not demonstrate actual savings, model rates or equal quality. Original-source context is shared by two read operations, so its estimated amount remains ambiguous between those producers. The summary output has a unique producer. A real choice requires matched tasks and outcomes plus all preprocessing, retries, cache effects and downstream reuse. No authenticated live Pi model comparison was available in this environment.
