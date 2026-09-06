import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { CostProfile } from "./types.js";
import { validateProfile } from "./profile.js";
import { writeArtifact } from "./files.js";

export function formatMoney(nanos: string, currency: string): string {
  const value = BigInt(nanos);
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${value < 0n ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${absolute / 1_000_000_000n}.${fraction}`;
}

// nameattr is line/tab-delimited before it becomes XML. Neutralize that grammar
// first, including XML-invalid control characters, then escape XML text.
const xml = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)
  .replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);

/** Uses the unmodified upstream renderer and its nameattr interface for exact monetary tooltips. */
export async function renderProfile(profile: CostProfile, directory: string, png = false): Promise<object> {
  profile = validateProfile(profile);
  const total = BigInt(profile.total_nanos);
  if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("SVG rendering requires a positive total within the renderer's exact integer range; use the exact profile/pprof artifacts otherwise");
  }
  const prefixes = new Map<string, { name: string; label: string; nanos: bigint }>();
  const folded: string[] = [];
  for (const sample of profile.samples) {
    if (BigInt(sample.value_nanos) === 0n) continue;
    const path: string[] = [];
    for (let index = 0; index < sample.stack.length; index++) {
      const frame = sample.stack[index]!;
      const key = JSON.stringify(sample.stack.slice(0, index + 1).map(item => item.id));
      let prefix = prefixes.get(key);
      if (!prefix) {
        // A separate name for each full prefix makes tooltips correct when the same frame occurs under multiple parents.
        const label = frame.name.replace(/[;\s\u0000-\u001f\u007f]/gu, character => encodeURIComponent(character));
        prefix = { name: `${label} [${prefixes.size + 1}]`.replace(/ /g, "_"), label: frame.name, nanos: 0n };
        prefixes.set(key, prefix);
      }
      prefix.nanos += BigInt(sample.value_nanos);
      path.push(prefix.name);
    }
    folded.push(`${path.join(";")} ${sample.value_nanos}`);
  }
  const amount = formatMoney(profile.total_nanos, profile.currency);
  const attrs = [ `\ttitle=${xml(`All selected costs: ${amount} (100%)`)}` ];
  for (const prefix of prefixes.values()) {
    const percent = (Number(prefix.nanos) * 100 / Number(total)).toFixed(2);
    attrs.push(`${prefix.name}\ttitle=${xml(`${prefix.label}: ${formatMoney(prefix.nanos.toString(), profile.currency)} (${percent}%)`)}`);
  }
  await mkdir(directory, { recursive: true });
  await writeArtifact(join(directory, "render.folded"), folded.join("\n") + "\n");
  const attrFile = resolve(directory, "render.nameattr");
  await writeArtifact(attrFile, attrs.join("\n") + "\n");
  const renderer = fileURLToPath(new URL("../vendor/FlameGraph/flamegraph.pl", import.meta.url));
  const title = `flAImegraph - ${amount} ${profile.complete ? "selected cost" : "known subtotal"}`;
  const result = spawnSync("perl", [renderer, "--title", title, "--subtitle", `${profile.basis} | ${profile.cost_view} | width = cost | click to zoom; Ctrl+F to search`,
    "--countname", profile.unit, "--nametype", "Attribution:", "--nameattr", attrFile, "--width", "1400", "--minwidth", "0"],
    { input: folded.join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`FlameGraph renderer failed: ${result.error?.message ?? result.stderr}`);
  const svgPath = join(directory, "cost.svg");
  await writeArtifact(svgPath, result.stdout);
  if (png) {
    const raster = spawnSync("rsvg-convert", [svgPath], { maxBuffer: 64 * 1024 * 1024 });
    if (raster.error || raster.status !== 0) throw new Error(`PNG rendering requires rsvg-convert: ${raster.error?.message ?? raster.stderr.toString()}`);
    await writeArtifact(join(directory, "cost.png"), raster.stdout);
  }
  const provenance = JSON.parse(await readFile(new URL("../vendor/FlameGraph/PROVENANCE.json", import.meta.url), "utf8"));
  const manifest = { renderer: "brendangregg/FlameGraph", renderer_commit: provenance.commit,
    profile_id: profile.id, total_nanos: profile.total_nanos, currency: profile.currency, complete: profile.complete,
    svg_sha256: createHash("sha256").update(result.stdout).digest("hex"),
    tooltip_method: "upstream nameattr; exact decimal currency per attribution prefix", png };
  await writeArtifact(join(directory, "render.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
