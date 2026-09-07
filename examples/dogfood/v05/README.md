# Synthetic interruption scenario

`lifecycle.json` contains an explicitly synthetic sequence with seven action identities: a workflow, a model request paused for eight hours by quota, a file read with an unexplained eight-hour progress gap, a failed request and its separate retry, an action without observed completion, and an action paused when capture stops. Its three declared usage receipts total 1,410 input tokens, including 30 on the failed attempt. It does not describe a real outage, account balance, model, or measured provider usage.

Regenerate deterministically with `node --import tsx tools/dogfood-lifecycle.ts`. The same capture is available in the viewer as **Interruption scenario (synthetic)**. Validate it with `node dist/cli.js validate --kind lifecycle --input examples/dogfood/v05/lifecycle.json`.

Real process-termination, recovery and storage-fault verification belongs to the public journal tests, not this demonstration. See [the lifecycle guide](../../../docs/lifecycle.md) and [implementation evidence](../../../docs/implementation-evidence/durable-lifecycle.md).
