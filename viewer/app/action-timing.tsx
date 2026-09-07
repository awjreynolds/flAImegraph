import type { ActionTiming } from '../lib/timing';

export function ActionTimingFields({ timing, compact = false }: { timing: ActionTiming; compact?: boolean }) {
  return <dl className={compact ? 'action-timing action-timing--compact' : 'action-timing'} aria-label="Action timing">
    {(['start', 'end', 'duration'] as const).map(key => <div key={key}><dt>{key === 'start' ? 'Start (UTC)' : key === 'end' ? 'End (UTC)' : 'Duration'}</dt><dd title={timing[key].note}>{timing[key].value}</dd>{!compact && <small>{timing[key].note}</small>}</div>)}
    {!compact && <>{(['event', 'collected'] as const).map(key => <div key={key}><dt>{key === 'event' ? 'Event time (UTC)' : 'Collected at (UTC)'}</dt><dd>{timing[key].value}</dd><small>{timing[key].note}</small></div>)}<p className="timing-note">Event time identifies a recorded event. Collection time identifies when evidence was gathered. Neither substitutes for the action’s start or end. Duration may include waiting or pauses; this capture does not identify active work, sleep, or service delays separately.</p></>}
  </dl>;
}
