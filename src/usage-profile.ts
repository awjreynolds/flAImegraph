import type { UsageGrouping, UsageObservation, UsageReport } from "./usage-types.js";
import { isAdditiveUsageMeasurement, validateUsageReport } from "./usage.js";

export interface UsageProfileOptions {
  meter_id: string;
  group_by?: Array<UsageGrouping | "execution">;
}
export interface UsageProfileFrame { id: string; label: string }
export interface UsageProfileSample {
  observation_id: string;
  stack: UsageProfileFrame[];
  value: string;
  integer_value: string;
}
/** One meter at a time; subsets, currencies and unlike units are never combined. */
export interface UsageProfile {
  schema_version: "0.4.0";
  dataset_id: string;
  meter_id: string;
  unit: string;
  decimal_places: number;
  integer_unit: string;
  total: string;
  integer_total: string;
  group_by: Array<UsageGrouping | "execution">;
  samples: UsageProfileSample[];
  unknown_observation_ids: string[];
  excluded_observation_ids: string[];
  count_bases: string[];
  limitations: string[];
}

const canonical = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""}`;
};
const integer = (value: string, places: number): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(places, "0")}`);
};
export function formatUsageInteger(value: string, places: number): string {
  if (places === 0) return value;
  const padded = value.padStart(places + 1, "0");
  return canonical(`${padded.slice(0, -places)}.${padded.slice(-places)}`);
}
function dimension(observation: UsageObservation, grouping: UsageGrouping): string {
  if (grouping === "model") {
    const dimensions = observation.dimensions;
    if (dimensions.actual_model?.value != null) return String(dimensions.actual_model.value);
    if (dimensions.model?.value != null) return `${String(dimensions.model.value)} (identity unconfirmed)`;
    if (dimensions.requested_model?.value != null) return `${String(dimensions.requested_model.value)} (requested)`;
    return "Model unknown / not applicable";
  }
  if (grouping === "scope") return observation.accounting_scope;
  if (grouping === "task") return observation.task_id ?? observation.work_item_id ?? "Task unassigned";
  return observation[`${grouping}_id`] ?? `${grouping} unassigned`;
}

export function createUsageProfile(input: UsageReport, options: UsageProfileOptions): UsageProfile {
  const report = validateUsageReport(input);
  if (!options || typeof options.meter_id !== "string" || Object.keys(options).some(key => !["meter_id", "group_by"].includes(key))) throw new Error("Select a meter and an optional grouping for the usage profile");
  const meter = report.bundle.meters.find(item => item.id === options.meter_id);
  if (!meter || !report.selected_meter_ids.includes(meter.id)) throw new Error("The selected meter is not present in this report");
  const groupBy = options.group_by ?? ["task", "operation"];
  if (!Array.isArray(groupBy) || groupBy.some(item => !["task", "work_item", "model", "agent", "scope", "operation", "session", "execution"].includes(item)) || new Set(groupBy).size !== groupBy.length || (groupBy.includes("execution") && groupBy.length !== 1)) throw new Error("Choose unique usage groupings, or execution alone");
  const byId = new Map(report.bundle.observations.map(observation => [observation.id, observation]));
  const rows = new Map(report.observations.map(row => [row.observation_id, row]));
  const selected = report.bundle.observations.filter(observation => {
    const measurement = observation.measurements[meter.id];
    return measurement !== undefined && isAdditiveUsageMeasurement(observation, measurement) && measurement.value !== null;
  });
  const places = selected.reduce((max, observation) => Math.max(max, canonical(observation.measurements[meter.id]!.value!).split(".")[1]?.length ?? 0), 0);
  const samples = selected.map(observation => {
    const stack: UsageProfileFrame[] = [{ id: "usage", label: `Usage · ${meter.id}` }];
    if (groupBy[0] === "execution") {
      for (const id of rows.get(observation.id)!.ancestry) {
        const ancestor = byId.get(id)!;
        stack.push({ id: `observation:${id}`, label: ancestor.subject ?? ancestor.operation_id ?? id });
      }
    } else {
      for (const grouping of groupBy) {
        const label = dimension(observation, grouping as UsageGrouping);
        // A caller's literal work label must never collide with the missing-value label.
        const identity = grouping === "task" ? observation.task_id ?? observation.work_item_id
          : grouping === "work_item" || grouping === "agent" || grouping === "operation" || grouping === "session"
            ? observation[`${grouping}_id`] : label;
        stack.push({ id: JSON.stringify([grouping, identity]), label });
      }
      stack.push({ id: `observation:${observation.id}`, label: observation.subject ?? observation.operation_id ?? observation.id });
    }
    const value = canonical(observation.measurements[meter.id]!.value!);
    return { observation_id: observation.id, stack, value, integer_value: integer(value, places).toString() };
  }).sort((a, b) => a.observation_id < b.observation_id ? -1 : a.observation_id > b.observation_id ? 1 : 0);
  const total = samples.reduce((sum, sample) => sum + BigInt(sample.integer_value), 0n).toString();
  const coverage = report.meter_totals.find(row => row.meter_id === meter.id)!.coverage;
  const countBases = [...new Set(selected.map(observation => observation.measurements[meter.id]!.count_basis))].sort();
  return {
    schema_version: "0.4.0", dataset_id: report.dataset_id, meter_id: meter.id, unit: meter.unit,
    decimal_places: places, integer_unit: places === 0 ? meter.unit : `0.${"0".repeat(places - 1)}1 ${meter.unit}`,
    total: formatUsageInteger(total, places), integer_total: total, group_by: [...groupBy], samples,
    unknown_observation_ids: [...coverage.unknown_observation_ids].sort(), excluded_observation_ids: [...coverage.excluded_observation_ids].sort(), count_bases: countBases,
    limitations: [
      ...(report.bundle.sources.some(source => source.coverage !== "complete") ? ["Source capture is partial or unknown; this is a known usage subtotal."] : []),
      ...(meter.subset_of ? [`This meter is a subset of ${meter.subset_of}; do not add the two totals.`] : []),
      ...(countBases.length > 1 || countBases.includes("unknown") ? ["Count bases differ or are unknown; comparisons require the corresponding measurement provenance."] : []),
      ...(groupBy[0] !== "execution" ? ["Frames group recorded usage; grouping does not describe execution parentage."] : []),
    ],
  };
}

