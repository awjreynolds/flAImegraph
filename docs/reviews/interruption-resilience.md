# Interruption resilience audit

Status: audited on 2026-09-07 against the v0.4 implementation and the action-timing follow-up. This document distinguishes current behavior, corrections in the timing patch, and proposed work. A durable interruption/recovery subsystem is **not implemented** by this patch.

## Verdict

flAImegraph preserves available evidence and handles some replay and partial-capture cases. It does not yet guarantee recovery of live recorder state after process death or power loss, and it cannot reliably attribute a long duration to active work, a quota pause, laptop sleep, a network wait, or a service outage.

Structural evidence survives when its records and identifiers survive. In-memory parent scopes and unwritten events can be lost. A missing terminal event is evidence that completion was not captured, not evidence that a particular interruption occurred. A provider request may complete and consume resources after the client loses contact.

## What exists

- Usage and operation recorders retain start, end, status, identity and parent information supplied or captured at their boundaries. Operation scopes record wall-clock endpoints and a monotonic elapsed measurement. [Usage recorder](../../src/usage-recorder.ts), [operation recorder](../../src/operation-recorder.ts).
- A usage observation may be `running`, `ok`, `error`, `cancelled` or `unknown`. Work/acceptance metadata separately supports `interrupted` and `capped`. These are representations, not automatic interruption detectors. [Usage types](../../src/usage-types.ts), [analysis types](../../src/efficiency-types.ts).
- Exact immutable replays deduplicate; changed facts under the same identity fail rather than silently replacing prior evidence. Independent source loss counters are preserved. This is an evidence merge, not a mutable action-state recovery protocol. [Reconciliation](../../src/usage.ts).
- The older native capture pipeline has validated byte/record cursors and prefix hashes for Codex/Pi streams. Exact replay is idempotent; rewritten/truncated prefixes and incomplete JSONL tails are rejected without mutating the prior state. Continuing requires the persisted state and a valid complete source prefix. It is not an automatic log-rotation or torn-tail repair service. [Capture implementation](../../src/capture.ts), [tests](../../test/capture.test.ts).
- Individual artifact files are written through a temporary file and rename. This protects against readers observing a half-replaced output and helps retain the prior artifact on ordinary write failure. No file/directory synchronization or multi-file transaction is implemented, so this is not a power-loss durability guarantee. [Artifact writer](../../src/files.ts).
- Native operation import retains explicit available relationships and reports missing parents/terminal evidence. Some unfinished native spans are reported as unknown; parent-linked unfinished spans can remain running. Neither state verifies current process liveness. [Native importer](../../src/native-operations.ts).

## Failure scenarios

