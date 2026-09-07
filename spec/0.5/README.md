# Durable lifecycle interchange 0.5

This experimental contract adds immutable action lifecycle evidence alongside the unchanged Usage Interchange 0.4 contract. Its purpose is to retain action identity and ancestry before work begins, recover valid evidence after producer failure, and qualify timing when pauses or gaps are present. It does not determine a remote request's result, subscription allowance, or interruption cause from silence.

The normative TypeScript transport definitions are in `src/lifecycle-types.ts`; the strict portable validators are `validateLifecycleEvent` and `validateLifecycleCapture` in `src/lifecycle.ts`. The filesystem reader additionally validates journal framing and integrity. Unsupported fields and versions fail validation. Raw prompts, responses, error objects and credentials are not contract fields. Caller-supplied identifiers, dimensions and reason methods remain caller-controlled metadata.

## Identities and ordering

A `LifecycleCapture` has `schema_version: "0.5.0"`, `kind: "lifecycle"`, one `dataset_id`, an `events` array and retained `issues`. An event identifies its producer, an opaque globally unique `epoch`, and a nonnegative safe-integer `sequence`. Its `event_id` must be exactly `epoch:sequence`. Every epoch begins with sequence zero and `data.kind: "epoch"`; every successful writer open creates a new epoch. No process identity or PID is used to reclaim an earlier writer's file.

Events contain a UTC `wall_at` timestamp with up to nanosecond precision, and integer-string `monotonic_ns`. Sequence is authoritative within an epoch. Monotonic timestamps must not decrease there. Wall clocks may change. Monotonic values from separate epochs must never be subtracted, even when both epochs have the same producer. The global sort order of epochs is deterministic, not causal.

Action IDs are unique throughout the dataset. A start records its subject and optional parent, retry, work item, task, session, agent and processing dimensions. A retry always uses a new action ID and names the previous attempt in `retry_of`. Parent IDs refer to action IDs, including actions from other producers; a missing parent is retained and reported. Parent cycles, self-parenting and self-retry are invalid.

Exact event redelivery deduplicates by event ID. Conflicting content under an existing event identity fails with `LIFECYCLE_CONFLICT`. Multiple distinct starts or terminal events for an action also fail. A late terminal record may arrive from a later epoch, but it supplies no same-clock elapsed interval. Pause, resume and heartbeat transitions require the starting epoch in this first implementation; after a restart, record a new retry if work is dispatched again. End and usage receipt records may resolve earlier actions without dispatching them again.

## Event kinds

| Kind | Meaning |
| --- | --- |
| `epoch` | A producer writer opened. No action or remote result is implied. |
| `start` | The named action and its recorded associations exist. The journal acknowledges this before a wrapped callback runs. |
| `pause` | The caller supplies an explicit interruption reason and evidence. Nested pauses are invalid. |
| `resume` | Ends a recorded pause in the same epoch. It is not a retry. |
| `heartbeat` | The caller reached a checkpoint for this action. It does not establish remote progress or current liveness. |
| `end` | A caller-observed terminal state: `ok`, `error`, `cancelled`, or `unknown`. No end is inferred from shutdown or silence. |
| `measurement` | One immutable usage receipt attached to an action, with exact quantity, evidence, method, counting basis, aggregation and scope, plus its meter definition. |

Reason codes are `quota`, `rate_limit`, `network`, `service`, `sleep`, `user`, and `unknown`. Reasons require `observed`, `declared`, or `unknown` evidence and a method. Unknown code and unknown evidence must occur together. A source-supplied `reset_at` is optional. A quota warning alone is not a pause: the integration records a pause only when waiting actually begins. The journal does not query account balances or classify arbitrary errors automatically.

## Recovery and materialization

The projector returns canonical deduplicated events, action states, issues and a Usage 0.4 projection. A start without an end becomes `completion_unobserved`, or `paused` if an explicit pause remains open. Neither state proves the producer is currently alive. A terminal event without a start remains visible with missing ancestry and start time. Later evidence can resolve that absence.

