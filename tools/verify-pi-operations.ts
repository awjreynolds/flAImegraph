import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { OperationRecorder } from "../src/operation-recorder.js";
import { createPiOperationBridge, type PiToolLike } from "../src/pi-operations.js";
import { validateOperationBundle } from "../src/operations.js";

type PiModule = {
  VERSION?: string;
  createReadTool: (cwd: string, options?: { autoResizeImages?: boolean; operations?: unknown }) => PiToolLike;
  createEditTool: (cwd: string, options?: { operations?: unknown }) => PiToolLike;
  createWriteTool: (cwd: string, options?: { operations?: unknown }) => PiToolLike;
  createLsTool: (cwd: string, options?: { operations?: unknown }) => PiToolLike;
};

type ToolResult = {
  content?: unknown;
  details?: unknown;
};

function usage(): never {
  throw new Error("Usage: node --import tsx tools/verify-pi-operations.ts --pi-module /absolute/path/to/dist/index.js [--output /path/to/metadata.json]");
}

function argument(name: string, args: string[]): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) usage();
  return value;
}

function moduleUrl(value: string): string {
  if (value.startsWith("file:")) return value;
  if (!isAbsolute(value)) throw new Error("--pi-module must be an absolute filesystem path or file URL");
  return pathToFileURL(value).href;
}

function asPiModule(value: Record<string, unknown>): PiModule {
  const names = ["createReadTool", "createEditTool", "createWriteTool", "createLsTool"];
  for (const name of names) if (typeof value[name] !== "function") throw new Error(`Pi module does not export ${name}`);
  return value as unknown as PiModule;
}

function toolExecute(tool: PiToolLike, args: unknown): Promise<ToolResult> {
  return tool.execute("pi-operation-verification", args, new AbortController().signal, () => undefined) as Promise<ToolResult>;
}

function normalizedJson(value: unknown, root: string): string {
  return JSON.stringify(value).replaceAll(root, "<fixture>");
}