| Scenario | Present behavior / risk | Required mitigation |
| --- | --- | --- |
| Subscription allowance exhausted or rate limit reached | Supplied exceptions/statuses can be recorded; there is no quota-paused lifecycle, reset event, or automatic allowance integration. A percentage does not establish remaining tokens. | Explicit evidence-backed `quota_wait`/`rate_limit` reasons, blocked intervals, reset/resume events, and an unknown fallback. |
| Context-window compaction or agent restart | Saved native evidence may remain readable; in-memory recorder state and implicit scope stacks are not restored automatically. | Stable run/work/action identities plus a new producer epoch per restart; durable parent links and continuation events. |
| Process crash, forced termination, power cut | Unexported maps/arrays vanish. A previously saved open snapshot can show missing completion, but cannot recover unwritten observations or count their loss exactly. | Durable local lifecycle journal, documented flush/ack policy and loss window, startup recovery scan. |
| Laptop sleep, process suspension, event-loop starvation | A span can remain open for hours. Elapsed clocks do not identify why execution paused; sleep inclusion depends on the clock/platform. | Wall and monotonic samples with clock identity, suspend/resume evidence where available, heartbeat gaps labelled as gaps rather than proof of sleep. |
| Provider/MCP/DNS/network outage or slow disk | An awaited action includes time spent waiting. Generic errors do not identify all causes. | Structured wait/timeout/failure reasons with provenance; separate queue, backoff, service and local-work intervals where instrumented. |
| Response lost after server completes | Client outcome and provider consumption may be unknown; blind retry can repeat a real operation and consume usage twice. | Keep an unknown outcome, preserve request/response/idempotency identifiers, record each retry as a distinct attempt and reconcile late provider evidence. Never report absent usage as zero. |
| Parent process dies while child continues | Persisted explicit parent links can survive; an unsaved parent may be absent. Native import can leave parentage null with a limitation. | Durable parent ID before dispatch, orphan placeholders/unresolved edges, later resolution without inventing ancestry. |
| Start snapshot followed by completion snapshot | Current immutable usage merge rejects the changed same-ID observation. This is intentional, but prevents using ordinary bundle merge as a recovery journal. | Append immutable lifecycle events and derive a materialized action view, or a separately versioned state-update protocol with ordering/conflict rules. |
| Truncated final log record / rotation / source rewrite | Capture rejects invalid tails or changed prefixes and retains the previous accepted state. New complete records before a torn tail are not automatically salvaged. | Quarantine partial tails, recover only validated frames, explicitly link rotated streams and record uncertain gaps. |
| Disk full, permissions failure, exporter down, queue overflow | File writes fail; recorder caps report observed dropped events. There is no durable delivery spool or collector-health timeline. | Bounded durable spool, backpressure/drop policy, queue/flush/dropped metrics, and conspicuous capture-health warnings. |
| Duplicate, delayed or reordered events | Identical immutable IDs deduplicate; conflicts fail. There is no general per-action lifecycle sequence/recovery ordering contract. | Per-producer epoch/sequence, stable event IDs, out-of-order resolution and late-terminal-event rules. |
| Host clock correction or cross-host clock skew | Monotonic local operation duration resists wall-clock jumps; wall-clock comparisons can be misleading. Monotonic values from different processes/boots must not be subtracted blindly. | Clock domain/boot identity, explicit uncertainty, and separate causal ordering from timestamp ordering. |

## Timing patch corrections

The action-timing patch fixes proven local problems without claiming full resilience:

1. Usage and context displays now distinguish Start, End, Duration, event time and collection time. Missing boundaries say **Not captured** with a reason; event time is never silently substituted for start.
2. Supported Codex usage imports preserve explicit outer-envelope event/start/end timestamps. The legacy adapter retains an explicit start in `flAImegraph.timing.started_at`; migration and the context view retain that distinction. Existing OTLP explicit span starts remain usable.
3. Recorded interval measurements retain their evidence/method. Otherwise duration is visibly derived from explicit endpoints; fractional precision and zero survive. Invalid reversed intervals are not rendered as zero.
4. A running action remains **In progress** even when an elapsed-so-far measurement exists. The explanation says that this is captured state, not verified current liveness. Durations are not labelled active work.
5. A usage snapshot containing running observations can no longer declare complete capture. A focused public-API regression reproduced the prior incorrect `complete: true` result and verifies the correction.

## Independent probe results

A separate read-only capture audit confirmed that a public `startModelCall` → snapshot → `end` → snapshot sequence produces `USAGE_CONFLICT` when the two snapshots are merged: the same observation ID changed. The analogous operation merge explicitly rejects an open snapshot with `OPERATION_MERGE_RUNNING`. The completed snapshot is valid by itself. These checks demonstrate the lifecycle/replay boundary; they are not crash-injection tests.

The audit also confirmed two less obvious gaps. A callback that catches and swallows a provider error returns normally, so the generic wrapper records `ok`; callers must supply meaningful status/error evidence. Capture CLI evidence and state files are replaced sequentially, so an interruption between writes can leave different generations even though each individual replacement is atomic. [Capture CLI](../../src/pricing-cli.ts).

