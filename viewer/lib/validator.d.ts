import type { ContextReport, ContextReportOptions, ContextBundle } from './context-types';
import type { EvidenceBundle, Valuation } from './types';
import type { OperationBundle, OperationReport } from './operation-types';
export function validateContextReport(value: unknown): ContextReport;
export function createContextReport(evidence: EvidenceBundle, valuation: Valuation, context: ContextBundle, options?: ContextReportOptions): ContextReport;
export function validateOperationBundle(value: unknown): OperationBundle;
export function validateOperationReport(value: unknown): OperationReport;
