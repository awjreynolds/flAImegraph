'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnalysisWorkbench } from './analysis-workbench';
import { UsageFlamegraph } from './flamegraph';
import { LifecyclePanel, lifecycleDuration, lifecycleStateLabel } from './lifecycle-panel';
import { TaskTokenTable, TokenBreakdown } from './token-breakdown';
import { ActionTimingFields } from '../action-timing';
import { usageTiming } from '@/lib/timing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableBody, TableRow, TableCell, TableHead, TableHeader } from '@/components/ui/table';
import { createUsageReport, validateUsageBundle, validateUsageReport, importUsage, fromLegacyEvidence, analyzeEfficiency, decimalCompare, createUsageProfile, projectLifecycle, validateLifecycleCapture } from '@/lib/usage.js';
import type { LifecycleProjection, UsageBundle, UsageGrouping, UsageObservation, UsageDimensionFact, EfficiencyOptions } from '@/lib/usage.js';

const names: Record<string, string> = { work_item: 'Work identifier', input_tokens: 'Input tokens', output_tokens: 'Output tokens', cache_read_input_tokens: 'Cached input', cache_write_input_tokens: 'Cache writes', reasoning_output_tokens: 'Reasoning output', operation_count: 'Operations', read_bytes: 'Bytes read', returned_bytes: 'Bytes returned', elapsed_ns: 'Elapsed intervals', duration_ns: 'Duration', tool_calls: 'Tool calls' };
const pretty = (value: string) => names[value] ?? value.replaceAll('_', ' ');
const number = (value: string | null | undefined) => {
  if (value == null) return 'Unknown';
  const [whole, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
};
const factText = (fact?: UsageDimensionFact) => fact?.value == null ? 'Unknown' : String(fact.value);
const model = (observation: UsageObservation) => observation.dimensions.actual_model?.value != null ? String(observation.dimensions.actual_model.value) : observation.dimensions.model?.value != null ? `${String(observation.dimensions.model.value)} · unconfirmed` : observation.dimensions.requested_model?.value != null ? `${String(observation.dimensions.requested_model.value)} · requested` : 'Model unknown / not applicable';
const timingQualification = (qualified: boolean) => qualified ? 'Timing needs review' : 'Elapsed interval recorded';
const examples = { native: { path: '/usage-native.json', label: 'Recorded development session' }, files: { path: '/usage-files.json', label: '5,000-file operation capture' }, interruptions: { path: '/usage-interruptions.json', label: 'Interruption scenario (synthetic)' }, task: { path: '/usage-task-example.json', label: 'Task breakdown example (synthetic)' } };
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type LoadedSession = { bundle: UsageBundle; lifecycle: LifecycleProjection | null };
function loadedBundle(value: unknown): LoadedSession {
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'lifecycle') {
    const capture = validateLifecycleCapture(value);
    const lifecycle = projectLifecycle(capture);
    return { bundle: lifecycle.usage, lifecycle };
  }
  if (value && typeof value === 'object' && 'bundle' in value) return { bundle: validateUsageReport(value).bundle, lifecycle: null };
  if (value && typeof value === 'object' && 'evidence' in value) return { bundle: validateUsageBundle(fromLegacyEvidence(value.evidence)), lifecycle: null };
  if (value && typeof value === 'object' && 'schema_version' in value && value.schema_version === '0.1.0') return { bundle: validateUsageBundle(fromLegacyEvidence(value)), lifecycle: null };
  return { bundle: validateUsageBundle(value), lifecycle: null };
}

