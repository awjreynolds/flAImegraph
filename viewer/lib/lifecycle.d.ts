import { type LifecycleEvent, type LifecycleCapture, type LifecycleProjection } from "./lifecycle-types.js";
export * from "./lifecycle-types.js";
export declare class LifecycleError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Strict portable event validation; filesystem integrity is checked by the journal reader. */
export declare function validateLifecycleEvent(value: unknown): LifecycleEvent;
export declare function validateLifecycleCapture(value: unknown): LifecycleCapture;
/** Replay immutable events into a fresh view. Merge events, never successive usage projections. */
export declare function projectLifecycle(input: LifecycleCapture, options?: {
    gap_threshold_ns?: string;
}): LifecycleProjection;
/** Merge raw immutable events, deduplicating exact delivery and rejecting identity conflicts. */
export declare function mergeLifecycleCaptures(inputs: LifecycleCapture[]): LifecycleCapture;
