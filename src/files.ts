import { mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_INPUT_BYTES = 64 * 1024 * 1024;

/** Bound CLI memory use even if a native transcript grows while being read. */
export async function readInputText(file: string, maxBytes = DEFAULT_INPUT_BYTES): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid input byte limit");
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Input must be a regular file");
    const bounds = () => Object.assign(new Error(`Input exceeds ${maxBytes} bytes; split the capture before importing`), { code: "INPUT_BOUNDS" });
    if (stat.size > maxBytes) throw bounds();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - size + 1));
      const { bytesRead } = await handle.read(buffer);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maxBytes) throw bounds();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally { await handle.close(); }
}

async function canonical(file: string): Promise<string> {
  try { return await realpath(file); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return resolve(file);
    throw error;
  }
}

export async function protectInputs(outputs: string[], inputs: string[]): Promise<void> {
  const sourcePaths = new Set(await Promise.all(inputs.map(canonical)));
  for (const output of outputs) {
    if (sourcePaths.has(await canonical(output))) {
      throw Object.assign(new Error("Output must differ from every source input, including symbolic links"), { code: "INPUT_OVERWRITE" });
    }
  }
}

/** Replace the output directory entry atomically, without following an existing output symlink. */
export async function writeArtifact(file: string, content: string | Uint8Array): Promise<void> {
  const directory = dirname(resolve(file));
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.flaimegraph-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
