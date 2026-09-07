import test from "node:test";
import assert from "node:assert/strict";
import { createUsageProfile, validateUsageProfile } from "../src/usage-profile.js";
import { exportUsageFolded, exportUsagePprof, renderUsageSvg } from "../src/usage-export.js";
import { createUsageReport } from "../src/usage.js";
import type { UsageBundle, UsageObservation } from "../src/usage-types.js";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import protobuf from "protobufjs";
import { profileTree, profileBars, findProfileNode } from "../viewer/lib/profile-tree.js";

const refs = [{ source_id: "source", record: "request:1" }];
const fact = (value: string) => ({ value, evidence: "observed" as const, method: "provider response", source_refs: refs });
const observation = (id: string, value: string | null, parent_id: string | null = null): UsageObservation => ({
  id, source_refs: refs, subject: "model.request", accounting_scope: "direct", operation_id: id, parent_id,
  agent_id: "agent", session_id: "session", work_item_id: "work", task_id: "task", status: "ok",
  event_at: null, started_at: null, ended_at: null, collected_at: null,
  measurements: { compute_seconds: { value, evidence: value === null ? "unknown" : "observed", method: "provider response", source_refs: refs, count_basis: "consumed", aggregation: "delta", scope: "event" } },
  dimensions: { actual_model: fact("model;a<script>") },
});

test("upstream usage flamegraphs show measured values and escape labels; execution uses only recorded ancestry", () => {
  const report = createUsageReport(bundle());
  const profile = createUsageProfile(report, { meter_id: "compute_seconds", group_by: ["execution"] });
  assert.deepEqual(profile.samples.find(sample => sample.observation_id === "b")!.stack.map(frame => frame.id), ["usage", "observation:a", "observation:b"]);
  const svg = renderUsageSvg(createUsageProfile(report, { meter_id: "compute_seconds", group_by: ["model"] }), 400)!;
  assert.match(svg, /0\.5 seconds/);
  assert.match(svg, /model;a&lt;script&gt;/);
  assert.doesNotMatch(svg, /model;a<script>/);
  assert.match(svg, /function zoom/);
  const forged = structuredClone(profile);
  forged.integer_total = "1";
  assert.throws(() => validateUsageProfile(forged), /total/);
  const contradictory = structuredClone(profile);
  contradictory.unknown_observation_ids.push("a");
  assert.throws(() => validateUsageProfile(contradictory), /coverage/);
  assert.throws(() => validateUsageProfile({ ...profile, currency: "USD" }), /fields/);
});

test("profile export preserves large exact usage and explicitly refuses lossy renderer ranges", () => {
  const source = bundle();
  source.observations = [observation("large", "9223372036854775808")];
  const profile = createUsageProfile(createUsageReport(source), { meter_id: "compute_seconds" });
  assert.equal(profile.total, "9223372036854775808");
  assert.throws(() => exportUsagePprof(profile), /int64/);
  assert.throws(() => renderUsageSvg(profile), /exact SVG/);
  source.observations = [observation("zero", "0"), observation("unknown", null)];
  const empty = createUsageProfile(createUsageReport(source), { meter_id: "compute_seconds" });
  assert.equal(renderUsageSvg(empty), null);
  assert.deepEqual(empty.unknown_observation_ids, ["unknown"]);
});
const bundle = (): UsageBundle => ({ schema_version: "0.4.0", dataset_id: "demo", sources: [{ id: "source", harness: "fixture", format: "usage", coverage: "partial" }],
  meters: [{ id: "compute_seconds", unit: "seconds", description: "Measured compute", subset_of: null, overlap: "disjoint" }],
  observations: [observation("a", "0.125"), observation("b", "0.375", "a"), observation("unknown", null)],
});

test("usage profiles preserve decimal quantities and unknown coverage without any valuation", () => {
  const profile = createUsageProfile(createUsageReport(bundle()), { meter_id: "compute_seconds", group_by: ["model"] });
  assert.equal(profile.total, "0.5");
  assert.equal(profile.integer_total, "500");
  assert.equal(profile.decimal_places, 3);
  assert.deepEqual(profile.unknown_observation_ids, ["unknown"]);
  assert.equal(profile.samples.length, 2);
  const folded = exportUsageFolded(profile);
  assert.match(folded, / 125\n/);
  assert.match(folded, / 375\n/);
  assert.doesNotMatch(folded, /model;a<script>/);
  const type = protobuf.parse(readFileSync(new URL("../vendor/pprof/profile.proto", import.meta.url), "utf8")).root.lookupType("perftools.profiles.Profile");
  const decoded = type.toObject(type.decode(gunzipSync(exportUsagePprof(profile))), { longs: String }) as { sample: Array<{ value: string[] }>; stringTable: string[] };
  assert.deepEqual(decoded.sample.map(row => row.value[0]).sort(), ["125", "375"]);
  assert.ok(decoded.stringTable.includes("0.001 seconds"));
});

