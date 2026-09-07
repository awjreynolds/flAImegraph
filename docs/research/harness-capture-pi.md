# Pi telemetry capture boundary

Research date: 7 September 2026. Decision evidence for [Which Pi capture boundary provides the evidence we need?](https://github.com/awjreynolds/flAImegraph/issues/36), under [Find a practical telemetry capture route for developer harnesses](https://github.com/awjreynolds/flAImegraph/issues/34).

## Finding

A Pi extension subscribing to automatic execution events is the strongest identified candidate for detailed capture. Session JSONL remains a useful offline fallback. A launcher could enable the extension, while a herdr plugin could manage setup and identity. These are candidate roles for the later integration decision, not implemented TScope commands or a tested compatibility claim.

## Observable surfaces

At inspected Pi source revision `9767ba275f3e9a5ee0f5c5342249b629ab1b2282`, extension loading supports explicit `-e` paths, global/project discovery and package distribution. Thus an illustrative `tscope pi` wrapper could launch Pi with an extension path; installing an automatically discovered extension is another option.

Events cover model/thinking selection, context construction, provider request/response boundaries, assistant streaming/completion, tool execution, compaction and session lifecycle. Particularly relevant events are `before_provider_request`, `message_end`, `model_select`, `thinking_level_select`, `tool_execution_start/update/end`, `session_compact`, `session_compact_failed`, and `agent_settled`. The last distinguishes settled work from an `agent_end` that will retry. Tool arguments can contain content and should not be copied indiscriminately under metadata-default capture.

Source: [Pinned Pi extension documentation](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/docs/extensions.md).

Session JSONL can preserve assistant provider/model/usage/stop reason, tool results, tree ancestry, model/thinking changes and compaction/branch information. Its usefulness depends on which records the installed version writes; a session tree parent is not automatically an agent-delegation relationship. Native records can reconcile extension output if identities are retained.

Source: [Pinned Pi session format](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/docs/session-format.md).

## Durability and interruption

Inspected extension execution awaits relevant handlers. `before_provider_request` is a candidate pre-dispatch boundary; a durable writer must finish its required acknowledgement before returning. Merely scheduling a background write does not provide flAImegraph's journal guarantee. `after_provider_response` occurs after a response has arrived and is too late to establish a durable start before dispatch. `message_end` precedes persistence of the finalized message, so an event listener and the session file do not have identical failure boundaries.

Sources: [Extension runner](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/extensions/runner.ts), [Agent session](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/src/core/agent-session.ts), local [lifecycle contract](../lifecycle.md).

## Existing flAImegraph support and gaps

The existing [adapters](../../src/adapters/index.ts) support inspected legacy Pi transcripts and Pi v4 storage contracts: assistant receipts or durable `usage.row` records supply usage, while cumulative totals remain snapshots. This does not establish compatibility with every current Pi version. The [Pi operation bridge](../../src/pi-operations.ts) supports deeper filesystem observation only when tools are constructed through that bridge; it does not intercept arbitrary installed Pi sessions. Existing [capture research](pi-capture-fidelity.md) should remain the baseline for version-specific fixtures.

No universal subagent lineage guarantee was established. Third-party spawning extensions may require explicit propagation of identities and child usage, especially when child sessions are not persisted. Do not infer child ancestry from a shared process or terminal alone.

## herdr relationship

herdr's documented Pi integration installs a Pi extension for agent/session-state reporting. That demonstrates a manager-to-harness setup path. herdr plugins are separate executable packages; installing one does not automatically grant Pi-internal model/tool observation. The user-supplied quota plugin is a packaging and attribution reference, not a per-call telemetry feed.

Sources: [herdr integrations, 0.8.2 documentation](https://github.com/herdrdev/herdr/blob/master/docs/versions/0.8.2/website/src/content/docs/integrations.mdx), [herdr plugin documentation](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx), [herdr-agent-quota](https://github.com/levi-qiao/herdr-agent-quota).

## Decision implications and verification still needed

Compare a Pi extension plus importer-compatible local evidence against session-only capture in the later route decision. Preserve metadata by default, opt-in raw content and post-work analysis. Model/effort configuration should retain whether it was selected or confirmed; missing final usage stays unavailable. A herdr plugin can be optional setup/status infrastructure, not the usage authority.

No live execution, installation, crash experiment or provider round-trip was performed. Validate the selected Pi release, exact event ordering, final-usage semantics, observer failure behavior, reconciliation and third-party child propagation before claiming supported integration. No production code or harness configuration changed.
