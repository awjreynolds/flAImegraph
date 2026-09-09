import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_INPUT_BYTES, writeArtifact } from "./files.js";
import { importUsage, type UsageImportOptions } from "./usage-import.js";
import { validateUsageBundle } from "./usage.js";
import type { UsageBundle } from "./usage-types.js";

export interface NativeCaptureOptions {
  format: "pi" | "claude" | "codex-exec";
  dataset_id: string;
  out: string;
  command: string[];
  work_item_id?: string;
}

/** Snapshot structured stdout locally; source content is never written to disk. */
export async function captureNative(options: NativeCaptureOptions): Promise<number> {
  if (!options.command.length || !options.command[0]) throw new Error("Capture requires a command after --");
  if (!["pi", "claude", "codex-exec"].includes(options.format)) throw new Error("Capture supports pi, claude and codex-exec structured stdout");
  const sourceId = `capture:${randomUUID()}`;
  const importOptions: UsageImportOptions = { format: options.format, dataset_id: options.dataset_id, source_id: sourceId, work_item_id: options.work_item_id };
  const chunks: Buffer[] = [];
  let size = 0, nextSnapshot = 0;
  let lastBundle: UsageBundle | null = null;
  const snapshot = async (code: string, message: string, final = false) => {
    const bytes = Buffer.concat(chunks, size);
    // A running source can stop mid-UTF8 codepoint or mid-JSON record. Import
    // only complete lines until finalization, when malformed tails are visible.
    const end = final ? bytes.length : bytes.lastIndexOf(10) + 1;
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    const bundle = validateUsageBundle(importUsage(raw, importOptions));
    bundle.coverage!.complete = false;
    bundle.coverage!.limitations.push("Capture output is a replaceable snapshot. Do not merge successive snapshots as independent sources. Atomic snapshots do not promise power-loss durability; use the lifecycle journal SDK for that contract.");
    bundle.issues = [...bundle.issues ?? [], { code, message, severity: code === "CAPTURE_COMPLETED" ? "info" : "warning", source_id: sourceId }];
    await writeArtifact(options.out, JSON.stringify(bundle, null, 2) + "\n");
    lastBundle = bundle;
  };
  // Reserve a new path before launching anything. A capture must never replace
  // an existing transcript, command script or earlier capture.
  await mkdir(dirname(resolve(options.out)), { recursive: true });
  await writeFile(options.out, "", { flag: "wx", mode: 0o600 });
  await snapshot("CAPTURE_RUNNING", "The child has not completed; only captured evidence is available.");
  const child = spawn(options.command[0], options.command.slice(1), { stdio: ["inherit", "pipe", "inherit"], shell: false });
  let interrupted: NodeJS.Signals | null = null;
  const interrupt = (signal: NodeJS.Signals) => { interrupted = signal; child.kill(signal); };
  const onInt = () => interrupt("SIGINT"), onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  // Register error/exit handling before reading to avoid missing a fast exit.
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  // Attach a handler immediately; failure is still rethrown by the awaited path.
  void done.catch(() => {});
  try {
    for await (const chunk of child.stdout!) {
      const bytes = Buffer.from(chunk);
      if (size + bytes.length > DEFAULT_INPUT_BYTES) throw new Error(`Capture exceeds ${DEFAULT_INPUT_BYTES} bytes`);
      chunks.push(bytes); size += bytes.length;
      if (Date.now() >= nextSnapshot) {
        await snapshot("CAPTURE_RUNNING", "The child has not completed; only captured evidence is available.");
        nextSnapshot = Date.now() + 250;
      }
    }
    const result = await done;
    const signal = result.signal ?? interrupted;
    const code = result.code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
    await snapshot(code === 0 ? "CAPTURE_COMPLETED" : "CAPTURE_CHILD_FAILED", code === 0 ? "The child exited successfully; native coverage limitations still apply." : `Child exited with code ${code}${signal ? ` (${signal})` : ""}; retain observed usage without assuming completion.`, true);
    return code;
  } catch (error) {
    child.kill("SIGTERM");
    // Preserve the last valid snapshot. Raw errors can include source content,
    // so the artifact records only the capture failure category.
    try {
      if (lastBundle) {
        const previous: UsageBundle = lastBundle;
        previous.issues = [...previous.issues ?? [], { code: "CAPTURE_FAILED", message: "Capture stopped because reading, importing or persisting evidence failed. The last valid snapshot is retained.", severity: "error", source_id: sourceId }];
        await writeArtifact(options.out, JSON.stringify(previous, null, 2) + "\n");
      }
    } catch { /* Prior atomic snapshot remains intact. */ }
    throw error;
  } finally {
    process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
  }
}
