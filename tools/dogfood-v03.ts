/** Controlled real-I/O workload. It intentionally makes no model or network calls. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { OperationRecorder, type OperationRunSpec } from "../src/operation-recorder.js";
import { createOperationReport, reconcileOperationBundles, validateOperationReport } from "../src/operations.js";
import { exportOperationFolded, exportOperationPprof, exportOperationTrace, renderOperationSvg } from "../src/operation-export.js";
import { valueEvidence } from "../src/core.js";
import type { EvidenceBundle } from "../src/types.js";

const execute = promisify(execFile);
const output = resolve(process.argv[2] ?? "examples/dogfood/v03");
const scratch = await mkdtemp(join(tmpdir(), "flaimegraph-operation-work-"));
const corpus = join(scratch, "corpus");
const FILES = 5_000, SHARDS = 10, BATCH = 50;
interface WorkIO {
  run<T>(spec: OperationRunSpec, callback: () => T | PromiseLike<T>): Promise<T>;
  readFile(path: string, options?: { label: string }): Promise<string>;
  readDirectory(path: string, options?: { label: string }): Promise<string[]>;
}
const baseline: WorkIO = {
  run: async (_spec, callback) => callback(),
  readFile: path => readFile(path, "utf8"), readDirectory: path => readdir(path),
};
const call = (label: string): OperationRunSpec => ({ kind: "tool", label, classification: { evidence: "declared", method: "named workload function boundary" } });
async function readBatch(io: WorkIO, directory: string, names: string[]): Promise<number> {
  return io.run(call("readBatch"), async () => {
    const contents = await Promise.all(names.map(name => io.readFile(join(directory, name), { label: name })));
    assert.equal(contents.length, names.length);
    return contents.length;
  });
}
async function scanShard(io: WorkIO, name: string): Promise<number> {
  return io.run(call(`scanShard ${name}`), async () => {
    const directory = join(corpus, name);
    const files = (await io.readDirectory(directory, { label: name })).sort();
    let count = 0;
    for (let offset = 0; offset < files.length; offset += BATCH) count += await readBatch(io, directory, files.slice(offset, offset + BATCH));
    return count;
  });
}
async function indexRepository(io: WorkIO): Promise<number> {
  return io.run(call("indexRepository"), async () => {
    const shards = (await io.readDirectory(corpus, { label: "generated corpus" })).sort();
    let count = 0;
    for (const shard of shards) count += await scanShard(io, shard);
    return count;
  });
}
async function scan(io: WorkIO): Promise<number> {
  return io.run({ kind: "work", label: "Index generated repository" }, () =>
    io.run({ kind: "agent", label: "Filesystem worker", agent_id: "filesystem-worker" }, () =>
      io.run({ kind: "phase", label: "Fact finding", classification: { evidence: "declared", method: "workload author phase annotation" } }, () => indexRepository(io))));
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const save = async (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n");

try {
  await mkdir(corpus, { recursive: true });
  for (let shard = 0; shard < SHARDS; shard++) {
    const directory = join(corpus, `shard-${String(shard).padStart(2, "0")}`);
    await mkdir(directory);
    for (let batch = 0; batch < FILES / SHARDS; batch += BATCH) await Promise.all(Array.from({ length: BATCH }, (_, offset) => {
      const index = shard * (FILES / SHARDS) + batch + offset;
      const content = `export const value = ${index};\n` + Array.from({ length: 12 + index % 30 }, (_, line) => `// fixture ${index}, line ${line}\n`).join("");
      return writeFile(join(directory, `file-${String(index).padStart(4, "0")}.ts`), content);
    }));
  }
  assert.equal(await scan(baseline), FILES); // Warm up the same directory/cache path.
  const baselineMs: number[] = [], recordedMs: number[] = [];
  let recorder: OperationRecorder | undefined;
  for (let round = 0; round < 3; round++) {
    // Alternate order after warm-up to reduce a simple first-run cache bias.
    const tasks = round % 2 ? ["recorded", "baseline"] : ["baseline", "recorded"];
    for (const task of tasks) {
      if (task === "baseline") {
        const started = performance.now(); assert.equal(await scan(baseline), FILES); baselineMs.push(performance.now() - started);
      } else {
        recorder = new OperationRecorder({ dataset_id: "operation-depth-files", namespace: "controlled-file-work", max_spans: 10_000, resource_key: "public-generated-corpus-only" });
        const started = performance.now(); assert.equal(await scan(recorder), FILES); recordedMs.push(performance.now() - started);
      }
    }
  }
  assert.ok(recorder);
  const target = join(corpus, "shard-00", "file-0000.ts");
  // The scan has ended. Editing and testing are later root scopes, not children of completed reads.
  await recorder.run({ kind: "phase", label: "Edit and verify", classification: { evidence: "declared", method: "workload author phase annotation" } }, async () => {
    const contents = await recorder!.readFile(target, { label: "file-0000.ts (before edit)" });
    assert.ok(contents.startsWith("export const value = 0;"));
    await recorder!.writeFile(target, contents.replace("export const value = 0;", "export const value = 42;"), { label: "file-0000.ts (write)" });
    const testFile = join(scratch, "acceptance.test.mjs");
    await writeFile(testFile, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFile,readdir} from 'node:fs/promises';\nimport {join} from 'node:path';\ntest('edited corpus retains its shard and requested change',async()=>{const dir=join(import.meta.dirname,'corpus','shard-00');assert.equal((await readdir(dir)).length,500);assert.match(await readFile(join(dir,'file-0000.ts'),'utf8'),/^export const value = 42;/);});\n`);
    await recorder!.run({ kind: "test", label: "Corpus acceptance test", classification: { evidence: "declared", method: "explicit test invocation" } }, () =>
      recorder!.run({ kind: "command", label: "node --test", classification: { evidence: "observed", method: "workload child process invocation" } }, async () => {
        const result = await execute(process.execPath, ["--test", testFile]);
        assert.match(result.stdout, /tests 1/); assert.match(result.stdout, /pass 1/);
      }));
  });
  const bundle = recorder.snapshot();
  bundle.coverage.complete = false;
  bundle.coverage.limitations.push("Controlled benchmark on 5,000 generated source files, with 5,001 read attempts including the pre-edit read. This is real filesystem work, not a production repository capture.", "Fixture creation and benchmark comparison rounds are outside this retained capture. Only the final scan and subsequent edit/test are retained.", "Subprocess test internals are opaque; the outer test invocation is captured. No model requests or context insertion occur in this workload.", "Phase labels are declared by the workload author. Nested indexRepository, scanShard and readBatch spans wrap actual invoked functions.");
  assert.equal(bundle.spans.filter(span => span.kind === "file_read").length, 5_001);
  assert.equal(bundle.spans.filter(span => span.kind === "directory_read").length, 11);
  assert.equal(bundle.spans.filter(span => span.kind === "file_write").length, 1);
  assert.equal(bundle.coverage.dropped_spans, 0);
  const evidence: EvidenceBundle = { schema_version: "0.1.0", dataset_id: bundle.dataset_id, sources: [{ id: "no-model-workload", harness: "flaimegraph", format: "controlled-workload", coverage: "complete", description: "The controlled workload invokes filesystem operations and one local test process. It has no model client or network call." }], observations: [], relationships: [], issues: [] };
  const valuation = valueEvidence(evidence, { mode: "recorded", currency: "USD" });
  const report = createOperationReport(bundle, evidence, valuation);
  assert.equal(report.summary.max_depth, 7);
  assert.deepEqual(validateOperationReport(report), report);
  assert.equal(reconcileOperationBundles([bundle, bundle]).spans.length, bundle.spans.length);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(scratch));
  assert.ok(!serialized.includes("export const value"));
  await mkdir(output, { recursive: true });
  await save("files-operations.json", bundle); await save("files-evidence.json", evidence); await save("files-valuation.json", valuation); await save("files-report.json", report);
  await save("files-trace.json", exportOperationTrace(report));
  await writeFile(join(output, "files-operations.folded"), exportOperationFolded(report, { projection: "execution", measure: "operations" }));
  await writeFile(join(output, "files-operations.pprof"), exportOperationPprof(report, { projection: "execution", measure: "operations" }));
  await writeFile(join(output, "files-operations.svg"), renderOperationSvg(report, { projection: "execution", measure: "operations" })!);
  const benchmark = { schema_version: "0.3.0", recorded_at: new Date().toISOString(), files: FILES, batch_size: BATCH, rounds: 3,
    baseline_ms: baselineMs, recorded_ms: recordedMs, median_baseline_ms: median(baselineMs), median_recorded_ms: median(recordedMs),
    median_delta_ms: median(recordedMs) - median(baselineMs), profiler_model_calls: 0, retained_spans: bundle.spans.length, max_depth: report.summary.max_depth, dropped_spans: bundle.coverage.dropped_spans,
    method: "Same functions, files, UTF-8 results, batching and warm cache; alternate baseline/recorded order. Timed scan excludes fixture creation, recorder construction, later edit/test, snapshot serialization, validation and export. Local wall time is environment-dependent; these are measurements, not a performance guarantee.",
    outcome: "5,000 distinct files read; an actual edit and a passing node:test subprocess followed; exact report validation and replay passed." };
  await save("files-benchmark.json", benchmark);
  process.stdout.write(JSON.stringify(benchmark, null, 2) + "\n");
} finally { await rm(scratch, { recursive: true, force: true }); }
