import test from 'node:test';
import assert from 'node:assert/strict';
import { usageTiming, contextTiming } from '../viewer/lib/timing.js';
import { createUsageRecorder } from '../src/usage-recorder.js';
import { importUsage } from '../src/usage-import.js';
import { importEvidence } from '../src/adapters/index.js';

test('display keeps event time distinct from missing action boundaries', () => {
  const input = JSON.stringify({type:'token_usage_record',timestamp:'2026-09-07T10:00:00Z',payload:{response_id:'r1',usage:{input_tokens:1}}});
  const usage = importUsage(input,{format:'codex',dataset_id:'timing'});
  const result=usageTiming(usage.observations[0]!,usage.meters);
  assert.equal(result.event.value,'2026-09-07T10:00:00Z');
  assert.equal(result.start.value,'Not captured');
  assert.equal(result.end.value,'Not captured');
  assert.equal(result.duration.value,'Not captured');
  const legacy=contextTiming(importEvidence('codex',input).observations[0]!);
  assert.equal(legacy.event.value,'2026-09-07T10:00:00Z');
  assert.equal(legacy.duration.value,'Not captured');
});

test('duration preserves nanoseconds and identifies clock reversal and running scopes', () => {
  const r=createUsageRecorder({dataset_id:'timing'});
  r.recordEvent({id:'precise',started_at:'2026-09-07T10:00:00.999999999Z',ended_at:'2026-09-07T10:00:01.000000001Z'});
  r.recordEvent({id:'reverse',started_at:'2026-09-07T10:00:02Z',ended_at:'2026-09-07T10:00:01Z'});
  const call=r.startModelCall({id:'running'});
  const bundle=r.snapshot();
  assert.equal(usageTiming(bundle.observations.find(x=>x.id==='precise')!,bundle.meters).duration.value,'0.000000002 s');
  assert.equal(usageTiming(bundle.observations.find(x=>x.id==='reverse')!,bundle.meters).duration.value,'Cannot calculate');
  assert.equal(usageTiming(bundle.observations.find(x=>x.id===call.id)!,bundle.meters).end.value,'In progress');
  call.end();
  const ended=r.snapshot();
  assert.match(usageTiming(ended.observations.find(x=>x.id===call.id)!,ended.meters).duration.note,/Derived/);
});

test('measured elapsed duration takes precedence and zero is not missing', () => {
  const r=createUsageRecorder({dataset_id:'timing'});
  r.recordEvent({id:'zero',started_at:'2026-09-07T10:00:00Z',ended_at:'2026-09-07T10:00:00Z',measurements:{elapsed_ns:{value:'123',unit:'nanoseconds',scope:'interval',evidence:'observed',method:'monotonic clock'}}});
  const b=r.snapshot();
  assert.equal(usageTiming(b.observations[0]!,b.meters).duration.value,'0.000000123 s');
  delete b.observations[0]!.measurements.elapsed_ns;
  assert.equal(usageTiming(b.observations[0]!,b.meters).duration.value,'0 s');
});

test('Codex action boundaries survive nested usage import without reusing event time', () => {
  const input=JSON.stringify({type:'token_usage_record', timestamp:'2026-09-07T09:00:02+01:00', started_at:'2026-09-07T09:00:00.123456789+01:00',ended_at:'2026-09-07T09:00:01.123456790+01:00',payload:{response_id:'bounds',usage:{input_tokens:1}}});
  const b=importUsage(input,{format:'codex',dataset_id:'timed'});
  const display=usageTiming(b.observations[0]!,b.meters);
  assert.equal(display.start.value,'2026-09-07T08:00:00.123456789Z');
  assert.equal(display.end.value,'2026-09-07T08:00:01.123456790Z');
  assert.equal(display.duration.value,'1.000000001 s');
  assert.equal(display.event.value,'2026-09-07T08:00:02Z');
  const legacy=contextTiming(importEvidence('codex',input).observations[0]!);
  assert.equal(legacy.event.value,'2026-09-07T08:00:02Z');
});

test('legacy OTLP explicit span boundaries remain visible in the context view', () => {
  const b=importEvidence('otel',JSON.stringify({resourceSpans:[{scopeSpans:[{spans:[{traceId:'0123456789abcdef0123456789abcdef',spanId:'0123456789abcdef',name:'chat',startTimeUnixNano:'1788771600000000001',endTimeUnixNano:'1788771600123456789',attributes:[{key:'gen_ai.operation.name',value:{stringValue:'chat'}}]}]}]}]}));
  const display=contextTiming(b.observations[0]!);
  assert.notEqual(display.start.value,'Not captured');
  assert.equal(display.duration.value,'0.123456788 s');
});

test('usage timing retains the canonical OTLP duration measurement and its evidence', () => {
  const b=importUsage(JSON.stringify({resourceSpans:[{scopeSpans:[{spans:[{traceId:'0123456789abcdef0123456789abcdef',spanId:'0123456789abcdef',name:'chat',startTimeUnixNano:'1788771600000000001',endTimeUnixNano:'1788771600123456789',attributes:[]}]}]}]}),{format:'otlp',dataset_id:'timing'});
  const display=usageTiming(b.observations[0]!,b.meters);
  assert.equal(display.duration.value,'0.123456788 s');
  assert.match(display.duration.note,/observed.*provider_native/);
  assert.doesNotMatch(display.duration.note,/Derived from/);
});

