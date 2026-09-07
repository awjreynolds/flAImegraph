import test from "node:test";
import assert from "node:assert/strict";
import { createUsageProfile, validateUsageProfile } from "../src/usage-profile.js";
import { exportUsageFolded, exportUsagePprof, renderUsageSvg } from "../src/usage-export.js";
import { createUsageReport } from "../src/usage.js";
import type { UsageBundle, UsageObservation } from "../src/usage-types.js";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import protobuf from "protobufjs";

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
