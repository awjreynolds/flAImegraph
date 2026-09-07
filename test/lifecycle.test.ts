import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLifecycle, mergeLifecycleCaptures } from '../src/lifecycle.js';
import { createUsageReport } from '../src/usage.js';
import type { LifecycleCapture, LifecycleData, LifecycleEvent } from '../src/lifecycle-types.js';
import type { InterruptionReason } from '../src/lifecycle-types.js';

const event = (sequence: number, data: LifecycleData, seconds = sequence, epoch = 'epoch-a'): LifecycleEvent => ({ schema_version: '0.5.0', dataset_id: 'recovery', producer_id: 'agent', epoch, sequence, event_id: `${epoch}:${sequence}`, wall_at: new Date(Date.UTC(2026, 8, 7) + seconds * 1000).toISOString(), monotonic_ns: String(seconds * 1e9), data });
const capture = (...events: LifecycleEvent[]): LifecycleCapture => ({ schema_version:'0.5.0', kind:'lifecycle', dataset_id:'recovery', events, issues:[] });

test('replay retains unfinished action ancestry and accepts a later terminal observation without double counting', () => {
  const epoch=event(0,{kind:'epoch'}), start=event(1,{kind:'start',action_id:'read',parent_id:'task',subject:'tool.read',work_item_id:'T-1'});
  const initial=projectLifecycle(capture(epoch,start,start));
  assert.equal(initial.actions[0]?.state,'completion_unobserved');
  assert.equal(initial.actions[0]?.parent_id,'task');
  assert.equal(initial.actions[0]?.ended_at,null);
  assert.equal(initial.usage.coverage?.complete,false);
  const done=projectLifecycle(capture(epoch,start,event(2,{kind:'end',action_id:'read',status:'ok'})));
  assert.equal(done.actions[0]?.state,'ok');
  assert.equal(done.actions[0]?.elapsed_ns,'1000000000');
  assert.equal(done.usage.observations.length,1);
});

test('reported service, transport and sleep interruptions preserve evidence without inferring remote consumption', () => {
  const cases:{code:InterruptionReason['code'];method:string;evidence:InterruptionReason['evidence'];status:'error'|'unknown'}[]=[
    {code:'rate_limit',method:'Simulated HTTP 429 Retry-After response',evidence:'observed',status:'error'},
    {code:'service',method:'Simulated HTTP 503 service unavailable response',evidence:'observed',status:'error'},
    {code:'network',method:'Simulated DNS ENOTFOUND before provider connection',evidence:'observed',status:'error'},
    {code:'network',method:'Simulated client timeout; remote completion not observed',evidence:'observed',status:'unknown'},
    {code:'network',method:'Simulated response lost after request dispatch',evidence:'observed',status:'unknown'},
    {code:'sleep',method:'Caller-reported laptop suspend and resume',evidence:'declared',status:'unknown'},
    {code:'unknown',method:'No cause supplied by the caller',evidence:'unknown',status:'unknown'},
  ];
  for(const scenario of cases) {
    const reason:InterruptionReason={code:scenario.code,method:scenario.method,evidence:scenario.evidence};
    const result=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'a',subject:'remote.call'}),event(2,{kind:'pause',action_id:'a',reason}),event(3,{kind:'end',action_id:'a',status:scenario.status},28802)));
    assert.deepEqual(result.actions[0]?.reasons,[reason],scenario.method);
    assert.equal(result.actions[0]?.state,scenario.status,scenario.method);
    assert.equal(result.actions[0]?.known_wait_ns,'28800000000000');
    assert.equal(result.usage.coverage?.complete,false);
    assert.deepEqual(result.usage.observations[0]?.measurements,{});
    assert.deepEqual(createUsageReport(result.usage).meter_totals,[], 'No receipt is not a zero-usage measurement');
  }
});

test('a custom meter named __proto__ survives validation and reports its exact quantity', () => {
  const result=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'a',subject:'work'}),event(2,{kind:'measurement',action_id:'a',meter:{id:'__proto__',unit:'unit',description:'Custom producer meter',subset_of:null,overlap:'disjoint'},measurement:{value:'7',evidence:'observed',method:'public custom meter',count_basis:'consumed',aggregation:'delta',scope:'event'}})));
  const row=result.usage.observations.find(x=>x.id==='epoch-a:2')!;
  assert.equal(Object.hasOwn(row.measurements,'__proto__'),true);
  assert.equal(row.measurements.__proto__?.value,'7');
  assert.equal(createUsageReport(result.usage).meter_totals.find(m=>m.meter_id==='__proto__')?.known_total,'7');
});

