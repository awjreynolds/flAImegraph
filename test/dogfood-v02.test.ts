import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateWorkItem} from '../src/work-items.js';

test('the real producer attempt includes every joined native usage timestamp', () => {
  const workItem=validateWorkItem(JSON.parse(readFileSync('examples/work-items/context-producer-proof.json','utf8')));
  const provenance=JSON.parse(readFileSync('examples/dogfood/v02/provenance.json','utf8'));
  const attempt=workItem.attempts[0]!;
  const usage=readFileSync('examples/dogfood/v02/independent-producer.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.type==='token_usage_record');
  assert.equal(usage.length, attempt.observation_ids.length);
  for(const row of usage) {
    assert.ok(Date.parse(row.timestamp)>=Date.parse(attempt.started_at!));
    assert.ok(Date.parse(row.timestamp)<=Date.parse(attempt.ended_at!));
  }
  assert.equal(attempt.ended_at, provenance.streams['independent-producer'].last_selected_usage_timestamp);
  assert.notEqual(attempt.ended_at, provenance.independent_producer_reported_bounds.ended_at);
  assert.ok(Date.parse(workItem.estimates[0]!.created_at)<Date.parse(attempt.started_at!));
});
