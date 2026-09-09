# Changelog

## Unreleased — logging toolchain candidate

- Publish standalone Draft 2020-12 schemas for usage bundles, lifecycle captures,
  lifecycle events and journal frames, with an independent Python syntax check.
- Add `schema` and `capture` commands, bounded UTF-8 imports and metadata snapshots
  that retain child failures and incomplete output.
- Add explicit Claude stream/transcript and Codex exec import surfaces. Preserve
  Claude query and Codex turn aggregates separately from response consumption.
- Fix Pi settled JSON-mode messages, tool-call/result identities, millisecond
  timestamps and exclusion of nested price estimates. Exclude synthetic Claude
  authentication-error counters from provider receipts.
- Expose the import formats in the local viewer; improve narrow observation
  tables and update affected viewer dependencies to patched versions.
- Add Linux/macOS Node 22/24 checks and published metadata from live CLI probes.

### Migration and compatibility

The usage 0.4 and lifecycle 0.5 document shapes have not changed. Existing semantic
and framing requirements still apply; JSON Schema does not replace them.

Reimport original Pi logs to correct numeric event times previously interpreted
as nanoseconds. Do not shift dates in an already-normalized bundle: the original
producer unit is needed. Tool observations now have distinct call/result identities.
Reimport the source as a replacement dataset instead of merging old and corrected
imports of the same evidence. Existing correct JSON/ISO timestamps are preserved.

Use `claude` for SDK/CLI stream-json and `claude-transcript` for the explicitly
experimental internal transcript reader. Generic `anthropic` remains a provider
request/response importer. Use `codex` for rollouts and `codex-exec` for public exec
stdout. Exec turn totals cannot provide response-level flamegraph attribution.

Capture snapshots require a new output path and replace that path while running.
Do not merge successive snapshots. No command installs hooks or changes harness
authentication, configuration, tool permissions or routing.
