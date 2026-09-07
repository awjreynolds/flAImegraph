'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createUsageProfile, formatUsageInteger } from '@/lib/usage.js';
import type { UsageReport } from '@/lib/usage.js';
import { findProfileNode, profileBars, profileTree } from '@/lib/profile-tree';

export function UsageFlamegraph({ report, meterId, onSelectObservation }: { report: UsageReport; meterId: string; onSelectObservation?: (id: string) => void }) {
  const [hierarchy, setHierarchy] = useState<'task' | 'execution'>('task');
  const [zoom, setZoom] = useState('[]');
  const profile = useMemo(() => createUsageProfile(report, { meter_id: meterId, group_by: hierarchy === 'task' ? ['task', 'operation'] : ['execution'] }), [report, meterId, hierarchy]);
  const tree = useMemo(() => profileTree(profile), [profile]);
  const focus = findProfileNode(tree, zoom) ?? tree;
  const bars = profileBars(focus);
  const depth = Math.max(0, ...bars.map(bar => bar.depth));
  const quantity = (value: bigint) => {
    const [whole, fraction] = formatUsageInteger(value.toString(), profile.decimal_places).split('.');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  };
  const taskCount = new Set(report.bundle.observations.flatMap(row => (row.task_id ?? row.work_item_id) ? [row.task_id ?? row.work_item_id] : [])).size;
  const hasParents = report.bundle.observations.some(row => row.parent_id !== null);
  return <section className="usage-panel" aria-label="Task flame graph">
    <div className="usage-panel-heading"><div><h2>Where the work went</h2><p>{meterId.replaceAll('_', ' ')} · {profile.samples.length ? `${quantity(tree.value)} ${profile.unit} known additive subtotal` : 'No known additive subtotal'}</p></div><label>Hierarchy<select value={hierarchy} onChange={event => { setHierarchy(event.target.value as 'task' | 'execution'); setZoom('[]'); }}><option value="task">Task → operation</option><option value="execution">Recorded parent actions</option></select></label></div>
    <p className="usage-note">{profile.unknown_observation_ids.length} unavailable · {profile.excluded_observation_ids.length} non-additive observations excluded.</p>
    {profile.limitations.map(limitation => <p key={limitation} className="usage-note">{limitation}</p>)}
    <p className="usage-note">{hierarchy === 'task' ? 'Tasks group their recorded operations. Model details are available when you inspect an observation.' : 'Each level follows a recorded parent link. Separate roots have no recorded common parent.'}</p>
    {hierarchy === 'task' && taskCount === 0 && <p className="usage-note">Task association was not captured. These observations remain under “Task unassigned”; load a capture with task or work identifiers to see a task breakdown.</p>}
    {hierarchy === 'execution' && !hasParents && <p className="usage-note">No parent links were captured for this session.</p>}
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}><Button variant="outline" disabled={focus === tree} onClick={() => setZoom('[]')}>All work</Button><span>{focus.label} · {quantity(focus.value)} {profile.unit}</span>{focus.observationIds.length === 1 && onSelectObservation && <Button variant="outline" onClick={() => onSelectObservation(focus.observationIds[0])}>Inspect observation</Button>}</div>
    {focus.children.size > 0 && <label style={{ display: 'grid', gap: 6, maxWidth: '100%', marginBottom: 12 }}>Zoom into any frame<select aria-label="Zoom into any frame" style={{ maxWidth: '100%' }} value="" onChange={event => { if (event.target.value) setZoom(event.target.value); }}><option value="">Choose a task or operation, including tiny frames</option>{[...focus.children.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key)).map(child => <option key={child.key} value={child.key}>{child.label} · {quantity(child.value)} {profile.unit}</option>)}</select></label>}
    {bars.length ? <fieldset aria-label={`${meterId.replaceAll('_', ' ')} by ${hierarchy}`} style={{ position: 'relative', height: (depth + 1) * 34, margin: '12px 0', padding: 0, border: 0, minWidth: 0 }}>
      {bars.map(bar => <button key={bar.node.key} type="button" aria-label={`${bar.node.label}: ${quantity(bar.node.value)} ${profile.unit}`} title={`${bar.node.label}: ${quantity(bar.node.value)} ${profile.unit}. Click to zoom.`} onClick={() => setZoom(bar.node.key)} style={{ position: 'absolute', left: `${bar.left}%`, width: `${bar.width}%`, bottom: bar.depth * 34, height: 32, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', padding: '5px 8px', border: '1px solid #142237', borderRadius: 3, background: ['#76cde3', '#96ddb9', '#b5a1e8', '#e9c681'][bar.depth % 4], color: '#132333', cursor: 'pointer', fontSize: 12 }}>{bar.width > 5 ? bar.node.label : ''}</button>)}
    </fieldset> : <p>No positive additive usage for this measure. Unknown usage remains unknown.</p>}
    <p className="usage-note">Parent widths include their descendants; do not add graph levels together. Click a frame to zoom or use the frame selector for tiny entries. Frames narrower than 0.3% and levels beyond 12 are hidden on the chart; the observation table retains every record. Cache and reasoning subsets are never added to their parent totals.</p>
  </section>;
}