test('late usage delivery does not extend or qualify a completed action interval', () => {
  const result=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'a',subject:'model.response'}),event(2,{kind:'end',action_id:'a',status:'ok'}),event(3,{kind:'measurement',action_id:'a',meter:{id:'tokens',unit:'token',description:'Reported tokens',subset_of:null,overlap:'disjoint'},measurement:{value:'10',evidence:'observed',method:'delayed provider receipt',count_basis:'consumed',aggregation:'delta',scope:'event'}},28802)));
  assert.equal(result.actions[0]?.elapsed_ns,'1000000000');
  assert.equal(result.actions[0]?.timing_qualified,false);
  assert.deepEqual(result.actions[0]?.gaps,[]);
  assert.equal(createUsageReport(result.usage).meter_totals[0]?.known_total,'10');
});

test('retry lineage rejects cycles and retains unresolved earlier attempt references visibly', () => {
  const a=event(1,{kind:'start',action_id:'a',subject:'model.response',retry_of:'b'});
  const b=event(2,{kind:'start',action_id:'b',subject:'model.response',retry_of:'a'});
  assert.throws(()=>projectLifecycle(capture(event(0,{kind:'epoch'}),a,b)),/Retry cycle/);
  const partial=projectLifecycle(capture(event(0,{kind:'epoch'}),a));
  assert.ok(partial.issues.some(i=>i.code==='LIFECYCLE_RETRY_UNOBSERVED' && i.action_id==='a'));
});

test('missing sequence cannot turn an uncertain pause into eight hours of known wait', () => {
  const result=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'a',subject:'work'}),event(2,{kind:'pause',action_id:'a',reason:{code:'quota',evidence:'declared',method:'reported wait'}}),event(4,{kind:'resume',action_id:'a'},28802),event(5,{kind:'end',action_id:'a',status:'ok'},28803)));
  assert.equal(result.actions[0]?.known_wait_ns,'0');
  assert.ok(result.issues.some(i=>i.code==='LIFECYCLE_WAIT_UNCERTAIN'));
});

test('partial capture keeps orphan terminal evidence and resolves it when its start arrives', () => {
  const late=event(2,{kind:'end',action_id:'remote',status:'error'});
  const partial=projectLifecycle(capture(late));
  assert.equal(partial.actions[0]?.started_at,null);
  assert.equal(partial.actions[0]?.ended_at,late.wall_at);
  assert.equal(partial.actions[0]?.state,'error');
  assert.ok(partial.issues.some(i=>i.code==='LIFECYCLE_START_UNOBSERVED'));
  const merged=mergeLifecycleCaptures([capture(late),capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'remote',subject:'tool.remote'}))]);
  assert.equal(projectLifecycle(merged).actions[0]?.elapsed_ns,'1000000000');
  assert.equal(merged.events.length,3);
  assert.throws(()=>projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'a',subject:'tool.read'}),event(2,{kind:'end',action_id:'a',status:'ok'}),event(3,{kind:'pause',action_id:'a',reason:{code:'user',evidence:'declared',method:'test'}}))),/after completion/);
});

test('restart and wall clock changes preserve terminal evidence without inventing elapsed time', () => {
  const start=event(1,{kind:'start',action_id:'read',subject:'tool.read'});
  const end=event(1,{kind:'end',action_id:'read',status:'ok'},0,'epoch-b');
  const replay=projectLifecycle(capture(event(0,{kind:'epoch'}),start,event(0,{kind:'epoch'},0,'epoch-b'),end));
  assert.equal(replay.actions[0]?.state,'ok');
  assert.equal(replay.actions[0]?.elapsed_ns,null);
  assert.equal(replay.actions[0]?.ended_at,'2026-09-07T00:00:00.000Z');
  assert.equal(replay.usage.observations[0]?.ended_at,null);
  assert.deepEqual(replay.usage.observations[0]?.dimensions.extensions?.['flAImegraph.lifecycle.raw_ended_at']?.source_refs,[{source_id:'lifecycle:epoch-b',record:'epoch-b:1'}]);
  assert.equal(replay.usage.observations[0]?.dimensions.extensions?.['flAImegraph.lifecycle.raw_ended_at']?.evidence,'observed');
  assert.ok(replay.issues.some(x=>x.code==='LIFECYCLE_CLOCK_DISCONTINUITY'));
  const jump=event(2,{kind:'end',action_id:'read',status:'ok'}); jump.wall_at='2026-09-07T08:00:02Z';
  const forward=projectLifecycle(capture(event(0,{kind:'epoch'}),start,jump));
  assert.equal(forward.actions[0]?.elapsed_ns,'1000000000');
  assert.equal(forward.actions[0]?.timing_qualified,true);
  assert.deepEqual(forward.usage.observations[0]?.dimensions.extensions?.['flAImegraph.lifecycle.elapsed_ns']?.source_refs,[{source_id:'lifecycle:epoch-a',record:'epoch-a:1'},{source_id:'lifecycle:epoch-a',record:'epoch-a:2'}]);
});

