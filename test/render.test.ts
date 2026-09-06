import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderProfile } from "../src/render.js";
import type { CostProfile } from "../src/types.js";

test("caller-supplied frame text cannot inject nameattr links or event handlers into SVG", async () => {
  const profile: CostProfile = {
    schema_version: "0.1.0", id: "external-profile", dataset_id: "test", valuation_id: "test-value",
    currency: "USD", unit: "nanoUSD", basis: "model_price_estimate", group_by: [], cost_view: "charges",
    total_nanos: "2", complete: true, issues: [], excluded_observation_ids: [], assumptions: [],
    samples: [
      { observation_id: "a", value_nanos: "1", stack: [{ id: "victim", name: "victim", kind: "root" }] },
      { observation_id: "b", value_nanos: "1", stack: [{ id: "hostile", name: "mal\nvictim_[1]\thref=javascript:alert(1)\ttitle=Injected\tg_extra=onclick=alert(1)\ta_extra=onload=alert(1)", kind: "root" }] },
    ],
  };
  const directory = await mkdtemp(join(tmpdir(), "flaimegraph-svg-"));
  try {
    await renderProfile(profile, directory);
    const svg = await readFile(join(directory, "cost.svg"), "utf8");
    assert.doesNotMatch(svg, /<a\s+xlink:href=/);
    assert.doesNotMatch(svg, /<g[^>]+onclick=/);
    const attributes = await readFile(join(directory, "render.nameattr"), "utf8");
    assert.equal(attributes.trim().split("\n").length, 3);
    assert.ok(attributes.trimEnd().split("\n").every(line => line.split("\t").length === 2));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("replaying the same cost profile reproduces the SVG bytes", async () => {
  const profile: CostProfile = {
    schema_version: "0.1.0", id: "deterministic", dataset_id: "test", valuation_id: "test-value",
    currency: "USD", unit: "nanoUSD", basis: "model_price_estimate", group_by: [], cost_view: "charges",
    total_nanos: "7", complete: true, issues: [], excluded_observation_ids: [], assumptions: [],
    samples: [{ observation_id: "a", value_nanos: "7", stack: [{ id: "root", name: "root", kind: "root" }] }],
  };
  const directory = await mkdtemp(join(tmpdir(), "flaimegraph-replay-"));
  try {
    await renderProfile(profile, join(directory, "a"));
    await renderProfile(profile, join(directory, "b"));
    const first = await readFile(join(directory, "a/cost.svg"), "utf8");
    const second = await readFile(join(directory, "b/cost.svg"), "utf8");
    assert.ok(first === second, "renderer must not choose random colors on replay");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