Recorder bounds can also degrade ancestry: dropped scopes still execute, but lack an exportable identity; descendants may attach to a retained ancestor. Reported drop counts explain that loss, but cannot reconstruct the missing structure. Hard process loss can remove the counters themselves along with the events.

## Proposed next implementation

Add a versioned lifecycle journal beside the existing immutable usage interchange. Each event should carry an event ID, stable action/work/run IDs, producer epoch and sequence, parent identity, source provenance, UTC time, and the applicable local clock domain. Start, end, pause, resume, heartbeat, retry and recovery events must remain distinct. Interruption reasons must say whether observed, reported, inferred or unknown. Store normalized error categories rather than raw prompts, credentials or arbitrary provider error bodies.

Persist the start/parent record before dispatch when the selected durability policy requires it. Journal acknowledgements must distinguish an in-memory append, an OS write and a synchronized durable write. Batched synchronization should declare its possible loss window. Recover valid frames after restart, retain open actions as **completion unobserved**, and never synthesize success/end time from a timeout or reboot. A new attempt links to the prior attempt; it is not the same billable call replayed under a reused identifier.

Expose separate user-visible clocks: wall elapsed, recorded operation interval, observed waiting/blocked time, and active work **only when independently measured**. Show an unexplained gap when classification is unavailable. An eight-hour file operation might truthfully have eight hours of wall elapsed and only milliseconds of local CPU work; remote service work may remain unknowable. The profiler should display that uncertainty rather than deduct a guessed sleep interval.

Analysis must retain interrupted/capped attempts and their resource demand, compare equivalent timing bases, and flag missing outcomes or gap-contaminated latency before making model/setup recommendations. Do not treat a quota pause as evidence that a model itself is slow, or omit failed attempts to make efficiency appear better.

## Acceptance tests for resilience work

- Kill a producer after durable start but before end; recover the parent/child graph with completion unknown.
- Kill during a journal write; recover the valid prefix and report the torn tail without losing acknowledged records or manufacturing events.
- Resume with a new producer epoch; merge repeated delivery idempotently and retain distinct retry attempts.
- Simulate eight-hour suspension, clock rollback and host-clock skew; never turn elapsed into active work or subtract clocks from different domains.
- Simulate 429/quota exhaustion, HTTP 503, timeout, DNS failure and a lost response after successful remote completion; preserve reason evidence and unknown consumption where necessary.
- Simulate disk-full, collector-down and bounded-buffer overflow; report capture health and the documented loss/retention behavior.
- Deliver child completion before parent/start and late completion after recovery; reconcile without silently corrupting ancestry or double counting usage.
- Compare interrupted and uninterrupted benchmark cohorts; expose timing contamination and count failed/retried resource demand.

These destructive/fault-injection scenarios have not been run against a durable flAImegraph journal because no such journal exists yet. Current evidence consists of code inspection, public API regressions, existing capture/reconciliation tests, and the focused probes described by the audit.

## Clock and delivery references

Node documents `process.hrtime.bigint()` as a high-resolution interval clock independent of time of day; that does not make it per-operation CPU time or identify waits. [Node process documentation](https://nodejs.org/api/process.html#processhrtimebigint).

On Linux, `CLOCK_MONOTONIC` excludes suspended time whereas `CLOCK_BOOTTIME` includes it. This is a concrete reason to record clock semantics and avoid claiming a portable sleep interpretation from a generic monotonic duration. The audit does not establish identical behavior on every supported OS. [Linux clock_gettime manual](https://www.man7.org/linux/man-pages/man2/clock_gettime.2.html).

OpenTelemetry documents persistent exporter queues using a write-ahead log for restart survival, with remaining risks such as disk failure, capacity and retry limits. An appropriately configured Collector can help delivery resilience; it cannot recreate application lifecycle events that were never emitted. [OpenTelemetry Collector resiliency](https://opentelemetry.io/docs/collector/resiliency/).