test('conflicts and invalid ordering fail visibly; partial sequence coverage is declared', () => {
  const epoch=event(0,{kind:'epoch'}), start=event(1,{kind:'start',action_id:'read',subject:'tool.read'});
  assert.throws(()=>projectLifecycle(capture(epoch,start,{...start,data:{...start.data,kind:'start',action_id:'read',subject:'changed'}})),/Conflicting event/);
  assert.throws(()=>projectLifecycle(capture(epoch,event(1,{kind:'end',action_id:'read',status:'ok'}),event(2,{kind:'start',action_id:'read',subject:'tool.read'}))),/precedes/);
  assert.throws(()=>projectLifecycle(capture(epoch,start,event(2,{kind:'end',action_id:'read',status:'ok'}),event(3,{kind:'end',action_id:'read',status:'error'}))),/Multiple terminal/);
  const partial=projectLifecycle(capture(epoch,start,event(3,{kind:'end',action_id:'read',status:'ok'})));
  assert.ok(partial.issues.some(x=>x.code==='LIFECYCLE_SEQUENCE_GAP'));
  assert.equal(partial.actions[0]?.timing_qualified,true);
});

test('delta receipts survive failure and retry while cumulative checkpoints never add twice', () => {
  const meter={id:'input_tokens',unit:'token',description:'Provider input',subset_of:null,overlap:'disjoint' as const};
  const measurement={value:'10',evidence:'observed' as const,method:'provider receipt',count_basis:'consumed' as const,aggregation:'delta' as const,scope:'event' as const};
  const receipt=event(2,{kind:'measurement',action_id:'first',meter,measurement});
  const result=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'first',subject:'model.response',task_id:'task'}),receipt,receipt,event(3,{kind:'end',action_id:'first',status:'error'}),event(4,{kind:'start',action_id:'retry',retry_of:'first',subject:'model.response',task_id:'task'}),event(5,{kind:'measurement',action_id:'retry',meter,measurement:{...measurement,value:'15'}}),event(6,{kind:'measurement',action_id:'retry',meter,measurement:{...measurement,value:'25',aggregation:'cumulative',scope:'snapshot'}}),event(7,{kind:'end',action_id:'retry',status:'ok'})));
  assert.equal(createUsageReport(result.usage).meter_totals.find(x=>x.meter_id==='input_tokens')?.known_total,'25');
  assert.equal(result.actions[1]?.retry_of,'first');
  assert.equal(result.usage.observations.filter(x=>x.measurements.input_tokens).length,3);
  assert.equal(result.usage.observations.find(x=>x.id===receipt.event_id)?.status,'error');
  assert.equal(result.usage.observations.find(x=>x.id===receipt.event_id)?.parent_id,'first');
});

test('an eight hour quota pause records known wait while an unexplained gap stays unclassified', () => {
  const quota=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'model',subject:'model.response'}),event(2,{kind:'pause',action_id:'model',reason:{code:'quota',evidence:'observed',method:'provider reset response',reset_at:'2026-09-07T08:00:02Z'}}),event(3,{kind:'resume',action_id:'model'},28802),event(4,{kind:'end',action_id:'model',status:'ok'},28803)));
  assert.equal(quota.actions[0]?.known_wait_ns,'28800000000000');
  assert.equal(quota.actions[0]?.elapsed_ns,'28802000000000');
  assert.equal(quota.actions[0]?.reasons[0]?.code,'quota');
  assert.equal(quota.actions[0]?.timing_qualified,true);
  const gap=projectLifecycle(capture(event(0,{kind:'epoch'}),event(1,{kind:'start',action_id:'read',subject:'tool.read'}),event(2,{kind:'heartbeat',action_id:'read'},28801),event(3,{kind:'end',action_id:'read',status:'ok'},28802)));
  assert.equal(gap.actions[0]?.known_wait_ns,'0');
  assert.deepEqual(gap.actions[0]?.reasons,[]);
  assert.equal(gap.actions[0]?.gaps[0]?.elapsed_ns,'28800000000000');
  assert.equal(gap.actions[0]?.timing_qualified,true);
});
