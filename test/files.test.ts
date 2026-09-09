import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInputText } from "../src/files.js";

test("CLI input bounds count UTF-8 bytes, accept the exact limit and reject invalid encoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "logging-input-"));
  try {
    const path = join(directory, "input.jsonl");
    await writeFile(path, "£x");
    assert.equal(await readInputText(path, 3), "£x");
    await assert.rejects(readInputText(path, 2), { code: "INPUT_BOUNDS" });
    await writeFile(path, Buffer.from([0xff]));
    await assert.rejects(readInputText(path, 3), /encoded data/);
    await assert.rejects(readInputText(directory), /regular file|directory/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
