import type { UsageBundle, UsageDimensions, UsageMeasurement, UsageMeter, UsageStatus } from "./usage-types.js";
export declare const LIFECYCLE_SCHEMA_VERSION: "0.5.0";
/** Action IDs are dataset-wide opaque identities; retries must use a new ID. */
export interface LifecycleActionInput {
    action_id: string;
    subject: string;
    parent_id?: string | null;
    retry_of?: string | null;
    work_item_id?: string | null;
    task_id?: string | null;
    agent_id?: string | null;
    session_id?: string | null;
    dimensions?: UsageDimensions;
}
export interface InterruptionReason {
    code: "quota" | "rate_limit" | "network" | "service" | "sleep" | "user" | "unknown";
    evidence: "observed" | "declared" | "unknown";
    method: string;
    reset_at?: string | null;
}
export type LifecycleData = {
    kind: "epoch";
} | ({
    kind: "start";
} & LifecycleActionInput) | {
    kind: "pause";
    action_id: string;
    reason: InterruptionReason;
} | {
    kind: "resume";
    action_id: string;
} | {
    kind: "heartbeat";
    action_id: string;
} | {
    kind: "end";
    action_id: string;
    status: Exclude<UsageStatus, "running">;
    reason?: InterruptionReason;
} | {
    kind: "measurement";
    action_id: string;
    meter: UsageMeter;
    measurement: Omit<UsageMeasurement, "source_refs">;
};
export interface LifecycleEvent {
    schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
    dataset_id: string;
    producer_id: string;
    epoch: string;
    sequence: number;
    event_id: string;
    wall_at: string;
    /** Valid only within this producer epoch. Never compared across epochs. */
    monotonic_ns: string;
    data: LifecycleData;
}
export interface LifecycleIssue {
    code: string;
    message: string;
    action_id?: string;
}
/** Portable replay artifact. Journal readers retain faults alongside valid prefixes. */
export interface LifecycleCapture {
    schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
    kind: "lifecycle";
    dataset_id: string;
    events: LifecycleEvent[];
    issues: LifecycleIssue[];
}
export interface LifecycleAction {
    action_id: string;
    parent_id: string | null;
    retry_of: string | null;
    state: "completion_unobserved" | "paused" | "ok" | "error" | "cancelled" | "unknown";
    started_at: string | null;
    ended_at: string | null;
    elapsed_ns: string | null;
    known_wait_ns: string;
    /** Long heartbeat intervals are capture gaps, never an inferred cause. */
    gaps: {
        from: string;
        to: string;
        elapsed_ns: string;
    }[];
    reasons: InterruptionReason[];
    timing_qualified: boolean;
}
export interface LifecycleProjection {
    capture: LifecycleCapture;
    actions: LifecycleAction[];
    issues: LifecycleIssue[];
    usage: UsageBundle;
}
