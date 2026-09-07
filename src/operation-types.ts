import type { Source, SourceRef, EvidenceBundle, Valuation } from "./types.js";
import type { ContextReport } from "./context-types.js";

export const OPERATION_KINDS = ["work", "agent", "phase", "model", "tool", "directory_read", "file_read", "file_write", "search", "test", "command", "delegation", "hook", "summary", "other"] as const;
export type OperationKind = typeof OPERATION_KINDS[number];
export const OPERATION_IO_MEASURES = ["read_bytes", "returned_bytes", "written_bytes", "inserted_bytes", "deleted_bytes", "entry_count", "examined_entries", "content_sha256"] as const;
export interface OperationClassification {
  evidence: "observed" | "declared" | "derived" | "unknown";
  method: string;
}
export interface OperationTiming {
  started_at: OperationClassification;
  ended_at: OperationClassification;
  duration_ns: OperationClassification & { clock: "monotonic" | "wall" | "unknown" };
}
export interface OperationIO {
  /** Each fact has independent evidence; provenance resolves through the owning span's source_refs. */
  measurements: Record<typeof OPERATION_IO_MEASURES[number], OperationClassification>;
  /** Producer identity or keyed fingerprint; raw paths are opt-in display labels. */
  resource_id: string;
  resource_label: string;
  requested_range: { start_line: number; end_line: number | null } | null;
  /** null means unavailable, not zero. Reading does not prove insertion in context. */
  read_bytes: string | null;
  returned_bytes: string | null;
  written_bytes: string | null;
  inserted_bytes: string | null;
  deleted_bytes: string | null;
  entry_count: string | null;
  examined_entries: string | null;
  content_sha256: string | null;
}
export interface RoutingDecision {
  /** This describes the workload's policy. The profiler itself never redirects or blocks. */
  origin: "workload_policy";
  policy_id: string;
  policy_version: string;
  action: "allow" | "redirect" | "block" | "fallback" | "override";
  facts: Record<string, string | number | boolean | null>;
  reason: string;
  requested_model: string | null;
  selected_model: string | null;
  evidence: "observed" | "declared";
}
export interface OperationSpan {
  id: string;
  /** Actual execution containment only; dependency and context links are separate. */
  parent_id: string | null;
  parentage: OperationClassification | null;
  /** Sequence is local to this producer stream; concurrency has no invented total order. */
  stream_id: string;
  sequence: number;
  kind: OperationKind;
  label: string;
  classification: OperationClassification;
  status: "running" | "ok" | "error" | "cancelled" | "unknown";
  started_at: string | null;
  ended_at: string | null;
  /** Monotonic elapsed nanoseconds when measured by a live recorder. */
  duration_ns: string | null;
  timing: OperationTiming;
  agent_id: string | null;
  /** Model that requested a tool is not a model executing that tool. */
  requesting_model: string | null;
  executing_model: string | null;
  observation_id: string | null;
  source_refs: SourceRef[];
  io: OperationIO | null;
  routing: RoutingDecision | null;
}
export interface OperationLink {
  source_refs: SourceRef[];
  from_operation_id: string;
  kind: "depends_on" | "delegates" | "produces_context" | "consumes_context";
  to_operation_id: string | null;
  context_revision_id: string | null;
  request_id: string | null;
  occurrence_id: string | null;
  evidence: "observed" | "declared" | "derived";
  method: string;
}
export interface OperationBundle {
  schema_version: "0.3.0";
  dataset_id: string;
  artifacts: Source[];
  spans: OperationSpan[];
  links: OperationLink[];
  coverage: {
    boundary: "instrumented" | "native_transcript" | "mixed";
    complete: boolean;
    dropped_spans: number;
    /** Cumulative loss counters scoped to producer streams; replay takes their maximum. */
    dropped_spans_by_stream: Record<string, number>;
    dropped_links: number;
    dropped_links_by_stream: Record<string, number>;
    limitations: string[];
  };
}
export interface OperationNode {
  operation_id: string;
  depth: number;
  child_count: number;
  self_cost_state: "not_applicable" | "unknown" | "priced";
  self_charges_nanos: string;
  subtree_charges_nanos: string;
  self_credits_nanos: string;
  subtree_credits_nanos: string;
  unknown_cost_observation_ids: string[];
}
export interface OperationCostSample {
  observation_id: string;
  operation_ids: string[];
  /** Signed exact amount. Charge and credit flamegraphs are exported separately. */
  amount_nanos: string;
  context_source_id: string | null;
  context_revision_id: string | null;
  occurrence_id: string | null;
  request_id: string | null;
  attribution: "execution" | "estimated_source" | "unallocated";
  label: string;
}
export interface OperationReport {
  schema_version: "0.3.0";
  dataset_id: string;
  operations: OperationBundle;
  evidence: EvidenceBundle;
  valuation: Valuation;
  context_report: ContextReport | null;
  nodes: OperationNode[];
  execution_cost: OperationCostSample[];
  /** Estimated information-flow projection, never represented as a runtime stack. */
  source_cost: OperationCostSample[];
  summary: {
    spans: number;
    max_depth: number;
    known_net_nanos: string;
    charges_nanos: string;
    credits_nanos: string;
    currency: string;
    unbound_observation_ids: string[];
    unknown_cost_observation_ids: string[];
  };
  assumptions: string[];
}
