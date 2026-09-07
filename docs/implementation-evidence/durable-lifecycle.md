# Durable lifecycle v0.5 implementation evidence

The v0.5 implementation adds an opt-in durable journal, portable lifecycle replay, CLI recovery and a viewer recovery panel. Usage Interchange 0.4 remains unchanged; action revisions are materialized from immutable events rather than merged as conflicting running/completed Usage observations. Existing in-memory recorders still require an explicit integration to gain durability.

## Public verification

The journal tests exercise the SDK's real filesystem implementation. A child process synchronizes a start containing a parent reference, signals readiness, and is killed with `SIGKILL`. Recovery retains the start and ancestry, and the projector reports completion unobserved. A second child writes part of a frame through an injected write fault and is killed before completing it; recovery preserves the valid prefix and original suffix. Other cases cover restart with a new epoch and late terminal evidence, simultaneous writers with separate segments, serialized concurrent appends, repeat recovery, complete-frame and UTF-8 corruption, cumulative read bounds, segment capacity failure before callback dispatch, write/sync failure and writer poisoning, mutation of asynchronous inputs, and dual callback/logging failures.

The portable replay tests exercise known eight-hour quota waits versus unexplained eight-hour gaps, clock reversal and cross-epoch completion, duplicate receipts, non-additive cumulative checkpoints, failed and retried usage, missing sequence coverage, missing starts and parents, retry cycles, late usage delivery, and source provenance. A delayed receipt cannot extend a completed action's elapsed interval. Missing transitions cannot manufacture a confirmed waiting duration. A custom meter named `__proto__` remains an own property through lifecycle projection and the shared Usage validator; its quantity survives reporting.

The public SDK-to-CLI test opens a real journal, recovers it, validates and merges repeated capture, imports Usage, and generates a lifecycle report. It verifies that an uncompleted action retains its work identifier, unknown status and absent end, and that merge cannot overwrite its input.

The lifecycle implementation passed 319 tests plus TypeScript and package build before the subsequent task-view changes. An offline-installed package captured an actual 6,077-byte read of its own README, retained three action identities through restart and replay, and exported the same byte subtotal through the CLI's Usage report, SVG and pprof path. Go's independent pprof reader decoded the 6,077-byte profile. The package manifest inspection found no `.git`, `.openai`, `.env`, `.local` or dependency directories in that release candidate. The independent focused review passed 35 tests and approved the lifecycle change after corrections.

The synthetic viewer fixture contains seven action identities, 19 events and three declared input-token receipts totaling 1,410, including 30 on the failed attempt. It is visibly labelled synthetic and is not evidence of an actual outage, subscription balance or provider consumption. The same pure projector runs in the browser and Node. Timing helpers retain missing completion, pause state, exact elapsed values, recorded terminal timestamps after clock reversal, and uncertainty across epochs.

## Task and token presentation

The viewer and default SDK/CLI profile now use task → operation grouping, with recorded parent ancestry available separately. This does not infer task identities or causal relationships. All 584 observations in the frozen development capture lack task/work identifiers and parent links; its derived upstream SVG/folded/pprof artifacts retain the 11,993,223-input-token subtotal beneath an unassigned task. Model grouping remains an explicit option.

The task example is deterministic and visibly synthetic: three declared tasks, six model observations and three structural task records. It records 6,200 input and 1,790 output tokens, with cache/read-write subsets of input and a known 490 reasoning tokens plus two unavailable reasoning measurements. The public recorder generator calls no provider. Missing cache measurements remain absent rather than becoming zeros. Its recorded task links demonstrate the presentation, not recovered native task ancestry.

Browser verification confirmed nested input/output subset panels, switching to reasoning with two unavailable records retained, selecting a task to filter all three associated observations, zooming task → operation → receipt, and inspecting the exact declared measurement and source identity. The dynamic graph follows the selected meter for local data and keeps exact integer totals before computing drawing coordinates. Unit tests cover quantities above the safe JavaScript integer range, missing versus literal identifier labels, default task grouping, and selector access to tiny chart frames. The integrated suite after these changes passed 324 tests.

Focused React rendering checks also passed for conventional subset nesting, a canonical output meter declared as an input subset, absent output, singular `token` units and a custom `tokens` meter. Browser recovery inspection confirmed that retry and failed-action sheets expose their respective 180-token and 30-token receipts, exact two-second and one-second elapsed intervals, and parent/retry links. The subsequent independent review approved the combined lifecycle and task-view change with no unresolved findings.

## Review corrections

Independent review corrected incomplete provenance on derived timing facts, invalid retry cycles, late receipts contaminating execution gaps, and a custom-meter property-name edge case. Integration checks also tightened missing-sequence wait accounting, surfaced both callback and terminal logging errors, and required creation metadata synchronization for the default durability acknowledgement. The review document records final acceptance and verification details.

## Limits

These checks include real process termination and controlled software faults, not physical power interruption, device loss, actual laptop suspension, a real quota exhaustion or a real provider/network outage. File synchronization remains an OS/filesystem acknowledgement. A platform that cannot synchronize required directory metadata cannot supply this writer's default acknowledgement. The journal cannot recover an event that was never written, discover a wholly missing segment, determine a silent producer's current state, or establish whether an unknown remote result consumed resources.

Critical appends add synchronization overhead. Captured elapsed intervals include pre-dispatch acknowledgement, instrumentation and any waits. They do not measure uninstrumented operation latency or active CPU time. Heartbeat cadence, total directory quotas, retention, rotation and producer wiring remain integration responsibilities. Recovery uses bounded reads and never rewrites original segments. After ambiguous acknowledgement, callers must reconcile retained evidence and separately establish dispatch/result state before retrying external work.

The private hosted viewer requires separately authorized source upload. Local browser verification and downloadable static artifacts do not imply that hosted version was updated.
