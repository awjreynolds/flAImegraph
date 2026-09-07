import { canonicalUsage, validateUsageBundle } from "./usage.js";
import type { UsageBundle, UsageDimensions, UsageMeter, UsageObservation, UsageSourceRef } from "./usage-types.js";
import { LIFECYCLE_SCHEMA_VERSION, type LifecycleEvent, type LifecycleCapture, type LifecycleAction, type LifecycleProjection, type LifecycleIssue } from "./lifecycle-types.js";
export * from "./lifecycle-types.js";

export class LifecycleError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "LifecycleError"; }
}
function fail(message: string): never { throw new LifecycleError("LIFECYCLE_INVALID", message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown lifecycle field ${key}`);
}
function string(value: unknown): asserts value is string { if (typeof value !== "string" || !value.length) fail("Expected a nonempty string"); }
function utc(value: unknown): asserts value is string {
  string(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString().slice(0,19) !== value.slice(0,19)) fail("Expected a valid UTC timestamp with at most nanosecond precision");
}
const sourceId = (e: LifecycleEvent) => `lifecycle:${e.epoch}`;
const refs = (e: LifecycleEvent): UsageSourceRef[] => [{ source_id: sourceId(e), record: e.event_id }];
const timestamp = (e: LifecycleEvent) => ({ value: e.wall_at, evidence: "observed" as const, method: "lifecycle producer wall clock", source_refs: refs(e) });
const wallNs=(value:string)=>BigInt(Date.parse(value.slice(0,19)+"Z"))*1000000n+BigInt((value.split(".")[1]?.replace("Z","")??"").padEnd(9,"0"));
function dimensions(input: UsageDimensions, event: LifecycleEvent): UsageDimensions {
  const result = structuredClone(input);
  for (const [key, value] of Object.entries(result)) {
    if (key === "extensions") for (const fact of Object.values(value as NonNullable<UsageDimensions["extensions"]>)) fact.source_refs = refs(event);
    else value.source_refs = refs(event);
  }
  return result;
}
function observation(e: LifecycleEvent, id: string): UsageObservation {
  return { id, source_refs: refs(e), subject: null, accounting_scope: "direct", operation_id: id, parent_id: null, agent_id: null, session_id: null, work_item_id: null, task_id: null, status: "unknown", event_at: null, started_at: null, ended_at: null, collected_at: null, measurements: {}, dimensions: {} };
}
function validationBundle(e: LifecycleEvent): UsageBundle {
  const row = observation(e, "validation");
  row.event_at = timestamp(e);
  if (e.data.kind === "start") row.dimensions = dimensions(e.data.dimensions ?? {}, e);
  if (e.data.kind === "measurement") row.measurements = { [e.data.meter.id]: { ...e.data.measurement, source_refs: refs(e) } };
  const meters = e.data.kind === "measurement" ? [e.data.meter, ...(e.data.meter.subset_of ? [{ id:e.data.meter.subset_of, unit:e.data.meter.unit, description:"Referenced meter validated at projection", subset_of:null, overlap:"unknown" as const }] : [])] : [];
  return { schema_version:"0.4.0", dataset_id:e.dataset_id, sources:[{id:sourceId(e),harness:e.producer_id,format:"lifecycle",coverage:"unknown"}], meters, observations:[row] };
}
/** Strict portable event validation; filesystem integrity is checked by the journal reader. */
export function validateLifecycleEvent(value: unknown): LifecycleEvent {
  const e = object(value);
  keys(e,["schema_version","dataset_id","producer_id","epoch","sequence","event_id","wall_at","monotonic_ns","data"]);
  if(e.schema_version !== LIFECYCLE_SCHEMA_VERSION) fail("Unsupported lifecycle schema");
  for(const key of ["dataset_id","producer_id","epoch","event_id"]) string(e[key]);
  if(typeof e.sequence !== "number" || !Number.isSafeInteger(e.sequence) || e.sequence < 0) fail("Invalid epoch sequence");
  if(e.event_id !== `${e.epoch}:${e.sequence}`) fail("Event identity must equal epoch:sequence");
  utc(e.wall_at); string(e.monotonic_ns);
  if(!/^(0|[1-9][0-9]*)$/.test(e.monotonic_ns)) fail("Invalid monotonic nanoseconds");
  const d=object(e.data); string(d.kind);
  const allowed:Record<string,string[]>={epoch:[],start:["action_id","subject","parent_id","retry_of","work_item_id","task_id","agent_id","session_id","dimensions"],pause:["action_id","reason"],resume:["action_id"],heartbeat:["action_id"],end:["action_id","status","reason"],measurement:["action_id","meter","measurement"]};
  if(!Object.hasOwn(allowed,d.kind)) fail("Unknown lifecycle event kind");
  keys(d,["kind",...allowed[d.kind]!]);
  if((d.kind === "epoch") !== (e.sequence === 0)) fail("Epoch must be the first event only");
  if(d.kind !== "epoch") string(d.action_id);
  if(d.kind === "start") {
    string(d.subject);
    for(const key of ["parent_id","retry_of","work_item_id","task_id","agent_id","session_id"]) if(d[key] != null) string(d[key]);
    if(d.parent_id === d.action_id || d.retry_of === d.action_id) fail("Action cannot parent or retry itself");
  }
  if(d.kind === "end" && !["ok","error","cancelled","unknown"].includes(String(d.status))) fail("Invalid terminal state");
  if(d.kind === "pause" || d.reason !== undefined) {
    const r=object(d.reason); keys(r,["code","evidence","method","reset_at"]);
    if(!["quota","rate_limit","network","service","sleep","user","unknown"].includes(String(r.code)) || !["observed","declared","unknown"].includes(String(r.evidence))) fail("Invalid interruption reason");
    string(r.method); if(r.reset_at != null) utc(r.reset_at);
    if((r.code === "unknown") !== (r.evidence === "unknown")) fail("Unknown reason requires unknown evidence and conversely");
  }
  const result=structuredClone(e) as unknown as LifecycleEvent;
  if(result.data.kind === "measurement") keys(object(result.data.measurement),["value","evidence","method","count_basis","aggregation","scope"]);
  validateUsageBundle(validationBundle(result));
  return result;
}
export function validateLifecycleCapture(value: unknown): LifecycleCapture {
  const c=object(value); keys(c,["schema_version","kind","dataset_id","events","issues"]);
  if(c.schema_version !== LIFECYCLE_SCHEMA_VERSION || c.kind !== "lifecycle") fail("Expected lifecycle capture");
  string(c.dataset_id);
  if(!Array.isArray(c.events) || !Array.isArray(c.issues)) fail("Expected events and issues arrays");
  const events=c.events.map(validateLifecycleEvent);
  for(const e of events) if(e.dataset_id !== c.dataset_id) fail("Mixed lifecycle datasets");
  const issues=c.issues.map(value=>{const i=object(value); keys(i,["code","message","action_id"]); string(i.code); string(i.message); if(i.action_id !== undefined) string(i.action_id); return structuredClone(i) as unknown as LifecycleIssue;});
  return {schema_version:LIFECYCLE_SCHEMA_VERSION,kind:"lifecycle",dataset_id:c.dataset_id,events,issues};
}
/** Replay immutable events into a fresh view. Merge events, never successive usage projections. */
export function projectLifecycle(input: LifecycleCapture, options: { gap_threshold_ns?: string } = {}): LifecycleProjection {
  const threshold=options.gap_threshold_ns??"60000000000";
  if(!/^[1-9][0-9]*$/.test(threshold)) fail("Gap threshold must be positive integer nanoseconds");
  const thresholdLabel=BigInt(threshold)%1000000000n===0n?`${BigInt(threshold)/1000000000n} s`:`${threshold} ns`;
  const capture=validateLifecycleCapture(input), issues=[...capture.issues];
  const unique=new Map<string,LifecycleEvent>();
  for(const event of capture.events) {
    const prior=unique.get(event.event_id);
    if(prior && canonicalUsage(prior)!==canonicalUsage(event)) throw new LifecycleError("LIFECYCLE_CONFLICT",`Conflicting event ${event.event_id}`);
    unique.set(event.event_id,event);
  }
  const events=[...unique.values()].sort((a,b)=>a.epoch.localeCompare(b.epoch)||a.sequence-b.sequence);
  const epochs=new Map<string,LifecycleEvent>(), incompleteEpochs=new Set<string>();
  for(const e of events) {
    const previous=epochs.get(e.epoch);
    if(previous && previous.producer_id!==e.producer_id) fail("Epoch has multiple producer identities");
    if(previous && BigInt(previous.monotonic_ns)>BigInt(e.monotonic_ns)) fail("Monotonic clock reversed within epoch");
    if(e.sequence!==(previous?previous.sequence+1:0)) {incompleteEpochs.add(e.epoch);issues.push({code:"LIFECYCLE_SEQUENCE_GAP",message:`Epoch ${e.epoch} has missing events before sequence ${e.sequence}`});}
    epochs.set(e.epoch,e);
  }
  const sources=[...new Map(events.map(e=>[sourceId(e),{id:sourceId(e),harness:e.producer_id,format:"lifecycle",coverage:"unknown" as const}])).values()];
  const byAction=new Map<string,LifecycleEvent[]>();
  for(const e of events) if(e.data.kind!=="epoch") {const group=byAction.get(e.data.action_id)??[];group.push(e);byAction.set(e.data.action_id,group);}
  const actions:LifecycleAction[]=[], observations:UsageObservation[]=[], meters=new Map<string,UsageMeter>();
  for(const start of events.filter(e=>e.data.kind === "start")) {
    if(start.data.kind !== "start") continue;
    const data=start.data;
    if(actions.some(a=>a.action_id===data.action_id)) throw new LifecycleError("LIFECYCLE_CONFLICT",`Multiple starts for ${data.action_id}`);
    const related=byAction.get(data.action_id)!;
    const ends=related.filter(e=>e.data.kind === "end");
    if(ends.length>1) throw new LifecycleError("LIFECYCLE_CONFLICT",`Multiple terminal records for ${data.action_id}`);
    const end=ends[0];
    if(end && end.epoch===start.epoch && end.sequence<start.sequence) fail(`Completion precedes start for ${data.action_id}`);
    const elapsed=end && end.epoch===start.epoch && BigInt(end.monotonic_ns)>=BigInt(start.monotonic_ns) ? String(BigInt(end.monotonic_ns)-BigInt(start.monotonic_ns)) : null;
    const action:LifecycleAction={action_id:data.action_id,parent_id:data.parent_id??null,retry_of:data.retry_of??null,state:end?.data.kind === "end"?end.data.status:"completion_unobserved",started_at:start.wall_at,ended_at:end?.wall_at??null,elapsed_ns:elapsed,known_wait_ns:"0",gaps:[],reasons:[],timing_qualified:false};
    const own=related.filter(e=>e.epoch===start.epoch);
    for(const e of related) {
      if(e.epoch!==start.epoch && ["pause","resume","heartbeat"].includes(e.data.kind)) fail("Pause, resume and heartbeat require the starting epoch; use a new retry after restart");
      if(e.epoch===start.epoch && e.sequence<start.sequence) fail(`Event precedes start for ${data.action_id}`);
      if(end && e.epoch===end.epoch && e.sequence>end.sequence && !["measurement"].includes(e.data.kind)) fail(`Lifecycle transition after completion for ${data.action_id}`);
    }
    let pause:LifecycleEvent|undefined, previous:LifecycleEvent|undefined;
    for(const current of own) {
      if(end && end.epoch===current.epoch && current.sequence>end.sequence) continue;
      if(previous) {
        const delta=BigInt(current.monotonic_ns)-BigInt(previous.monotonic_ns);
        if(delta<0n) fail(`Monotonic clock reversed within ${start.epoch}`);
        if(!pause && delta>BigInt(threshold)) action.gaps.push({from:previous.wall_at,to:current.wall_at,elapsed_ns:String(delta)});
      }
      if(current.data.kind === "pause") {
        if(pause && !incompleteEpochs.has(start.epoch)) fail(`Repeated pause without resume for ${data.action_id}`);
        pause=current; action.reasons.push(current.data.reason);
      }
      if(current.data.kind === "resume" || current.data.kind === "end") {
        if(current.data.kind === "resume" && !pause && !incompleteEpochs.has(start.epoch)) fail(`Resume without pause for ${data.action_id}`);
        if(pause) action.known_wait_ns=String(BigInt(action.known_wait_ns)+BigInt(current.monotonic_ns)-BigInt(pause.monotonic_ns));
        pause=undefined;
        if(current.data.kind === "end" && current.data.reason) action.reasons.push(current.data.reason);
      }
      previous=current;
    }
    if(end && end.epoch!==start.epoch && end.data.kind==="end" && end.data.reason) action.reasons.push(end.data.reason);
    if(incompleteEpochs.has(start.epoch) && action.reasons.length) {
      action.known_wait_ns="0";
      issues.push({code:"LIFECYCLE_WAIT_UNCERTAIN",message:`${data.action_id} has missing lifecycle records; pause duration cannot be established`,action_id:data.action_id});
    }
    if(pause && !end) action.state="paused";
    const wallDelta=end?wallNs(end.wall_at)-wallNs(start.wall_at):null;
    const discrepancy=wallDelta!==null && elapsed!==null ? wallDelta-BigInt(elapsed):0n;
    const discontinuity=!!end && (elapsed===null || wallDelta!<0n || discrepancy>1000000000n || discrepancy< -1000000000n);
    action.timing_qualified=action.gaps.length>0 || action.reasons.length>0 || !end || discontinuity || incompleteEpochs.has(start.epoch);
    if(discontinuity) issues.push({code:"LIFECYCLE_CLOCK_DISCONTINUITY",message:`${data.action_id} spans different clock epochs or inconsistent wall/monotonic intervals; active duration is unknown`,action_id:data.action_id});
    if(action.gaps.length) issues.push({code:"LIFECYCLE_CAPTURE_GAP",message:`${data.action_id} has a gap above ${thresholdLabel}; the cause and active work during the gap are unknown`,action_id:data.action_id});
    if(!end) issues.push({code:"LIFECYCLE_COMPLETION_UNOBSERVED",message:`${data.action_id} has no recorded completion; current liveness is unknown`,action_id:data.action_id});
    actions.push(action);
    const row=observation(start,data.action_id);
    Object.assign(row,{subject:data.subject,parent_id:data.parent_id??null,agent_id:data.agent_id??null,session_id:data.session_id??null,work_item_id:data.work_item_id??null,task_id:data.task_id??null,status:end?.data.kind === "end"?end.data.status:"unknown",started_at:timestamp(start),ended_at:end?timestamp(end):null,dimensions:dimensions(data.dimensions??{},start)});
    if(wallDelta!==null && wallDelta<0n) row.ended_at=null;
    row.source_refs=related.flatMap(refs);
    const extension=(value:string,method:string)=>({value,evidence:"derived" as const,method,source_refs:related.flatMap(refs)});
    row.dimensions.extensions={...row.dimensions.extensions,"flAImegraph.lifecycle.state":extension(action.state,"replayed lifecycle state; does not establish current liveness"),"flAImegraph.lifecycle.known_wait_ns":extension(action.known_wait_ns,"sum of explicitly closed pause intervals in one clock epoch"),"flAImegraph.lifecycle.timing_qualified":extension(String(action.timing_qualified),"wait, gap, missing completion or clock continuity qualification"),"flAImegraph.lifecycle.clock_continuity":extension(elapsed===null?"unknown":"continuous","elapsed interval requires one monotonic producer epoch")};
    if(elapsed!==null && end) row.dimensions.extensions["flAImegraph.lifecycle.elapsed_ns"]={...extension(elapsed,"difference of monotonic samples in one producer epoch; includes pre-dispatch journal acknowledgement and may include waits; not active CPU time"),source_refs:[...refs(start),...refs(end)]};
    if(end) row.dimensions.extensions["flAImegraph.lifecycle.raw_ended_at"]={value:end.wall_at,evidence:"observed",method:"recorded terminal wall timestamp, including clock reversal if any",source_refs:refs(end)};
    if(data.retry_of) row.dimensions.extensions["flAImegraph.lifecycle.retry_of"]={value:data.retry_of,evidence:"declared",method:"explicit retry identity",source_refs:refs(start)};
    observations.push(row);
  }
  for(const [id,related] of byAction) if(!actions.some(a=>a.action_id===id)) {
    const ends=related.filter(e=>e.data.kind==="end");
    if(ends.length>1) throw new LifecycleError("LIFECYCLE_CONFLICT",`Multiple terminal records for ${id}`);
    const end=ends[0], first=related[0]!;
    const state=end?.data.kind==="end"?end.data.status:"completion_unobserved";
    actions.push({action_id:id,parent_id:null,retry_of:null,state,started_at:null,ended_at:end?.wall_at??null,elapsed_ns:null,known_wait_ns:"0",gaps:[],reasons:related.flatMap(e=>(e.data.kind==="pause" || e.data.kind==="end") && e.data.reason?[e.data.reason]:[]),timing_qualified:true});
    const row=observation(first,id); row.status=end?.data.kind==="end"?end.data.status:"unknown";row.ended_at=end?timestamp(end):null;
    observations.push(row);
    issues.push({code:"LIFECYCLE_START_UNOBSERVED",message:`Start and ancestry of ${id} have not been captured`,action_id:id});
  }
  for(const e of events) if(e.data.kind === "measurement") {
    const d=e.data, prior=meters.get(d.meter.id);
    if(prior && canonicalUsage(prior)!==canonicalUsage(d.meter)) throw new LifecycleError("LIFECYCLE_CONFLICT",`Conflicting meter ${d.meter.id}`);
    meters.set(d.meter.id,d.meter);
    const parent=observations.find(o=>o.id===d.action_id), row=observation(e,e.event_id);
    if(parent) {
      Object.assign(row,{subject:parent.subject,agent_id:parent.agent_id,session_id:parent.session_id,work_item_id:parent.work_item_id,task_id:parent.task_id,status:parent.status,dimensions:structuredClone(parent.dimensions)});
      for(const key of Object.keys(row.dimensions.extensions??{})) if(key.startsWith("flAImegraph.lifecycle.") && key!=="flAImegraph.lifecycle.retry_of") delete row.dimensions.extensions![key];
    }
    row.operation_id=d.action_id; row.parent_id=d.action_id; row.event_at={...timestamp(e),method:"lifecycle usage receipt recorded; may be later than consumption"};
    row.measurements={ [d.meter.id]:{...d.measurement,source_refs:refs(e)} };
    observations.push(row);
  }
  for(const action of actions) if(action.parent_id && !actions.some(a=>a.action_id===action.parent_id)) issues.push({code:"LIFECYCLE_PARENT_UNOBSERVED",message:`Parent ${action.parent_id} has not been captured`,action_id:action.action_id});
  const actionMap=new Map(actions.map(a=>[a.action_id,a]));
  for(const action of actions) {
    if(action.retry_of && !actionMap.has(action.retry_of)) issues.push({code:"LIFECYCLE_RETRY_UNOBSERVED",message:`Earlier attempt ${action.retry_of} has not been captured`,action_id:action.action_id});
    const seen=new Set<string>();let current:LifecycleAction|undefined=action;
    while(current) {if(seen.has(current.action_id)) fail(`Retry cycle at ${current.action_id}`);seen.add(current.action_id);current=current.retry_of?actionMap.get(current.retry_of):undefined;}
  }
  const rowIds=new Set<string>();
  for(const row of observations) {if(rowIds.has(row.id)) fail(`Action identity collides with measurement event ${row.id}`);rowIds.add(row.id);}
  const usage=validateUsageBundle({schema_version:"0.4.0",dataset_id:capture.dataset_id,sources,meters:[...meters.values()],observations,coverage:{boundary:"instrumented",complete:false,dropped_observations:0,limitations:["Lifecycle capture records instrumented actions only. Missing completion is not success, cancellation, zero usage, or proof of a particular interruption.","Elapsed intervals include pre-dispatch journal acknowledgement, instrumentation and possible waits; they are not active CPU time or uninstrumented operation benchmarks.","Merge lifecycle events before projection. Successive projections of the same action are revisions, not immutable usage observations to merge.",...issues.map(i=>i.message)]}});
  return {capture:{...capture,events},actions,issues,usage};
}

/** Merge raw immutable events, deduplicating exact delivery and rejecting identity conflicts. */
export function mergeLifecycleCaptures(inputs: LifecycleCapture[]): LifecycleCapture {
  if(!inputs.length) fail("At least one lifecycle capture is required");
  const validated=inputs.map(validateLifecycleCapture), dataset=validated[0]!.dataset_id;
  if(validated.some(c=>c.dataset_id!==dataset)) fail("Cannot merge different lifecycle datasets");
  const issues=[...new Map(validated.flatMap(c=>c.issues).map(i=>[canonicalUsage(i),i])).values()];
  return projectLifecycle({schema_version:LIFECYCLE_SCHEMA_VERSION,kind:"lifecycle",dataset_id:dataset,events:validated.flatMap(c=>c.events),issues}).capture;
}
