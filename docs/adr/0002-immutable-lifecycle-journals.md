---
status: accepted
---

# Preserve lifecycle events before materializing action state

On 7 September 2026, interruption analysis showed that an in-memory recorder could lose the start and ancestry of an action after process failure. Saving a running Usage observation and later merging its completed version also conflicts with the immutable observation contract. Long elapsed intervals could include quota waits, machine suspension, network outages or periods for which no progress evidence exists.

Use a separate immutable lifecycle stream. Persist starts and parent links before dispatch, append explicit pause/resume/terminal/measurement evidence, and derive a fresh action view after recovery. Usage Interchange 0.4 remains unchanged. Consumers merge lifecycle events before projection; successive action projections are revisions, not independently additive observations.

Each writer open creates an exclusive UUID segment and a new clock epoch. This sacrifices one globally ordered append file in exchange for safe concurrent writers and restart without guessing whether a stale lock or reused PID is live. Previous segments remain untouched. Recovery retains a validated prefix and reports an incomplete suffix; complete-frame corruption blocks recovery. Hash chaining is an integrity check, not authentication or proof that every segment is present.

The alternative of updating one running record would simplify viewing but would erase event history and weaken replay conflict detection. A shared file with automatic stale-lock takeover would simplify enumeration but risks two producers writing simultaneously. Automatic inference of sleep or network failure from elapsed time would be convenient but overstates available evidence. We accept a separate replay interface and explicit caller-supplied interruption reasons to preserve these distinctions.

This is an opt-in integration. Acknowledgement means file and creation metadata synchronization succeeded; it cannot guarantee every storage device's power-failure behavior. Missing completion remains unknown. Cross-epoch completion is accepted without an invented monotonic duration. Retries get separate action IDs, and observed resource consumption remains present after failure. The detailed contract and limits are in [Lifecycle 0.5](../../spec/0.5/README.md).
