import type { EvidenceBundle, Source, SourceRef, Valuation } from "./types.js";

export const CONTEXT_ORIGINS = [
  "system_instruction", "developer_instruction", "user_prompt", "repository_instruction", "skill",
  "repository_file", "retrieved_document", "tool_result", "tool_schema", "output_schema", "conversation_history",
  "assistant_output", "memory", "delegated_context", "attachment", "unknown",
] as const;
export type ContextOrigin = typeof CONTEXT_ORIGINS[number];
export type MeasurementEvidence = "observed" | "derived" | "estimated" | "counterfactual" | "unavailable";
export type ContextRepresentation = "original" | "excerpt" | "truncated" | "summary" | "opaque" | "reference";
export type ContextMedia = "text" | "structured" | "image" | "audio" | "video" | "document" | "unknown";
export type ContextRole = "system" | "developer" | "user" | "assistant" | "tool" | "unknown";
export type ContextPlacement = "instruction" | "history" | "current_turn" | "tool_result" | "tool_definition" | "attachment" | "server_state" | "unknown";
export type CaptureBoundary = "client_request" | "harness_context" | "transcript_reconstruction" | "unavailable";

export interface ContextMeasurement {
  value: string | null;
  unit: "tokens" | "utf8_bytes" | "unicode_scalars" | "items";
  evidence: MeasurementEvidence;
  method: string;
  source_refs: SourceRef[];
}
export interface HarnessFact {
  value: string | number | boolean | null;
  evidence: "observed" | "declared" | "unknown";
  source_refs: SourceRef[];
}
export interface HarnessProfile {
  schema_version: "0.2.0";
  id: string;
  name: string;
  harness: string;
  harness_version: HarnessFact;
  profile_version: string;
  model: { provider: HarnessFact; name: HarnessFact; settings: Record<string, HarnessFact> };
  instruction_sources: Array<{ origin: ContextOrigin; label: string; delivery: "always" | "conditional" | "on_demand" | "unknown"; evidence: "observed" | "declared" | "unknown"; source_refs: SourceRef[] }>;
  tools: Array<{ id: string; name: string; definition_sha256: string | null; definition_evidence: "derived" | "declared" | "unknown"; definition_method: string | null; evidence: "observed" | "declared" | "unknown"; source_refs: SourceRef[] }>;
  policies: { assembly: HarnessFact; truncation: HarnessFact; compaction: HarnessFact; caching: HarnessFact };
  context_capabilities: Array<{ origin: ContextOrigin; capture: "direct" | "reconstructed" | "unavailable" | "unknown"; evidence: "observed" | "declared" | "unknown"; source_refs: SourceRef[]; note: string }>;
  artifacts: Source[];
}
export interface ContextSource {
  id: string;
  origin: ContextOrigin;
  origin_evidence: "observed" | "declared" | "estimated" | "unknown";
  label: string;
  identity_basis: "producer" | "content_fingerprint" | "unknown";
  source_refs: SourceRef[];
}
export interface ContextRevision {
  id: string;
  source_id: string;
  representation: ContextRepresentation;
  media: ContextMedia;
  content_sha256: string | null;
  fingerprint_evidence: "derived" | "declared" | "unknown";
  fingerprint_method: string | null;
  tokens: ContextMeasurement;
  bytes: ContextMeasurement;
  source_refs: SourceRef[];
}
export interface ContextOccurrence {
  id: string;
  revision_id: string;
  role: ContextRole;
  placement: ContextPlacement;
  treatment: { value: "fresh" | "cache_read" | "cache_write" | "mixed" | "unknown"; evidence: "observed" | "declared" | "estimated" | "unknown"; method: string; source_refs: SourceRef[] };
}
export interface RequestContext {
  id: string;
  observation_id: string | null;
  profile_id: string;
  captured_at: string | null;
  boundary: CaptureBoundary;
  coverage: "complete" | "partial" | "unknown";
  coverage_evidence: "observed" | "declared" | "unknown";
  /** Order is significant; identical revisions may occur more than once. */
  occurrences: ContextOccurrence[];
  overrides: Record<string, HarnessFact>;
  source_refs: SourceRef[];
}
export interface ContextTransformation {
  id: string;
  kind: "truncate" | "summarize" | "compact" | "delegate" | "copy" | "other";
  from_revision_ids: string[];
  to_revision_ids: string[];
  evidence: "observed" | "declared" | "estimated";
  method: string;
  observation_id: string | null;
  source_refs: SourceRef[];
}
export interface ContextIssue {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  request_id?: string;
  source_id?: string;
  revision_id?: string;
}
export interface ContextBundle {
  schema_version: "0.2.0";
  dataset_id: string;
  evidence_schema_version: "0.1.0";
  artifacts: Source[];
  profiles: HarnessProfile[];
  sources: ContextSource[];
  revisions: ContextRevision[];
  requests: RequestContext[];
  transformations: ContextTransformation[];
  issues: ContextIssue[];
}

/** Public capture boundary: content is consumed locally, then reduced to fingerprints and measurements. */
export interface ContextBlockInput {
  source_id: string;
  origin: ContextOrigin;
  origin_evidence?: ContextSource["origin_evidence"];
  label: string;
  identity_basis?: ContextSource["identity_basis"];
  representation: ContextRepresentation;
  media: ContextMedia;
  role: ContextRole;
  placement: ContextPlacement;
  content?: string;
  /** Transient raw bytes; never serialized in the exported ContextBundle. */
  content_bytes?: Uint8Array;
  content_sha256?: string | null;
  /** Source location within the supplied capture artifact, such as a JSON pointer. */
  record?: string;
  tokens?: ContextMeasurement;
  bytes?: ContextMeasurement;
  treatment?: ContextOccurrence["treatment"];
}
export interface CaptureContextInput {
  dataset_id: string;
  request_id: string;
  observation_id?: string | null;
  captured_at?: string | null;
  profile: HarnessProfile;
  boundary: CaptureBoundary;
  coverage: "complete" | "partial" | "unknown";
  coverage_evidence?: RequestContext["coverage_evidence"];
  artifact: Source;
  record: string;
  blocks: ContextBlockInput[];
  overrides?: Record<string, HarnessFact>;
}
export interface ContextAllocation {
  request_id: string;
  observation_id: string;
  method: "proportional-input-coverage-v1";
  evidence: "estimated";
  amount_nanos: string;
  denominator_tokens: string | null;
  unallocated_weight_tokens: string | null;
  allocated_nanos: string;
  unallocated_nanos: string;
  portions: Array<{ occurrence_id: string; source_id: string; revision_id: string; amount_nanos: string; weight_tokens: string }>;
  assumptions: string[];
  issues: ContextIssue[];
}
export interface ContextReport {
  schema_version: "0.2.0";
  dataset_id: string;
  evidence: EvidenceBundle;
  valuation: Valuation;
  context: ContextBundle;
  /** Estimated allocations are opt-in and are separate from the observed monetary profile. */
  allocations: ContextAllocation[];
  summary: { requests: number; linked_observations: number; context_sources: number; known_cost_nanos: string; currency: string; valuation_complete: boolean; complete_context_requests: number; partial_context_requests: number; unknown_context_requests: number };
  issues: ContextIssue[];
}
export interface ContextReportOptions {
  /** Explicitly choose at most one request per observation for estimated allocation. */
  allocation_request_ids?: string[];
}
