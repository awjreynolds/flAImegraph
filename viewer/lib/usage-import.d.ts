import type { UsageBundle, UsageSource } from "./usage-types.js";
/** Formats accepted by the usage-only importer. */
export type UsageImportFormat = "codex" | "pi" | "openai" | "anthropic" | "gemini" | "otel" | "otlp" | "usage" | "legacy" | "legacy-evidence" | (string & {});
export interface UsageImportOptions {
    format: UsageImportFormat;
    dataset_id: string;
    source_id?: string;
    source_format?: string;
    source_harness?: string;
    version?: string;
    source_description?: string;
    work_item_id?: string;
    agent_id?: string;
    session_id?: string;
    task_id?: string;
    collected_at?: string | number | bigint;
}
export interface LegacyEvidenceImportOptions extends Partial<Omit<UsageImportOptions, "format">> {
    format?: "legacy" | "legacy-evidence";
}
/** Normalize one producer quantity without exposing pricing or rate logic. */
export declare function normalizeUsageQuantity(value: unknown): string | null;
/** Convert known source timestamp forms to UTC without truncating fractional digits. */
export declare function normalizeUsageTimestamp(value: unknown): string | null;
/** Convert a public legacy 0.1 EvidenceBundle without loading its pricing core. */
export declare function fromLegacyEvidence(input: unknown, options?: LegacyEvidenceImportOptions): UsageBundle;
/** Return source evidence for an input without retaining the raw document. */
export declare function captureSource(input: unknown, options: UsageImportOptions): UsageSource;
/** Import native JSON/JSONL or OTLP usage into the pricing-free 0.4 bundle. */
export declare function importUsage(input: unknown, options: UsageImportOptions): UsageBundle;
