# Usage-first demonstrations

Regenerate with `node --import tsx tools/dogfood-usage-v04.ts` after installing dependencies. The generator uses public metadata-only v0.3 artifacts and deterministic illustrative inputs; it does not contact a provider.

- `native-usage.json`: 584 recorded development observations projected from `../v03/native-report.json`. Input total: 11,993,223 tokens. The original capture is incomplete. Applied tier is unavailable; no Fast/standard setting is invented.
- `ticket-usage.json`: the public native Codex coordinator log imported directly through the 0.4 adapter. Real recorded usage has an explicitly declared illustrative work identifier, `FLAI-42 / example work association`; no real ticket or accepted outcome is asserted.
- `files-usage.json`: 5,130 actual recorded operation scopes projected from `../v03/files-operations.json`. There are seven operation levels (eight profile frames including the dataset root), filesystem traversal/read/edit/test evidence and no model-token usage.
- `*.folded`, `*.pprof`, `*.svg`: standard single-meter profiles. Native selects input tokens grouped by model; files selects operation count using real ancestry.
- `*-analysis.json`: session analysis with missing acceptance metadata explicit. A captured operation is not automatically an accepted task.
- `baseline.json`, `candidate.json`, `comparison.json`, `candidate-policy.json`: **illustrative declared** matched tasks and invented models. Include failed samples and analysis overhead. These values demonstrate the API and do not establish a real model ranking.
- `runway-input.json`, `runway-forecast.json`: **illustrative declared** capacity and demand with a frozen horizon. They are not the user's account limits.
- `inspect-log.json`, `inspect-options.json`, `inspect-import.json`: synthetic Inspect-shaped integration example with an explicit scorer rule. It is not a live benchmark execution.
- `manifest.json`: provenance basis, quantity/depth checks and hashes of the canonical compact capture serialization.

The browser uses identical compact capture projections and the same scenario. No raw conversations or tool-result bodies are added by this migration. Original source provenance and limitations remain in the v0.3 artifacts.
