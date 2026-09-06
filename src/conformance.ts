import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { valueEvidence } from "./core.js";
import { createCostProfile, exportFolded, exportPprof } from "./profile.js";
import type { EvidenceBundle, ValuationOptions } from "./types.js";

interface Vector {
  id: string;
  evidence: EvidenceBundle;
  options: ValuationOptions;
  expected: { total_nanos?: string; complete?: boolean; amounts?: (string | null)[]; error?: string };
}

/** Runs the published literal accounting vectors against this reference consumer. */
export async function runConformance() {
  const corpus = JSON.parse(await readFile(new URL("../spec/0.1/fixtures/accounting.json", import.meta.url), "utf8")) as { specification: string; cases: Vector[] };
  const cases = corpus.cases.map(vector => {
    let actual: Vector["expected"];
    let profileConserved = true;
    try {
      const value = valueEvidence(vector.evidence, vector.options);
      actual = { total_nanos: value.total_nanos, complete: value.complete, amounts: value.observations.map(item => item.amount_nanos) };
      const profile = createCostProfile(vector.evidence, value);
      const foldedTotal = exportFolded(profile).trim().split("\n").filter(Boolean)
        .reduce((sum, line) => sum + BigInt(line.slice(line.lastIndexOf(" ") + 1)), 0n);
      const pprof = exportPprof(profile);
      profileConserved = profile.total_nanos === value.total_nanos && foldedTotal === BigInt(value.total_nanos) && pprof[0] === 0x1f && pprof[1] === 0x8b;
    } catch (error) {
      actual = { error: error && typeof error === "object" && "code" in error ? String(error.code) : String(error) };
    }
    return { id: vector.id, passed: isDeepStrictEqual(actual, vector.expected) && profileConserved, expected: vector.expected, actual };
  });
  return { specification: corpus.specification, passed: cases.filter(item => item.passed).length, failed: cases.filter(item => !item.passed).length, cases };
}
