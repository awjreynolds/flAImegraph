import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureNative } from "../src/native-capture.js";
import { validateUsageBundle } from "../src/usage.js";

const receipt = { type: "message_end", message: { role: "assistant", provider: "ollama", model: "test", responseId: "response-one", content: [{ type: "text", text: "PRIVATE_PROMPT" }], usage: { input: 12, output: 3, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop" } };

test("capture preserves settled usage on child failure and reports a truncated tail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-capture-"));
  try {
    const out = join(directory, "usage.json");
    const source = `process.stdout.write(${JSON.stringify(JSON.stringify(receipt) + '\n{broken')}); process.exitCode=7;`;
    const code = await captureNative({ format: "pi", dataset_id: "test", out, command: [process.execPath, "-e", source] });
    assert.equal(code, 7);
    const text = await readFile(out, "utf8");
    const bundle = validateUsageBundle(JSON.parse(text));
    assert.equal(bundle.observations[0]!.measurements.output_tokens!.value, "3");
    assert.equal(bundle.coverage!.dropped_observations, 1);
    assert.equal(bundle.coverage!.complete, false);
    assert.ok(bundle.issues!.some(issue => issue.code === "CAPTURE_CHILD_FAILED"));
    assert.equal(text.includes("PRIVATE_PROMPT"), false);
    assert.equal(text.includes("broken"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("capture saves metadata before the child exits and refuses existing output paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-capture-"));
  try {
    const out = join(directory, "usage.json");
    const source = `process.stdout.write(${JSON.stringify(JSON.stringify(receipt) + '\n')}); setTimeout(()=>{},1500);`;
    const done = captureNative({ format: "pi", dataset_id: "test", out, command: [process.execPath, "-e", source] });
    let snapshot: ReturnType<typeof validateUsageBundle> | undefined;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      try { snapshot = validateUsageBundle(JSON.parse(await readFile(out, "utf8"))); } catch { continue; }
      if (snapshot.observations.length) break;
    }
    assert.equal(snapshot?.observations.length, 1);
    assert.ok(snapshot?.issues?.some(issue => issue.code === "CAPTURE_RUNNING"));
    assert.equal(await done, 0);
    const saved = await readFile(out, "utf8");
    await assert.rejects(captureNative({ format: "pi", dataset_id: "test", out, command: [process.execPath, "-e", "process.exit(0)"] }), { code: "EEXIST" });
    assert.equal(await readFile(out, "utf8"), saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("spawn and encoding failures preserve a visible failed capture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-capture-"));
  try {
    for (const [name, command] of [["spawn", [join(directory, "missing-executable")]], ["encoding", [process.execPath, "-e", "process.stdout.write(Buffer.from([255,10]));"]]] as const) {
      const out = join(directory, `${name}.json`);
      await assert.rejects(captureNative({ format: "pi", dataset_id: "test", out, command: [...command] }));
      const bundle = validateUsageBundle(JSON.parse(await readFile(out, "utf8")));
      assert.ok(bundle.issues!.some(issue => issue.code === "CAPTURE_FAILED"));
      assert.equal(bundle.coverage!.complete, false);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
