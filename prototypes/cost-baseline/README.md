# Cost as the flamegraph baseline

This public-data example makes **horizontal width monetary cost**. Tokens and timestamps remain supporting evidence; neither determines width. The recorded estimate is **USD 42.5959075**, but the fixture does not establish the complete cost of the task or the amount billed.

[evidence.json](evidence.json) contains 484 content-free assistant observations extracted from Pi's public `before-compaction.jsonl` test fixture. There are 471 positive-cost observations and 13 native zero-cost observations. Two compaction records have no usage or cost and remain explicitly unknown. Any workstream, work-item, ticket or epic grouping used in a demonstration is **analyst-supplied**, not a hierarchy inferred from this fixture. The source only supports assistant sequence and observed compaction boundaries.

## Provenance and currency basis

Source: [Pi fixture at revision `9767ba275f3e9a5ee0f5c5342249b629ab1b2282`](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/test/fixtures/before-compaction.jsonl). The extraction uses all 1,003 physical JSONL records. The source's SHA-256 is `56f9cf221541c09091cf082ad2ed0c4b4931ef5e8857a42dc623afae35a2e59c`.

Pi documents its displayed cost as an estimate in USD based on model pricing. The model type expresses rates per million tokens, and `calculateCost` multiplies usage by model rates and sums the four cost components. This supports interpreting the fixture's monetary values as **recorded model-price estimates in USD**. The fixture has no explicit currency, historical price snapshot, invoice or settlement evidence, and this extraction does not reprice it using current rates. [USD convention](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/CHANGELOG.md#L5665), [rate type](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/ai/src/types.ts#L825), [calculation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/ai/src/models.ts#L891).

All assistant observations name `anthropic` / `claude-opus-4-5`. This is a legacy, unversioned fixture, not a capture of the current Pi runtime. Each observation ID combines the exact fixture digest and one-based physical line. These are reproducible evidence IDs, **not provider response IDs**. They support repeat-import identity for this file but cannot prove that separate records represent separate billable responses.

Only sequence, source identity, timestamps, model/provider/API, stop reason, usage and recorded cost are extracted. Prompts, response content, tool arguments/results, conversational file paths and compaction summaries are omitted. No private sessions or provider calls were used.

## Precision and conservation

JSON monetary lexemes are read as strings and converted with decimal arithmetic, avoiding a new binary floating-point conversion. Native `usage.cost` component and total strings are retained per observation.

| Quantity | Value |
| --- | ---: |
| Exact decimal sum of recorded `cost.total` strings | USD `42.595907499999999555` |
| Assigned chart width | `42595907500` nanodollars |
| Assigned chart width in USD | `42.5959075` |
| Width minus exact recorded sum | USD `0.000000000000000445` |
| Recorded total minus sum of recorded components | USD `-0.000000000000000155922` |

For every observation, `widthNanodollars = ROUND_HALF_EVEN(Decimal(recordedCost.total) × 1_000_000_000)`. The width is assigned **once per observation**. Every parent width is the integer sum of its child observation widths. Do not round a parent independently, count parent totals again, or add component costs to the already counted total. All widths and their sum fit exactly within JavaScript's safe integer range. Original decimal strings preserve the finer source precision; the nanodollar chart quantization is explicit.

The tiny component/total mismatch already exists in the source's serialized arithmetic. The baseline takes the source's `cost.total` as authoritative for each observation and records the residual; it does not silently rewrite that total. A future component-level breakdown would need an explicit residual or allocation rule.

## Coverage limits that must stay visible

- Compactions at source lines 360 and 629 record no usage or cost. Their `widthNanodollars` is `null`, not zero. They cannot receive a monetary width without additional evidence.
- Thirteen assistant records contain zero native cost and zero usage: 12 aborted and one error. They have zero recorded width, but the absence of provider usage is not proof of zero billing. Keep their count visible outside positive-width frames.
- Six other aborted observations contain nonzero recorded costs; these partial observations remain included. No blanket exclusion of failed or cancelled work is applied.
- Hidden requests, provider retries, duplicate responses, or settlement cannot be reconciled from this fixture because provider response IDs and billing evidence are absent.
- Consequently, the chart measures **recorded cost covered by this fixture**, not certified total task cost. Unknown monetary costs cannot be assigned an honest proportional width.

The counts, exact sums, unknown events and quantization policy are also machine-readable in `evidence.json`. A suggested chart note is: “Recorded estimate: $42.5959075 USD. Complete task cost unknown: 2 compactions unpriced; 13 zero-usage aborted/error records are not proof of zero billing. Work-item grouping is illustrative.”

## View and reproduce the cost flamegraph

Open [cost-flamegraph.svg](cost-flamegraph.svg). The existing Brendan Gregg FlameGraph renderer provides the visualization; the project-specific code prepares monetary weights and verifies conservation. [render.json](render.json) records renderer provenance, exact sums and checks; [cost.folded](cost.folded) contains the weighted disjoint response leaves.

Reproduce with the pinned [`flamegraph.pl`](https://raw.githubusercontent.com/brendangregg/FlameGraph/41fee1f99f9276008b7cd112fca19dc3ea84ac32/flamegraph.pl), whose SHA-256 is `088f82e6848a4f12a56e1e8e8170ee6761fccf12e5615cd64630f6b087c99ea7`:

```sh
python3 render.py --renderer /absolute/path/to/flamegraph.pl
```

The adapter verifies the renderer digest, per-observation monetary conversion, sums and rendered leaves. It does not convert time or token counts into width.

## Recheck the extraction

Download the pinned public fixture linked above as `before-compaction.jsonl`, then run this from this directory. It validates the content-free monetary projection and conservation without any dependencies or provider calls:

```python
import hashlib
import json
from decimal import Decimal, ROUND_HALF_EVEN, getcontext
from pathlib import Path

getcontext().prec = 70
capture = Path("before-compaction.jsonl").read_bytes()
evidence = json.loads(Path("evidence.json").read_text())
assert hashlib.sha256(capture).hexdigest() == evidence["source"]["sha256"]
rows = [json.loads(line, parse_float=str) for line in capture.splitlines()]
assistant = [(i, row["message"]) for i, row in enumerate(rows, 1)
             if row.get("message", {}).get("role") == "assistant"]
assert len(assistant) == len(evidence["observations"]) == 484
for (line, message), observation in zip(assistant, evidence["observations"]):
    assert line == observation["sourceLine"]
    for key, value in message["usage"]["cost"].items():
        assert str(value) == observation["recordedCost"][key]
    expected = int((Decimal(observation["recordedCost"]["total"]) * 10**9)
                   .to_integral_value(rounding=ROUND_HALF_EVEN))
    assert expected == observation["widthNanodollars"]
exact = sum((Decimal(o["recordedCost"]["total"])
             for o in evidence["observations"]), Decimal(0))
assert exact == Decimal(evidence["totals"]["recordedCost"]["total"])
assert sum(o["widthNanodollars"] for o in evidence["observations"]) == 42595907500
assert all(c["widthNanodollars"] is None for c in evidence["compactions"])
print("Exact recorded USD:", exact)
```
