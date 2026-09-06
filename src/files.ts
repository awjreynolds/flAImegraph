import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

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