test('legacy explicit Codex start survives migration and is never renamed event time', () => {
  const source=JSON.stringify({type:'token_usage_record',started_at:'2026-09-07T10:00:00Z',ended_at:'2026-09-07T10:00:01Z',payload:{response_id:'r',usage:{input_tokens:1}}});
  const legacy=importEvidence('codex',source);
  const display=contextTiming(legacy.observations[0]!);
  assert.equal(display.start.value,'2026-09-07T10:00:00Z');
  assert.equal(display.event.value,'Not captured');
  assert.equal(display.duration.value,'1 s');
  const migrated=importUsage(legacy,{format:'legacy',dataset_id:'timing'});
  assert.equal(usageTiming(migrated.observations[0]!,migrated.meters).start.value,'2026-09-07T10:00:00Z');
});

test('running duration remains open and non-additive accounting does not hide a recorded interval', () => {
  const r=createUsageRecorder({dataset_id:'timing'});
  r.recordEvent({id:'running',status:'running',measurements:{duration_ns:{value:'2',scope:'interval'}}});
  r.recordEvent({id:'aggregate',accounting_scope:'aggregate',measurements:{duration_ns:{value:'3',aggregation:'delta',scope:'interval'}}});
  const b=r.snapshot();
  const open=usageTiming(b.observations.find(o=>o.id==='running')!,b.meters);
  assert.equal(open.duration.value,'In progress');
  assert.match(open.duration.note,/elapsed so far/);
  assert.equal(usageTiming(b.observations.find(o=>o.id==='aggregate')!,b.meters).duration.value,'0.000000003 s');
});

test('lifecycle timing uses explicit state and elapsed evidence without crossing clock epochs', () => {
  const r=createUsageRecorder({dataset_id:'timing'});
  r.recordEvent({id:'paused',status:'unknown',started_at:'2026-09-07T10:00:00Z',dimensions:{extensions:{
    'flAImegraph.lifecycle.state':{value:'paused',evidence:'derived',method:'replayed lifecycle state',source_refs:[]},
    'flAImegraph.lifecycle.known_wait_ns':{value:'3000000000',evidence:'derived',method:'closed pause intervals',source_refs:[]},
    'flAImegraph.lifecycle.timing_qualified':{value:'true',evidence:'derived',method:'lifecycle qualification',source_refs:[]},
    'flAImegraph.lifecycle.clock_continuity':{value:'unknown',evidence:'derived',method:'producer epoch',source_refs:[]},
  }}});
  r.recordEvent({id:'unobserved',status:'unknown',started_at:'2026-09-07T10:00:00Z',dimensions:{extensions:{
    'flAImegraph.lifecycle.state':{value:'completion_unobserved',evidence:'derived',method:'replayed lifecycle state',source_refs:[]},
    'flAImegraph.lifecycle.clock_continuity':{value:'unknown',evidence:'derived',method:'producer epoch',source_refs:[]},
  }}});
  r.recordEvent({id:'ended',status:'ok',started_at:'2026-09-07T10:00:00Z',ended_at:'2026-09-07T10:00:10Z',dimensions:{extensions:{
    'flAImegraph.lifecycle.state':{value:'ok',evidence:'derived',method:'replayed lifecycle state',source_refs:[]},
    'flAImegraph.lifecycle.elapsed_ns':{value:'2000000000',evidence:'derived',method:'difference of monotonic samples in one producer epoch; includes pre-dispatch journal acknowledgement and may include waits; not active CPU time',source_refs:[]},
    'flAImegraph.lifecycle.known_wait_ns':{value:'3000000000',evidence:'derived',method:'closed pause intervals',source_refs:[]},
    'flAImegraph.lifecycle.timing_qualified':{value:'true',evidence:'derived',method:'lifecycle qualification',source_refs:[]},
    'flAImegraph.lifecycle.clock_continuity':{value:'continuous',evidence:'derived',method:'producer epoch',source_refs:[]},
  }}});
  r.recordEvent({id:'cross-epoch',status:'ok',started_at:'2026-09-07T10:00:00Z',ended_at:'2026-09-07T10:00:10Z',dimensions:{extensions:{
    'flAImegraph.lifecycle.state':{value:'ok',evidence:'derived',method:'replayed lifecycle state',source_refs:[]},
    'flAImegraph.lifecycle.clock_continuity':{value:'unknown',evidence:'derived',method:'producer epoch',source_refs:[]},
  }}});
  const b=r.snapshot();
  const paused=usageTiming(b.observations.find(o=>o.id==='paused')!,b.meters);
  assert.equal(paused.end.value,'Paused at capture');
  assert.equal(paused.duration.value,'Not captured');
  assert.doesNotMatch(paused.end.value,/In progress/);
  const unobserved=usageTiming(b.observations.find(o=>o.id==='unobserved')!,b.meters);
  assert.equal(unobserved.end.value,'Completion unobserved');
  assert.equal(unobserved.duration.value,'Not captured');
  const ended=usageTiming(b.observations.find(o=>o.id==='ended')!,b.meters);
  assert.equal(ended.duration.value,'2 s');
  assert.match(ended.duration.note,/Lifecycle elapsed/);
  assert.match(ended.duration.note,/known wait/i);
  assert.match(ended.duration.note,/pre-dispatch journal acknowledgement/);
  const crossEpoch=usageTiming(b.observations.find(o=>o.id==='cross-epoch')!,b.meters);
  assert.equal(crossEpoch.duration.value,'Not captured');
  assert.match(crossEpoch.duration.note,/clock epoch/i);
});
