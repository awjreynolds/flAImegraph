import { readFile, writeFile } from "node:fs/promises";
import { getLoggingSchema, LOGGING_SCHEMA_KINDS } from "../../src/logging-schema.js";

for (const kind of LOGGING_SCHEMA_KINDS) {
  const version = kind === "usage" ? "0.4" : "0.5";
  const path = new URL(`../../spec/${version}/${kind}.schema.json`, import.meta.url);
  const content = JSON.stringify(getLoggingSchema(kind), null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8") !== content) throw new Error(`Generated schema differs: ${path.pathname}`);
  } else await writeFile(path, content);
}
