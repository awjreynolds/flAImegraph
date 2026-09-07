import { type UsageBundle, type UsageDecimal, type UsageMeasurement, type UsageObservation, type UsageReport, type UsageReportOptions } from "./usage-types.js";
export * from "./usage-types.js";
export declare class UsageError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Stable JSON for exact replay and canonical report validation. */
export declare function canonicalUsage(value: unknown): string;
/** Returns a canonical exact decimal without redundant zeroes. */
export declare function normalizeDecimal(value: string): UsageDecimal;
export declare function isDecimal(value: unknown): value is UsageDecimal;
export declare function isNonNegativeDecimal(value: unknown): value is UsageDecimal;
export declare function decimalCompare(a: string, b: string): -1 | 0 | 1;
export declare function decimalAdd(a: string, b: string): UsageDecimal;
export declare function decimalSum(values: readonly string[]): UsageDecimal;
export declare const addDecimals: typeof decimalAdd;
export declare const compareDecimals: typeof decimalCompare;
/** Validate transport shape, provenance links, exact quantities and temporal semantics. */
export declare function validateUsageBundle(value: unknown): UsageBundle;
/** Replay-safe immutable merge. Duplicate IDs must match exactly apart from merged provenance. */
export declare function reconcileUsageBundles(inputs: UsageBundle[]): UsageBundle;
/**
 * A quantity is additive only when it is a direct delta at a known event or
 * interval grain. Cumulative, aggregate, snapshot and unknown-grain values
 * remain evidence but are excluded from totals.
 */
export declare function isAdditiveUsageMeasurement(observation: UsageObservation, measurement: UsageMeasurement): boolean;
/** Build a canonical usage-only report from the selected meters and grouping. */
export declare function createUsageReport(input: UsageBundle, options?: UsageReportOptions): UsageReport;
/** Recompute the report from its embedded bundle and reject every drift. */
export declare function validateUsageReport(value: unknown): UsageReport;
