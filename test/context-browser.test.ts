import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateContextReport, createContextReport } from '../src/context-report.js';
import { valueEvidence } from '../src/core.js';

test('the offline browser validator preserves the public semantics without dynamic evaluation', async () => {
  const directory=mkdtempSync(join(tmpdir(),'context-browser-'));
  try {
    const output=join(directory,'validator.mjs');
    const build=spawnSync(process.execPath,['tools/viewer/build-validator.mjs',output],{encoding:'utf8'});
    assert.equal(build.status,0,build.stderr);
    const source=readFileSync(output,'utf8');
    assert.doesNotMatch(source,/\bnew Function\b|\beval\(/);
    const browser=await import(pathToFileURL(output).href);
    const report=JSON.parse(readFileSync('examples/context/lifecycle-report.json','utf8'));
    assert.deepEqual(browser.validateContextReport(report),validateContextReport(report));
    const unpricedEvidence = structuredClone(report.evidence);
    for (const observation of unpricedEvidence.observations) delete observation.recorded_cost;
    const unpriced = createContextReport(unpricedEvidence, valueEvidence(unpricedEvidence, {mode:'recorded'}), report.context);
    assert.deepEqual(browser.validateContextReport(unpriced), validateContextReport(unpriced));
    assert.equal(unpriced.summary.currency, 'UNKNOWN');
    assert.equal(unpriced.summary.valuation_complete, false);
    for(const mutate of [
      (r:typeof report)=>{r.summary.known_cost_nanos='1';},
      (r:typeof report)=>{r.context.requests[0].occurrences[0].revision_id='missing';},
      (r:typeof report)=>{r.allocations[0].portions[0].amount_nanos='99999999';},
      (r:typeof report)=>{r.context.profiles[0].policies.compaction.evidence='observed';r.context.profiles[0].policies.compaction.source_refs=[];},
    ]) {
      const changed=structuredClone(report);mutate(changed);
      assert.throws(()=>browser.validateContextReport(changed));
    }
  } finally {rmSync(directory,{recursive:true,force:true});}
});
