import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createUsageRecorder } from '../src/usage-recorder.js';
import type { UsageMeasurementInput } from '../src/usage-recorder.js';
import { validateUsageBundle } from '../src/usage.js';
import type { UsageDimensionFact } from '../src/usage-types.js';

/**
 * A deterministic, explicitly declared task hierarchy for the usage viewer.
 * This script never calls a provider; every quantity is a scenario fact.
 */
const datasetId = 'synthetic-task-breakdown';
const sourceId = 'synthetic-task-breakdown';
const workItemId = 'DEMO-TASK-BREAKDOWN';
const sessionId = 'synthetic-session';
const agentId = 'synthetic-agent';
const collectedAt = '2026-09-07T09:00:00Z';
const sourceRefs = (record: string) => [{ source_id: sourceId, record }];

const recorder = createUsageRecorder({
  dataset_id: datasetId,
  source_id: sourceId,
  harness: 'synthetic',
  format: 'usage-recorder',
  version: '1',
  description: 'Declared task breakdown example; no provider was contacted and no live token usage is asserted.',
  default_session_id: sessionId,
  default_agent_id: agentId,
  collected_at: collectedAt,
});

function fact(value: string | null, record: string, evidence: 'declared' | 'unknown' = value === null ? 'unknown' : 'declared'): UsageDimensionFact {
  return { value, evidence, method: 'Synthetic task breakdown metadata; declared scenario fact', source_refs: sourceRefs(record) };
}

function quantity(value: string | null, record: string): UsageMeasurementInput {
  return {
    value,
    evidence: value === null ? 'unknown' : 'declared',
    method: 'Synthetic task breakdown quantity; no provider measurement',
    source_refs: sourceRefs(record),
    count_basis: 'consumed',
    aggregation: 'delta',
    scope: 'event',
  };
}

type CallSpec = {
  input: string;
  cacheRead?: string;
  cacheWrite?: string;
  output: string;
  reasoning: string | null;
  model: string;
  requestedReasoning: string;
};

type TaskSpec = {
  id: string;
  key: string;
  label: string;
  calls: CallSpec[];
};

const tasks: TaskSpec[] = [
  {
    id: 'Investigate failing test',
    key: 'investigate-failing-test',
    label: 'Investigate failing test',
    calls: [
      { input: '1200', cacheRead: '450', cacheWrite: '50', output: '320', reasoning: '120', model: 'example/model-small', requestedReasoning: 'medium' },
      { input: '700', cacheRead: '250', output: '220', reasoning: null, model: 'example/model-small', requestedReasoning: 'medium' },
    ],
  },
  {
    id: 'Implement fix',
    key: 'implement-fix',
    label: 'Implement fix',
    calls: [
      { input: '1700', cacheRead: '850', cacheWrite: '150', output: '480', reasoning: '220', model: 'example/model-large', requestedReasoning: 'high' },
      { input: '1100', output: '330', reasoning: '90', model: 'example/model-large', requestedReasoning: 'high' },
    ],
  },
  {
    id: 'Review change',
    key: 'review-change',
    label: 'Review change',
    calls: [
      { input: '900', cacheRead: '200', cacheWrite: '25', output: '260', reasoning: null, model: 'example/model-small', requestedReasoning: 'low' },
      { input: '600', cacheRead: '100', output: '180', reasoning: '60', model: 'example/model-small', requestedReasoning: 'low' },
    ],
  },
];

for (const [taskIndex, task] of tasks.entries()) {
  const taskRecordId = `task:${task.key}`;
  recorder.recordEvent({
    id: taskRecordId,
    subject: task.label,
    operation_id: taskRecordId,
    work_item_id: workItemId,
    task_id: task.id,
    agent_id: agentId,
    session_id: sessionId,
    status: 'ok',
    event_at: `2026-09-07T08:00:0${taskIndex}Z`,
    collected_at: collectedAt,
  });

  for (const [callIndex, call] of task.calls.entries()) {
    const callId = `model:${task.key}:${callIndex + 1}`;
    const callRecord = `observation:${callId}`;
    const seconds = 10 + taskIndex * 20 + callIndex * 5;
    const startedAt = `2026-09-07T08:00:${String(seconds).padStart(2, '0')}Z`;
    const endedAt = `2026-09-07T08:00:${String(seconds + 1).padStart(2, '0')}Z`;
    recorder.recordModelCall({
      id: callId,
      operation_id: `${task.key}:model-${callIndex + 1}`,
      parent_id: taskRecordId,
      work_item_id: workItemId,
      task_id: task.id,
      agent_id: agentId,
      session_id: sessionId,
      status: 'ok',
      event_at: startedAt,
      started_at: startedAt,
      ended_at: endedAt,
      collected_at: collectedAt,
      dimensions: {
        requested_model: fact(call.model, `${callRecord}:requested-model`),
        actual_model: fact(call.model, `${callRecord}:actual-model`),
        requested_tier: fact('standard', `${callRecord}:requested-tier`),
        actual_tier: fact('standard', `${callRecord}:actual-tier`),
        requested_reasoning: fact(call.requestedReasoning, `${callRecord}:requested-reasoning`),
        actual_reasoning: fact(call.reasoning === null ? null : call.requestedReasoning, `${callRecord}:actual-reasoning`),
      },
      measurements: {
        input_tokens: quantity(call.input, `${callRecord}:input_tokens`),
        ...(call.cacheRead === undefined ? {} : { cache_read_input_tokens: quantity(call.cacheRead, `${callRecord}:cache_read_input_tokens`) }),
        ...(call.cacheWrite === undefined ? {} : { cache_write_input_tokens: quantity(call.cacheWrite, `${callRecord}:cache_write_input_tokens`) }),
        output_tokens: quantity(call.output, `${callRecord}:output_tokens`),
        reasoning_output_tokens: quantity(call.reasoning, `${callRecord}:reasoning_output_tokens`),
      },
    });
  }
}

const snapshot = recorder.snapshot();
const tokenMeters = new Set(['input_tokens', 'cache_read_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens']);
const bundle = validateUsageBundle({ ...snapshot, meters: snapshot.meters.filter(meter => tokenMeters.has(meter.id)) });
for (const path of ['examples/dogfood/v04/usage-task-example.json', 'viewer/public/usage-task-example.json']) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(bundle, null, 2) + '\n');
}
console.log(`Generated declared synthetic task breakdown: ${tasks.length} tasks, ${tasks.reduce((count, task) => count + task.calls.length, 0)} model observations.`);
