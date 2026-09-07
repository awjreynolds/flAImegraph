/** Explicitly synthetic routing walkthrough. No model or filesystem workload is executed. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { reconcileContextBundles } from '../src/context.js';
import { captureRequestContext, createHarnessProfile } from '../src/context-capture.js';
import { createContextReport } from '../src/context-report.js';
import { valueEvidence } from '../src/core.js';
import { createOperationReport, validateOperationReport } from '../src/operations.js';
import { exportOperationFolded, exportOperationPprof, exportOperationTrace, renderOperationSvg } from '../src/operation-export.js';
import type { EvidenceBundle, Source } from '../src/types.js';
import { OPERATION_IO_MEASURES, type OperationBundle, type OperationSpan, type OperationLink } from '../src/operation-types.js';

const output = resolve(process.argv[2] ?? 'examples/dogfood/v03');
const dataset_id = 'synthetic-summary-routing';
const artifact: Source = { id: 'synthetic-routing', harness: 'illustrative-harness', format: 'synthetic-walkthrough', coverage: 'partial', description: 'Invented operations, usage, costs and policy facts for explanation. No model requests ran.' };
const classification = { evidence: 'declared' as const, method: 'synthetic scenario definition; not a measured execution' };
const unknown = { evidence: 'unknown' as const, method: 'synthetic example has no measured clock' };
const spans: OperationSpan[] = [];
function span(id: string, parent_id: string | null, kind: OperationSpan['kind'], label: string, extra: Partial<OperationSpan> = {}) {
  const value: OperationSpan = { id, parent_id, parentage: parent_id ? classification : null, stream_id: 'synthetic', sequence: spans.length, kind, label, classification, status: 'unknown', started_at: null, ended_at: null, duration_ns: null, timing: { started_at: unknown, ended_at: unknown, duration_ns: { ...unknown, clock: 'unknown' } }, agent_id: null, requesting_model: null, executing_model: null, observation_id: null, source_refs: [{ source_id: artifact.id, record: id }], io: null, routing: null, ...extra };
  spans.push(value); return value;
}
span('direct', null, 'work', 'Illustrative direct route · $0.101');
span('direct-agent', 'direct', 'agent', 'Main agent · high-cost model', { agent_id: 'main-direct' });
span('direct-read', 'direct-agent', 'file_read', 'Read 400-line source');
span('direct-model', 'direct-agent', 'model', 'High-cost model consumes source', { executing_model: 'illustrative-high', observation_id: 'direct-request' });
span('summary-route', null, 'work', 'Illustrative summary route · $0.070');
span('summary-agent', 'summary-route', 'agent', 'Main agent · high-cost model', { agent_id: 'main-summary' });
span('hook', 'summary-agent', 'hook', 'Read policy · more than 350 lines', { routing: { origin: 'workload_policy', policy_id: 'summarize-large-read', policy_version: 'illustrative-v1', action: 'redirect', facts: { requested_lines: 400, threshold_lines: 350, synthetic: true }, reason: 'Illustrative caller policy redirects this large read through a summarizer.', requested_model: 'illustrative-high', selected_model: 'illustrative-low', evidence: 'declared' } });
span('delegate', 'hook', 'delegation', 'Delegate summary request');
span('summary-worker', 'delegate', 'agent', 'Summary worker · low-cost model', { agent_id: 'summary-worker' });
span('summary-read', 'summary-worker', 'file_read', 'Read source for summarizer');
span('summary-op', 'summary-worker', 'summary', 'Create compact representation');
span('summary-model', 'summary-op', 'model', 'Low-cost summarizer', { executing_model: 'illustrative-low', observation_id: 'summary-request' });
span('consume-summary', 'summary-agent', 'model', 'High-cost model consumes summary', { executing_model: 'illustrative-high', observation_id: 'consumer-request' });
for (const id of ['direct-read', 'summary-read']) spans.find(s => s.id === id)!.io = {
  resource_id: 'synthetic-file', resource_label: 'Illustrative 400-line source', requested_range: { start_line: 1, end_line: 400 },
  read_bytes: null, returned_bytes: null, written_bytes: null, inserted_bytes: null, deleted_bytes: null, entry_count: null, examined_entries: null, content_sha256: null,
  measurements: Object.fromEntries(OPERATION_IO_MEASURES.map(key => [key, { evidence: 'unknown', method: 'no actual IO executed' }])) as NonNullable<OperationSpan['io']>['measurements'],
};
const evidence: EvidenceBundle = { schema_version: '0.1.0', dataset_id, sources: [artifact], observations: [
  ['direct-request', 'illustrative-high', '1000', '100', '0.101'],
  ['summary-request', 'illustrative-low', '1000', '100', '0.030'],
  ['consumer-request', 'illustrative-high', '400', '100', '0.040'],
].map(([id, model, input, out, amount]) => ({ id: id!, kind: 'model', operation: 'synthetic-generation', status: 'unknown', accounting_scope: 'direct', model: model!, usage: { input_tokens: input!, output_tokens: out!, cache_read_input_tokens: '0', cache_write_input_tokens: '0', reasoning_output_tokens: null }, recorded_cost: { amount: amount!, currency: 'USD', basis: 'enterprise_scenario' }, attributes: { synthetic: true, quality_verified: false }, source_refs: [{ source_id: artifact.id, record: id! }] })), relationships: [], issues: [{ code: 'SYNTHETIC', severity: 'warning', message: 'All usage and costs are invented illustrative values. This is not a provider rate card, actual bill or measured savings experiment.' }] };
const profile = createHarnessProfile({ harness: 'illustrative-harness' });
const raw = Array.from({length: 400}, (_, i) => `// illustrative line ${i + 1}`).join('\n');
const makeContext = (request_id: string, summary: boolean) => captureRequestContext({ dataset_id, request_id, observation_id: request_id, profile, boundary: 'client_request', coverage: 'partial', coverage_evidence: 'declared', artifact, record: request_id, blocks: [{ source_id: summary ? 'summary-source' : 'original-source', label: summary ? 'Illustrative summary' : 'Illustrative source', origin: summary ? 'delegated_context' : 'repository_file', origin_evidence: 'declared', representation: summary ? 'summary' : 'original', media: 'text', role: 'tool', placement: 'tool_result', content: summary ? 'Invented summary used only for this walkthrough.' : raw, tokens: { value: summary ? '200' : '800', unit: 'tokens', evidence: 'estimated', method: 'invented illustrative token weight', source_refs: [{ source_id: artifact.id, record: request_id }] } }] });
const contexts = [makeContext('direct-request', false), makeContext('summary-request', false), makeContext('consumer-request', true)];
const context = reconcileContextBundles(contexts, evidence);
const original = contexts[0]!.revisions[0]!.id, summarized = contexts[2]!.revisions[0]!.id;
context.transformations.push({ id: 'illustrative-summary-transform', kind: 'summarize', from_revision_ids: [original], to_revision_ids: [summarized], evidence: 'declared', method: 'synthetic summary lifecycle', observation_id: 'summary-request', source_refs: [{ source_id: artifact.id, record: 'summary-transform' }] });
const links: OperationLink[] = [];
function link(from: string, kind: OperationLink['kind'], revision: string, request_id: string | null = null, occurrence_id: string | null = null) {
  links.push({ from_operation_id: from, kind, to_operation_id: null, context_revision_id: revision, request_id, occurrence_id, evidence: 'declared', method: 'synthetic explicit context boundary', source_refs: [{ source_id: artifact.id, record: `${from}/${kind}` }] });
}
// Both routes share one logical source revision; retain ambiguity between its producers.
const directRevision = context.requests.find(r => r.id === 'direct-request')!.occurrences[0]!.revision_id;
link('summary-read', 'produces_context', original);
link('summary-op', 'produces_context', summarized);
for (const [request, operation] of [['direct-request', 'direct-model'], ['summary-request', 'summary-model'], ['consumer-request', 'consume-summary']]) {
  for (const occurrence of context.requests.find(r => r.id === request)!.occurrences) link(operation!, 'consumes_context', occurrence.revision_id, request!, occurrence.id);
}
// A shared revision produced by two separate reads is ambiguous; deliberately preserve
// the estimated source amount without attributing it to either execution ancestor.
link('direct-read', 'produces_context', directRevision);
const operations: OperationBundle = { schema_version: '0.3.0', dataset_id, artifacts: [artifact], spans, links, coverage: { boundary: 'instrumented', complete: false, dropped_spans: 0, dropped_spans_by_stream: {}, dropped_links: 0, dropped_links_by_stream: {}, limitations: ['Synthetic walkthrough: no operations, model requests, bytes, latency, quality or savings were measured.', 'The two routes illustrate a 350-line hook and separate model usage; actual comparison requires matched tasks, outcomes, cache behavior and rework.', 'Both reads produce one shared source revision, so the source allocation remains ambiguous between those read operations. Summary production is uniquely linked.'] } };
const valuation = valueEvidence(evidence, { mode: 'recorded' });
const contextReport = createContextReport(evidence, valuation, context, { allocation_request_ids: context.requests.map(r => r.id) });
const report = validateOperationReport(createOperationReport(operations, evidence, valuation, contextReport));
assert.equal(report.summary.known_net_nanos, '171000000');
assert.equal(report.nodes.find(n => n.operation_id === 'direct')!.subtree_charges_nanos, '101000000');
assert.equal(report.nodes.find(n => n.operation_id === 'summary-route')!.subtree_charges_nanos, '70000000');
assert.ok(report.source_cost.some(s => s.context_revision_id === summarized && s.operation_ids.at(-1) === 'summary-op'));
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries({ operations, evidence, valuation, context, 'context-report': contextReport, report, trace: exportOperationTrace(report) })) await writeFile(join(output, `routing-${name}.json`), JSON.stringify(value, null, 2) + '\n');
for (const [name, options] of [['operations', {projection:'execution',measure:'operations'}], ['execution-charges',{projection:'execution',measure:'charges'}], ['source-charges',{projection:'source',measure:'charges'}]] as const) {
  await writeFile(join(output, `routing-${name}.folded`), exportOperationFolded(report, options));
  await writeFile(join(output, `routing-${name}.pprof`), exportOperationPprof(report, options));
  await writeFile(join(output, `routing-${name}.svg`), renderOperationSvg(report, options)!);
}
process.stdout.write(JSON.stringify(report.summary) + '\n');
