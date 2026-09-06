# Bounded implementation-work capture

These metadata-only artifacts capture two real Codex streams through `2026-09-06T21:03:01.300Z`: 134 coordinator responses from the v0.2 goal and 33 responses from the independent Python producer task. They do not cover the whole project or all subagents.

Open `root-accounting-context-report.json` or `independent-producer-context-report.json` in the Context Explorer. Both retain observed usage and explicit unavailable context. Every cost line is unpriced; the zero known subtotal is not a claim of free work.

Each stream includes sanitized JSONL, an incremental capture state, normalized evidence, context and a self-contained report. `provenance.json` records exact cutoffs, hashes, prefix extension and replay/one-shot comparisons. `independent-producer-work-item-record.json` joins the producer task's observed usage to its earlier three-point estimate and accepted outcome. The scale is uncalibrated.

See [implementation evidence](../../../docs/implementation-evidence/v02-dogfood.md) for boundaries, allowlisted fields and validation. The original source logs are private and are not distributed. `tools/dogfood-v02.ts` recreates the sanitized derivation on the original machine; it reads only the two explicitly named sources. Public consumers can replay the checked-in JSONL using the `capture` CLI, retaining the namespace, dataset and agent options recorded in the corresponding capture state. No raw prompts, tool arguments/results or reasoning text are included.
