import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { projectLifecycle, type LifecycleCapture, type LifecycleData, type LifecycleEvent } from '../src/lifecycle.js';

// Deterministic synthetic scenario, never an assertion about a real account or outage.
const events:LifecycleEvent[]=[];
const epoch='scenario-epoch';
function record(seconds:number,data:LifecycleData) {
  const sequence=events.length;
  events.push({schema_version:'0.5.0',dataset_id:'synthetic-interruption-scenario',producer_id:'illustrative-worker',epoch,sequence,event_id:`${epoch}:${sequence}`,wall_at:new Date(Date.UTC(2026,8,7)+seconds*1000).toISOString(),monotonic_ns:String(seconds*1e9),data});
}
const meter={id:'input_tokens',unit:'token',description:'Illustrative provider input tokens',subset_of:null,overlap:'disjoint' as const};
const receipt=(action_id:string,value:string):LifecycleData=>({kind:'measurement',action_id,meter,measurement:{value,evidence:'declared',method:'Synthetic scenario receipt; not measured provider consumption',count_basis:'provider_native',aggregation:'delta',scope:'event'}});
const start=(action_id:string,subject:string,retry_of?:string):LifecycleData=>({kind:'start',action_id,subject,parent_id:'workflow',work_item_id:'EXAMPLE-42',task_id:'illustrative-task',agent_id:'illustrative-worker',...(retry_of?{retry_of}:{})});
record(0,{kind:'epoch'});
record(0.1,{kind:'start',action_id:'workflow',subject:'Synthetic workflow',work_item_id:'EXAMPLE-42'});
record(1,start('quota-wait','model.response · quota wait'));
record(2,{kind:'pause',action_id:'quota-wait',reason:{code:'quota',evidence:'declared',method:'Synthetic quota wait scenario',reset_at:'2026-09-07T08:00:02Z'}});
record(28802,{kind:'resume',action_id:'quota-wait'});
record(28802.5,receipt('quota-wait','1200'));
record(28803,{kind:'end',action_id:'quota-wait',status:'ok'});
record(28804,start('long-read','tool.read · unexplained gap'));
record(57604,{kind:'heartbeat',action_id:'long-read'});
record(57605,{kind:'end',action_id:'long-read',status:'ok'});
record(57606,start('failed-request','model.response · failed request'));
record(57606.5,receipt('failed-request','30'));
record(57607,{kind:'end',action_id:'failed-request',status:'error',reason:{code:'network',evidence:'declared',method:'Synthetic disconnected request scenario'}});
record(57608,start('retry-request','model.response · retry','failed-request'));
record(57609,receipt('retry-request','180'));
record(57610,{kind:'end',action_id:'retry-request',status:'ok'});
record(57611,start('completion-unobserved','tool.remote · completion unobserved'));
record(57612,start('paused-at-capture','model.response · paused at capture'));
record(57613,{kind:'pause',action_id:'paused-at-capture',reason:{code:'service',evidence:'declared',method:'Synthetic service unavailable scenario'}});
const capture:LifecycleCapture={schema_version:'0.5.0',kind:'lifecycle',dataset_id:'synthetic-interruption-scenario',events,issues:[{code:'SYNTHETIC_SCENARIO',message:'This is an illustrative interruption scenario. Times, failures, waits and usage quantities are synthetic, not measured events or account data.'}]};
projectLifecycle(capture);
for(const path of ['examples/dogfood/v05/lifecycle.json','viewer/public/usage-interruptions.json']) {
  await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(capture,null,2)+'\n');
}
console.log('Generated synthetic lifecycle scenario: 7 actions, 1,410 declared input tokens, explicit waits and unknown completion.');
