import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import protobuf from "protobufjs";
import { formatUsageInteger, validateUsageProfile, type UsageProfile, type UsageProfileFrame } from "./usage-profile.js";

const escaped = (value: string) => value.replace(/[%;\s<>&"'\\{}$\u0000-\u001f\u007f]/gu, character => [...Buffer.from(character)].map(byte => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join(""));
const frameName = (frame: UsageProfileFrame) => `${escaped(frame.label)}[${createHash("sha256").update(frame.id).digest("hex").slice(0, 16)}]`;
const xml = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);

export function exportUsageFolded(input: UsageProfile): string {
  const profile = validateUsageProfile(input);
  return profile.samples.map(sample => `${sample.stack.map(frameName).join(";")} ${sample.integer_value}\n`).join("");
}

/** Standard pprof integer samples with an explicit decimal scaling unit. */
export function exportUsagePprof(input: UsageProfile): Uint8Array {
  const profile = validateUsageProfile(input);
  if (BigInt(profile.integer_total) > (1n << 63n) - 1n) throw new Error("Usage exceeds the signed int64 pprof range; use exact JSON or folded stacks");
  const strings = [""], indices = new Map<string, number>([["", 0]]);
  const str = (value: string) => {
    let index = indices.get(value);
    if (index === undefined) { index = strings.length; strings.push(value); indices.set(value, index); }
    return index;
  };
  const frames = [...new Map(profile.samples.flatMap(sample => sample.stack).map(frame => [frameName(frame), frame])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const ids = new Map(frames.map(([name], index) => [name, index + 1]));
  const type = protobuf.parse(readFileSync(new URL("../vendor/pprof/profile.proto", import.meta.url), "utf8")).root.lookupType("perftools.profiles.Profile");
  const body = {
    sampleType: [{ type: str(profile.meter_id), unit: str(profile.integer_unit) }],
    sample: profile.samples.map(sample => ({ locationId: sample.stack.map(frame => ids.get(frameName(frame))!).reverse(), value: [sample.integer_value], label: [{ key: str("observation_id"), str: str(sample.observation_id) }] })),
    function: frames.map(([name, frame]) => ({ id: ids.get(name)!, name: str(frame.label), systemName: str(name), filename: 0 })),
    location: frames.map(([name]) => ({ id: ids.get(name)!, line: [{ functionId: ids.get(name)!, line: 0 }] })),
    comment: [str(JSON.stringify({ dataset_id: profile.dataset_id, meter_id: profile.meter_id, decimal_places: profile.decimal_places, unknown_observation_ids: profile.unknown_observation_ids, excluded_observation_ids: profile.excluded_observation_ids, count_bases: profile.count_bases })), ...profile.limitations.map(str)], stringTable: strings,
  };
  const message = type.fromObject(body);
  const error = type.verify(message);
  if (error) throw new Error(`Unable to encode usage pprof: ${error}`);
  return gzipSync(type.encode(message).finish());
}

/** Render one measured resource through the bundled, unmodified upstream FlameGraph. */
export function renderUsageSvg(input: UsageProfile, width = 1400): string | null {
  const profile = validateUsageProfile(input);
  if (!Number.isInteger(width) || width < 320 || width > 2400) throw new Error("Usage SVG width must be from 320 through 2400");
  const total = BigInt(profile.integer_total);
  if (total === 0n) return null;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Usage exceeds the exact SVG renderer range; use JSON, folded stacks or pprof");
  const prefixes = new Map<string, { name: string; label: string; value: bigint }>();
  const rows = profile.samples.filter(sample => BigInt(sample.integer_value) > 0n).map(sample => {
    const path: string[] = [];
    const names: string[] = [];
    for (const frame of sample.stack) {
      path.push(frame.id);
      const key = JSON.stringify(path);
      let prefix = prefixes.get(key);
      if (!prefix) {
        const identity = createHash("sha256").update(key).digest("hex").slice(0, 12);
        const hidden = `\u200B${[...identity].map(character => "\u200C".repeat(Number.parseInt(character, 16) + 1)).join("\u200D")}\u200B`;
        prefix = { name: frame.label.replace(/[;\t\r\n\u0000-\u001f\u007f]/g, " ") + hidden, label: frame.label, value: 0n };
        prefixes.set(key, prefix);
      }
      prefix.value += BigInt(sample.integer_value);
      names.push(prefix.name);
    }
    return `${names.join(";")} ${sample.integer_value}`;
  });
  const display = (value: bigint) => `${formatUsageInteger(value.toString(), profile.decimal_places)} ${profile.unit}`;
  const attributes = [...prefixes.values()].map(prefix => `${prefix.name}\ttitle=${xml(`${prefix.label}: ${display(prefix.value)} (${(Number(prefix.value) / Number(total) * 100).toFixed(2)}%)`)}`);
  const directory = mkdtempSync(join(tmpdir(), "flaimegraph-usage-svg-"));
  try {
    const path = join(directory, "names");
    writeFileSync(path, attributes.join("\n") + "\n", { mode: 0o600 });
    const renderer = fileURLToPath(new URL("../vendor/FlameGraph/flamegraph.pl", import.meta.url));
    const result = spawnSync("perl", [renderer, "--width", String(width), "--fontsize", "14", "--title", width < 600 ? display(total) : `${profile.meter_id}: ${display(total)}`, "--subtitle", "Known usage | click to zoom | Ctrl+F to search", "--countname", profile.integer_unit, "--nametype", "Usage:", "--nameattr", path, "--minwidth", "0", "--hash"], { input: rows.join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0" } });
    if (result.error || result.status !== 0) throw new Error(`Usage FlameGraph failed: ${result.error?.message ?? result.stderr}`);
    return result.stdout;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
