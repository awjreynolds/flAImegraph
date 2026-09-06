/** Derive a bounded metadata-only report from the public upstream Pi fixture. */
import { readFileSync, writeFileSync } from 'node:fs';
import { importEvidence } from '../../src/adapters/index.js';
import { valueEvidence } from '../../src/core.js';
import { createHarnessProfile } from '../../src/context-capture.js';
import { reconstructNativeContext } from '../../src/native-context.js';
import { createContextReport } from '../../src/context-report.js';
const path = process.argv[2];
if (!path) throw new Error('Supply the upstream before-compaction.jsonl fixture path');
const input = readFileSync(path, 'utf8').split(/\r?\n/).slice(0, 32).join('\n') + '\n';
const evidence = importEvidence('pi', input, {source_id:'pi-public-fixture-prefix-32',dataset_id:'pi-public-context-prefix-32',agent_id:'pi-fixture'});
const profile = createHarnessProfile({harness:'pi',name:'Pi public transcript fixture (32-row prefix)'});
const context = reconstructNativeContext('pi', input, evidence, profile, {source_id:'pi-public-fixture-prefix-32'});
const report = createContextReport(evidence, valueEvidence(evidence,{mode:'recorded'}), context);
writeFileSync('examples/context/pi-transcript-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report.summary,occurrences:context.requests.reduce((n,r)=>n+r.occurrences.length,0),bytes:JSON.stringify(report).length}));
