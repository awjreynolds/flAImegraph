import type { EvidenceBundle } from "./types.js";

/** Harnesses whose native JSONL streams have a capture-safe append contract. */
export type CaptureHarness = "codex" | "pi";

/** Options that identify one append-only native stream. */
export interface CaptureOptions {
  harness: CaptureHarness;
  capture_namespace: string;
  dataset_id: string;
  version?: string;
  work_item_id?: string;
  agent_id?: string;
  /** Producer or caller supplied monotonic snapshot number. */
  sequence?: string;
}

/** Persisted proof that the accepted stream ended at one complete JSONL prefix. */
export interface CaptureCursor {
  sequence: string;
  prefix_bytes: string;
  prefix_sha256: string;
  record_count: string;
}

/** Metadata for one accepted artifact; raw input is deliberately absent. */
export interface CaptureDescriptor {
  id: string;
  sequence: string;
  source_id: string;
  sha256: string;
  prefix_bytes: string;
  prefix_sha256: string;
  record_count: string;
  observation_count: string;
}

/** Import settings frozen when a capture stream is first opened. */
export interface CaptureImportOptions {
  version?: string;
  work_item_id?: string;
  agent_id?: string;
}

/** Durable state for one capture namespace. Every member is deeply frozen at runtime. */
export interface CaptureState {
  schema_version: "0.2.0";
  dataset_id: string;
  capture_namespace: string;
  harness: CaptureHarness;
  import_options: CaptureImportOptions;
  cursor: CaptureCursor;
  captures: CaptureDescriptor[];
  evidence: EvidenceBundle;
}
