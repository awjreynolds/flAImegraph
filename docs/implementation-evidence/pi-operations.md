# Pi live operation bridge evidence

`createPiOperationBridge(recorder, options?)` in [`src/pi-operations.ts`](../../src/pi-operations.ts) is a structural, zero-model-call integration for Pi's built-in `read`, `edit`, `write`, and `ls` tools. It has no runtime dependency on Pi. Callers pass the returned `readOperations`, `editOperations`, `writeOperations`, and `lsOperations` objects to Pi's `create*Tool(cwd, { operations })` functions, then pass each resulting tool through `bridge.wrapTool(tool)`.

The wrapper records one enclosing operation for the exact built-in tool name and uses the recorder's asynchronous scope so injected filesystem calls become real children. `readFile` returns the original `Buffer`; `writeFile`, `mkdir`, `access`, `exists`, and `stat` retain the local Pi operation contracts. Content reads and writes use file spans; permission checks, directory metadata checks, and directory creation use truthful `other` spans with opaque resource identities and no invented byte quantities. The wrapper forwards the original argument list, receiver, abort signal, update callback, result value, and workload exception. It never blocks, redirects, rewrites, or retries a tool call.

The bridge classifies only the exact names `read`, `edit`, `write`, and `ls`. Other names retain the generic `tool` kind and an opaque semantic label. Default resource labels are opaque and resource IDs are HMAC-SHA-256 values scoped by the recorder namespace. The bridge key is ephemeral when omitted; `resource_key` opts into deterministic IDs. A caller can explicitly publish a safe label through `safe_labels` without exposing a path.

Filesystem observations are made at the injected operation boundary:

- `readFile` records the actual returned `Buffer` length as observed `read_bytes` and `returned_bytes`, a derived backing-byte SHA-256, and the Pi `offset`/`limit` request as a line-range descriptor. It does not infer context insertion. The bridge uses the same pinned `file-type` detector as Pi 0.67.2, with its 4,100-byte probe and four-MIME allowlist. Extensionless images, files with misleading suffixes, truncated PNG signatures, and APNG files therefore take the same branch as native Pi. Pi performs that detector probe before calling `readFile`; the probe is not included in the `readFile` byte measurement and is reported as a coverage limitation when used.
- `readdir` records observed entry and examined-entry counts. `ls`'s existence, stat, sorting, and formatting behavior remains Pi's behavior.
- `access`, `exists`, `stat`, and `mkdir` each record an observed `other` child span at the injected operation boundary. They retain their result or error and leave byte measurements unavailable because those calls do not establish content transfer.
- `writeFile` records the full UTF-8 buffer length as observed `written_bytes`. For an edit, the per-tool asynchronous preimage cache pairs the actual `readFile` buffer with the actual post-write buffer. Inserted and deleted bytes are derived with a named common-prefix/common-suffix byte splice and remain null when no preimage was observed. The cache is scoped to one wrapped tool invocation, so parallel same-path calls cannot exchange preimages.
- A tool result contributes `returned_bytes` only when every result content block is text; the byte count is explicitly derived from UTF-8 text lengths and makes no claim about model-context insertion. Image-bearing results remain unknown at this outer boundary.

Instrumentation metadata is fail-open. Metadata errors are reduced to a stable capture limitation visible through `bridge.snapshot()`; they never cause a second tool invocation or replace a workload result/error. The recorder's own span-cap coverage remains visible in the same snapshot. Raw paths, arguments, contents, result text, and filesystem error messages are not stored in the operation bundle.

The public seam tests in [`test/pi-operations.test.ts`](../../test/pi-operations.test.ts) use real temporary files and structural Pi-compatible tools to cover nested reads, output byte measurement, edit deltas, rejected workload errors, privacy, parallel same-path isolation, and non-content filesystem probes. The manual installed-Pi verifier in [`tools/verify-pi-operations.ts`](../../tools/verify-pi-operations.ts) dynamically loads an explicit absolute Pi module, constructs Pi 0.67.2's actual built-in tools, compares bridged and native results, exercises text, extensionless-image, misleading-suffix, truncated-PNG, and APNG reads, writes, edits, `ls`, and a failed read, validates the emitted bundle, checks privacy, and can write the sanitized metadata fixture [`examples/dogfood/v03/pi-tool-operations.json`](../../examples/dogfood/v03/pi-tool-operations.json).

Verification on 2026-09-07 used the installed Pi `0.67.2` module supplied through the portable `PI_MODULE` variable below:

```text
node --import tsx --test test/pi-operations.test.ts
7 passed, 0 failed

npm run typecheck
passed

PI_MODULE=/absolute/path/to/@mariozechner/pi-coding-agent/dist/index.js
node --import tsx tools/verify-pi-operations.ts \
  --pi-module "$PI_MODULE" \
  --output examples/dogfood/v03/pi-tool-operations.json
{"ok":true,"pi_module":"index.js","pi_version":"0.67.2","spans":40,"nested_spans":30,"read_bytes":"30","edit":{"inserted_bytes":"5","deleted_bytes":"3"},"failed_read":true,"privacy":"passed","result_equivalence":"passed"}
```

The verifier does not create a Pi session or make a model request. Its temporary fixture and private contents are removed before exit; the checked-in artifact contains only recorder metadata.