Known wait is the sum of explicitly closed pause intervals from one monotonic epoch. It is a lower bound when a pause remains open. If epoch sequences are missing, intervening transitions are unknowable: the confirmed wait lower bound becomes zero and `LIFECYCLE_WAIT_UNCERTAIN` records that the duration is unknown. Elapsed time is the monotonic difference between start and end in one epoch. It includes pre-dispatch journal acknowledgement and other instrumentation overhead. Neither elapsed nor elapsed minus known wait establishes active CPU time or uninstrumented operation latency. Parent and child intervals can overlap. Usage receipts delivered after completion do not extend the action's timing or create execution-progress gaps.

The default gap threshold is 60 seconds between action lifecycle records outside an explicit pause, configurable as a positive integer-string `gap_threshold_ns` at projection time. A gap reports missing progress evidence; it does not assert sleep, network failure or service downtime. An ordinary long operation with sparse checkpoints can also trigger it. A wall/monotonic discrepancy exceeding one second, clock reversal, missing epoch sequence, missing completion, known pause, or cross-epoch completion qualifies timing. This is a diagnostic policy, not an OS suspend detector. Raw terminal wall time remains in the capture even if it precedes start; the Usage projection omits an invalid end interval and retains the raw end as a namespaced dimension.

Measurements become separate usage observations parented to their action, preserving their individual receipt identities. Exact duplicate delivery adds nothing; direct deltas add once, while cumulative/snapshot receipts remain non-additive under Usage 0.4 rules. Failed and retried actions retain their receipts. Missing receipts mean unknown consumption, including potentially billable remote work. Definitions for subset parent meters must be present in measurement evidence before the resulting Usage projection can validate.

Materialized action rows can change as new events arrive. Merge raw lifecycle captures with `mergeLifecycleCaptures`, then project afresh. **Do not merge successive Usage projections of one capture as immutable Usage observations.** Lifecycle projections declare partial coverage because instrumented boundaries cannot establish all provider work or prove that an unseen journal segment never existed. Capture issues remain in coverage limitations. A complete journal is not proof of complete external activity.

## Local journal framing and durability

Each writer creates a fresh UUID-named `.jsonl` segment exclusively. Independent writers never append to the same segment; concurrent producers and restarts need no stale-lock takeover. Each newline-terminated UTF-8 frame has exactly `event`, `previous_hash`, and `hash`; `hash` is lowercase SHA-256 of `canonicalUsage({event, previous_hash})`. The first previous hash is null; later frames name the previous frame hash. Hashes detect accidental modification and torn framing, not malicious rewriting or authenticity.

The writer serializes appends, writes a complete frame, synchronizes the file, and only then resolves its promise. File creation also synchronizes directory metadata. The first start acknowledgement occurs before `withAction` dispatches its callback. A storage failure is visible; uncertain write/sync failure poisons that writer. Do not retry an action blindly after an uncertain acknowledgement: read the retained journal, reconcile action/event identities, and separately establish whether dispatch happened. A successful callback followed by terminal logging failure does not become an error terminal event. Callback results and raw errors are not retained.

Recovery reads validated prefixes, preserving original segment bytes. An unterminated final suffix is excluded with a diagnostic; it is never silently counted, truncated, or overwritten. A malformed newline-terminated frame, invalid chain or interior corruption fails visibly. A restart writes a new segment. Live recovery is a point-in-time read and may see a suffix while its producer is writing; repeat recovery after the producer settles can resolve it. Missing entire segments cannot be detected by an intra-segment hash chain.

Defaults are 64 MiB per writer segment and 256 MiB per recovery read. A full segment fails before the next critical append; there is no automatic eviction. Integrators own retention, directory-wide quotas, heartbeat cadence, rotation and recovery scheduling. This first implementation supplies explicit recording and recovery APIs; it does not transparently retrofit every existing recorder or third-party harness.

File synchronization is an operating-system/filesystem acknowledgement, not a universal power-loss guarantee. Device loss, network filesystem semantics, dishonest hardware caches and platform-specific suspend behavior remain limits. The implementation tests real process termination and software-controlled storage faults; they do not constitute physical power-cut testing.
