# Live logging probes, 9 September 2026

These usage bundles were imported from real installed CLI output for the prompt
“Reply with exactly GA_LOGGING_PROBE”, in an otherwise empty temporary directory.
They contain metadata only. Session, source, operation and observation identifiers
were replaced for publication. Source hashes refer to the original raw captures;
those captures, which can include local paths and settings, are not published.

| Probe | Observed outcome | Expected evidence |
| --- | --- | --- |
| Codex CLI 0.153.4, exec JSON | Successful reply, exit 0; a separate startup warning reported a missing code-mode host | One turn aggregate: input 18,367, cached input 6,400, output 9; no response identity; excluded from direct totals |
| Pi 0.67.2, JSON mode, configured Ollama provider | Successful reply, exit 0 | One settled response: input 72, output 8, cache read/write 0; repeated update/turn-end/agent-end envelopes must not add receipts |
| Claude Code 2.1.133, stream-json | Authentication failure, exit 1, expired OAuth | Two retry notices, one synthetic harness error with no provider receipt, one error result aggregate with reported zeros; no successful Claude run is claimed |

Codex ignored user configuration and used read-only tool policy with a no-tools
prompt. Pi disabled tools, extension/skill/template/theme discovery and saved
sessions. Claude disabled tools, hooks, MCP servers, saved sessions and loaded
settings sources. These probes do not certify normal configured user sessions,
multi-agent work, crash recovery or complete physical provider-attempt capture.

The Claude research report also found a different installed executable/version;
the live probe above is specifically the `/opt/homebrew/bin/claude` invocation
resolved by the validation shell. The raw CLI help/version/source inspection is
not a substitute for a successful provider run.
