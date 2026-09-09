# Logging toolchain release-candidate evidence

Validated locally on macOS with Node 24.14.1 on 9 September 2026. This records
observed checks, not a general availability declaration.

## Portable contract and independent readers

The final reference suite passed 361 tests, including the Pi timestamp regression
correction. Four strict
Draft 2020-12 schemas compile in Ajv. The 23-case language-neutral corpus has
separate structural/semantic verdicts. Python jsonschema 4.26.0 independently
passes all syntax verdicts and two representative captures. The dependency set is
locked in `tools/logging/verify.py.lock`.

The isolated installed package exported usage schemas, validated lifecycle data,
generated a report and exported SVG, folded stacks and pprof. Go's independent
pprof reader reported 72 tokens for the live Pi input profile, matching the
source receipt. No rate card or pricing dependency was needed.

## Capture checks

The capture integration tests launch real child processes with controlled output:
one writes a settled receipt and malformed tail before exiting 7; another emits
a receipt while remaining alive, allowing an early snapshot check. Tests also
cover existing-output preservation, spawn failure and invalid UTF-8. The child
exit status is retained, text is omitted, and incomplete capture remains explicit.

The installed CLI wrapped an actual Pi 0.67.2/Ollama run successfully and recorded
one response with input 72/output 8. An independent raw Pi JSON-mode run produced
the same quantities. Codex 0.153.4 exec succeeded and exposed aggregate turn usage;
Claude 2.1.133 exercised the expired-authentication path only. See the
[published metadata specimens](../../examples/ga-validation/README.md).

The live and browser checks found concrete gaps that were corrected: Pi JSON-mode
settled-message recognition, distinct tool-call identities, nested price omission,
millisecond timestamps, and Claude synthetic-error zero counters. Regression
fixtures preserve the relevant source shapes and independently specified expected
quantities. Successful Claude execution remains unverified.

## Browser checks

The static viewer was built and served on localhost. In the Codex in-app browser:

1. Loaded the published live Pi usage file through **Load a session**.
2. Confirmed input 72/output 8, one observation, missing task association and
   partial coverage; switched the selected metric to output and saw width 8.
3. Opened the response details and inspected native methods and source line 16.
   Start/end/duration remained unavailable. After correcting Pi's source timestamp
   units, reloaded the file and verified `2026-09-09T21:49:04.528000000Z`.
4. Selected the synthetic interruption scenario and recorded-parent hierarchy.
   The UI distinguished completion unobserved, paused at capture, failed usage,
   declared quota wait and an unexplained gap. No current liveness was inferred.

The default narrow viewport also exposed cramped observation columns; minimum
column widths preserve readable text within the existing horizontal-scroll table.

## Dependencies and remaining gates

The initial locked viewer installation reported 11 affected dependency entries.
Patched React, vinext, Vite and Cloudflare tooling were installed with compatible
peer versions. A transitive `sharp` override at 0.35.4 addresses the remaining
[libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
The subsequent install audit reported zero vulnerabilities. Lint, TypeScript and
static export passed on the updated dependencies.

The expanded remote Node 22/24 Linux/macOS matrix and final release support scope
must be verified before declaring GA. The native snapshot wrapper and the durable
lifecycle journal have different persistence guarantees; documentation preserves
that distinction. No successful Claude run, Windows support, full provider billing
coverage, exact context attribution or accepted-work improvement is claimed.
