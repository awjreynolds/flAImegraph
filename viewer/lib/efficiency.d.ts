import type { BenchmarkComparison, BenchmarkInput, CapacitySnapshot, CandidatePolicy, CandidatePolicyScenario, EfficiencyAnalysis, EfficiencyInput, EfficiencyOptions, RunwayDemand, RunwayForecast, RunwayOptions } from "./efficiency-types.js";
import type { UsageBundle, UsageReport } from "./usage-types.js";
/** Errors from the browser-safe efficiency seams have stable machine codes. */
export declare class EfficiencyError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(code: string, message: string, details?: unknown);
}
/** Validate and clone the usage plus optional efficiency-owned joins. */
export declare function validateEfficiencyInput(value: unknown): EfficiencyInput;
/** Validate a benchmark artifact independently so it can be imported by another consumer. */
export declare function validateBenchmarkInput(value: unknown): BenchmarkInput;
/** Compare two declared benchmark artifacts without inventing a scalar score. */
export declare function compareBenchmarks(leftValue: BenchmarkInput, rightValue: BenchmarkInput): BenchmarkComparison;
/** Strict boundary for callers that cannot proceed with an incompatible cohort. */
export declare function assertComparableBenchmarks(leftValue: BenchmarkInput, rightValue: BenchmarkInput): BenchmarkComparison;
/** Derive a candidate scenario from one validated benchmark and explicit overhead. */
export declare function deriveCandidatePolicyScenario(policy: CandidatePolicy, benchmark: BenchmarkInput): CandidatePolicyScenario;
/** Analyze a UsageReport/UsageBundle with explicit outcome, benchmark and capacity joins. */
export declare function analyzeEfficiency(inputValue: EfficiencyInput | UsageReport | UsageBundle, options?: EfficiencyOptions): EfficiencyAnalysis;
/**
 * Validate a derived report and recompute it from the normalized input and
 * options retained inside the artifact. Changing a reported quantity, count,
 * finding or provenance field without changing the retained evidence is
 * rejected at this boundary.
 */
export declare function validateEfficiencyReport(value: unknown): EfficiencyAnalysis;
/** Verbose aliases are kept for consumers that name their boundary validator after the artifact. */
export declare const validateEfficiency: typeof validateEfficiencyInput;
export declare const validateEfficiencyAnalysis: typeof validateEfficiencyReport;
export declare const compareBenchmarkInputs: typeof compareBenchmarks;
export declare const forecastDeliveryRunway: typeof forecastRunway;
/** Forecast accepted work from declared capacity snapshots and same-unit observed demand. */
export declare function forecastRunway(snapshotsValue: CapacitySnapshot[], demandValue: RunwayDemand, optionsValue: RunwayOptions): RunwayForecast;
