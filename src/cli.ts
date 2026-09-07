#!/usr/bin/env node
import { runUsageCommand } from "./usage-cli.js";
runUsageCommand(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(JSON.stringify({ code: error && typeof error === "object" && "code" in error ? error.code : "USAGE_ERROR", message: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
});