async function assertEquivalent(control: PiToolLike, bridged: PiToolLike, args: unknown, root: string): Promise<ToolResult> {
  const expected = await toolExecute(control, args);
  const actual = await toolExecute(bridged, args);
  assert.equal(normalizedJson(actual, root), normalizedJson(expected, root));
  return actual;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const piPath = argument("--pi-module", args);
  if (piPath === undefined) usage();
  const outputPath = argument("--output", args);
  const pi = asPiModule((await import(moduleUrl(piPath!))) as Record<string, unknown>);
  const root = await mkdtemp(join(tmpdir(), "flaimegraph-pi-live-verification-"));
  const controlRoot = join(root, "control");
  const bridgeRoot = join(root, "bridge");
  await fsWriteFile(join(root, "placeholder"), "fixture");
  await mkdir(join(controlRoot, "nested"), { recursive: true });
  await mkdir(join(bridgeRoot, "nested"), { recursive: true });
  const source = "private Pi source\nsecond line\n";
  const image = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc33000000000049454e44ae426082", "hex");
  const truncatedPng = image.subarray(0, 8);
  const apng = Buffer.from("89504e470d0a1a0a0000000d494844520000000000000000000000000000000000000000086163544c000000000000000000000000", "hex");
  for (const fixture of [controlRoot, bridgeRoot]) {
    await fsWriteFile(join(fixture, "source.txt"), source, "utf8");
    await fsWriteFile(join(fixture, "image.png"), image);
    await fsWriteFile(join(fixture, "extensionless-image"), image);
    await fsWriteFile(join(fixture, "misleading.png"), "private text with a misleading suffix\n", "utf8");
    await fsWriteFile(join(fixture, "truncated.png"), truncatedPng);
    await fsWriteFile(join(fixture, "animated.png"), apng);
    await fsWriteFile(join(fixture, "edit.txt"), "old text\n", "utf8");
    await fsWriteFile(join(fixture, "nested", "entry.txt"), "entry\n", "utf8");
  }

  try {
    const recorder = new OperationRecorder({ dataset_id: "pi-live-verification", namespace: "pi-live-verification", resource_key: "verification-resource-key" });
    const bridge = createPiOperationBridge(recorder, { resource_key: "verification-resource-key" });
    const readControl = pi.createReadTool(controlRoot, { autoResizeImages: false });
    const readBridged = bridge.wrapTool(pi.createReadTool(bridgeRoot, { autoResizeImages: false, operations: bridge.readOperations }));
    const editControl = pi.createEditTool(controlRoot);
    const editBridged = bridge.wrapTool(pi.createEditTool(bridgeRoot, { operations: bridge.editOperations }));
    const writeControl = pi.createWriteTool(controlRoot);
    const writeBridged = bridge.wrapTool(pi.createWriteTool(bridgeRoot, { operations: bridge.writeOperations }));
    const lsControl = pi.createLsTool(controlRoot);
    const lsBridged = bridge.wrapTool(pi.createLsTool(bridgeRoot, { operations: bridge.lsOperations }));

    const readResult = await assertEquivalent(readControl, readBridged, { path: "source.txt", offset: 2, limit: 1 }, bridgeRoot);
    assert.match((readResult.content as Array<{ type?: string; text?: string }>)[0]?.text ?? "", /^second line\n\n\[1 more lines/);
    const imageResult = await assertEquivalent(readControl, readBridged, { path: "image.png" }, bridgeRoot);
    const imageBlock = (imageResult.content as Array<{ type?: string; data?: string }>).find((block) => block.type === "image");
    assert.equal(imageBlock?.data, image.toString("base64"));
    const extensionlessResult = await assertEquivalent(readControl, readBridged, { path: "extensionless-image" }, bridgeRoot);
    const extensionlessImageBlock = (extensionlessResult.content as Array<{ type?: string; data?: string }>).find((block) => block.type === "image");
    assert.equal(extensionlessImageBlock?.data, image.toString("base64"));
    const misleadingResult = await assertEquivalent(readControl, readBridged, { path: "misleading.png" }, bridgeRoot);
    assert.deepEqual(misleadingResult.content, [{ type: "text", text: "private text with a misleading suffix\n" }]);
    const truncatedResult = await assertEquivalent(readControl, readBridged, { path: "truncated.png" }, bridgeRoot);
    assert.equal((truncatedResult.content as Array<{ type?: string }>).some((block) => block.type === "image"), false);
    const apngResult = await assertEquivalent(readControl, readBridged, { path: "animated.png" }, bridgeRoot);
    assert.equal((apngResult.content as Array<{ type?: string }>).some((block) => block.type === "image"), false);

    const writeResult = await assertEquivalent(writeControl, writeBridged, { path: "written.txt", content: "written private payload" }, bridgeRoot);
    assert.equal(Array.isArray(writeResult.content), true);
    assert.equal(await fsReadFile(join(bridgeRoot, "written.txt"), "utf8"), "written private payload");

    const editResult = await assertEquivalent(editControl, editBridged, {
      path: "edit.txt",
      edits: [{ oldText: "old text", newText: "newer text" }],
    }, bridgeRoot);
    assert.equal(Array.isArray(editResult.content), true);
    assert.equal(await fsReadFile(join(bridgeRoot, "edit.txt"), "utf8"), "newer text\n");

    const lsResult = await assertEquivalent(lsControl, lsBridged, { path: "." }, bridgeRoot);
    assert.match(JSON.stringify(lsResult), /edit\.txt/);

    const missing = "missing-private.txt";
    let bridgeError: unknown;
    let controlError: unknown;
    try { await toolExecute(readBridged, { path: missing }); }
    catch (error) { bridgeError = error; }
    try { await toolExecute(readControl, { path: missing }); }
    catch (error) { controlError = error; }
    assert.ok(bridgeError instanceof Error);
    assert.ok(controlError instanceof Error);
    assert.equal(normalizedJson({ name: (bridgeError as Error).name, message: (bridgeError as Error).message }, bridgeRoot), normalizedJson({ name: (controlError as Error).name, message: (controlError as Error).message }, controlRoot));

    const bundle = bridge.snapshot();
    validateOperationBundle(bundle);
    const children = bundle.spans.filter((span) => span.parent_id !== null);
    assert.ok(children.some((span) => span.kind === "file_read" && span.io?.read_bytes === String(Buffer.byteLength(source))));
    assert.ok(children.some((span) => span.kind === "file_write" && span.io?.inserted_bytes !== null && span.io?.deleted_bytes !== null));
    assert.ok(children.some((span) => span.kind === "directory_read" && span.io?.entry_count !== null));
    assert.ok(bundle.spans.some((span) => span.label === "read" && span.status === "error"));
    assert.ok(bundle.spans.some((span) => span.io?.requested_range?.start_line === 2 && span.io.requested_range.end_line === 2));
    assert.ok(bundle.spans.filter((span) => span.kind === "file_read").every((span) => span.io?.resource_id.startsWith("hmac-sha256:") === true));
    assert.equal(JSON.stringify(bundle).includes(root), false);
    assert.equal(JSON.stringify(bundle).includes("private Pi source"), false);
    assert.equal(JSON.stringify(bundle).includes("written private payload"), false);
    assert.equal(JSON.stringify(bundle).includes("private text with a misleading suffix"), false);
    assert.equal(JSON.stringify(bundle).includes("missing-private.txt"), false);
    assert.equal(bundle.coverage.complete, false);
    assert.ok(bundle.coverage.limitations.some((item) => item.includes("Pi image MIME detection probes")));

    if (outputPath !== undefined) {
      const output = resolve(outputPath);
      const serialized = JSON.stringify(bundle, null, 2);
      if (serialized.includes(root) || serialized.includes(source) || serialized.includes("written private payload")) throw new Error("refusing to write unsanitized verification output");
      await mkdir(dirname(output), { recursive: true });
      await fsWriteFile(output, `${serialized}\n`, "utf8");
      console.log(`wrote sanitized metadata: ${output}`);
    }
    console.log(JSON.stringify({
      ok: true,
      pi_module: basename(piPath!),
      pi_version: pi.VERSION ?? "unknown",
      spans: bundle.spans.length,
      nested_spans: children.length,
      read_bytes: children.find((span) => span.kind === "file_read" && span.io?.read_bytes !== null)?.io?.read_bytes ?? null,
      edit: {
        inserted_bytes: children.find((span) => span.kind === "file_write" && span.io?.inserted_bytes !== null)?.io?.inserted_bytes ?? null,
        deleted_bytes: children.find((span) => span.kind === "file_write" && span.io?.deleted_bytes !== null)?.io?.deleted_bytes ?? null,
      },
      failed_read: bundle.spans.some((span) => span.label === "read" && span.status === "error"),
      privacy: "passed",
      result_equivalence: "passed",
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
