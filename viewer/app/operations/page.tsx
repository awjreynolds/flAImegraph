'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { validateOperationReport } from '@/lib/validator.js';
import type { OperationReport, OperationSpan, OperationCostSample } from '@/lib/operation-types';
import type { RateCard } from '@/lib/types';
import { BudgetPanel } from './budget-panel';
import { DollarFlamegraph } from './dollar-flamegraph';

const PAGE_SIZE = 75;
const demos = {
  files: { label: 'Directory scan · 5,000 files', note: 'Real IO · generated corpus · no model calls', file: '/operation-files.json', graph: '/operation-files' },
  native: { label: 'Codex development work', note: 'Real native capture · partial coverage', file: '/operation-native.json', graph: '/operation-native' },
  routing: { label: 'Summary routing walkthrough', note: 'Synthetic example · illustrative costs and token weights', file: '/operation-routing.json', graph: '/operation-routing' },
};
type Demo = keyof typeof demos;
const words = (value: string) => value.replaceAll('_', ' ');
function money(value: string, currency: string) {
  const n = BigInt(value), abs = n < 0n ? -n : n;
  const fraction = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${n < 0n ? '-' : ''}${currency === 'USD' ? '$' : currency + ' '}${abs / 1_000_000_000n}${fraction ? '.' + fraction : '.00'}`;
}
const quantity = (value: string | null | undefined) => value == null ? 'Unknown' : BigInt(value).toLocaleString();
const elapsed = (span: OperationSpan) => span.duration_ns !== null ? `${(Number(span.duration_ns) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 })} ms` : span.started_at && span.ended_at ? `${Date.parse(span.ended_at) - Date.parse(span.started_at)} ms (wall clock)` : 'Unknown';
const refs = (span: OperationSpan) => span.source_refs.map(ref => `${ref.source_id} · ${ref.record}`).join('\n');
type Registry = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (value: unknown) => unknown }, options: { signal: AbortSignal }) => unknown };

export default function Operations() {
  const [report, setReport] = useState<OperationReport | null>(null);
  const [reportRevision, setReportRevision] = useState(0);
  const [budgetRates, setBudgetRates] = useState<RateCard>();
  const [demo, setDemo] = useState<Demo | 'local'>('native');
  const [label, setLabel] = useState(demos.native.label);
  const [scope, setScope] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [tab, setTab] = useState('flamegraph');
  const [page, setPage] = useState(0);
  const [graph, setGraph] = useState('tokens');
  const [graphQuery, setGraphQuery] = useState('');
  const [graphSearch, setGraphSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  function adopt(value: unknown, name: string, choice: Demo | 'local') {
    const validated = validateOperationReport(value);
    setReport(validated); setBudgetRates(undefined); setReportRevision(revision => revision + 1); setLabel(name); setDemo(choice); setScope(null); setSelected(null); setPage(0); setSearch(''); setKind('all'); setError('');
  }
  async function loadDemo(choice: Demo) {
    const sequence = ++loadSequence.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(demos[choice].file);
      if (!response.ok) throw new Error('This example could not be loaded. You can open a local operation report.');
      const value: unknown = await response.json();
      if (sequence === loadSequence.current) adopt(value, demos[choice].label, choice);
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load report'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++loadSequence.current;
    void (async () => {
      try {
        const response = await fetch(demos.native.file, { signal: controller.signal });
        if (!response.ok) throw new Error('This example could not be loaded. You can open a local operation report.');
        const value: unknown = await response.json();
        if (!controller.signal.aborted && sequence === loadSequence.current) adopt(value, demos.native.label, 'native');
      } catch (cause) { if (!controller.signal.aborted && sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load report'); }
      finally { if (!controller.signal.aborted && sequence === loadSequence.current) setLoading(false); }
    })();
    return () => controller.abort();
  }, []);
  async function openLocal(file?: File) {
    if (!file) return;
    const sequence = ++loadSequence.current; setLoading(true);
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('Choose an operation report smaller than 32 MB.');
      const value: unknown = JSON.parse(await file.text());
      if (sequence === loadSequence.current) adopt(value, file.name, 'local');
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'Unable to open report'); }
    finally { if (sequence === loadSequence.current) setLoading(false); if (input.current) input.current.value = ''; }
  }
  const byId = useMemo(() => new Map(report?.operations.spans.map(span => [span.id, span])), [report]);
  const nodes = useMemo(() => new Map(report?.nodes.map(node => [node.operation_id, node])), [report]);
  const kinds = useMemo(() => [...new Set(report?.operations.spans.map(span => span.kind))].sort(), [report]);
  const current = selected ? byId.get(selected) : undefined;
  const ancestry = (id: string | null) => {
    const path: OperationSpan[] = []; let span = id === null ? undefined : byId.get(id);
    while (span) { path.push(span); span = span.parent_id === null ? undefined : byId.get(span.parent_id); }
    return path.reverse();
  };
  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (report?.operations.spans ?? []).filter(span => {
      if (kind !== 'all' && span.kind !== kind) return false;
      if (query && ![span.label, span.id, span.agent_id, span.requesting_model, span.executing_model, span.io?.resource_label, span.io?.resource_id].some(value => value?.toLowerCase().includes(query))) return false;
      return tab !== 'execution' || query !== '' || kind !== 'all' || span.parent_id === scope;
    }).sort((a, b) => (tab === 'timeline' ? (a.started_at === null ? (b.started_at === null ? 0 : 1) : b.started_at === null ? -1 : Date.parse(a.started_at) - Date.parse(b.started_at)) : 0) || a.stream_id.localeCompare(b.stream_id) || a.sequence - b.sequence);
  }, [report, kind, search, scope, tab]);
  const sourceRows = useMemo(() => (report?.source_cost ?? []).filter(sample => !search.trim() || [sample.label, sample.context_source_id, sample.observation_id, sample.request_id].some(value => value?.toLowerCase().includes(search.toLowerCase().trim()))), [report, search]);
  const selectedLinks = useMemo(() => report?.operations.links.filter(link => link.from_operation_id === selected || link.to_operation_id === selected) ?? [], [report, selected]);
  const selectedConsumers = useMemo(() => {
    if (!selected || !report) return [];
    const produced = new Set(report.operations.links.filter(link => link.from_operation_id === selected && link.kind === 'produces_context').map(link => link.context_revision_id));
    return report.operations.links.filter(link => link.kind === 'consumes_context' && produced.has(link.context_revision_id));
  }, [report, selected]);
  const readStats = useMemo(() => { const spans = report?.operations.spans ?? []; const measured = spans.filter(span => span.io?.read_bytes != null); return { bytes: measured.reduce((sum, span) => sum + BigInt(span.io!.read_bytes!), 0n), measured: measured.length, unknown: spans.filter(span => span.kind === 'file_read' && span.io?.read_bytes == null).length }; }, [report]);
  const modelCalls = report?.evidence.observations.filter(observation => observation.kind === 'model' && observation.accounting_scope === 'direct').length ?? 0;
  const visibleRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rowsTotal = tab === 'sources' ? sourceRows.length : filtered.length;
  const pageCount = Math.max(1, Math.ceil(rowsTotal / PAGE_SIZE));
  const currency = report?.summary.currency ?? 'USD';
  const chooseScope = (id: string | null) => { setScope(id); setSearch(''); setKind('all'); setPage(0); setTab('execution'); };
  useEffect(() => {
    if (!report) return;
    const registry = (document as Document & { modelContext?: Registry }).modelContext;
    if (!registry?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<Registry['registerTool']>[0]) => { try { void Promise.resolve(registry.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Visible controls are always available. */ } };
    register({ name: 'get_operation_report_state', title: 'Read operation report state', description: 'Read the current operation report summary, selected operation and execution scope.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new Error('Expected an empty object');
      return { dataset_id: report.dataset_id, summary: report.summary, selected_operation_id: selected, scope_operation_id: scope, query: search, view: tab };
    } });
    register({ name: 'select_operation', title: 'Inspect an operation', description: 'Select an existing captured operation and open its evidence details.', inputSchema: { type: 'object', properties: { operation_id: { type: 'string' } }, required: ['operation_id'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('operation_id' in value) || typeof value.operation_id !== 'string' || !byId.has(value.operation_id)) throw new Error('Choose an existing operation_id');
      const id = value.operation_id; flushSync(() => setSelected(id)); return { selected_operation_id: id, operation: byId.get(id) };
    } });
    return () => lifecycle.abort();
  }, [report, byId, selected, scope, search, tab]);

  const sourceRow = (sample: OperationCostSample, index: number) => <TableRow key={`${sample.observation_id}:${sample.occurrence_id}:${index}`}>
    <TableCell><strong>{sample.label}</strong><span className="op-secondary">{sample.attribution === 'estimated_source' ? 'Estimated whole-request allocation' : 'Unallocated'}</span></TableCell>
    <TableCell className="op-id">{sample.request_id ?? sample.observation_id}<span className="op-secondary">{sample.occurrence_id ?? 'No occurrence allocation'}</span></TableCell>
    <TableCell className="op-number">{money(sample.amount_nanos, currency)}</TableCell>
    <TableCell>{sample.attribution === 'estimated_source' && sample.operation_ids.length ? <Button variant="outline" onClick={() => setSelected(sample.operation_ids.at(-1)!)}>Inspect producer</Button> : 'Unattributed'}</TableCell>
  </TableRow>;

  return <main className="op-explorer">
    <header><div className="brand"><span className="flame" aria-hidden="true">▥</span><strong>flAImegraph</strong><span className="muted">/ Operations</span></div><div className="actions"><Link href="/">Context explorer</Link><span className="badge">Experimental 0.3</span><Button variant="outline" onClick={() => input.current?.click()}>Open report</Button><input ref={input} type="file" accept=".json,application/json" className="sr-only" aria-label="Open local operation report JSON" onChange={event => void openLocal(event.target.files?.[0])} /></div></header>
    <section className="intro"><div><p className="eyebrow">{demo === 'local' ? 'LOCAL REPORT · VALIDATED IN YOUR BROWSER' : demos[demo].note}</p><h1>{label}</h1><p className="muted">Compare dollar spend across activities, models and token categories. Inspect the evidence behind each amount.</p></div><Select value={demo === 'local' ? null : demo} onValueChange={value => { if (value && value in demos) void loadDemo(value as Demo); }}><SelectTrigger aria-label="Choose operation example" className="op-example-select"><SelectValue placeholder="Choose an example">{demo === 'local' ? 'Local report' : demos[demo].label}</SelectValue></SelectTrigger><SelectContent>{Object.entries(demos).map(([id, item]) => <SelectItem key={id} value={id}>{item.label}</SelectItem>)}</SelectContent></Select></section>
    {error && <p role="alert" className="op-error">{error}</p>}
    {loading && <output>Loading and validating the operation report…</output>}
    {report && <>
      <section className="metrics"><div><span className="metric-label">Known token / model cost</span><strong>{money(report.summary.known_net_nanos, currency)}</strong><span className="muted">{words(report.valuation.basis)} · selected pricing</span></div><div><span className="metric-label">Charges / credits</span><strong className="op-coverage-label">{money(report.summary.charges_nanos, currency)} / {money(report.summary.credits_nanos, currency)}</strong><span className="muted">{report.summary.unknown_cost_observation_ids.length} model observations remain unpriced</span></div><div><span className="metric-label">Captured model observations</span><strong>{modelCalls.toLocaleString()}</strong><span className="muted">{report.summary.spans.toLocaleString()} operations · {report.summary.max_depth} execution levels</span></div><div><span className="metric-label">Cost coverage</span><strong className="op-coverage-label">{report.valuation.complete ? 'Complete selected valuation' : 'Partial · known subtotal'}</strong><span className="muted">{report.operations.coverage.complete ? 'Instrumented execution' : 'Partial execution capture'} · {report.operations.coverage.dropped_spans} spans dropped</span></div></section>
      <Tabs value={tab} onValueChange={value => { setTab(value); setPage(0); }}>
        <TabsList aria-label="Operation views"><TabsTrigger value="flamegraph">Dollar flamegraph</TabsTrigger><TabsTrigger value="budget">Cost comparison</TabsTrigger><TabsTrigger value="execution">Execution tree</TabsTrigger><TabsTrigger value="timeline">Chronology</TabsTrigger><TabsTrigger value="sources">Estimated source cost</TabsTrigger></TabsList>
        <TabsContent value="flamegraph"><section className="op-panel"><div className="op-toolbar"><div><h2>{graph === 'operations' ? 'Recorded work · width is operation count' : 'Dollar cost · wider means more expensive'}</h2><p className="muted">{graph === 'operations' ? 'This diagnostic view has no dollar scale.' : `${money(report.summary.charges_nanos, currency)} in known positive costs`}</p></div><Select value={graph} onValueChange={value => { if (value) { setGraph(value); setGraphSearch(''); setGraphQuery(''); } }}><SelectTrigger aria-label="Flamegraph measure" className="op-example-select"><SelectValue>{graph === 'tokens' ? 'Input / cache / output cost' : graph === 'operations' ? 'Operation count (diagnostic)' : graph === 'execution-charges' ? 'Cost by activity' : 'Estimated source cost'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="tokens">Input / cache / output cost</SelectItem><SelectItem value="execution-charges">Cost by activity</SelectItem><SelectItem value="source-charges">Estimated source cost</SelectItem><SelectItem value="operations">Operation count (diagnostic)</SelectItem></SelectContent></Select></div>
          <p className="muted">{graph === 'operations' ? 'Count includes IO with no direct model charge.' : 'Each priced frame shows its dollar amount. Parent amounts include their children; do not add layers together. Credits and unpriced observations are separate.'} Tap a frame to zoom. Search to highlight a label.</p>
          {graph === 'source-charges' && <p className="op-notice">Estimated shares of whole-request cost, including output. This is not exact per-file billing or the savings from removing a source.</p>}
          {graph === 'tokens' && <p className="op-notice">Costs are grouped by token category, with recorded activities inside each group. Matching saved rates supply the split; otherwise totals remain unsplit. Reasoning is already included in output.</p>}
          {demo !== 'local' && <form className="op-toolbar" onSubmit={event => { event.preventDefault(); setGraphSearch(graphQuery); }}><Input aria-label="Search flamegraph frames" placeholder="Search an activity or token category…" value={graphQuery} onChange={event => setGraphQuery(event.target.value)} /><Button type="submit">Search frames</Button><Button type="button" variant="outline" onClick={() => { setGraphQuery(''); setGraphSearch(''); }}>Clear search</Button></form>}
          {demo === 'local' ? <p>Your local report’s dollar breakdown is available under Cost comparison. Export it with the bundled renderer for an interactive SVG flamegraph.</p> : graph !== 'operations' && report.summary.charges_nanos === '0' ? <div className="budget-empty"><h3>No positive model cost to plot</h3><p>{modelCalls === 0 ? 'This directory-scan benchmark made no model calls. It demonstrates filesystem instrumentation, so it cannot show token spending.' : 'This report has no known positive monetary amounts. Missing prices do not mean the work was free.'}</p><Button onClick={() => void loadDemo('native')}>Open real token-spend example</Button><Button variant="outline" onClick={() => setGraph('operations')}>Inspect operation count</Button></div> : <DollarFlamegraph source={`${demos[demo].graph}-${graph}`} title={`${graph} flamegraph`} search={graphSearch} />}
        </section>{graph !== 'operations' && <BudgetPanel key={`flame-costs:${reportRevision}`} report={report} rateCard={budgetRates} onInspect={setSelected} compact />}<Button variant="outline" onClick={() => setTab('budget')}>Compare activities and token costs</Button></TabsContent>
        <TabsContent value="budget"><BudgetPanel key={`${report.dataset_id}:${reportRevision}`} report={report} rateCard={budgetRates} onRateCardChange={setBudgetRates} onInspect={setSelected} /></TabsContent>
        {['execution', 'timeline'].map(view => <TabsContent value={view} key={view}><section className="op-panel"><div className="op-toolbar"><Input value={search} aria-label="Search operations" placeholder="Search operations, resources, agents or models" onChange={event => { setSearch(event.target.value); setPage(0); }} /><Select value={kind} onValueChange={value => { if (value) { setKind(value); setPage(0); } }}><SelectTrigger aria-label="Filter operation kind" className="op-kind-select"><SelectValue>{kind === 'all' ? 'All operation kinds' : words(kind)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All operation kinds</SelectItem>{kinds.map(value => <SelectItem key={value} value={value}>{words(value)}</SelectItem>)}</SelectContent></Select></div>
          {view === 'execution' ? <nav aria-label="Execution scope" className="op-breadcrumb"><Button variant="ghost" onClick={() => chooseScope(null)}>All roots</Button>{ancestry(scope).map(span => <Button key={span.id} variant="ghost" onClick={() => chooseScope(span.id)}>› {span.label}</Button>)}{(search || kind !== 'all') && <span className="muted">Search covers the whole run</span>}</nav> : <p className="op-table-note">Recorded start times where available; unknown start times follow in producer sequence. Clocks from different producers may differ. Overlapping durations are not additive.</p>}
          <Table><TableHeader><TableRow><TableHead>Operation</TableHead><TableHead>{view === 'timeline' ? 'Start / stream order' : 'Kind / children'}</TableHead><TableHead>Elapsed</TableHead><TableHead>Read / returned bytes</TableHead><TableHead>Known self / subtree charge</TableHead></TableRow></TableHeader><TableBody>{visibleRows.map(span => { const node = nodes.get(span.id)!; return <TableRow key={span.id}><TableCell><div className="op-row-title"><Button variant="ghost" className="op-inspect" onClick={() => setSelected(span.id)}>{span.label}</Button>{node.child_count > 0 && <Button variant="outline" size="sm" aria-label={`Open children of ${span.label}`} onClick={() => chooseScope(span.id)}>↳ {node.child_count.toLocaleString()}</Button>}</div><span className="op-secondary">{span.status} · depth {node.depth}{span.executing_model ? ` · ${span.executing_model}` : ''}</span></TableCell><TableCell>{view === 'timeline' ? span.started_at ?? `Sequence ${span.sequence}` : words(span.kind)}<span className="op-secondary op-id">{view === 'timeline' ? span.stream_id : `${node.child_count} child operations`}</span></TableCell><TableCell>{elapsed(span)}</TableCell><TableCell className="op-number">{span.io ? `${quantity(span.io.read_bytes)} / ${quantity(span.io.returned_bytes)}` : '—'}</TableCell><TableCell className="op-number">{node.self_cost_state === 'priced' ? money(node.self_charges_nanos, currency) : node.self_cost_state === 'unknown' ? 'Unknown' : 'Not applicable'}<span className="op-secondary">{money(node.subtree_charges_nanos, currency)} known in subtree{node.unknown_cost_observation_ids.length ? ' + unpriced' : ''}</span></TableCell></TableRow>; })}</TableBody></Table>
          {visibleRows.length === 0 && <p className="op-table-note">No operations match this scope or filter.</p>}
        </section></TabsContent>)}
        <TabsContent value="sources"><section className="op-panel"><div className="op-toolbar"><Input value={search} aria-label="Search source allocations" placeholder="Search sources or consuming requests" onChange={event => { setSearch(event.target.value); setPage(0); }} /></div><p className="op-notice">Estimated shares of whole request cost, including output. Repeated occurrences are separate exposures. An operation is attributed only when both its production and the consuming occurrence are linked. Uncovered context stays unallocated.</p><Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Consuming request / occurrence</TableHead><TableHead>Estimated amount</TableHead><TableHead>Producing operation</TableHead></TableRow></TableHeader><TableBody>{sourceRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(sourceRow)}</TableBody></Table>{sourceRows.length === 0 && <p className="op-table-note">{search.trim() ? 'No source allocations match this search.' : 'No model cost or context allocation was captured for this workload.'}</p>}</section></TabsContent>
      </Tabs>
      {tab !== 'flamegraph' && tab !== 'budget' && <div className="op-pagination"><span>{rowsTotal.toLocaleString()} results · page {Math.min(page + 1, pageCount)} of {pageCount}</span><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Next</Button></div>}
      <section className="op-coverage"><h2>Capture limits</h2><p>Known read bytes: {readStats.measured ? readStats.bytes.toLocaleString() : 'Unknown'} · {readStats.unknown} reads lack byte counts. Reading a file does not prove it entered model context.</p>{report.operations.coverage.limitations.slice(0, 5).map((limitation, index) => <p key={index}>{limitation}</p>)}{report.operations.coverage.limitations.length > 5 && <details><summary>Show {report.operations.coverage.limitations.length - 5} more capture notes</summary>{report.operations.coverage.limitations.slice(5).map((limitation, index) => <p key={index}>{limitation}</p>)}</details>}<p>{report.summary.unbound_observation_ids.length} monetary observations have no execution binding. A shell command records its outer execution; internal files need their own instrumentation.</p><p>Recording and deterministic classification need no model calls. Any summarizer or semantic classifier is workload activity and must carry its own usage.</p></section>
      <Sheet open={Boolean(current)} onOpenChange={open => { if (!open) setSelected(null); }}><SheetContent className="op-detail"><SheetHeader><SheetTitle>{current?.label}</SheetTitle><SheetDescription>Dollar cost, token categories and operation evidence</SheetDescription></SheetHeader>{current && <div className="op-detail-body"><BudgetPanel key={current.id} report={report} rateCard={budgetRates} operationId={current.id} onInspect={setSelected} compact /><p className="badge">{words(current.kind)} · {current.status}</p><nav aria-label="Selected operation ancestry" className="op-breadcrumb">{ancestry(current.id).map(span => <Button variant="ghost" key={span.id} onClick={() => setSelected(span.id)}>{span.label}</Button>)}</nav><dl><dt>Classification</dt><dd>{current.classification.evidence} · {current.classification.method}</dd><dt>Requesting model</dt><dd>{current.requesting_model ?? 'Unknown / not captured'}</dd><dt>Executing model</dt><dd>{current.executing_model ?? 'No executing model recorded'}</dd><dt>Agent</dt><dd>{current.agent_id ?? 'Unknown'}</dd><dt>Elapsed</dt><dd>{elapsed(current)}<span className="op-secondary">{current.timing.duration_ns.evidence} · {current.timing.duration_ns.method} · {current.timing.duration_ns.clock}</span></dd><dt>Start / end</dt><dd>{current.started_at ?? 'Unknown'}<br />{current.ended_at ?? 'Unknown'}</dd><dt>Parent evidence</dt><dd>{current.parentage ? `${current.parentage.evidence} · ${current.parentage.method}` : 'Root operation'}</dd><dt>Model observation</dt><dd className="op-id">{current.observation_id ?? 'No direct monetary observation'}</dd></dl>
        {current.io && <section><h2>File / directory evidence</h2><p>{current.io.resource_label}</p><dl>{(['read_bytes', 'returned_bytes', 'written_bytes', 'inserted_bytes', 'deleted_bytes', 'entry_count', 'examined_entries'] as const).map(measure => <div key={measure}><dt>{words(measure)}</dt><dd>{quantity(current.io![measure])}<span className="op-secondary">{current.io!.measurements[measure].evidence} · {current.io!.measurements[measure].method}</span></dd></div>)}<dt>Requested range</dt><dd>{current.io.requested_range ? `${current.io.requested_range.start_line}–${current.io.requested_range.end_line ?? 'end'}` : 'Not captured'}</dd><dt>Content fingerprint</dt><dd className="op-id">{current.io.content_sha256 ?? 'Unknown'}</dd></dl></section>}
        {current.routing && <section><h2>Workload routing policy</h2><p>{current.routing.action} · {current.routing.policy_id} / {current.routing.policy_version}</p><p>{current.routing.reason}</p><p>{current.routing.requested_model ?? 'Unknown model'} → {current.routing.selected_model ?? 'Unknown model'}</p><pre>{JSON.stringify(current.routing.facts, null, 2)}</pre><p className="muted">The profiler recorded this policy decision; it did not apply it.</p></section>}
        <section><h2>Context and dependencies</h2>{selectedLinks.length === 0 ? <p>No explicit links captured.</p> : selectedLinks.slice(0, PAGE_SIZE).map((link, index) => <p className="op-id" key={index}>{words(link.kind)} · {link.request_id ?? link.to_operation_id ?? link.context_revision_id}<span className="op-secondary">{link.evidence} · {link.method}</span></p>)}{selectedLinks.length > PAGE_SIZE && <p>{selectedLinks.length} links total; first {PAGE_SIZE} shown. The report retains all links.</p>}{selectedConsumers.length > 0 && <><h3>Requests consuming this output</h3>{selectedConsumers.slice(0, PAGE_SIZE).map((link, index) => <p key={index}><Button variant="outline" onClick={() => setSelected(link.from_operation_id)}>Inspect consumer</Button><span className="op-secondary op-id">{link.request_id} · {link.occurrence_id}</span></p>)}{selectedConsumers.length > PAGE_SIZE && <p>{selectedConsumers.length} consumers total; first {PAGE_SIZE} shown. The report retains all consumers.</p>}</>}</section>
        <section><h2>Source evidence</h2><pre>{refs(current)}</pre><p className="op-id">{current.id}</p></section><Button onClick={() => { chooseScope(current.id); setSelected(null); }}>Open child operations</Button></div>}</SheetContent></Sheet>
    </>}
    <footer className="op-footer"><p>Local reports stay in this browser. <a href="https://github.com/awjreynolds/flAImegraph">Source and interchange specification</a></p></footer>
  </main>;
}
