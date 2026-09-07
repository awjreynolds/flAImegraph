'use client';
import { Button } from '@/components/ui/button';
import type { InterruptionReason, LifecycleAction, LifecycleProjection } from '@/lib/usage.js';

const stateLabels: Record<LifecycleAction['state'], string> = {
  completion_unobserved: 'Completion unobserved',
  paused: 'Paused at capture',
  ok: 'Completed: ok',
  error: 'Completed: error',
  cancelled: 'Completed: cancelled',
  unknown: 'Terminal state unknown',
};

export function lifecycleDuration(value: string | null): string {
  if (value === null) return 'Unknown';
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return value;
  const ns = BigInt(value), whole = ns / 1_000_000_000n, fraction = (ns % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} s`;
}

export function lifecycleStateLabel(state: LifecycleAction['state']): string {
  return stateLabels[state];
}

function reason(reason: InterruptionReason): string {
  return `${reason.code} · ${reason.evidence} · ${reason.method}${reason.reset_at ? ` · reset at ${reason.reset_at}` : ''}`;
}

function qualification(value: boolean): string {
  return value ? 'Timing needs review' : 'Elapsed interval recorded';
}

function actionLink(id: string, actions: LifecycleAction[], onSelectAction: (id: string) => void) {
  if (actions.some(candidate => candidate.action_id === id)) {
    return <button className="usage-inspect" onClick={() => onSelectAction(id)}>{id}</button>;
  }
  return <span>{id} (not captured)</span>;
}

function downloadCapture(projection: LifecycleProjection) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(projection.capture, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'lifecycle-capture.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LifecyclePanel({ projection, selectedActionId, onSelectAction }: { projection: LifecycleProjection; selectedActionId: string | null; onSelectAction: (id: string) => void }) {
  const selected = projection.actions.find(action => action.action_id === selectedActionId) ?? null;
  const uncertainWait = (action: LifecycleAction) => projection.issues.some(issue => issue.code === 'LIFECYCLE_WAIT_UNCERTAIN' && issue.action_id === action.action_id);
  const wait = (action: LifecycleAction) => uncertainWait(action) ? 'Unknown' : lifecycleDuration(action.known_wait_ns);
  return <section className="usage-panel" aria-label="Interruption and recovery">
    <div className="usage-panel-heading"><div><h2>Interruption and recovery</h2><p>Replayable lifecycle evidence keeps pauses, missing completion and capture gaps separate from current liveness.</p></div><div><span className="usage-badge">{projection.actions.length} actions · {projection.capture.events.length} events</span> <Button variant="outline" onClick={() => downloadCapture(projection)}>Download lifecycle capture</Button></div></div>
    {projection.issues.length > 0 && <div className="usage-error" role="alert"><strong>Capture and replay issues need review</strong>{projection.issues.map((issue, index) => <p key={`${issue.code}:${issue.action_id ?? ''}:${index}`}>{issue.message}{issue.action_id ? ` · ${issue.action_id}` : ''} <small>({issue.code})</small></p>)}</div>}
    <div className="usage-scroll"><table style={{ minWidth: '960px', width: '100%', tableLayout: 'auto', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}><thead><tr><th>Action</th><th>State</th><th>Start / end</th><th>Elapsed</th><th>Known wait</th><th>Gaps / reasons</th></tr></thead><tbody>{projection.actions.map(action => <tr key={action.action_id} data-selected={selectedActionId === action.action_id}><td><button className="usage-inspect" onClick={() => onSelectAction(action.action_id)}>{action.action_id}</button>{action.parent_id && <small>Parent: {actionLink(action.parent_id, projection.actions, onSelectAction)}</small>}{action.retry_of && <small>Retry of: {actionLink(action.retry_of, projection.actions, onSelectAction)}</small>}</td><td><span className="usage-badge">{stateLabels[action.state]}</span><small>{qualification(action.timing_qualified)}</small></td><td style={{ whiteSpace: 'nowrap' }}>{action.started_at ?? 'Not captured'}<small style={{ whiteSpace: 'inherit' }}>{action.ended_at ?? stateLabels[action.state]}</small></td><td className="usage-number">{lifecycleDuration(action.elapsed_ns)}<small>Recorded elapsed; may include waits</small></td><td className="usage-number">{wait(action)}<small>{uncertainWait(action) ? 'Closed wait is uncertain' : 'Explicitly closed pauses'}</small></td><td>{action.gaps.length ? <small>{action.gaps.length} capture gap(s); cause unknown</small> : null}{action.reasons.length ? action.reasons.map((item, index) => <small key={`${item.code}:${index}`}>{reason(item)}</small>) : <small>No explicit interruption reason</small>}</td></tr>)}</tbody></table></div>
    {projection.actions.length === 0 && <p className="usage-note">No action start or terminal evidence was captured. The raw capture remains available for replay.</p>}
    {selected && <article className="usage-finding"><span className="usage-badge">Selected action</span><h3>{selected.action_id}</h3><div className="usage-detail-row"><strong>Lifecycle state</strong><span>{stateLabels[selected.state]}</span><small>{qualification(selected.timing_qualified)} · elapsed duration is not active CPU time.</small></div><div className="usage-detail-row"><strong>Timing</strong><span>{selected.started_at ?? 'Start not captured'} → {selected.ended_at ?? stateLabels[selected.state]}</span><small>Elapsed {lifecycleDuration(selected.elapsed_ns)} · known wait {wait(selected)}</small></div><div className="usage-detail-row"><strong>Parent action</strong><span>{selected.parent_id ? actionLink(selected.parent_id, projection.actions, onSelectAction) : 'None recorded'}</span></div><div className="usage-detail-row"><strong>Retry of</strong><span>{selected.retry_of ? actionLink(selected.retry_of, projection.actions, onSelectAction) : 'None recorded'}</span></div><div className="usage-detail-row"><strong>Interruption reasons</strong>{selected.reasons.length ? selected.reasons.map((item, index) => <span key={`${item.code}:${index}`}>{reason(item)}</span>) : <span>No explicit interruption reason was recorded.</span>}</div><div className="usage-detail-row"><strong>Capture gaps</strong>{selected.gaps.length ? selected.gaps.map((gap, index) => <span key={`${gap.from}:${index}`}>{gap.from} → {gap.to} · {lifecycleDuration(gap.elapsed_ns)} · cause unknown</span>) : <span>No gap above the configured threshold was recorded.</span>}</div></article>}
  </section>;
}
