'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { compareBenchmarks, validateBenchmarkInput, forecastRunway } from '@/lib/usage.js';
import type { BenchmarkInput, CapacitySnapshot, RunwayDemand, RunwayOptions, ExactRatio } from '@/lib/usage.js';

type RunwayInput = { snapshots: CapacitySnapshot[]; demand: RunwayDemand; options: RunwayOptions };
const ratio = (value: ExactRatio | null) => value ? `${value.numerator} / ${value.denominator}` : 'Unknown';
function quality(benchmark: BenchmarkInput) {
  const passed = benchmark.samples.filter(sample => sample.quality?.passed === true && sample.quality.evidence !== 'unknown').length;
  const failed = benchmark.samples.filter(sample => sample.quality?.passed === false && sample.quality.evidence !== 'unknown').length;
  const evidence = [...new Set(benchmark.samples.map(sample => sample.quality?.evidence ?? 'unknown'))].join(', ');
  return `${passed} passed · ${failed} failed · ${benchmark.samples.length - passed - failed} unknown (${evidence})`;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function read(file?: File) {
  if (!file) return null;
  if (file.size > 50 * 1024 * 1024) throw new Error('Choose a file smaller than 50 MB.');
  return JSON.parse(await file.text());
}
export function AnalysisWorkbench() {
  const [baseline, setBaseline] = useState<BenchmarkInput | null>(null);
  const [candidate, setCandidate] = useState<BenchmarkInput | null>(null);
  const [runwayText, setRunwayText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [illustrative, setIllustrative] = useState(false);
  const comparison = useMemo(() => {
    try { return { value: baseline && candidate ? compareBenchmarks(baseline, candidate) : null, error: null }; }
    catch (reason) { return { value: null, error: message(reason) }; }
  }, [baseline, candidate]);
  const runway = useMemo(() => {
    try { if (!runwayText.trim()) return { value: null, error: null }; const input: RunwayInput = JSON.parse(runwayText); return { value: forecastRunway(input.snapshots, input.demand, input.options), error: null }; }
    catch (reason) { return { value: null, error: message(reason) }; }
  }, [runwayText]);
  async function example() {
    try {
      const response = await fetch('/usage-scenario.json'); if (!response.ok) throw new Error('Example unavailable.');
      const value = await response.json();
      if (!value || typeof value !== 'object' || !('baseline' in value) || !('candidate' in value) || !('runway' in value)) throw new Error('Invalid scenario.');
      setBaseline(validateBenchmarkInput(value.baseline)); setCandidate(validateBenchmarkInput(value.candidate)); setRunwayText(JSON.stringify(value.runway, null, 2)); setIllustrative(true); setError(null);
    } catch (reason) { setError(message(reason)); }
  }
  async function load(file: File | undefined, kind: 'baseline' | 'candidate' | 'runway') {
    try { const value = await read(file); if (value === null) return; if (kind === 'runway') setRunwayText(JSON.stringify(value, null, 2)); else { const benchmark = validateBenchmarkInput(value); if (benchmark.role !== kind) throw new Error(`Load a benchmark whose role is ${kind}.`); if (kind === 'baseline') setBaseline(benchmark); else setCandidate(benchmark); } setIllustrative(false); setError(null); }
    catch (reason) { setError(message(reason)); }
  }
  return <>
    <section className="usage-panel">
      <div className="usage-panel-heading"><div><h2>Compare model configurations</h2><p>Match workload, acceptance criteria and execution conditions before interpreting differences.</p></div><Button variant="outline" onClick={() => void example()}>Try an illustrative scenario</Button></div>
      {illustrative && <p className="usage-note">Illustrative data with invented model names. This demonstrates the calculation; it is not a measured ranking or a recommendation for your session.</p>}
      {error && <p className="usage-error" role="alert">{error}</p>}
      <div className="usage-benchmark-inputs">{(['baseline','candidate'] as const).map(kind => { const value = kind === 'baseline' ? baseline : candidate; return <div key={kind}><label>{kind === 'baseline' ? 'Baseline benchmark' : 'Candidate benchmark'}<input type="file" accept=".json" onChange={event => { void load(event.target.files?.[0], kind); event.target.value = ''; }} /></label>{value && <><h3>{value.model_config.model}</h3><p>{value.model_config.reasoning ?? 'Reasoning unknown'} · {value.model_config.tier ?? 'Tier unknown'}</p><p>{value.samples.length} samples · {value.evaluation} · {value.conditions.harness}</p><p>Quality: {quality(value)}</p><small>{value.cohort.workload_id} · scope {value.cohort.scope_revision} · acceptance {value.cohort.acceptance_version}</small></>}</div>; })}</div>
      <p className="usage-note">Benchmarks are loaded independently of the selected session. Load canonical benchmark JSON. Inspect AI logs can be converted with the SDK or benchmark-import command; acceptance is supplied explicitly in the import options.</p>
      {comparison.error && <p className="usage-error" role="alert">{comparison.error}</p>}
      {comparison.value && <><p className="usage-analysis-summary"><strong>{comparison.value.status} comparison</strong><span>Accepted: {comparison.value.accepted_counts.baseline} / {comparison.value.sample_sizes.baseline} baseline · {comparison.value.accepted_counts.candidate} / {comparison.value.sample_sizes.candidate} candidate</span></p><div className="usage-scroll"><table className="usage-comparison"><thead><tr><th>Resource per accepted task</th><th>Baseline</th><th>Candidate</th><th>Baseline − candidate</th></tr></thead><tbody>{comparison.value.resource_deltas.map(delta => <tr key={`${delta.meter_id}:${delta.unit}`}><td>{delta.meter_id} ({delta.unit})</td><td>{ratio(delta.baseline)}</td><td>{ratio(delta.candidate)}</td><td>{delta.delta ?? 'Unknown'}</td></tr>)}<tr><td>Mean sample latency (ns)</td><td>{ratio(comparison.value.latency_ns.baseline)}</td><td>{ratio(comparison.value.latency_ns.candidate)}</td><td>{comparison.value.latency_ns.delta ?? 'Unknown'}</td></tr></tbody></table></div><p className="usage-note">Ratios retain exact quantities. A positive resource delta means lower candidate demand; acceptance and latency remain separate checks.</p>{comparison.value.limitations.map(text => <p className="usage-note" key={text}>{text}</p>)}<Button variant="outline" onClick={() => download('benchmark-comparison.json', comparison.value)}>Export comparison</Button></>}
    </section>
    <section className="usage-panel"><div className="usage-panel-heading"><div><h2>Delivery runway</h2><p>Estimate accepted work from an explicit remaining resource pool and measured demand in the same units.</p></div><label>Load capacity & demand<input type="file" accept=".json" onChange={event => { void load(event.target.files?.[0], 'runway'); event.target.value = ''; }} /></label></div>
      <p className="usage-note">Subscription percentages cannot be converted to tokens without a provider-supplied mapping. Missing capacity, stale snapshots and resets inside the horizon remain explicit.</p>
      <label className="usage-scenario-editor">Capacity snapshots, demand and forecast horizon<textarea spellCheck={false} value={runwayText} onChange={event => setRunwayText(event.target.value)} placeholder="Load a runway input or try the illustrative scenario above." /></label>
      {runway.error && <p className="usage-error" role="alert">{runway.error}</p>}
      {runway.value && <><div className="usage-analysis-summary"><strong>{runway.value.accepted_work ?? 'Unknown'} accepted tasks</strong><span>{runway.value.status} · {runway.value.horizon_start} to {runway.value.horizon_end}</span></div>{runway.value.limiting_snapshot_id && <p>Limiting resource snapshot: {runway.value.limiting_snapshot_id}</p>}{runway.value.limitations.map(text => <p className="usage-note" key={text}>{text}</p>)}<Button variant="outline" onClick={() => download('runway-forecast.json', runway.value)}>Export forecast</Button></>}
    </section>
  </>;
}
