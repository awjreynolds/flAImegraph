/**
 * Usage-only interchange types for the 0.4 contract.
 *
 * Nothing in this file assigns a rate, amount, currency or other commercial
 * interpretation to a measurement.  A quantity is an exact decimal string;
 * null means that the producer did not supply that quantity.
 */

export const USAGE_SCHEMA_VERSION = "0.4.0" as const;
export type UsageSchemaVersion = typeof USAGE_SCHEMA_VERSION;

export type UsageDecimal = string;
export type UsageScalar = string | number | boolean | null;
export type UsageEvidence = "observed" | "declared" | "derived" | "estimated" | "unknown";
export type UsageAccountingScope = "direct" | "aggregate" | "snapshot" | "unknown";
export type UsageStatus = "running" | "ok" | "error" | "cancelled" | "unknown";
export type UsageCountBasis = "provider_native" | "consumed" | "billable" | "allocated" | "unknown";
export type UsageAggregation = "delta" | "cumulative" | "unknown";
export type UsageMeasurementScope = "event" | "interval" | "snapshot" | "aggregate" | "unknown";
export type UsageMeterOverlap = "disjoint" | "subset" | "overlap" | "unknown";

export interface UsageSource {
  id: string;
  harness: string;
  format: string;
  version?: string;
  sha256?: string;
  coverage: "complete" | "partial" | "unknown";
  description?: string;
}

export interface UsageSourceRef {
  source_id: string;
  record: string;
}

/** A timestamp retains its source text and its capture provenance. */
export interface UsageTimestamp {
  value: string | null;
  evidence: UsageEvidence;
  method: string;
  source_refs: UsageSourceRef[];
}

/** A pricing-relevant fact records conditions of consumption only. */
export interface UsageDimensionFact {
  value: UsageScalar;
  evidence: UsageEvidence;
  method: string;
  source_refs: UsageSourceRef[];
}

/**
 * Known dimensions are deliberately small and useful to downstream policy
 * consumers. Provider-specific facts belong under `extensions` using a
 * namespaced key such as `provider.example.tier`.
 */
export interface UsageDimensions {
  requested_provider?: UsageDimensionFact;
  actual_provider?: UsageDimensionFact;
  provider?: UsageDimensionFact;
  service?: UsageDimensionFact;
  product?: UsageDimensionFact;
  api_operation?: UsageDimensionFact;
  requested_model?: UsageDimensionFact;
  actual_model?: UsageDimensionFact;
  model?: UsageDimensionFact;
  requested_tier?: UsageDimensionFact;
  actual_tier?: UsageDimensionFact;
  tier?: UsageDimensionFact;
  requested_reasoning?: UsageDimensionFact;
  actual_reasoning?: UsageDimensionFact;
  reasoning?: UsageDimensionFact;
  requested_region?: UsageDimensionFact;
  actual_region?: UsageDimensionFact;
  region?: UsageDimensionFact;
  cache_ttl?: UsageDimensionFact;
  cache_behavior?: UsageDimensionFact;
  deployment?: UsageDimensionFact;
  sku?: UsageDimensionFact;
  /** Namespaced provider/harness dimensions; unqualified generic keys are invalid. */
  extensions?: Record<string, UsageDimensionFact>;
}

export interface UsageMeter {
  id: string;
  unit: string;
  description: string;
  /** The declared parent meter when this quantity is a subset of another. */
  subset_of: string | null;
  /** Declares overlap semantics; reports never add a subset into its parent. */
  overlap: UsageMeterOverlap;
}

export interface UsageMeasurement {
  /** Null is unavailable; zero is an observed/declared quantity of zero. */
  value: UsageDecimal | null;
  evidence: UsageEvidence;
  method: string;
  source_refs: UsageSourceRef[];
  count_basis: UsageCountBasis;
  /** A delta can be added once; a cumulative value is retained but not added. */
  aggregation: UsageAggregation;
  /** The temporal/accounting grain of the quantity. */
  scope: UsageMeasurementScope;
}

export interface UsageObservation {
  /** Stable producer identity. Replays of this ID must be byte/semantic equal. */
  id: string;
  source_refs: UsageSourceRef[];
  /** Producer-defined subject identity, e.g. model.response or tool.search. */
  subject: string | null;
  accounting_scope: UsageAccountingScope;
  operation_id: string | null;
  parent_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  /** Developer-supplied opaque work identifier, scoped to dataset_id; e.g. ticket or issue URL. */
  work_item_id: string | null;
  task_id: string | null;
  status: UsageStatus;
  event_at: UsageTimestamp | null;
  started_at: UsageTimestamp | null;
  ended_at: UsageTimestamp | null;
  collected_at: UsageTimestamp | null;
  measurements: Record<string, UsageMeasurement>;
  dimensions: UsageDimensions;
}

export interface UsageIssue {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  observation_id?: string;
  meter_id?: string;
  source_id?: string;
}

export interface UsageCoverage {
  boundary: "instrumented" | "native_transcript" | "mixed" | "unknown";
  complete: boolean;
  dropped_observations: number;
  /** Cumulative loss counters by stable producer source; replay uses each maximum. */
  dropped_by_source?: Record<string, number>;
  limitations: string[];
}

export interface UsageBundle {
  schema_version: UsageSchemaVersion;
  dataset_id: string;
  sources: UsageSource[];
  meters: UsageMeter[];
  observations: UsageObservation[];
  coverage?: UsageCoverage;
  issues?: UsageIssue[];
}

export type UsageGrouping = "model" | "work_item" | "task" | "agent" | "scope" | "operation" | "session";

export interface UsageReportOptions {
  /** Defaults to all meters in the bundle, sorted by meter ID. */
  meter_ids?: string[];
  /** Defaults to work_item, task, agent, model, scope for renderer/analyzer consumers. */
  group_by?: UsageGrouping[];
}

export interface UsageMeterCoverage {
  total_observations: number;
  additive_observations: number;
  excluded_observations: number;
  known_observations: number;
  unknown_observations: number;
  observed_observations: number;
  estimated_observations: number;
  declared_observations: number;
  derived_observations: number;
  /** IDs are retained so unknown coverage cannot be mistaken for zero. */
  unknown_observation_ids: string[];
  excluded_observation_ids: string[];
}

export interface UsageMeterTotal {
  meter_id: string;
  unit: string;
  /** Exact sum of known additive (delta/direct) values, including zero. */
  known_total: UsageDecimal;
  /** Exact sum of additive values whose evidence is observed. */
  observed_total: UsageDecimal;
  /** Exact sum of additive values whose evidence is estimated. */
  estimated_total: UsageDecimal;
  coverage: UsageMeterCoverage;
}

export interface UsageReportGroup {
  key: string;
  dimensions: Record<string, string>;
  observation_ids: string[];
  meter_totals: UsageMeterTotal[];
}

/** A row keeps only real observation ancestry; grouping rows are separate. */
export interface UsageReportObservation {
  observation_id: string;
  parent_observation_id: string | null;
  /** Root-to-leaf IDs from recorded parent links; no synthetic parents. */
  ancestry: string[];
  group_key: string;
}

export interface UsageReport {
  schema_version: UsageSchemaVersion;
  dataset_id: string;
  bundle: UsageBundle;
  selected_meter_ids: string[];
  group_by: UsageGrouping[];
  meter_totals: UsageMeterTotal[];
  groups: UsageReportGroup[];
  observations: UsageReportObservation[];
}
