import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });

test("a native log can be assigned an arbitrary work string and grouped by ticket", async () => {
  const directory = await mkdtemp(join(tmpdir(), "usage-work-label-"));
  try {
    const usage = join(directory, "usage.json"), report = join(directory, "report.json"), work = "PROJ-142 / customer cache fix";
    const imported = cli("import", "--format", "codex", "--input", "test/fixtures/usage-codex.jsonl", "--dataset-id", "repo-1", "--work-item", work, "--out", usage);
    assert.equal(imported.status, 0, imported.stderr);
    const recorded = JSON.parse(await readFile(usage, "utf8"));
    assert.ok(recorded.observations.length > 0);
    assert.ok(recorded.observations.every((row: { work_item_id: string }) => row.work_item_id === work));
    const grouped = cli("report", "--input", usage, "--group-by", "work_item", "--out", report);
    assert.equal(grouped.status, 0, grouped.stderr);
    assert.equal(JSON.parse(await readFile(report, "utf8")).groups[0].dimensions.work_item, work);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the default CLI reports and exports recorded usage without any pricing input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "usage-cli-"));
  try {
    const usage = join(directory, "usage.json"), report = join(directory, "report.json"), output = join(directory, "profiles");
    const imported = cli("import", "--format", "operations", "--input", "examples/dogfood/v03/files-operations.json", "--out", usage);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(cli("report", "--input", usage, "--out", report).status, 0);
    const rendered = cli("export", "--input", report, "--meter", "operation_count", "--group-by", "execution", "--out-dir", output, "--svg", "true");
    assert.equal(rendered.status, 0, rendered.stderr);
    const profile = JSON.parse(await readFile(join(output, "profile.json"), "utf8"));
    assert.equal(profile.total, "5130");
    assert.equal(Object.hasOwn(profile, "currency"), false);
    assert.equal(cli("validate", "--kind", "usage", "--input", usage).status, 0);
    assert.equal(cli("export", "--input", report, "--meter", "operation_count", "--out-dir", directory).status, 1, "report.json is protected from export overwrite");
    assert.match(cli("value", "--input", usage).stderr, /flaimegraph-pricing/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
