# Durable capture and interruption recovery

Use the durable journal when losing the last in-memory recorder snapshot would lose important action structure. It is opt-in: existing `UsageRecorder` and `OperationRecorder` captures do not become crash-safe automatically, and old logs cannot gain missing starts or interruption causes retroactively.

```ts
import { openLifecycleJournal, readLifecycleJournal, projectLifecycle } from 'flaimegraph';

const journal = await openLifecycleJournal({
  directory: './capture/run-42', dataset_id: 'run-42', producer_id: 'worker-1',
});
try {
  await journal.withAction({
    action_id: 'attempt-1', subject: 'model.response',
    parent_id: 'task-42', work_item_id: 'PROJ-42',
  }, async () => {
    // This callback cannot run until its start record is synchronized.
    // Invoke the provider/tool here, then record only its supplied usage:
    await journal.measurement('attempt-1', {
      id: 'input_tokens', unit: 'token', description: 'Provider input tokens',
      subset_of: null, overlap: 'disjoint',
    }, {
      value: '120', evidence: 'declared', method: 'Illustrative receipt; replace with provider-reported value',
      count_basis: 'provider_native', aggregation: 'delta', scope: 'event',
    });
  });
} finally { await journal.close(); }

const capture = await readLifecycleJournal({ directory: './capture/run-42', dataset_id: 'run-42' });
const recovered = projectLifecycle(capture);
// recovered.actions exposes state, raw timing, known waits and unexplained gaps.
// recovered.usage feeds the existing usage report/profile consumers.
```

Choose a fresh action ID for each dispatch attempt. Persist a task action before its children when you control both; an external parent reference can be resolved when its producer's capture arrives. Stable work identifiers associate attempts with the same ticket without collapsing their identities.

Record pauses only from evidence supplied by the integration:

```ts
await journal.pause('attempt-1', {
  code: 'quota', evidence: 'observed', method: 'Provider explicitly rejected work until reset',
  reset_at: '2026-09-08T00:00:00Z',
});
// Wait for the declared condition in your integration.
await journal.resume('attempt-1');
await journal.heartbeat('attempt-1'); // Optional explicit progress checkpoint.
```

These calls belong inside an open action. A quota warning does not itself imply work has paused. A caught network exception can be recorded as an error with an observed reason; a dead producer cannot reliably log the cause of its own disappearance. Do not label an unexplained gap as laptop sleep. On restart, record a new attempt with `retry_of: 'attempt-1'` if you dispatch again. If you obtain the original attempt's result, append its terminal evidence using its original action ID; the recovered duration remains unknown across epochs.

```sh
flaimegraph lifecycle-recover --directory ./capture/run-42 --dataset-id run-42 --out lifecycle.json
flaimegraph validate --kind lifecycle --input lifecycle.json
flaimegraph lifecycle-report --input lifecycle.json --out recovery-report.json
flaimegraph lifecycle-merge --inputs worker-a.json,worker-b.json --out combined.json
flaimegraph import --format lifecycle --input combined.json --out usage.json
flaimegraph report --input usage.json --out usage-report.json
```

Load `lifecycle.json` or `combined.json` in the viewer's automatic JSON import to inspect interruptions alongside usage. Keep raw lifecycle captures as the replay source; replace derived reports after merging new events. Do not merge old and new Usage projections of the same lifecycle action.

Critical appends fail visibly at the segment bound or on storage failure. A failed start prevents the wrapped callback from running. If acknowledgement is uncertain, close that writer, recover its evidence, and establish whether work was dispatched before retrying. A failed end leaves completion unobserved even if remote work actually succeeded. The journal does not provide exactly-once external execution.

Each critical event waits for file synchronization. Choose instrumentation granularity with that overhead in mind: start-to-end intervals include the pre-dispatch journal acknowledgement and any in-action logging. They are not benchmarks of the uninstrumented operation or active CPU time. Record independent resource measurements if you need those quantities.

Storage retention, total directory size, heartbeat scheduling and producer integration remain application responsibilities. See [the contract](../spec/0.5/README.md) for synchronization, partial-write, clock and coverage limits, and [the interruption audit](reviews/interruption-resilience.md) for the motivating failures.
