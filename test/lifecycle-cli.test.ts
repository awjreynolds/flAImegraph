import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openLifecycleJournal } from '../src/index.js';

const cli=(...args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts',...args],{encoding:'utf8'});
test('public SDK journal recovers through CLI, merges replay, and imports usage without pricing', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lifecycle-cli-'));
  try {
    const journal=await openLifecycleJournal({directory:join(dir,'journal'),dataset_id:'cli-recovery',producer_id:'test'});
    await journal.start({action_id:'read',subject:'tool.read',work_item_id:'T-42'});
    await journal.close();
    const out=join(dir,'capture.json');
    const recover=cli('lifecycle-recover','--directory',join(dir,'journal'),'--dataset-id','cli-recovery','--out',out);
    assert.equal(recover.status,0,recover.stderr);
    const validate=cli('validate','--kind','lifecycle','--input',out); assert.equal(validate.status,0,validate.stderr);
    const merged=join(dir,'merged.json');
    assert.equal(cli('lifecycle-merge','--inputs',`${out},${out}`,'--out',merged).status,0);
    assert.equal(JSON.parse(await readFile(merged,'utf8')).events.length,2);
    const usage=join(dir,'usage.json');
    const imported=cli('import','--format','lifecycle','--input',merged,'--out',usage);assert.equal(imported.status,0,imported.stderr);
    const bundle=JSON.parse(await readFile(usage,'utf8'));
    assert.equal(bundle.observations[0].work_item_id,'T-42');
    assert.equal(bundle.observations[0].status,'unknown');
    assert.equal(bundle.observations[0].ended_at,null);
    assert.equal(cli('lifecycle-merge','--inputs',out,'--out',out).status,1);
    const report=cli('lifecycle-report','--input',out,'--out',join(dir,'report.json'));assert.equal(report.status,0,report.stderr);
    assert.equal(JSON.parse(await readFile(join(dir,'report.json'),'utf8')).actions[0].state,'completion_unobserved');
  } finally {await rm(dir,{recursive:true,force:true});}
});
