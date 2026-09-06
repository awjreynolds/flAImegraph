/** Agent Cost Interchange experimental 0.1.0. All quantities are exact decimal strings. */
export type Quantity = string;
export type Decimal = string;
export type Attributes = Record<string, string | number | boolean>;
export interface Source {
  id: string;
  harness: string;
  format: string;
  version?: string;
  sha256?: string;
  coverage: "complete" | "partial" | "unknown";
  description?: string;
}
export interface SourceRef { source_id: string; record: string }
export interface CoverageIssue {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  observation_id?: string;
  source_id?: string;
}
export interface Usage {
  /** Total input, including the disjoint cache-read and cache-write subsets. */
  input_tokens: Quantity | null;
  output_tokens: Quantity | null;
  cache_read_input_tokens: Quantity | null;
  cache_write_input_tokens: Quantity | null;
  /** Subset of output, never independently added to output. */
  reasoning_output_tokens: Quantity | null;
  /** Consumption reported outside the known input/output categories. */
  unclassified_tokens?: Quantity | null;
}
export type CostBasis = "model_price_estimate" | "provider_reported" | "billed" | "enterprise_scenario" | "contract_estimate";
export interface RecordedCost { amount: Decimal; currency: string; basis: CostBasis }
export interface Observation {
  id: string;
  source_refs: SourceRef[];
  kind: "model" | "tool" | "activity";
  operation: string;
  status: "ok" | "error" | "cancelled" | "unknown";
  accounting_scope: "direct" | "aggregate" | "snapshot" | "unknown";
  subject_id?: string;
  grain?: "attempt" | "operation" | "session" | "event" | "unknown";
  count_basis?: "provider_native" | "billable" | "consumed" | "unknown";
  timestamp?: string;
  end_time?: string;
  agent_id?: string;
  session_id?: string;
  turn_id?: string;
  parent_id?: string;
  trace_id?: string;
  span_id?: string;
  provider?: string;
  product?: string;
  model?: string;
  model_identity?: "response" | "setting" | "unknown";
  work_item_id?: string;
  usage: Usage | null;
  recorded_cost?: RecordedCost;
  attributes?: Attributes;
}
export interface Relationship {
  from: string;
  to: string;
  kind: "parent" | "delegates" | "context_from" | "adjusts" | "corresponds_to";
}
export interface EvidenceBundle {
  schema_version: "0.1.0";
  dataset_id: string;
  sources: Source[];
  observations: Observation[];
  relationships: Relationship[];
  issues: CoverageIssue[];
}
export type RateCategory = "input" | "cache_read" | "cache_write" | "output";
export interface RateRule {
  id: string;
  model: string;
  provider?: string;
  product?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  /** Currency units per unit_tokens, represented as decimal strings. */
  rates: Record<RateCategory, Decimal | null>;
  unit_tokens: Quantity;
}
export interface RateCard {
  schema_version: "0.1.0";
  id: string;
  currency: string;
  basis: "enterprise_scenario" | "contract_estimate" | "model_price_estimate";
  source_url: string;
  retrieved_at: string;
  assumptions: string[];
  rules: RateRule[];
}
export interface ValuationOptions { mode: "recorded" | "rate_card"; currency?: string; rate_card?: RateCard }
export interface ValuedObservation {
  observation_id: string;
  amount_nanos: Quantity | null;
  basis: CostBasis | null;
  rate_rule_id?: string;
  reason?: string;
}
export interface Valuation {
  schema_version: "0.1.0";
  id: string;
  dataset_id: string;
  selection_policy: "direct-only-v1";
  currency: string;
  basis: CostBasis | "mixed";
  rate_card_id?: string;
  assumptions: string[];
  observations: ValuedObservation[];
  total_nanos: Quantity;
  complete: boolean;
  issues: CoverageIssue[];
}
export type Grouping = "work_item" | "agent" | "model" | "operation" | "session" | "turn" | "observation";
export interface Allocation { work_item_id: string; weight: Quantity }
export interface ProfileOptions {
  group_by?: Grouping[];
  root_label?: string;
  allocations?: Record<string, Allocation[]>;
  cost_view?: "charges" | "credits" | "net";
}
export interface Frame { id: string; name: string; kind: string }
export interface ProfileSample { observation_id: string; stack: Frame[]; value_nanos: Quantity }
export interface CostProfile {
  schema_version: "0.1.0";
  id: string;
  currency: string;
  unit: string;
  basis: CostBasis | "mixed";
  valuation_id: string;
  dataset_id: string;
  group_by: Grouping[];
  cost_view: "charges" | "credits" | "net";
  total_nanos: Quantity;
  complete: boolean;
  samples: ProfileSample[];
  issues: CoverageIssue[];
  excluded_observation_ids: string[];
  assumptions: string[];
}
export interface ImportOptions {
  source_id?: string;
  dataset_id?: string;
  version?: string;
  work_item_id?: string;
  agent_id?: string;
}
export type Harness = "codex" | "pi" | "omp" | "claude" | "gemini" | "opencode" | "otel" | "copilot";
export interface AdapterCapability {
  harness: Harness;
  formats: string[];
  tested_versions: string[];
  usage: string;
  lineage: string;
  limitations: string[];
}
