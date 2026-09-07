import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/pricing-cli.ts", ...args], { encoding: "utf8" });
test("CLI emits and validates an honest versioned harness profile template", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-cli-"));
  try {
    const out = join(dir, "profile.json");
    const created = cli("harness-profile", "--harness", "codex", "--version", "test", "--model", "test-model", "--out", out);
    assert.equal(created.status, 0, created.stderr);
    const profile = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(profile.harness_version.evidence, "declared");
    assert.equal(profile.policies.compaction.value, null);
    assert.equal(cli("validate", "--kind", "harness-profile", "--input", out).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI creates a report without fabricating context or changing the exact valuation", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-cli-"));
  try {
    const profilePath = join(dir, "profile.json");
    assert.equal(cli("harness-profile", "--harness", "fixture", "--out", profilePath).status, 0);
    const profile = JSON.parse(readFileSync(profilePath, "utf8"));
    const contextPath = join(dir, "context.json");
    writeFileSync(contextPath, JSON.stringify({schema_version:"0.2.0", dataset_id:"golden-two-costs", evidence_schema_version:"0.1.0", artifacts:[], profiles:[profile], sources:[], revisions:[], requests:[], transformations:[], issues:[]}));
    const valuation = join(dir, "valuation.json");
    assert.equal(cli("value", "--input", "examples/golden/evidence.json", "--mode", "recorded", "--out", valuation).status, 0);
    const out = join(dir, "report.json");
    const result = cli("context-report", "--evidence", "examples/golden/evidence.json", "--valuation", valuation, "--context", contextPath, "--out", out);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.summary.known_cost_nanos,"200000000");
    assert.equal(report.summary.requests,0);
    assert.deepEqual(report.allocations,[]);
    const protectedResult = cli("context-report", "--evidence", "examples/golden/evidence.json", "--valuation", valuation, "--context", contextPath, "--out", contextPath);
    assert.notEqual(protectedResult.status,0);
    assert.equal(JSON.parse(readFileSync(contextPath,"utf8")).requests.length,0);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test("CLI advances a captured stream in place while preserving raw input and failed state", () => {
  const dir=mkdtempSync(join(tmpdir(),'context-cli-'));
  try {
    const raw=join(dir,'raw.jsonl'), state=join(dir,'state.json'), evidence=join(dir,'evidence.json');
    const row=(id:string)=>JSON.stringify({type:'token_usage_record',response_id:id,usage:{input_tokens:10,output_tokens:2,cached_input_tokens:0}})+'\n';
    writeFileSync(raw,row('a'));
    const first=cli('capture','--harness','codex','--input',raw,'--namespace','test','--dataset-id','test','--out',state,'--evidence-out',evidence);
    assert.equal(first.status,0,first.stderr);
    writeFileSync(raw,row('a')+row('b'));
    const second=cli('capture','--input',raw,'--state',state,'--out',state,'--evidence-out',evidence);
    assert.equal(second.status,0,second.stderr);
    assert.equal(JSON.parse(readFileSync(evidence,'utf8')).observations.filter((o:{kind:string})=>o.kind==='model').length,2);
    const saved=readFileSync(state,'utf8');
    writeFileSync(raw,row('changed'));
    assert.notEqual(cli('capture','--input',raw,'--state',state,'--out',state).status,0);
    assert.equal(readFileSync(state,'utf8'),saved);
    assert.notEqual(cli('capture','--input',raw,'--state',state,'--out',raw).status,0);
    assert.equal(readFileSync(raw,'utf8'),row('changed'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("CLI captures a supplied provider payload without exporting its raw content and merges replay idempotently", () => {
  const dir=mkdtempSync(join(tmpdir(),'context-cli-'));
  try {
    const profilePath=join(dir,'profile.json');
    assert.equal(cli('harness-profile','--harness','fixture','--out',profilePath).status,0);
    const input=join(dir,'request.json'), options=join(dir,'options.json'), out=join(dir,'context.json'), merged=join(dir,'merged.json');
    writeFileSync(input,JSON.stringify({model:'fixture-model',input:[{role:'user',content:'private-content-not-for-export'}]}));
    writeFileSync(options,JSON.stringify({dataset_id:'provider-cli',namespace:'fixture',request_id:'request',profile:JSON.parse(readFileSync(profilePath,'utf8')),artifact:{id:'request-artifact',harness:'fixture',format:'json',coverage:'complete'}}));
    const result=cli('context-capture','--format','openai-responses','--input',input,'--options',options,'--out',out);
    assert.equal(result.status,0,result.stderr);
    assert.doesNotMatch(readFileSync(out,'utf8'),/private-content-not-for-export/);
    assert.equal(cli('validate','--kind','context','--input',out).status,0);
    const merge=cli('context-merge','--inputs',`${out},${out}`,'--out',merged);
    assert.equal(merge.status,0,merge.stderr);
    assert.deepEqual(JSON.parse(readFileSync(merged,'utf8')),JSON.parse(readFileSync(out,'utf8')));
    assert.notEqual(cli('context-capture','--format','openai-responses','--input',input,'--options',options,'--out',options).status,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("CLI imports native context with an explicit unavailable Codex boundary", () => {
  const dir=mkdtempSync(join(tmpdir(),'context-cli-'));
  try {
    const input='examples/dogfood/codex/coordinator.jsonl', evidence=join(dir,'evidence.json'), profile=join(dir,'profile.json'), out=join(dir,'context.json');
    assert.equal(cli('import','--harness','codex','--input',input,'--source-id','native-cli','--out',evidence).status,0);
    assert.equal(cli('harness-profile','--harness','codex','--out',profile).status,0);
    const result=cli('context-import','--harness','codex','--input',input,'--evidence',evidence,'--profile',profile,'--source-id','native-cli','--out',out);
    assert.equal(result.status,0,result.stderr);
    const context=JSON.parse(readFileSync(out,'utf8'));
    assert.equal(context.requests.length,88);
    assert.ok(context.requests.every((r:{boundary:string;coverage:string})=>r.boundary==='unavailable'&&r.coverage==='unknown'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