export default function UsageExplorer() {
  const [bundle, setBundle] = useState<UsageBundle | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleProjection | null>(null);
  const [example, setExample] = useState<keyof typeof examples | 'local'>('native');
  const [filename, setFilename] = useState('Recorded development session');
  const [metric, setMetric] = useState('input_tokens');
  const [group, setGroup] = useState<UsageGrouping>('model');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [format, setFormat] = useState('auto');
  const [workIdentifier, setWorkIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisOptions, setAnalysisOptions] = useState<EfficiencyOptions>({});
  const file = useRef<HTMLInputElement>(null);
  const analysisFile = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  function adopt(next: LoadedSession, name: string) {
    const usage = next.bundle;
    const first = usage.meters.find(meter => meter.id === 'input_tokens') ?? usage.meters.find(meter => meter.id === 'operation_count') ?? usage.meters[0];
    setBundle(usage); setLifecycle(next.lifecycle); setGroup('model'); setFilename(name); setMetric(first?.id ?? ''); setSelected(null); setSelectedActionId(null); setSelectedGroup(null); setQuery(''); setPage(0); setAnalysisOptions({}); setError(null);
  }
  function selectObservation(id: string) {
    setSelected(id);
    const observation = bundle?.observations.find(row => row.id === id);
    setSelectedActionId(lifecycle?.actions.find(action => action.action_id === id || action.action_id === observation?.operation_id)?.action_id ?? null);
  }
  function selectLifecycleAction(id: string) {
    setSelectedActionId(id);
    if (bundle?.observations.some(observation => observation.id === id)) setSelected(id);
    else setSelected(null);
  }
  useEffect(() => {
    if (example === 'local') return;
    const id = ++sequence.current, controller = new AbortController();
    fetch(examples[example].path, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('The example could not be loaded.'); return response.json(); }).then(value => {
      if (id === sequence.current) adopt(loadedBundle(value), examples[example].label);
    }).catch(reason => { if (!controller.signal.aborted && id === sequence.current) setError(reason.message); }).finally(() => { if (id === sequence.current) setLoading(false); });
    return () => controller.abort();
  }, [example]);
  const derived = useMemo(() => {
    if (!bundle) return { report: null, analysis: null, error: null };
    try {
      const report = createUsageReport(bundle, { group_by: [group] });
      return { report, error: null };
    } catch (reason) { return { report: null, analysis: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [bundle, group]);
  const report = derived.report;
  const analysisResult = useMemo(() => {
    try { return { value: report ? analyzeEfficiency(report, analysisOptions) : null, error: null }; }
    catch (reason) { return { value: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [report, analysisOptions]);
  const analysis = analysisResult.value;
  const total = report?.meter_totals.find(item => item.meter_id === metric);
  const meter = bundle?.meters.find(item => item.id === metric);
  const detail = bundle?.observations.find(observation => observation.id === selected);
  const selectedAction = lifecycle?.actions.find(action => action.action_id === selectedActionId) ?? null;
  const selectedWaitUncertain = selectedAction ? lifecycle?.issues.some(issue => issue.code === 'LIFECYCLE_WAIT_UNCERTAIN' && issue.action_id === selectedAction.action_id) ?? false : false;
  const detailDimensions = detail ? Object.entries(detail.dimensions).flatMap(([key, value]) => key === 'extensions'
    ? Object.entries(value as Record<string, UsageDimensionFact>).filter(([extension]) => !extension.startsWith('flAImegraph.lifecycle.'))
    : [[key, value] as [string, UsageDimensionFact]]) : [];
  const receiptObservations = lifecycle && detail ? bundle?.observations.filter(observation => observation.parent_id === detail.id && Object.keys(observation.measurements).length > 0) ?? [] : [];
  const taskReport = useMemo(() => bundle ? createUsageReport(bundle, { group_by: ['task'] }) : null, [bundle]);
  const groups = useMemo(() => (report?.groups ?? []).map(item => { const total = item.meter_totals.find(value => value.meter_id === metric); return { ...item, amount: total?.known_total ?? '0', coverage: total?.coverage }; }).sort((a, b) => -decimalCompare(a.amount, b.amount)), [report, metric]);
  const visible = useMemo(() => {
    const ids = selectedGroup ? new Set(report?.groups.find(item => item.key === selectedGroup)?.observation_ids ?? []) : null;
    const text = query.toLowerCase();
    return (bundle?.observations ?? []).filter(observation => (!ids || ids.has(observation.id)) && (!text || [observation.id, observation.subject, model(observation), observation.task_id, observation.work_item_id, observation.agent_id].join(' ').toLowerCase().includes(text)));
  }, [bundle, selectedGroup, report, query]);
  async function loadFile(selectedFile?: File) {
    if (!selectedFile) return;
    const id = ++sequence.current; setExample('local'); setLoading(true); setError(null);
    try {
      if (selectedFile.size > 50 * 1024 * 1024) throw new Error('Choose a capture smaller than 50 MB.');
      const text = await selectedFile.text();
      const next = format === 'auto' ? loadedBundle(JSON.parse(text)) : { bundle: validateUsageBundle(importUsage(text, { format, dataset_id: 'local-session', work_item_id: workIdentifier.trim() ? workIdentifier : undefined })), lifecycle: null };
      if (id === sequence.current) adopt(next, selectedFile.name);
    } catch (reason) { if (id === sequence.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (id === sequence.current) setLoading(false); }
  }
  const knownPercent = (amount: string) => {
    if (!total || decimalCompare(total.known_total, '0') === 0) return 0;
    const places = Math.max(amount.split('.')[1]?.length ?? 0, total.known_total.split('.')[1]?.length ?? 0);
    const scaled = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole + fraction.padEnd(places, '0')); };
    return Math.min(100, Number(scaled(amount) * 10000n / scaled(total.known_total)) / 100);
  };
  return <main className="usage-explorer">
    <header className="usage-header"><div><span className="usage-wordmark">flAImegraph <span>0.5</span></span><h1>Usage & delivery efficiency</h1></div><nav aria-label="Explorer views"><Link href="/context/">Context</Link><Link href="/operations/">Legacy cost views</Link></nav></header>
    <div className="usage-controls">
      <label>Session<select value={example} onChange={event => { setLoading(true); setError(null); setExample(event.target.value as keyof typeof examples | 'local'); }}><option value="native">{examples.native.label}</option><option value="files">{examples.files.label}</option><option value="interruptions">{examples.interruptions.label}</option><option value="task">{examples.task.label}</option>{example === 'local' && <option value="local">{filename}</option>}</select></label>
      <label>Import format<select value={format} onChange={event => setFormat(event.target.value)}><option value="auto">Usage / lifecycle / legacy report JSON</option>{['codex','pi','openai','anthropic','gemini','otel'].map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label htmlFor="work-identifier">Work identifier for native log<Input id="work-identifier" value={workIdentifier} onChange={event => setWorkIdentifier(event.target.value)} placeholder="PROJ-142 or issue URL" disabled={format === 'auto'} /></label><Button onClick={() => file.current?.click()}>Load a session</Button><input ref={file} type="file" accept=".json,.jsonl,.ndjson" hidden onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
      {report && <Button variant="outline" onClick={() => download('usage-report.json', report)}>Export report</Button>}
    </div>
    <p className="usage-local">Files are processed in this browser. Usage is recorded independently of pricing.</p>
    {(error || derived.error) && <div className="usage-error" role="alert">{error ?? derived.error}</div>}
    {loading && <output>Loading session…</output>}
    {report && bundle && <>
      <Tabs defaultValue="usage"><TabsList className="usage-tabs"><TabsTrigger value="usage">Usage profile</TabsTrigger><TabsTrigger value="efficiency">Efficiency analysis</TabsTrigger><TabsTrigger value="benchmarks">Benchmarks & runway</TabsTrigger></TabsList>
        <TabsContent value="usage">
          {taskReport && <TokenBreakdown bundle={bundle} report={taskReport} selectedMeterId={metric} onSelectMeter={meterId => { setMetric(meterId); setPage(0); }} />}
          {taskReport && <TaskTokenTable bundle={bundle} report={taskReport} onSelectObservation={selectObservation} selectedTaskKey={group === 'task' ? selectedGroup : null} onSelectTask={groupKey => { setGroup('task'); setSelectedGroup(groupKey); setQuery(''); setPage(0); }} />}
          {lifecycle && <LifecyclePanel projection={lifecycle} selectedActionId={selectedActionId} onSelectAction={selectLifecycleAction} />}
          {taskReport && <UsageFlamegraph key={bundle.dataset_id} report={taskReport} meterId={metric} onSelectObservation={selectObservation} />}
          <section className="usage-panel"><div className="usage-panel-heading"><div><h2>Secondary usage view</h2><p>{total?.coverage.known_observations ? `${number(total.known_total)} ${meter?.unit} · selected meter subtotal` : 'No known additive usage for this measure'}</p></div><div className="usage-inline-controls"><label>Measure<select value={metric} onChange={event => { setMetric(event.target.value); setPage(0); }}>{bundle.meters.map(item => <option value={item.id} key={item.id}>{pretty(item.id)} ({item.unit})</option>)}</select></label><label>Secondary grouping<select value={group} onChange={event => { setGroup(event.target.value as UsageGrouping); setSelectedGroup(null); setPage(0); }}>{['model','work_item','task','agent','scope','operation','session'].map(item => <option value={item} key={item}>{pretty(item)}</option>)}</select></label>{(example === 'native' || example === 'files') && <a href={`/usage-${example}.svg`} target="_blank" rel="noreferrer">Upstream SVG · {example === 'native' ? 'input tokens' : 'operations'}</a>}</div></div>
            {meter?.subset_of && <p className="usage-note">Included in {pretty(meter.subset_of).toLowerCase()}; these totals should not be added together.</p>}
            {groups.slice(0, 20).map((item, index) => <button className="usage-bar-row" key={item.key} onClick={() => { setSelectedGroup(item.key); setPage(0); }}><span>{Object.values(item.dimensions).join(' · ')}</span><strong>{item.coverage?.known_observations ? `${number(item.amount)}${item.coverage.unknown_observations ? ' + unknown' : ''}` : item.coverage?.total_observations ? 'Unknown / non-additive' : 'Not reported'}</strong><span className="usage-bar-track"><span style={{ width: `${item.coverage?.known_observations ? knownPercent(item.amount) : 0}%`, background: ['#67c4e6','#bb9aee','#86d4b2','#e5bf73'][index % 4] }} /></span></button>)}
            {groups.length > 20 && <p className="usage-note">Showing the 20 largest groups. Search the observation table to inspect the full capture.</p>}
            {total && <p className="usage-note">{total.coverage.unknown_observations} unavailable · {total.coverage.excluded_observations} non-additive observations excluded. Each chart shows one meter.</p>}
            <Button variant="outline" onClick={() => download('usage-profile.json', createUsageProfile(report, { meter_id: metric, group_by: [group] }))}>Export selected profile</Button>
          </section>
          <section className="usage-panel"><div className="usage-panel-heading"><h2>Observations <span className="usage-count">{visible.length}</span></h2><Input aria-label="Search observations" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search tasks, models, agents or operations" />{selectedGroup && <Button variant="outline" onClick={() => { setSelectedGroup(null); setPage(0); }}>All groups</Button>}</div>
            <Table><TableHeader><TableRow><TableHead>Operation / work identifier</TableHead><TableHead>Action timing</TableHead><TableHead>Model</TableHead><TableHead>{pretty(metric)}</TableHead><TableHead>Requested tier</TableHead><TableHead>Applied tier</TableHead><TableHead>Reasoning requested</TableHead></TableRow></TableHeader><TableBody>{visible.slice(page * 30, page * 30 + 30).map(observation => <TableRow key={observation.id}><TableCell><button className="usage-inspect" onClick={() => selectObservation(observation.id)}>{observation.subject ?? observation.operation_id ?? 'Observation'}</button><small>{observation.work_item_id ?? 'Work unassigned'} · {observation.task_id ?? 'Task unassigned'} · {observation.status}</small></TableCell><TableCell><ActionTimingFields timing={usageTiming(observation, bundle.meters)} compact /></TableCell><TableCell>{model(observation)}</TableCell><TableCell className="usage-number">{observation.measurements[metric] ? number(observation.measurements[metric].value) : 'Not reported'}<small>{observation.measurements[metric]?.evidence}</small></TableCell><TableCell>{factText(observation.dimensions.requested_tier)}</TableCell><TableCell>{factText(observation.dimensions.actual_tier)}</TableCell><TableCell>{factText(observation.dimensions.requested_reasoning)}</TableCell></TableRow>)}</TableBody></Table>
            <div className="usage-pagination"><span>{visible.length ? page * 30 + 1 : 0}–{Math.min(visible.length, page * 30 + 30)} of {visible.length}</span><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={(page + 1) * 30 >= visible.length} onClick={() => setPage(page + 1)}>Next</Button></div>
          </section>
        </TabsContent>
        <TabsContent value="benchmarks"><AnalysisWorkbench /></TabsContent>
        <TabsContent value="efficiency"><section className="usage-panel"><div className="usage-panel-heading"><div><h2>Evidence before advice</h2><p>Compare accepted work, resource use and the conditions that produced it.</p></div><Button variant="outline" onClick={() => analysisFile.current?.click()}>Load outcomes & benchmarks</Button><input ref={analysisFile} type="file" accept=".json" hidden onChange={async event => { const selectedFile = event.target.files?.[0]; event.target.value = ''; if (selectedFile) try { if (selectedFile.size > 50 * 1024 * 1024) throw new Error('Choose a file smaller than 50 MB.'); const version = sequence.current; const options = JSON.parse(await selectedFile.text()); analyzeEfficiency(report, options); if (version !== sequence.current) return; setAnalysisOptions(options); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }} /></div>
          {analysisResult.error && <p className="usage-error" role="alert">{analysisResult.error}</p>}{analysis && <><div className="usage-analysis-summary"><strong>{analysis.cohort.accepted_count} accepted / {analysis.cohort.task_count} assigned tasks</strong><span>{analysis.cohort.retry_count} retries · {analysis.cohort.escalation_count} escalations</span></div>{analysis.findings.map((finding, index) => <article className={`usage-finding ${finding.status}`} key={`${finding.rule}-${index}`}><span className="usage-badge">{finding.status}</span><h3>{pretty(finding.rule.replaceAll('-', '_'))}</h3><p>{finding.message}</p>{finding.limitations?.map(text => <small key={text}>{text}</small>)}{finding.observation_ids?.length ? <Button variant="ghost" onClick={() => selectObservation(finding.observation_ids![0])}>Inspect evidence</Button> : null}</article>)}{analysis.benchmark_comparisons.map(comparison => <article className="usage-finding" key={`${comparison.baseline_id}:${comparison.candidate_id}`}><span className="usage-badge">{comparison.status}</span><h3>{comparison.baseline_id} → {comparison.candidate_id}</h3><p>Accepted: {comparison.accepted_counts.baseline} / {comparison.sample_sizes.baseline} baseline · {comparison.accepted_counts.candidate} / {comparison.sample_sizes.candidate} candidate</p>{comparison.resource_deltas.map(delta => <p key={delta.meter_id}>{pretty(delta.meter_id)} per accepted task: baseline {delta.baseline ? `${delta.baseline.numerator} / ${delta.baseline.denominator}` : 'Unknown'} · candidate {delta.candidate ? `${delta.candidate.numerator} / ${delta.candidate.denominator}` : 'Unknown'} {delta.unit}</p>)}{comparison.limitations.map(text => <small key={text}>{text}</small>)}</article>)}
          {analysis.candidate_policy && <article className="usage-finding candidate"><span className="usage-badge">{analysis.candidate_policy.status} scenario</span><h3>Candidate policy: {analysis.candidate_policy.policy_id}</h3><p>Expected resource demand per accepted task, including declared overhead. This is a scenario to evaluate.</p>{analysis.candidate_policy.status === 'derived' && analysis.candidate_policy.expected_per_accepted.map(rate => <p key={rate.meter_id}>{pretty(rate.meter_id)}: {rate.rate.numerator} / {rate.rate.denominator} {rate.unit} · {rate.evidence}</p>)}{analysis.candidate_policy.limitations.map(text => <small key={text}>{text}</small>)}</article>}
          {analysis.runway && <article className="usage-finding"><span className="usage-badge">{analysis.runway.status}</span><h3>Session delivery runway</h3><p>{analysis.runway.accepted_work ?? 'Unknown'} accepted tasks within the declared horizon.</p>{analysis.runway.limitations.map(text => <small key={text}>{text}</small>)}</article>}
          {analysis.limitations.map(text => <p className="usage-note" key={text}>{text}</p>)}<Button variant="outline" onClick={() => download('efficiency-analysis.json', analysis)}>Export analysis</Button></>}
        </section></TabsContent>
      </Tabs>
      <footer className="usage-coverage"><h2>Capture coverage</h2><p>{filename} · {bundle.observations.length} observations · {bundle.sources.length} sources. {bundle.coverage?.complete ? 'Declared complete capture.' : 'Partial or unknown capture.'}</p>{bundle.coverage?.limitations.map(text => <p key={text}>{text}</p>)}<p>A request timestamp, a configured model and a confirmed provider response are separate facts. Missing evidence remains unknown.</p></footer>
    </>}
    <Sheet open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><SheetContent className="usage-detail"><SheetHeader><SheetTitle>{detail?.subject ?? 'Observation'}</SheetTitle><SheetDescription>{detail?.id}</SheetDescription></SheetHeader>{detail && <div className="usage-detail-body"><h3>Work association</h3><p>{detail.work_item_id ?? 'Work identifier unassigned'}</p><small>Task: {detail.task_id ?? 'Unassigned'} · Agent: {detail.agent_id ?? 'Unassigned'} · Dataset: {bundle?.dataset_id}</small><h3>Usage</h3>{Object.keys(detail.measurements).length > 0 && Object.entries(detail.measurements).map(([key, value]) => <div className="usage-detail-row" key={key}><strong>{pretty(key)}</strong><span>{number(value.value)} · {value.evidence}</span><small>{value.method} · {value.count_basis} · {value.aggregation}</small></div>)}{receiptObservations.length > 0 && <><h4>Receipts</h4>{receiptObservations.flatMap(receipt => Object.entries(receipt.measurements).map(([meterId, measurement]) => <div className="usage-detail-row" key={`${receipt.id}:${meterId}`}><strong>{receipt.id}</strong><span>{pretty(meterId)}: {number(measurement.value)} {bundle?.meters.find(meter => meter.id === meterId)?.unit ?? ''} · {measurement.evidence}</span><small>{measurement.aggregation} · {measurement.count_basis} · {measurement.method}</small></div>))}</>}{Object.keys(detail.measurements).length === 0 && receiptObservations.length === 0 && <p className="usage-note">No direct usage measurement was recorded for this action.</p>}{detailDimensions.length > 0 && <><h3>Processing dimensions</h3>{detailDimensions.map(([key, value]) => <div className="usage-detail-row" key={key}><strong>{pretty(key)}</strong><span>{factText(value as UsageDimensionFact)} · {(value as UsageDimensionFact).evidence}</span><small>{(value as UsageDimensionFact).method}</small></div>)}</>}<h3>Action timing</h3><ActionTimingFields timing={usageTiming(detail, bundle?.meters ?? [])} />{selectedAction && <><h3>Lifecycle action</h3><div className="usage-detail-row"><strong>State</strong><span>{lifecycleStateLabel(selectedAction.state)}</span><small>{timingQualification(selectedAction.timing_qualified)} · elapsed duration is not active CPU time.</small></div><div className="usage-detail-row"><strong>Elapsed / known wait</strong><span>{lifecycleDuration(selectedAction.elapsed_ns)} · {selectedWaitUncertain ? 'Unknown' : lifecycleDuration(selectedAction.known_wait_ns)} known wait</span><small>{selectedWaitUncertain ? 'Missing lifecycle records prevent confirming the closed pause duration.' : 'Known wait includes explicitly closed pauses. Unexplained gaps remain cause unknown.'}</small></div>{(selectedAction.parent_id || selectedAction.retry_of) && <div className="usage-detail-row"><strong>Lineage</strong>{selectedAction.parent_id && <span>Parent <button className="usage-inspect" onClick={() => selectLifecycleAction(selectedAction.parent_id!)}>{selectedAction.parent_id}</button></span>}{selectedAction.retry_of && <span>Retry of <button className="usage-inspect" onClick={() => selectLifecycleAction(selectedAction.retry_of!)}>{selectedAction.retry_of}</button></span>}</div>}{selectedAction.reasons.length > 0 && <div className="usage-detail-row"><strong>Interruption reasons</strong>{selectedAction.reasons.map((item, index) => <span key={`${item.code}:${index}`}>{item.code} · {item.evidence} · {item.method}{item.reset_at ? ` · reset at ${item.reset_at}` : ''}</span>)}</div>}{selectedAction.gaps.length > 0 && <div className="usage-detail-row"><strong>Capture gaps</strong>{selectedAction.gaps.map((gap, index) => <span key={`${gap.from}:${index}`}>{gap.from} → {gap.to} · {lifecycleDuration(gap.elapsed_ns)} · cause unknown</span>)}</div>}</>}<h3>Source references</h3>{detail.source_refs.map(ref => <p key={`${ref.source_id}:${ref.record}`} className="usage-source-ref">{ref.source_id} · {ref.record}</p>)}</div>}</SheetContent></Sheet>
  </main>;
}
