#!/usr/bin/env node
'use strict';

// Standalone arithmetic over an immutable sanitized snapshot; no network or SDK.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const base = __dirname;
const read = name => fs.readFileSync(path.join(base, name));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const usageBytes = read('usage.json');
const rateBytes = read('ratecard.json');
const usage = JSON.parse(usageBytes);
const rate = JSON.parse(rateBytes);
assert.equal(hash(usageBytes), rate.sourceUsageSha256, 'Immutable usage hash changed');
assert.equal(rate.currency, 'USD');
assert.equal(rate.surface, 'Codex');
assert.deepEqual(rate.multipliersApplied,
  { speed: 1, regionalProcessing: 1, longContext: 1, reasoningEffort: 1 });
for (const key of ['freshInput', 'cachedInput', 'output']) {
  assert.match(rate.usdPerMillionTokens[key], /^\d+$/);
  assert.equal(BigInt(rate.nanoUsdPerToken[key]), BigInt(rate.usdPerMillionTokens[key]) * 1000n);
}
const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const emptyUsage = () => Object.fromEntries(fields.map(key => [key, 0]));
const addUsage = (sum, row) => {
  for (const key of fields) {
    assert(Number.isSafeInteger(row[key]) && row[key] >= 0, `Invalid ${key}`);
    sum[key] += row[key];
    assert(Number.isSafeInteger(sum[key]));
  }
};
const usd = nano => {
  const whole = nano / 1000000000n;
  const part = (nano % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}${part ? `.${part}` : ''}`;
};
const asNumber = value => {
  const number = Number(value);
  assert(Number.isSafeInteger(number), 'JSON integer would lose precision');
  return number;
};
const price = quantities => {
  const components = Object.fromEntries(Object.entries(quantities)
    .map(([key, tokens]) => [key, BigInt(tokens) * BigInt(rate.nanoUsdPerToken[key])]));
  const total = Object.values(components).reduce((a, b) => a + b, 0n);
  return {
    componentNanoUsd: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, asNumber(v)])),
    totalNanoUsd: asNumber(total),
    totalUsd: usd(total),
  };
};
const quantities = row => ({
  freshInput: row.input_tokens - row.cached_input_tokens,
  cachedInput: row.cached_input_tokens,
  output: row.output_tokens,
});
const ids = new Set();
const responseHashes = new Set();
const agentSums = new Map(usage.threads.map(t => [t.agent,
  { usage: emptyUsage(), count: 0, total: 0n }]));
assert.equal(agentSums.size, usage.threads.length);
const overallUsage = emptyUsage();
let overallNano = 0n;
const observations = usage.calls.map(call => {
  assert(!ids.has(call.id), 'Duplicate observation ID');
  assert(!responseHashes.has(call.responseHash), 'Duplicate response hash');
  ids.add(call.id);
  responseHashes.add(call.responseHash);
  assert.equal(call.model, rate.model, 'Rate card does not match model setting');
  assert(agentSums.has(call.agent), 'Unknown agent');
  assert(call.cached_input_tokens <= call.input_tokens);
  assert(call.reasoning_output_tokens <= call.output_tokens);
  assert.equal(call.cache_write_input_tokens, 0, 'Nonzero cache writes need an explicit mapping');
  assert.equal(call.total_tokens, call.input_tokens + call.output_tokens);
  const tokens = Object.fromEntries(fields.map(key => [key, call[key]]));
  const billableQuantities = quantities(call);
  const cost = price(billableQuantities);
  const agent = agentSums.get(call.agent);
  addUsage(agent.usage, tokens);
  addUsage(overallUsage, tokens);
  agent.count++;
  agent.total += BigInt(cost.totalNanoUsd);
  overallNano += BigInt(cost.totalNanoUsd);
  return {
    id: call.id, responseHash: call.responseHash, agent: call.agent,
    turn: call.turn, modelSetting: call.model, modelVerifiedInResponse: false,
    effortSetting: call.effort, time: call.time, tokens, billableQuantities, ...cost,
  };
});
assert.deepEqual(overallUsage, usage.total, 'Calls do not conserve source total');
const agents = usage.threads.map(thread => {
  const sum = agentSums.get(thread.agent);
  assert.deepEqual(sum.usage, thread.sum);
  assert.deepEqual(sum.usage, thread.reported);
  assert.equal(sum.count, thread.callCount);
  const tokens = quantities(sum.usage);
  const cost = price(tokens);
  assert.equal(sum.total, BigInt(cost.totalNanoUsd), 'Agent subtotal does not conserve calls');
  return { agent: thread.agent, parent: thread.parent, observationCount: sum.count,
    sourceThreadHash: thread.sourceHash, tokens: sum.usage, billableQuantities: tokens, ...cost };
});
const overall = { observationCount: observations.length, tokens: overallUsage,
  billableQuantities: quantities(overallUsage), ...price(quantities(overallUsage)) };
assert.equal(overallNano, BigInt(overall.totalNanoUsd));
assert.equal(agents.reduce((n, a) => n + BigInt(a.totalNanoUsd), 0n), overallNano);

const safeFrame = text => {
  assert(!/[;\r\n]/.test(text), 'Unsafe folded frame');
  // A leaf ending in " call 001" looks like differential input to FlameGraph.
  // Remove whitespace from frame names so the only trailing number is weight.
  return text.replace(/\s/g, '_');
};
const folded = observations.map(row =>
  ['Selected enterprise scenario', row.agent, row.turn, row.id].map(safeFrame).join(';')
  + ` ${row.totalNanoUsd}`).join('\n') + '\n';
fs.writeFileSync(path.join(base, 'cost.folded'), folded);
const output = {
  label: rate.label, basis: rate.basis, scenarioId: rate.scenarioId,
  selectedRateSource: rate.source, rateRetrievedDate: rate.retrievedDate,
  validFrom: rate.validFrom, validUntil: rate.validUntil,
  historicalApplicabilityEstablished: rate.historicalApplicabilityEstablished,
  assumptions: rate.assumptions, exclusions: rate.exclusions,
  fullEnterpriseBillKnown: false, completeRunCostKnown: false,
  usageSource: { path: 'usage.json', copiedFrom: '../capture-depth/evidence.json',
    sha256: hash(usageBytes), cutoff: usage.cutoff, immutable: true },
  ratecardSha256: hash(rateBytes), currency: rate.currency, weightUnit: 'integer nanoUSD',
  nanoUsdPerUsd: 1000000000, rounding: 'None: rates yield integral nanoUSD per token',
  pricingMapping: 'fresh=input-cached; cached=cached; output includes reasoning; no extra cache-write fee',
  overall, agents, observations,
  verification: { uniqueObservationIds: true, uniqueResponseHashes: true,
    inputAndOutputConserveTotal: true, cachedAndReasoningRemainSubsets: true,
    sourceThreadTotalsMatch: true, sourceOverallTotalsMatch: true,
    observationCostsConserveAgentTotals: true, agentTotalsConserveOverall: true,
    componentTotalsConserveOverall: true, usageHashUnchanged: true },
};
fs.writeFileSync(path.join(base, 'output.json'), JSON.stringify(output, null, 2) + '\n');

const args = process.argv.slice(2);
if (args.length) {
  assert.equal(args[0], '--renderer');
  assert.equal(args.length, 2, 'Usage: node reprice.cjs [--renderer /path/to/flamegraph.pl]');
  const renderer = path.resolve(args[1]);
  assert.equal(hash(fs.readFileSync(renderer)), rate.renderer.sha256, 'Renderer hash mismatch');
  const run = (cmd, argv) => {
    const result = spawnSync(cmd, argv, { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${cmd} failed: ${result.stderr}`);
    assert.equal(result.stderr, '', `${cmd} reported a warning`);
    return result.stdout;
  };
  const svg = run('perl', ['-CA', renderer,
    '--title', 'Enterprise-rate scenario — model tokens only',
    '--subtitle', `$${overall.totalUsd} USD | ${observations.length} observed calls | selected public rates, not a bill | fees and hidden usage excluded`,
    '--countname', 'nanoUSD (1e-9 USD)', '--nametype', 'Attribution:',
    '--width', '1800', '--height', '28', '--fontsize', '13', '--minwidth', '0',
    '--colors', 'blue', '--hash', '--notes',
    `Selected rate scenario ${rate.scenarioId}. Model from settings, not response verified. `
      + `Assume standard speed and no regional uplift. Usage hash ${hash(usageBytes)}. `
      + `Rate source ${rate.source.url}. Unmodified renderer ${rate.renderer.url}.`,
    path.join(base, 'cost.folded')]);
  const tips = [...svg.matchAll(/<title>(.*?)<\/title>/g)].map(match => match[1]);
  const grouped = number => number.toLocaleString('en-US');
  assert(tips.includes(`all (${grouped(overall.totalNanoUsd)} nanoUSD (1e-9 USD), 100%)`));
  for (const row of observations) {
    const start = `${safeFrame(row.id)} (${grouped(row.totalNanoUsd)} nanoUSD `;
    assert.equal(tips.filter(tip => tip.startsWith(start)).length, 1, row.id);
  }
  for (const agent of agents) {
    assert(tips.some(tip => tip.startsWith(`${agent.agent} (${grouped(agent.totalNanoUsd)} nanoUSD `)));
  }
  fs.writeFileSync(path.join(base, 'cost-flamegraph.svg'), svg);
  run('rsvg-convert', ['--output', path.join(base, 'cost-flamegraph.png'), path.join(base, 'cost-flamegraph.svg')]);
  const png = read('cost-flamegraph.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  fs.writeFileSync(path.join(base, 'render.json'), JSON.stringify({
    ...rate.renderer, title: 'Enterprise-rate scenario — model tokens only',
    totalNanoUsd: overall.totalNanoUsd, foldedSha256: hash(Buffer.from(folded)),
    svgSha256: hash(Buffer.from(svg)), pngSha256: hash(png),
    verification: { rootTotalMatches: true, eachObservationMatchesOnce: true,
      agentTotalsMatch: true, pngSignatureValid: true },
  }, null, 2) + '\n');
}
assert.equal(hash(read('usage.json')), rate.sourceUsageSha256);
console.log(JSON.stringify({ scenario: rate.scenarioId, ...overall,
  agents: agents.map(({ agent, observationCount, totalUsd }) => ({ agent, observationCount, totalUsd })) }, null, 2));
