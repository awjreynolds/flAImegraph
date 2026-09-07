import type { BenchmarkInput } from "./efficiency-types.js";
/** Scalar values accepted by an Inspect scorer selection rule. */
export type InspectScoreValue = string | number | boolean;
export type InspectThresholdOperator = "gte" | "gt" | "lte" | "lt" | "eq";
export interface InspectScoreThreshold {
    value: string | number;
    operator?: InspectThresholdOperator;
}
/** Options that make the benchmark comparison boundary explicit. */
export interface InspectBenchmarkImportOptions {
    benchmark_id?: string;
    role: BenchmarkInput["role"];
    scorer: string;
    accepted_values?: readonly InspectScoreValue[];
    /** Alias accepted for callers that prefer the shorter spelling. */
    acceptedValues?: readonly InspectScoreValue[];
    score_threshold?: string | number | InspectScoreThreshold;
    /** Alias accepted for callers that prefer the shorter spelling. */
    threshold?: string | number | InspectScoreThreshold;
    threshold_operator?: InspectThresholdOperator;
    workload_id: string;
    scope_revision: string;
    acceptance_version: string;
    task_class?: string;
    acceptance_criteria_id?: string;
    evaluation?: BenchmarkInput["evaluation"];
    harness?: string;
    harness_version?: string;
    tools_version?: string;
    cache?: string;
    context_policy?: string;
    routing_policy?: string;
    conditions_other?: Record<string, string>;
    model?: string;
    model_version?: string;
    reasoning?: string;
    tier?: string;
    provider?: string;
    source_id?: string;
    /** An opaque dataset label used only when deriving a source descriptor. */
    dataset_id?: string;
}
export interface InspectBenchmarkImportResult {
    benchmark: BenchmarkInput;
    /** Import coverage and missing-condition notes that BenchmarkInput cannot carry. */
    limitations: string[];
}
/** Import an Inspect AI JSON evaluation log into the pricing-free benchmark contract. */
export declare function importInspectBenchmarkDetailed(input: unknown, options: InspectBenchmarkImportOptions): InspectBenchmarkImportResult;
export declare function importInspectBenchmark(input: unknown, options: InspectBenchmarkImportOptions): BenchmarkInput;
/** Copy an already normalized benchmark without touching source payloads. */
export declare function normalizeBenchmarkImport(value: BenchmarkInput): BenchmarkInput;