test('default usage profiles start with tasks and operations; model grouping remains explicit', () => {
  const report = createUsageReport(bundle());
  const profile = createUsageProfile(report, { meter_id: 'compute_seconds' });
  assert.deepEqual(profile.group_by, ['task', 'operation']);
  assert.equal(profile.samples[0].stack[1].label, 'task');
  assert.equal(profile.samples[0].stack[2].label, 'a');
  assert.deepEqual(createUsageProfile(report, { meter_id: 'compute_seconds', group_by: ['model'] }).group_by, ['model']);
});

test('task profiles distinguish a literal missing-label task from unassigned work', () => {
  const source = bundle();
  source.observations = [
    { ...observation('assigned', '1'), task_id: 'Task unassigned' },
    { ...observation('missing', '2'), task_id: null, work_item_id: null },
  ];
  const profile = createUsageProfile(createUsageReport(source), { meter_id: 'compute_seconds', group_by: ['task', 'operation'] });
  assert.notEqual(profile.samples[0].stack[1].id, profile.samples[1].stack[1].id);
  assert.equal(profileTree(profile).children.size, 2);
});

test('interactive task widths conserve exact quantities and zoom preserves observation identity', () => {
  const source = bundle();
  source.observations = [
    { ...observation('first', '9007199254740993'), task_id: 'First task' },
    { ...observation('second', '9007199254740993'), task_id: 'Second task' },
    { ...observation('empty', '0'), task_id: 'No recorded usage' },
    { ...observation('unknown', null), task_id: 'Unknown usage' },
  ];
  const profile = createUsageProfile(createUsageReport(source), { meter_id: 'compute_seconds', group_by: ['task', 'operation'] });
  const tree = profileTree(profile);
  assert.equal(tree.value, 18014398509481986n);
  assert.equal(tree.children.size, 2);
  assert.deepEqual(profileBars(tree).filter(bar => bar.depth === 1).map(bar => bar.width), [50, 50]);
  const leaf = profileBars(tree).find(bar => bar.node.observationIds.includes('second'))!.node;
  assert.equal(findProfileNode(tree, leaf.key), leaf);
  assert.equal(profileBars(leaf)[0].width, 100);
  assert.deepEqual(leaf.observationIds, ['second']);
  assert.equal(findProfileNode(tree, 'missing'), null);
});

test('ID groupings keep literal unassigned labels separate from missing identifiers', () => {
  for (const grouping of ['operation', 'agent', 'session', 'work_item'] as const) {
    const field = `${grouping}_id` as const;
    const source = bundle();
    source.observations = [
      { ...observation('assigned', '1'), [field]: `${grouping} unassigned` },
      { ...observation('missing', '2'), [field]: null },
    ];
    const profile = createUsageProfile(createUsageReport(source), { meter_id: 'compute_seconds', group_by: ['task', grouping] });
    assert.notEqual(profile.samples[0].stack[2].id, profile.samples[1].stack[2].id, grouping);
  }
});

test('tiny task remains addressable for selector zoom when its bar is hidden', () => {
  const source = bundle();
  source.observations = [
    { ...observation('large', '9999'), task_id: 'Large task' },
    { ...observation('tiny', '1'), task_id: 'Tiny task' },
  ];
  const tree = profileTree(createUsageProfile(createUsageReport(source), { meter_id: 'compute_seconds', group_by: ['task', 'operation'] }));
  const tiny = [...tree.children.values()].find(node => node.label === 'Tiny task')!;
  assert.ok(tiny);
  assert.equal(profileBars(tree).some(bar => bar.node === tiny), false);
  assert.equal(findProfileNode(tree, tiny.key), tiny);
  assert.equal(profileBars(tiny)[0].width, 100);
  assert.equal(profileBars(tiny).at(-1)!.node.observationIds[0], 'tiny');
});
