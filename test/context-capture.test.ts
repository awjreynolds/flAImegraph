import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessProfile } from "../src/context-capture.js";

test("a harness profile preserves declared model settings without inventing effective context policies", () => {
  const profile = createHarnessProfile({ harness: "codex", harness_version: "0.153.4", model: "example-model", provider: "example-provider" });
  assert.deepEqual(profile.harness_version, { value: "0.153.4", evidence: "declared", source_refs: [] });
  assert.deepEqual(profile.model.name, { value: "example-model", evidence: "declared", source_refs: [] });
  assert.deepEqual(profile.policies.compaction, { value: null, evidence: "unknown", source_refs: [] });
  assert.ok(profile.context_capabilities.some(item => item.origin === "skill" && item.capture === "unknown"));
  assert.ok(profile.context_capabilities.some(item => item.origin === "output_schema"));
  assert.equal(profile.id, createHarnessProfile({ provider: "example-provider", model: "example-model", harness_version: "0.153.4", harness: "codex" }).id);
});
