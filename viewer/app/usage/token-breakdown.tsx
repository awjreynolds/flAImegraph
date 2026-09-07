'use client';
import type { ReactNode } from 'react';
import type { UsageBundle, UsageMeter, UsageReport, UsageReportGroup, UsageMeterTotal } from '@/lib/usage.js';

const tokenOrder = ['input_tokens', 'cache_read_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
const tokenNames: Record<string, string> = {
  input_tokens: 'Input',
  cache_read_input_tokens: 'Cached input',
  cache_write_input_tokens: 'Cache writes',
  output_tokens: 'Output',
  reasoning_output_tokens: 'Reasoning',
};
type UsageObservation = UsageBundle['observations'][number];

function tokenMeters(bundle: UsageBundle): UsageMeter[] {
  return bundle.meters.filter(meter => meter.unit === 'token' || meter.unit === 'tokens').sort((a, b) => {
    const ai = tokenOrder.indexOf(a.id), bi = tokenOrder.indexOf(b.id);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? tokenOrder.length : ai) - (bi === -1 ? tokenOrder.length : bi);
    return a.id.localeCompare(b.id);
  });
}

function format(value: string | null): string {
  if (value === null) return 'Unknown';
  const [whole, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

function meterLabel(meter: UsageMeter | undefined): string {
  return meter ? tokenNames[meter.id] ?? meter.id.replaceAll('_', ' ') : 'Unknown meter';
}

function meterTotal(report: UsageReport, meterId: string): UsageMeterTotal | undefined {
  return report.meter_totals.find(total => total.meter_id === meterId);
}

function groupMeterTotal(group: UsageReportGroup, meterId: string): UsageMeterTotal | undefined {
  return group.meter_totals.find(total => total.meter_id === meterId);
}

function coverage(total: UsageMeterTotal | undefined): string {
  if (!total || total.coverage.total_observations === 0) return 'Not reported';
  const labels = total.coverage.known_observations > 0 ? [`${total.coverage.known_observations} recorded`] : ['Unknown quantity'];
  if (total.coverage.unknown_observations > 0) labels.push(`${total.coverage.unknown_observations} unavailable`);
  if (total.coverage.excluded_observations > 0) labels.push(`${total.coverage.excluded_observations} excluded from totals`);
  return labels.join(' · ');
}

function totalValue(total: UsageMeterTotal | undefined): string {
  if (!total || total.coverage.total_observations === 0) return 'Not reported';
  return total.coverage.known_observations > 0 ? format(total.known_total) : 'Unknown';
}

function relationshipLabel(meter: UsageMeter | undefined): string {
  if (!meter) return 'Not reported';
  if (meter.subset_of !== null) return 'Declared subset';
  return meter.overlap === 'disjoint' ? 'Independent total' : 'Reported measure';
}

function taskLabel(group: UsageReportGroup, observations: Map<string, UsageObservation>): string {
  // createUsageReport uses the same display string, "unknown", for a null
  // grouping value. Recover the identity from the source observation so a
  // caller's literal task ID "unknown" stays distinct from an unassigned row.
  const first = observations.get(group.observation_ids[0] ?? '');
  const value = first?.task_id ?? first?.work_item_id ?? null;
  return value ?? 'Task unassigned';
}

function taskEvidence(group: UsageReportGroup, observations: Map<string, UsageObservation>, tokenMeterIds: Set<string>): string[] {
  return group.observation_ids.filter(id => {
    const observation = observations.get(id);
    return observation ? Object.keys(observation.measurements).some(meterId => tokenMeterIds.has(meterId)) : false;
  });
}

function MeterCard({ meter, report, parent, nested, selected, onSelectMeter }: { meter: UsageMeter; report: UsageReport; parent?: UsageMeter; nested?: boolean; selected: boolean; onSelectMeter: (meterId: string) => void }) {
  const total = meterTotal(report, meter.id);
  return <button type="button" className={`usage-token-card ${nested ? 'nested' : ''} ${selected ? 'active' : ''}`} key={meter.id} onClick={() => onSelectMeter(meter.id)} aria-pressed={selected} aria-label={`Select ${meterLabel(meter)} measure`}>
    <span>{meterLabel(meter)}</span>
    <strong>{totalValue(total)}</strong>
    <small>{meter.unit} · {coverage(total)}</small>
    {meter.subset_of !== null && <small>Declared subset of {meterLabel(parent)}; do not add it to that total.</small>}
  </button>;
}

function MeterTree({ meter, report, byParent, byId, ancestors = new Set<string>(), selectedMeterId, onSelectMeter, depth = 0 }: { meter: UsageMeter; report: UsageReport; byParent: Map<string, UsageMeter[]>; byId: Map<string, UsageMeter>; ancestors?: Set<string>; selectedMeterId: string; onSelectMeter: (meterId: string) => void; depth?: number }): ReactNode {
  if (ancestors.has(meter.id)) return null;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(meter.id);
  const children = byParent.get(meter.id) ?? [];
  return <div className="usage-token-node" key={meter.id}>
    <MeterCard meter={meter} report={report} parent={meter.subset_of === null ? undefined : byId.get(meter.subset_of)} nested={depth > 0} selected={selectedMeterId === meter.id} onSelectMeter={onSelectMeter} />
    {children.length > 0 && <div className="usage-token-children">{children.map(child => <MeterTree key={child.id} meter={child} report={report} byParent={byParent} byId={byId} ancestors={nextAncestors} selectedMeterId={selectedMeterId} onSelectMeter={onSelectMeter} depth={depth + 1} />)}</div>}
  </div>;
}

function TokenGroup({ title, meter, report, byParent, byId, selectedMeterId, onSelectMeter }: { title: string; meter?: UsageMeter; report: UsageReport; byParent: Map<string, UsageMeter[]>; byId: Map<string, UsageMeter>; selectedMeterId: string; onSelectMeter: (meterId: string) => void }) {
  return <section className="usage-token-group" aria-labelledby={`usage-token-${title.toLowerCase().replaceAll(' ', '-')}-title`}>
    <div className="usage-token-group-heading"><h3 id={`usage-token-${title.toLowerCase().replaceAll(' ', '-')}-title`}>{title}</h3><span>{relationshipLabel(meter)}</span></div>
    {meter ? <MeterTree meter={meter} report={report} byParent={byParent} byId={byId} selectedMeterId={selectedMeterId} onSelectMeter={onSelectMeter} /> : <p className="usage-note">No {title.toLowerCase()} meter was reported.</p>}
  </section>;
}

export function TokenBreakdown({ bundle, report, selectedMeterId, onSelectMeter }: { bundle: UsageBundle; report: UsageReport; selectedMeterId: string; onSelectMeter: (meterId: string) => void }) {
  const meters = tokenMeters(bundle);
  const byId = new Map(bundle.meters.map(meter => [meter.id, meter]));
  const byParent = new Map<string, UsageMeter[]>();
  for (const meter of meters) if (meter.subset_of !== null) byParent.set(meter.subset_of, [...(byParent.get(meter.subset_of) ?? []), meter]);
  for (const children of byParent.values()) children.sort((a, b) => a.id.localeCompare(b.id));
  const visible = new Map(meters.map(meter => [meter.id, meter]));
  const roots = meters.filter(meter => meter.subset_of === null || !visible.has(meter.subset_of));
  const input = roots.find(meter => meter.id === 'input_tokens');
  const output = roots.find(meter => meter.id === 'output_tokens');
  const canonicalRoots = roots.filter(meter => meter.id === input?.id || meter.id === output?.id);
  const canonicalGroups = [
    ...(input || !byId.has('input_tokens') ? [{ title: 'Input', meter: input }] : []),
    ...(output || !byId.has('output_tokens') ? [{ title: 'Output', meter: output }] : []),
  ];
  const otherRoots = roots.filter(meter => !canonicalRoots.some(root => root.id === meter.id));
  return <section className="usage-panel usage-token-panel" aria-labelledby="token-breakdown-title">
    <div className="usage-panel-heading"><div><h2 id="token-breakdown-title">Token breakdown</h2><p>Each token meter keeps its own reported total. Nested measures follow the meter declarations in this capture; unknown quantities remain visible.</p></div></div>
    {meters.length > 0 ? <>
      <div className="usage-token-groups">
        {canonicalGroups.map(group => <TokenGroup key={group.title} title={group.title} meter={group.meter} report={report} byParent={byParent} byId={byId} selectedMeterId={selectedMeterId} onSelectMeter={onSelectMeter} />)}
      </div>
      {otherRoots.length > 0 && <section className="usage-token-other" aria-labelledby="usage-token-other-title"><div className="usage-token-group-heading"><h3 id="usage-token-other-title">Other token measures</h3><span>Declared relationships shown where available</span></div><div className="usage-token-other-grid">{otherRoots.map(meter => <MeterTree key={meter.id} meter={meter} report={report} byParent={byParent} byId={byId} selectedMeterId={selectedMeterId} onSelectMeter={onSelectMeter} />)}</div></section>}
    </> : <p className="usage-note">This capture contains no token meters. Token quantities remain unavailable; the selected measure can still show other recorded meters.</p>}
    {meters.length > 0 && <p className="usage-note">Each card reports one meter on its own. Unknown and excluded observations stay visible in the coverage text; declared subsets are never summed into their parent.</p>}
  </section>;
}

export function TaskTokenTable({ bundle, report, onSelectObservation, onSelectTask, selectedTaskKey }: { bundle: UsageBundle; report: UsageReport; onSelectObservation: (id: string) => void; onSelectTask?: (groupKey: string) => void; selectedTaskKey?: string | null }) {
  const meters = tokenMeters(bundle);
  const observations = new Map(bundle.observations.map(observation => [observation.id, observation]));
  const tokenMeterIds = new Set(meters.map(meter => meter.id));
  return <section className="usage-panel usage-task-panel" aria-labelledby="task-token-title">
    <div className="usage-panel-heading"><div><h2 id="task-token-title">Tasks and work</h2><p>Primary token view. Captured task IDs are shown as supplied; missing task or work association remains explicit.</p></div><span className="usage-badge">{report.groups.length} task group{report.groups.length === 1 ? '' : 's'}</span></div>
    {meters.length > 0 ? <div className="usage-scroll"><table className="usage-task-table"><thead><tr><th>Task / work</th>{meters.map(meter => <th key={meter.id}>{meterLabel(meter)}<small>{meter.unit}{meter.subset_of !== null ? ' · declared subset' : ''}</small></th>)}<th>Inspect</th></tr></thead><tbody>{report.groups.map(group => {
      const evidenceIds = taskEvidence(group, observations, tokenMeterIds);
      const inspectIds = evidenceIds.length > 0 ? evidenceIds : group.observation_ids.slice(0, 1);
      const selected = selectedTaskKey === group.key;
      return <tr key={group.key} data-selected={selected ? 'true' : undefined}><td>{onSelectTask ? <button type="button" className="usage-inspect usage-task-select" onClick={() => onSelectTask(group.key)} aria-pressed={selected}><strong>{taskLabel(group, observations)}</strong></button> : <strong>{taskLabel(group, observations)}</strong>}<small>{group.observation_ids.length} captured observation{group.observation_ids.length === 1 ? '' : 's'}</small></td>{meters.map(meter => <td className="usage-number" key={meter.id}><strong>{totalValue(groupMeterTotal(group, meter.id))}</strong><small>{coverage(groupMeterTotal(group, meter.id))}</small></td>)}<td>{inspectIds.length > 0 ? <details className="usage-task-inspect"><summary>Inspect {evidenceIds.length > 0 ? `${evidenceIds.length} token record${evidenceIds.length === 1 ? '' : 's'}` : 'evidence'}</summary><div>{inspectIds.slice(0, 20).map(id => <button type="button" className="usage-inspect" key={id} onClick={() => onSelectObservation(id)}>{observations.get(id)?.subject ?? id}</button>)}{inspectIds.length > 20 && <small>Showing the first 20 evidence records. Select the task to filter all its observations.</small>}</div></details> : <small>No captured evidence</small>}</td></tr>;
    })}</tbody></table></div> : <p className="usage-note">No token meters were recorded for these task groups. The capture keeps task association separate from other usage measures.</p>}
  </section>;
}
