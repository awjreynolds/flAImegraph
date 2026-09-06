import type { ContextReport, ContextReportOptions, ContextBundle } from './context-types';
import type { EvidenceBundle, Valuation } from './types';
export function validateContextReport(value: unknown): ContextReport;
export function createContextReport(evidence: EvidenceBundle, valuation: Valuation, context: ContextBundle, options?: ContextReportOptions): ContextReport;
