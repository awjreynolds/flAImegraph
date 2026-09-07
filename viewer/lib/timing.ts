import type { UsageObservation, UsageMeter, UsageTimestamp } from './usage-types';
import type { Observation } from './types';

export type TimingValue = { value: string; note: string };
export type ActionTiming = { event: TimingValue; start: TimingValue; end: TimingValue; duration: TimingValue; collected: TimingValue };
const missing = (note: string): TimingValue => ({ value: 'Not captured', note });
const timestamp = (fact: UsageTimestamp | null | undefined, label: string): TimingValue => fact?.value
  ? { value: fact.value, note: `${fact.evidence} · ${fact.method}` }
  : missing(fact?.method ?? `No ${label} timestamp was recorded by the source.`);

// Keep sub-millisecond precision; Date is used only for the whole-second epoch.
function epoch(value: string): { seconds: bigint; fraction: string } | null {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(match[1] + match[3]);
  return Number.isFinite(milliseconds) ? { seconds: BigInt(milliseconds / 1000), fraction: match[2] ?? '' } : null;
}
function utc(value: string): string {
  const part = epoch(value);
  return part ? new Date(Number(part.seconds) * 1000).toISOString().replace('.000Z', `${part.fraction ? '.' + part.fraction : ''}Z`) : value;
}
function seconds(value: bigint, places: number): string {
  const text = value.toString().padStart(places + 1, '0');
  const fraction = places ? text.slice(-places).replace(/0+$/, '') : '';
  return `${places ? text.slice(0, -places) : text}${fraction ? '.' + fraction : ''} s`;
}
function duration(start: string | null | undefined, end: string | null | undefined, running: boolean): TimingValue {
  if (running && !end) return { value: 'In progress', note: 'No end was recorded in this capture. The last recorded state was running; current liveness is not verified.' };
  if (!start || !end) return missing('Duration needs a recorded elapsed measurement or both start and end timestamps. Event and collection times are not action boundaries.');
  const a = epoch(start), b = epoch(end);
  if (!a || !b) return { value: 'Cannot calculate', note: 'One or both action timestamps are invalid.' };
  const places = Math.max(a.fraction.length, b.fraction.length);
  const scaled = (part: { seconds: bigint; fraction: string }) => part.seconds * 10n ** BigInt(places) + BigInt(part.fraction.padEnd(places, '0') || '0');
  const delta = scaled(b) - scaled(a);
  return delta < 0n ? { value: 'Cannot calculate', note: 'End precedes start; the source clocks may disagree.' }
    : { value: seconds(delta, places), note: 'Derived from start and end wall-clock timestamps; subject to their precision and clock adjustments.' };
}
export function usageTiming(observation: UsageObservation, meters: UsageMeter[]): ActionTiming {
  const running = observation.status === 'running';
  let elapsed = duration(observation.started_at?.value, observation.ended_at?.value, running);
  const measured = ['elapsed_ns', 'duration_ns'].map(id => ({ id, value: observation.measurements[id] })).find(({ id, value }) =>
    value?.value != null && value.evidence !== 'unknown' && ['event', 'interval'].includes(value.scope)
    && (value.aggregation === 'delta' || (id === 'elapsed_ns' && value.scope === 'interval' && value.aggregation === 'unknown'))
    && meters.some(meter => meter.id === id && ['ns', 'nanoseconds'].includes(meter.unit)))?.value;
  if (measured?.value != null) {
    const [whole, fraction = ''] = measured.value.split('.');
    elapsed = { value: seconds(BigInt(whole + fraction), 9 + fraction.length), note: `${measured.evidence} recorded duration · ${measured.count_basis} · ${measured.method}. Overlapping action durations are not additive.` };
  }
  if (running && !observation.ended_at?.value && measured?.value != null) elapsed = { value: 'In progress', note: `Recorded elapsed so far: ${elapsed.value}. Current liveness is not verified. ${elapsed.note}` };
  return {
    event: timestamp(observation.event_at, 'event'),
    start: timestamp(observation.started_at, 'action start'),
    end: running && !observation.ended_at?.value ? { value: 'In progress', note: 'No end was recorded. This describes the captured state, not proof that the action is still running.' } : timestamp(observation.ended_at, 'action end'),
    duration: elapsed,
    collected: timestamp(observation.collected_at, 'collection'),
  };
}
export function contextTiming(observation: Observation): ActionTiming {
  // OTLP carries an explicit start separately; other legacy event times are not starts.
  const nativeStart = observation.attributes?.['flAImegraph.otel.start_time_unix_nano'];
  const explicitStart = observation.attributes?.['flAImegraph.timing.started_at'];
  let start: string | null = typeof explicitStart === 'string' && epoch(explicitStart) ? utc(explicitStart) : null;
  if (!start && typeof nativeStart === 'string' && /^\d+$/.test(nativeStart)) {
    const ns = BigInt(nativeStart), ms = Number(ns / 1000000n);
    if (Number.isSafeInteger(ms) && Number.isFinite(new Date(ms).getTime())) start = new Date(Number(ns / 1000000000n) * 1000).toISOString().replace('.000Z', `.${(ns % 1000000000n).toString().padStart(9, '0')}Z`);
  }
  return {
    event: observation.timestamp ? { value: utc(observation.timestamp), note: 'Recorded event timestamp. This does not establish the action start.' } : missing('The imported record contains no event timestamp.'),
    start: start ? { value: start, note: typeof explicitStart === 'string' ? 'Recorded explicit action start.' : 'Recorded OTLP span start.' } : missing('This legacy record has no explicit action-start field. Its event time is kept separate.'),
    end: observation.end_time ? { value: utc(observation.end_time), note: 'Recorded action end.' } : missing('The imported record contains no action-end timestamp.'),
    duration: duration(start, observation.end_time, false),
    collected: missing('The imported record contains no collection timestamp.'),
  };
}