export function validateUsageProfile(value: unknown): UsageProfile {
  const profile = value as UsageProfile;
  const keys = (item: unknown, allowed: string[]) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !allowed.includes(key))) throw new Error("Invalid usage profile fields");
  };
  keys(value, ["schema_version", "dataset_id", "meter_id", "unit", "decimal_places", "integer_unit", "total", "integer_total", "group_by", "samples", "unknown_observation_ids", "excluded_observation_ids", "count_bases", "limitations"]);
  if (!profile || profile.schema_version !== "0.4.0" || typeof profile.dataset_id !== "string" || typeof profile.meter_id !== "string" || typeof profile.unit !== "string" || !Number.isInteger(profile.decimal_places) || profile.decimal_places < 0 || profile.decimal_places > 1000 || !Array.isArray(profile.samples)) throw new Error("Invalid usage profile");
  const ids = new Set<string>();
  let total = 0n;
  for (const sample of profile.samples) {
    keys(sample, ["observation_id", "stack", "value", "integer_value"]);
    if (typeof sample.observation_id !== "string" || ids.has(sample.observation_id) || !Array.isArray(sample.stack) || sample.stack.length === 0 || sample.stack.some(frame => typeof frame.id !== "string" || typeof frame.label !== "string") || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(sample.value) || !/^(0|[1-9][0-9]*)$/.test(sample.integer_value) || (sample.value.split(".")[1]?.length ?? 0) > profile.decimal_places || integer(sample.value, profile.decimal_places).toString() !== sample.integer_value) throw new Error("Invalid usage profile sample or duplicate identity");
    ids.add(sample.observation_id);
    for (const frame of sample.stack) keys(frame, ["id", "label"]);
    total += BigInt(sample.integer_value);
  }
  if (total.toString() !== profile.integer_total || formatUsageInteger(total.toString(), profile.decimal_places) !== profile.total) throw new Error("Usage profile total does not match its samples");
  if (profile.integer_unit !== (profile.decimal_places === 0 ? profile.unit : `0.${"0".repeat(profile.decimal_places - 1)}1 ${profile.unit}`)) throw new Error("Usage profile unit does not match its scale");
  for (const key of ["unknown_observation_ids", "excluded_observation_ids", "count_bases", "limitations", "group_by"] as const) if (!Array.isArray(profile[key]) || profile[key].some(item => typeof item !== "string")) throw new Error("Invalid usage profile metadata");
  if (profile.group_by.some(group => !["model", "work_item", "task", "agent", "scope", "operation", "session", "execution"].includes(group)) || new Set(profile.group_by).size !== profile.group_by.length || (profile.group_by.includes("execution") && profile.group_by.length !== 1)) throw new Error("Invalid usage profile grouping");
  if (profile.count_bases.some(basis => !["provider_native", "consumed", "billable", "allocated", "unknown"].includes(basis)) || new Set(profile.count_bases).size !== profile.count_bases.length) throw new Error("Invalid usage profile count bases");
  const covered = new Set(ids);
  for (const id of [...profile.unknown_observation_ids, ...profile.excluded_observation_ids]) {
    if (!id || covered.has(id)) throw new Error("Usage profile coverage identities overlap or repeat");
    covered.add(id);
  }
  return structuredClone(profile);
}
