import type { UsageBundle, UsageEvidence, UsageReport, UsageSourceRef } from "./usage-types.js";
/** Version of the downstream, usage-only efficiency analysis contract. */
export declare const EFFICIENCY_SCHEMA_VERSION: "0.4.0";
export type EfficiencySchemaVersion = typeof EFFICIENCY_SCHEMA_VERSION;
export type EfficiencyEvidence = UsageEvidence;
export type EfficiencyStatus = "measured" | "candidate" | "unknown";
export type EfficiencySeverity = "info" | "warning" | "error";
export interface ExactRatio {
    numerator: string;
    denominator: string;
}
export interface EfficiencyQuantity {
    meter_id: string;
    unit: string;
    quantity: string;
    evidence: EfficiencyEvidence;
    source_refs?: UsageSourceRef[];
}
export interface EfficiencyRate {
    meter_id: string;
    unit: string;
    rate: ExactRatio;
    evidence: EfficiencyEvidence;
    source_refs?: UsageSourceRef[];
}
export interface AcceptanceOutcome {
    status: "planned" | "in_progress" | "accepted" | "failed" | "interrupted" | "capped" | "cancelled" | "unknown";
    /** Input convenience alias; normalized output uses status. */
    accepted?: boolean | null;
    version?: string;
    evidence: EfficiencyEvidence;
    recorded_at?: string;
    quality_passed?: boolean | null;
    source_refs?: UsageSourceRef[];
}
export interface EfficiencyScope {
    revision: string;
    version?: string;
    description?: string;
    acceptance_criteria?: string[];
}
export interface TaskClassification {
    value: string;
    evidence: EfficiencyEvidence;
    method?: string;
    source_refs?: UsageSourceRef[];
}
export interface AttemptRecord {
    attempt_id: string;
    observation_ids?: string[];
    status: AcceptanceOutcome["status"];
    kind?: "initial" | "retry" | "escalation" | "review" | "rework" | "delegation" | "unknown";
    retry_of?: string;
    escalated_from?: string;
    source_refs?: UsageSourceRef[];
}
/** Immutable join key and declared acceptance endpoint for one Work Item. */
export interface EfficiencyWorkItem {
    work_item_id: string;
    task_id?: string;
    scope: EfficiencyScope;
    acceptance: AcceptanceOutcome;
    attempts?: AttemptRecord[];
    classification?: TaskClassification;
    source_refs?: UsageSourceRef[];
}
export interface CohortSelector {
    cohort_id?: string;
    task_class?: string;
    scope_revision?: string;
    acceptance_version?: string;
    work_item_ids?: string[];
}
export interface EfficiencyFinding {
    rule: "retry-burden" | "escalation-burden" | "review-rework-overhead" | "cache-read-ratio" | "repeated-context" | "model-configuration" | "missing-acceptance" | "missing-metadata" | "candidate-policy" | "runway-limit";
    status: EfficiencyStatus;
    severity: EfficiencySeverity;
    message: string;
    work_item_ids?: string[];
    observation_ids?: string[];
    measurement?: ExactRatio & {
        unit: string;
    };
    evidence?: EfficiencyEvidence;
    source_refs?: UsageSourceRef[];
    limitations?: string[];
}
export interface CohortSummary {
    selector: CohortSelector;
    task_count: string;
    accepted_count: string;
    known_outcome_count: string;
    unknown_outcome_count: string;
    acceptance_rate: string | null;
    retry_count: string;
    escalation_count: string;
    review_attempt_count: string;
    rework_attempt_count: string;
    totals: EfficiencyQuantity[];
    per_accepted: EfficiencyRate[];
}
export interface TaskEfficiencySummary {
    work_item_id: string;
    task_id: string;
    scope_revision: string;
    scope_version: string | null;
    acceptance_version: string | null;
    outcome: AcceptanceOutcome["status"];
    accepted: boolean | null;
    attempts: string;
    retry_count: string;
    escalation_count: string;
    review_attempt_count: string;
    rework_attempt_count: string;
    totals: EfficiencyQuantity[];
    limitations: string[];
}
export interface SessionEfficiencySummary {
    observation_count: string;
    totals: EfficiencyQuantity[];
    unknown_meter_ids: string[];
    limitations: string[];
}
export interface BenchmarkCohort {
    workload_id: string;
    task_class?: string;
    scope_revision: string;
    acceptance_version: string;
    acceptance_criteria_id?: string;
}
export interface BenchmarkConditions {
    harness: string;
    harness_version?: string;
    tools_version?: string;
    cache?: string;
    context_policy?: string;
    routing_policy?: string;
    other?: Record<string, string>;
}
export interface BenchmarkModelConfig {
    model: string;
    model_version?: string;
    reasoning?: string;
    tier?: string;
    provider?: string;
}
export interface BenchmarkQuality {
    passed: boolean | null;
    evidence: EfficiencyEvidence;
    score?: string | null;
    source_refs?: UsageSourceRef[];
}
export interface BenchmarkSample {
    sample_id: string;
    task_id: string;
    scope_revision?: string;
    acceptance_version?: string;
    accepted: boolean | null;
    quality?: BenchmarkQuality;
    /** Convenience aliases for normalized benchmark importers. */
    passed?: boolean | null;
    passed_score?: string | null;
    latency_ns?: string | null;
    meters: EfficiencyQuantity[];
    attempts?: string;
    source_refs: UsageSourceRef[];
}
export interface BenchmarkInput {
    benchmark_id: string;
    role: "baseline" | "candidate" | "control";
    cohort: BenchmarkCohort;
    conditions: BenchmarkConditions;
    model_config: BenchmarkModelConfig;
    evaluation: "held_out" | "controlled" | "historical" | "declared";
    samples: BenchmarkSample[];
    analysis_overhead?: EfficiencyQuantity[];
    provenance: UsageSourceRef[];
}
export interface BenchmarkResourceDelta {
    meter_id: string;
    unit: string;
    /** Baseline per-accepted demand minus candidate per-accepted demand. */
    delta: string | null;
    baseline: ExactRatio | null;
    candidate: ExactRatio | null;
    evidence: EfficiencyEvidence;
}
export interface BenchmarkComparison {
    schema_version: EfficiencySchemaVersion;
    baseline_id: string;
    candidate_id: string;
    status: "validated" | "limited" | "incompatible";
    evaluation: BenchmarkInput["evaluation"];
    sample_sizes: {
        baseline: string;
        candidate: string;
    };
    accepted_counts: {
        baseline: string;
        candidate: string;
    };
    acceptance_rate_delta: string | null;
    resource_deltas: BenchmarkResourceDelta[];
    latency_ns: {
        baseline: ExactRatio | null;
        candidate: ExactRatio | null;
        delta: string | null;
    };
    limitations: string[];
    source_refs: UsageSourceRef[];
}
export interface CandidatePolicy {
    policy_id: string;
    policy_version: string;
    benchmark_id: string;
    analysis_overhead?: EfficiencyQuantity[];
    source_refs?: UsageSourceRef[];
}
export interface CandidatePolicyScenario {
    policy_id: string;
    policy_version: string;
    benchmark_id: string;
    status: "derived" | "unknown";
    expected_per_accepted: EfficiencyRate[];
    expected_attempts_per_accepted: ExactRatio | null;
    analysis_overhead: EfficiencyQuantity[];
    limitations: string[];
    source_refs: UsageSourceRef[];
}
export interface CapacitySnapshot {
    snapshot_id: string;
    meter_id: string;
    unit: string;
    remaining: string | null;
    scope: "session" | "account" | "shared_pool";
    scope_id: string;
    workload_id: string | null;
    observed_at: string;
    reset_at: string | null;
    evidence: EfficiencyEvidence;
    coverage: "complete" | "partial" | "unknown";
    source_refs: UsageSourceRef[];
}
export interface RunwayDemand {
    workload_id: string;
    scope_id: string;
    accepted_count: string;
    per_accepted: EfficiencyRate[];
}
export interface RunwayOptions {
    now: string;
    horizon_end: string;
    stale_after_seconds?: string;
    allow_partial_coverage?: boolean;
    /** Permit declared/estimated demand for a limited scenario forecast. */
    allow_unverified_demand?: boolean;
}
export interface RunwayForecast {
    schema_version: EfficiencySchemaVersion;
    status: "ready" | "limited" | "unknown";
    accepted_work: string | null;
    limiting_snapshot_id: string | null;
    horizon_start: string;
    horizon_end: string;
    considered_snapshots: string[];
    limitations: string[];
    source_refs: UsageSourceRef[];
}
export interface EfficiencyInput {
    usage: UsageReport | UsageBundle;
    work_items?: EfficiencyWorkItem[];
    cohort?: CohortSelector;
    benchmarks?: BenchmarkInput[];
    capacity_snapshots?: CapacitySnapshot[];
    /** Optional source-backed context occurrence records used by the repeated-context rule. */
    context_occurrences?: Array<{
        source_id: string;
        revision_id: string;
        evidence?: EfficiencyEvidence;
        source_refs?: UsageSourceRef[];
    }>;
}
export interface EfficiencyOptions {
    work_items?: EfficiencyWorkItem[];
    cohort?: CohortSelector;
    benchmarks?: BenchmarkInput[];
    candidate_policy?: CandidatePolicy;
    capacity_snapshots?: CapacitySnapshot[];
    runway?: RunwayOptions;
}
export interface EfficiencyAnalysis {
    schema_version: EfficiencySchemaVersion;
    dataset_id: string;
    usage_schema_version: string;
    /**
     * The normalized inputs are retained with the derived artifact so a
     * standalone validator can recompute every reported value.  They are
     * evidence, not pricing or a routing instruction.
     */
    input: EfficiencyInput;
    options: EfficiencyOptions;
    session: SessionEfficiencySummary;
    cohort: CohortSummary;
    tasks: TaskEfficiencySummary[];
    findings: EfficiencyFinding[];
    benchmark_comparisons: BenchmarkComparison[];
    candidate_policy: CandidatePolicyScenario | null;
    runway: RunwayForecast | null;
    limitations: string[];
    source_refs: UsageSourceRef[];
}
export type EfficiencyUsage = UsageReport | UsageBundle;
