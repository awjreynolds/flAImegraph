/** Reproduce the public usage migration and explicitly illustrative optimization scenario. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromLegacyEvidence, importUsage } from '../src/usage-import.js';
import { operationUsage } from '../src/usage-operations.js';
import { createUsageReport, validateUsageBundle, reconcileUsageBundles } from '../src/usage.js';
import { createUsageProfile } from '../src/usage-profile.js';
import { exportUsageFolded, exportUsagePprof, renderUsageSvg } from '../src/usage-export.js';
import { analyzeEfficiency, compareBenchmarks, forecastRunway, deriveCandidatePolicyScenario, validateBenchmarkInput } from '../src/efficiency.js';
import { importInspectBenchmarkDetailed } from '../src/benchmark-import.js';
import type { BenchmarkInput, RunwayDemand, CapacitySnapshot } from '../src/efficiency-types.js';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const write = async (path: string, value: unknown) => writeFile(new URL(path, root), JSON.stringify(value, null, 2) + '\n');
await mkdir(new URL('examples/dogfood/v04/', root), { recursive: true });
const native = validateUsageBundle(fromLegacyEvidence((await read('examples/dogfood/v03/native-report.json')).evidence));
const files = operationUsage(await read('examples/dogfood/v03/files-operations.json'));
const nativeLog = await readFile(new URL('examples/dogfood/codex/coordinator.jsonl', root), 'utf8');
const ticketCapture = validateUsageBundle(importUsage(nativeLog, { format: 'codex', dataset_id: 'ticket-example', work_item_id: 'FLAI-42 / example work association' }));
assert.ok(ticketCapture.observations.length > 0);
assert.ok(ticketCapture.observations.every(row => row.work_item_id === 'FLAI-42 / example work association'));
await write('examples/dogfood/v04/ticket-usage.json', ticketCapture);
const manifest: Record<string, unknown> = { schema_version: '0.4.0', basis: 'Native and file operation captures are projected from the committed v0.3 real-work evidence. Benchmark and capacity examples are illustrative declared data.', captures: {} };
for (const [name, bundle, meter, grouping] of [['native', native, 'input_tokens', ['model']], ['files', files, 'operation_count', ['execution']]] as const) {
  const report = createUsageReport(bundle);
  assert.deepEqual(reconcileUsageBundles([bundle, bundle]), reconcileUsageBundles([bundle]));
  const profile = createUsageProfile(report, { meter_id: meter, group_by: [...grouping] });
  await write(`examples/dogfood/v04/${name}-usage.json`, bundle);
  // Compact identical data for browser delivery.
  await writeFile(new URL(`viewer/public/usage-${name}.json`, root), JSON.stringify(bundle));
  const svg = renderUsageSvg(profile);
  if (svg) { await writeFile(new URL(`examples/dogfood/v04/${name}.svg`, root), svg); await writeFile(new URL(`viewer/public/usage-${name}.svg`, root), svg); }
  const mobileSvg = renderUsageSvg(profile, 400);
  if (mobileSvg) await writeFile(new URL(`viewer/public/usage-${name}-mobile.svg`, root), mobileSvg);
  await writeFile(new URL(`examples/dogfood/v04/${name}.folded`, root), exportUsageFolded(profile));
  await writeFile(new URL(`examples/dogfood/v04/${name}.pprof`, root), exportUsagePprof(profile));
  await write(`examples/dogfood/v04/${name}-analysis.json`, analyzeEfficiency(bundle));
  (manifest.captures as Record<string, unknown>)[name] = { observations: bundle.observations.length, meter, total: profile.total, unit: profile.unit, maximum_stack_depth: Math.max(...profile.samples.map(sample => sample.stack.length)), sha256: createHash('sha256').update(JSON.stringify(bundle)).digest('hex'), actual_tier_observations: bundle.observations.filter(row => row.dimensions.actual_tier?.value != null).length };
}
const refs = [{ source_id: 'illustrative-scenario', record: 'declared-fixture' }];
function benchmark(role: 'baseline' | 'candidate'): BenchmarkInput {
  return validateBenchmarkInput({ benchmark_id: `illustrative-${role}`, role,
    cohort: { workload_id: 'illustrative-code-edit', task_class: 'bounded-edit', scope_revision: 'example-v1', acceptance_version: 'tests-v1' },
    conditions: { harness: 'illustrative', harness_version: '1', tools_version: '1', cache: 'warm', context_policy: 'same-files', routing_policy: 'single-model' },
    model_config: { model: role === 'baseline' ? 'example-large' : 'example-small', reasoning: 'high', tier: 'standard' }, evaluation: 'declared',
    samples: [1, 2, 3, 4].map(id => ({ sample_id: `${role}-${id}`, task_id: `task-${id}`, accepted: id !== 4, quality: { passed: id !== 4, evidence: 'declared' }, latency_ns: role === 'baseline' ? '10000000000' : '7000000000',
      meters: [{ meter_id: 'input_tokens', unit: 'tokens', quantity: role === 'baseline' ? '1000' : '600', evidence: 'declared' }, { meter_id: 'output_tokens', unit: 'tokens', quantity: role === 'baseline' ? '200' : '180', evidence: 'declared' }], attempts: '1', source_refs: refs })),
    analysis_overhead: role === 'candidate' ? [{ meter_id: 'input_tokens', unit: 'tokens', quantity: '120', evidence: 'declared', source_refs: refs }] : [], provenance: refs,
  });
}
const baseline = benchmark('baseline'), candidate = benchmark('candidate');
const policy = deriveCandidatePolicyScenario({ policy_id: 'illustrative-routing', policy_version: '1', benchmark_id: candidate.benchmark_id }, candidate);
const now = '2026-09-07T12:00:00Z';
const snapshots: CapacitySnapshot[] = [{ snapshot_id: 'example-input-pool', meter_id: 'input_tokens', unit: 'tokens', remaining: '10000', scope: 'account', scope_id: 'illustrative-account', workload_id: 'illustrative-code-edit', observed_at: now, reset_at: '2026-09-09T00:00:00Z', evidence: 'declared', coverage: 'complete', source_refs: refs }, { snapshot_id: 'example-output-pool', meter_id: 'output_tokens', unit: 'tokens', remaining: '3000', scope: 'account', scope_id: 'illustrative-account', workload_id: 'illustrative-code-edit', observed_at: now, reset_at: '2026-09-09T00:00:00Z', evidence: 'declared', coverage: 'complete', source_refs: refs }];
const demand: RunwayDemand = { workload_id: 'illustrative-code-edit', scope_id: 'illustrative-account', accepted_count: '3', per_accepted: policy.expected_per_accepted };
const runway = { snapshots, demand, options: { now, horizon_end: '2026-09-08T12:00:00Z', allow_unverified_demand: true } };
await write('examples/dogfood/v04/baseline.json', baseline);
await write('examples/dogfood/v04/candidate.json', candidate);
await write('examples/dogfood/v04/comparison.json', compareBenchmarks(baseline, candidate));
await write('examples/dogfood/v04/candidate-policy.json', policy);
await write('examples/dogfood/v04/runway-input.json', runway);
await write('examples/dogfood/v04/runway-forecast.json', forecastRunway(snapshots, demand, runway.options));
await write('viewer/public/usage-scenario.json', { baseline, candidate, runway });
const inspect = { version: 2, eval: { eval_id: 'illustrative-inspect', task: 'code-edit', model: 'example/model-small', created: now }, samples: [{ id: 'task-1', epoch: 1, scores: { tests: { value: 'C' } }, model_usage: { 'example/model-small': { input_tokens: 600, output_tokens: 180, input_tokens_cache_read: 400 } }, total_time: 7 }] };
const inspectOptions = { role: 'candidate' as const, scorer: 'tests', accepted_values: ['C'], workload_id: 'illustrative-code-edit', scope_revision: 'example-v1', acceptance_version: 'tests-v1', evaluation: 'declared' as const };
await write('examples/dogfood/v04/inspect-log.json', inspect);
await write('examples/dogfood/v04/inspect-options.json', inspectOptions);
await write('examples/dogfood/v04/inspect-import.json', importInspectBenchmarkDetailed(inspect, inspectOptions));
await write('examples/dogfood/v04/manifest.json', manifest);
console.log(JSON.stringify(manifest));
