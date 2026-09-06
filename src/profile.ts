import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import protobuf from "protobufjs";
import { gzipSync } from "node:zlib";
import { reconcileEvidence, validateEvidence } from "./core.js";

import type {
  Allocation,
  CostProfile,
  CoverageIssue,
  EvidenceBundle,
  Frame,
  Grouping,
  Observation,
  ProfileOptions,
  ProfileSample,
  Valuation,
} from "./types.js";

const DEFAULT_GROUP_BY: Grouping[] = ["work_item", "agent", "model", "operation", "observation"];
const PROFILE_DOC_URL =
  "https://github.com/awjreynolds/flAImegraph/blob/v0.1.0/spec/0.1/profiles.md";
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

export class ProfileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProfileError";
    this.code = code;
  }
}

interface ProfileMetadata {
  projection: "flAImegraph.cost-profile";
  projection_version: "0.1.0";
  cost_view: "charges" | "credits" | "net";
  currency: string;
  unit: string;
  selected_observation_ids: string[];
  included_observation_ids: string[];
  zero_observation_ids: string[];
  unknown_cost_observation_ids: string[];
  source_complete: boolean;
  charges_nanos: string;
  credits_nanos: string;
  net_nanos: string;
  signed_net_summary: { total_nanos: string; negative_observation_ids: string[] };
  root_label: string;
  selection_policy: "direct-only-v1";
  path_order: "root-first";
  allocation: {
    policy: "none" | "largest_remainder";
    tie_break: "work_item_id_ascending";
    manifest: AllocationManifestEntry[];
  };
  frame_manifest: Frame[];
}

interface AllocationManifestEntry {
  observation_id: string;
  allocations: Allocation[];
}

interface ProfileWithMetadata extends CostProfile {
  metadata: ProfileMetadata;
}

const SCHEMA_VERSION = "0.1.0" as const;
const PROFILE_PROJECTION = "flAImegraph.cost-profile" as const;
const CANONICAL_INTEGER = /^(0|-?[1-9][0-9]*)$/u;

function valueForGrouping(observation: Observation, grouping: Grouping): string {
  switch (grouping) {
    case "work_item":
      return observation.work_item_id ?? "<unknown>";
    case "agent":
      return observation.agent_id ?? "<unknown>";
    case "model":
      return observation.model ?? "<unknown>";
    case "operation":
      return observation.operation;
    case "observation":
      return observation.id;
    case "session":
      return observation.session_id ?? "<unknown>";
    case "turn":
      return observation.turn_id ?? "<unknown>";
  }
}

function stableEncoding(value: string): string {
  // UTF-16 preserves every JavaScript string code unit, including lone
  // surrogates that would otherwise be replaced by a UTF-8 encoder.
  const encoded = Buffer.from(value, "utf16le").toString("base64url");
  return encoded || "empty";
}

function readableEncoding(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === ";" ||
      character === "%" ||
      /\s/u.test(character) ||
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      for (const byte of Buffer.from(character, "utf8")) {
        result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    } else {
      result += character;
    }
  }
  return result || "<empty>";
}

function frameFor(grouping: string, value: string): Frame {
  return {
    id: `${grouping}:${stableEncoding(value)}`,
    // The complete identity is carried by id and metadata.frame_manifest.
    // Keeping the display label free of the long identity makes standard
    // pprof and folded views readable; exporters add a compact disambiguator.
    name: `${grouping}:${readableEncoding(value)}`,
    kind: grouping,
  };
}

function parseInteger(value: string, field: string): bigint {
  if (!CANONICAL_INTEGER.test(value)) {
    throw new ProfileError("invalid_integer", `${field} must be an exact decimal integer string.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new ProfileError("invalid_integer", `${field} must be an exact decimal integer string.`);
  }
}

function validateInputs(evidence: EvidenceBundle, valuation: Valuation, options: ProfileOptions): void {
  if (evidence.schema_version !== SCHEMA_VERSION) {
    throw new ProfileError("unsupported_schema_version", `Evidence schema version must be ${SCHEMA_VERSION}.`);
  }
  if (valuation.schema_version !== SCHEMA_VERSION) {
    throw new ProfileError("unsupported_schema_version", `Valuation schema version must be ${SCHEMA_VERSION}.`);
  }
  if (!evidence.dataset_id || !valuation.id) {
    throw new ProfileError("invalid_identity", "Evidence dataset_id and valuation id are required.");
  }
  if (valuation.dataset_id !== evidence.dataset_id) {
    throw new ProfileError("dataset_mismatch", "Evidence and valuation refer to different datasets.");
  }
  if (valuation.selection_policy !== "direct-only-v1") {
    throw new ProfileError("selection_policy", "Profiles require the direct-only-v1 valuation selection policy.");
  }
  if (valuation.basis === "mixed") {
    throw new ProfileError("mixed_basis", "A monetary profile cannot combine valuation bases.");
  }
  if (!/^[A-Z]{3}$/u.test(valuation.currency)) {
    throw new ProfileError("invalid_currency", "Profile currency must be an uppercase ISO-like three-letter code.");
  }
  const sourceIds = new Set<string>();
  for (const source of evidence.sources) {
    if (sourceIds.has(source.id)) throw new ProfileError("duplicate_source", `Source ${source.id} is repeated.`);
    sourceIds.add(source.id);
  }
  const observationIds = new Set<string>();
  for (const observation of evidence.observations) {
    if (observationIds.has(observation.id)) {
      throw new ProfileError("duplicate_observation", `Observation ${observation.id} is repeated.`);
    }
    observationIds.add(observation.id);
    for (const sourceRef of observation.source_refs) {
      if (!sourceIds.has(sourceRef.source_id)) {
        throw new ProfileError("invalid_source_reference", `Observation ${observation.id} references unknown source ${sourceRef.source_id}.`);
      }
    }
  }
  for (const relationship of evidence.relationships) {
    if (relationship.kind === "adjusts" && (!observationIds.has(relationship.from) || !observationIds.has(relationship.to))) {
      throw new ProfileError("invalid_relationship_reference", "A relationship references an unknown observation.");
    }
  }
  const groupBy = options.group_by ?? DEFAULT_GROUP_BY;
  const knownGroupings = new Set<Grouping>(["work_item", "agent", "model", "operation", "session", "turn", "observation"]);
  const seenGroupings = new Set<Grouping>();
  for (const grouping of groupBy) {
    if (!knownGroupings.has(grouping)) throw new ProfileError("invalid_grouping", `Unknown profile grouping ${grouping}.`);
    if (seenGroupings.has(grouping)) throw new ProfileError("duplicate_grouping", `Profile grouping ${grouping} is repeated.`);
    seenGroupings.add(grouping);
  }
  if (options.cost_view !== undefined && !["charges", "credits", "net"].includes(options.cost_view)) {
    throw new ProfileError("invalid_cost_view", "Profile cost_view must be charges, credits, or net.");
  }
  const valuedIds = new Set<string>();
  let subtotal = 0n;
  for (const valued of valuation.observations) {
    if (valuedIds.has(valued.observation_id)) {
      throw new ProfileError("duplicate_valuation_observation", `Valuation repeats observation ${valued.observation_id}.`);
    }
    valuedIds.add(valued.observation_id);
    const observation = evidence.observations.find((candidate) => candidate.id === valued.observation_id);
    if (!observation) {
      throw new ProfileError("invalid_valuation_reference", `Valuation references unknown observation ${valued.observation_id}.`);
    }
    if (observation.accounting_scope !== "direct" && valued.amount_nanos !== null) {
      throw new ProfileError("invalid_valuation_scope", `Valuation gives a monetary subtotal for non-direct observation ${observation.id}.`);
    }
    if (valued.amount_nanos !== null) {
      const amount = parseInteger(valued.amount_nanos, `valuation amount for ${valued.observation_id}`);
      subtotal += amount;
      if (valued.basis === null || valued.basis !== valuation.basis) {
        throw new ProfileError("mixed_basis", `Valuation amount for ${valued.observation_id} has a conflicting basis.`);
      }
      if (observation.recorded_cost) {
        if (
          observation.recorded_cost.basis === valuation.basis &&
          observation.recorded_cost.currency !== valuation.currency
        ) {
          throw new ProfileError("currency_mismatch", `Recorded cost for ${observation.id} uses another currency.`);
        }
      }
    }
  }
  const declaredTotal = parseInteger(valuation.total_nanos, "valuation total_nanos");
  if (declaredTotal !== subtotal) {
    throw new ProfileError("invalid_subtotal", "Valuation total_nanos does not equal its valued observation amounts.");
  }
  if (options.allocations) {
    if (seenGroupings.has("work_item") === false && Object.values(options.allocations).some((allocations) => allocations.length > 1)) {
      throw new ProfileError("allocation_not_projected", "Shared allocations require work_item in group_by.");
    }
    for (const [observationId, allocations] of Object.entries(options.allocations)) {
      if (!observationIds.has(observationId)) {
        throw new ProfileError("invalid_allocation_reference", `Allocation references unknown observation ${observationId}.`);
      }
      if (allocations.length === 0) throw new ProfileError("invalid_allocation", `Allocation for ${observationId} is empty.`);
      const workItems = new Set<string>();
      let denominator = 0n;
      for (const allocation of allocations) {
        if (!allocation.work_item_id || workItems.has(allocation.work_item_id)) {
          throw new ProfileError("invalid_allocation", `Allocation for ${observationId} repeats or omits a work item.`);
        }
        workItems.add(allocation.work_item_id);
        const weight = parseInteger(allocation.weight, `allocation weight for ${observationId}`);
        if (weight <= 0n) throw new ProfileError("invalid_allocation", `Allocation weights for ${observationId} must be positive integers.`);
        denominator += weight;
      }
      if (denominator <= 0n) throw new ProfileError("invalid_allocation", `Allocation weights for ${observationId} must sum positively.`);
    }
  }
}

function validateValuationShape(valuation: Valuation): void {
  const value = valuation as unknown as Record<string, unknown>;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProfileError("invalid_valuation", "Valuation must be an object.");
  }
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new ProfileError("invalid_identity", "Valuation id is required.");
  }
  if (typeof value.dataset_id !== "string" || value.dataset_id.trim().length === 0) {
    throw new ProfileError("invalid_identity", "Valuation dataset_id is required.");
  }
  if (!Array.isArray(value.assumptions) || !value.assumptions.every((item) => typeof item === "string" && item.length > 0)) {
    throw new ProfileError("invalid_valuation", "Valuation assumptions must be non-empty strings.");
  }
  if (!Array.isArray(value.observations)) throw new ProfileError("invalid_valuation", "Valuation observations must be an array.");
  if (!Array.isArray(value.issues)) throw new ProfileError("invalid_valuation", "Valuation issues must be an array.");
  if (typeof value.total_nanos !== "string") throw new ProfileError("invalid_valuation", "Valuation total_nanos must be an integer string.");
  parseInteger(value.total_nanos, "valuation total_nanos");
  if (typeof value.complete !== "boolean") throw new ProfileError("invalid_valuation", "Valuation complete must be a boolean.");
  if (![
    "model_price_estimate",
    "provider_reported",
    "billed",
    "enterprise_scenario",
    "contract_estimate",
    "mixed",
  ].includes(value.basis as string)) throw new ProfileError("invalid_valuation", "Valuation basis is unsupported.");
  for (const [index, observation] of value.observations.entries()) {
    if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
      throw new ProfileError("invalid_valuation", `Valuation observation ${index} must be an object.`);
    }
    const item = observation as Record<string, unknown>;
    if (typeof item.observation_id !== "string" || item.observation_id.trim().length === 0) {
      throw new ProfileError("invalid_valuation", `Valuation observation ${index} requires observation_id.`);
    }
    if (item.amount_nanos !== null && typeof item.amount_nanos !== "string") {
      throw new ProfileError("invalid_valuation", `Valuation observation ${index} amount_nanos must be an integer string or null.`);
    }
    if (typeof item.amount_nanos === "string") parseInteger(item.amount_nanos, `valuation amount for ${item.observation_id}`);
    if (item.basis !== null && typeof item.basis !== "string") {
      throw new ProfileError("invalid_valuation", `Valuation observation ${index} basis must be a string or null.`);
    }
  }
}

function allocateInteger(amount: bigint, allocations: Allocation[]): Array<{ work_item_id: string; amount: bigint }> {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error("allocations must contain at least one item");
  }
  const denominator = allocations.reduce((sum, allocation) => sum + BigInt(allocation.weight), 0n);
  if (denominator <= 0n) throw new Error("allocation weights must be positive integers");
  const sign = amount < 0n ? -1n : 1n;
  const magnitude = amount < 0n ? -amount : amount;
  const provisional = allocations.map((allocation) => {
    const numerator = magnitude * BigInt(allocation.weight);
    return {
      work_item_id: allocation.work_item_id,
      quotient: numerator / denominator,
      remainder: numerator % denominator,
    };
  });
  let left = magnitude - provisional.reduce((sum, allocation) => sum + allocation.quotient, 0n);
  provisional.sort((leftAllocation, rightAllocation) => {
    if (leftAllocation.remainder !== rightAllocation.remainder) {
      return leftAllocation.remainder > rightAllocation.remainder ? -1 : 1;
    }
    return compareStrings(leftAllocation.work_item_id, rightAllocation.work_item_id);
  });
  for (const allocation of provisional) {
    if (left === 0n) break;
    allocation.quotient += 1n;
    left -= 1n;
  }
  return provisional
    .map((allocation) => ({ work_item_id: allocation.work_item_id, amount: sign * allocation.quotient }))
    .sort((leftAllocation, rightAllocation) => compareStrings(leftAllocation.work_item_id, rightAllocation.work_item_id));
}

function valueForView(amount: bigint, costView: "charges" | "credits" | "net"): bigint | undefined {
  if (costView === "charges") return amount > 0n ? amount : amount === 0n ? 0n : undefined;
  if (costView === "credits") return amount < 0n ? -amount : amount === 0n ? 0n : undefined;
  if (amount < 0n) {
    throw new ProfileError("negative_net_value", "Net profile projection cannot emit a negative folded or pprof width.");
  }
  return amount;
}

function netAmounts(
  evidence: EvidenceBundle,
  amounts: Map<string, bigint>,
): { effective: Map<string, bigint>; negativeObservationIds: string[] } {
  const effective = new Map(amounts);
  const negativeObservationIds: string[] = [];
  for (const [observationId, amount] of amounts) {
    if (amount >= 0n) continue;
    const links = evidence.relationships.filter(
      (relationship) =>
        relationship.kind === "adjusts" &&
        ((relationship.from === observationId && (amounts.get(relationship.to) ?? 0n) > 0n) ||
          (relationship.to === observationId && (amounts.get(relationship.from) ?? 0n) > 0n)),
    );
    if (links.length !== 1) {
      throw new ProfileError(
        "unsupported_net_adjustment",
        `Negative observation ${observationId} requires exactly one explicit adjustment target for net view.`,
      );
    }
    const link = links[0]!;
    const targetId = link.from === observationId ? link.to : link.from;
    const targetAmount = effective.get(targetId);
    if (targetAmount === undefined || targetAmount <= 0n) {
      throw new ProfileError("unsupported_net_adjustment", `Adjustment ${observationId} has no positive charge target.`);
    }
    const net = targetAmount + amount;
    if (net < 0n) {
      throw new ProfileError("negative_net_value", `Adjustment ${observationId} would make its target negative.`);
    }
    effective.set(targetId, net);
    negativeObservationIds.push(observationId);
  }
  for (const observationId of negativeObservationIds) effective.delete(observationId);
  return { effective, negativeObservationIds: negativeObservationIds.sort(compareStrings) };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new ProfileError("invalid_profile", "Profile identity material is not JSON-compatible.");
  return encoded;
}

function canonicalAllocationManifest(options: ProfileOptions): AllocationManifestEntry[] {
  return Object.entries(options.allocations ?? {})
    .map(([observation_id, allocations]) => ({
      observation_id,
      allocations: allocations
        .map((allocation) => ({ work_item_id: allocation.work_item_id, weight: allocation.weight }))
        .sort((left, right) => compareStrings(left.work_item_id, right.work_item_id)),
    }))
    .sort((left, right) => compareStrings(left.observation_id, right.observation_id));
}

function profileIdMaterial(profile: ProfileWithMetadata): Record<string, unknown> {
  return {
    schema_version: profile.schema_version,
    projection: profile.metadata.projection,
    projection_version: profile.metadata.projection_version,
    valuation_id: profile.valuation_id,
    dataset_id: profile.dataset_id,
    currency: profile.currency,
    unit: profile.unit,
    basis: profile.basis,
    root_label: profile.metadata.root_label,
    selection_policy: profile.metadata.selection_policy,
    path_order: profile.metadata.path_order,
    group_by: profile.group_by,
    cost_view: profile.cost_view,
    allocation: profile.metadata.allocation,
    selected_observation_ids: profile.metadata.selected_observation_ids,
    included_observation_ids: profile.metadata.included_observation_ids,
    zero_observation_ids: profile.metadata.zero_observation_ids,
    unknown_cost_observation_ids: profile.metadata.unknown_cost_observation_ids,
    excluded_observation_ids: profile.excluded_observation_ids,
    complete: profile.complete,
    total_nanos: profile.total_nanos,
    charges_nanos: profile.metadata.charges_nanos,
    credits_nanos: profile.metadata.credits_nanos,
    net_nanos: profile.metadata.net_nanos,
    signed_net_summary: profile.metadata.signed_net_summary,
    frame_manifest: profile.metadata.frame_manifest,
    samples: profile.samples,
    issues: [...profile.issues].sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right))),
    assumptions: [...profile.assumptions].sort(compareStrings),
  };
}

function profileId(profile: ProfileWithMetadata): string {
  return `profile:${createHash("sha256").update(canonicalJson(profileIdMaterial(profile)), "utf8").digest("hex")}`;
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProfileError("invalid_profile", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ProfileError("invalid_profile", `${field} must be an array.`);
  return value;
}

function stringValueRequired(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProfileError("invalid_profile", `${field} must be a non-empty string.`);
  }
  return value;
}

function booleanValueRequired(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ProfileError("invalid_profile", `${field} must be a boolean.`);
  return value;
}

function exactInteger(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !CANONICAL_INTEGER.test(value)) {
    throw new ProfileError("invalid_profile_integer", `${field} must be a canonical integer string.`);
  }
  return BigInt(value);
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new ProfileError("invalid_profile", `${field} contains unknown field ${key}.`);
  }
}

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ProfileError("invalid_profile", `${field} has an unsupported value.`);
  }
  return value as T;
}

function assertSortedUnique(values: string[], field: string): void {
  const sorted = [...new Set(values)].sort(compareStrings);
  if (sorted.length !== values.length || values.some((value, index) => value !== sorted[index])) {
    throw new ProfileError("noncanonical_profile", `${field} must be sorted and contain unique values.`);
  }
}

function compareProfileSamples(left: ProfileSample, right: ProfileSample): number {
  const stackOrder = compareStrings(
    left.stack.map((frame) => frame.id).join(";"),
    right.stack.map((frame) => frame.id).join(";"),
  );
  return stackOrder || compareStrings(left.observation_id, right.observation_id) || compareStrings(left.value_nanos, right.value_nanos);
}

function validateIssueList(value: unknown, field: string): CoverageIssue[] {
  const issues = arrayValue(value, field).map((item, index) => {
    const issue = objectValue(item, `${field}[${index}]`);
    assertAllowedKeys(issue, ["code", "message", "severity", "observation_id", "source_id"], `${field}[${index}]`);
    const result: CoverageIssue = {
      code: stringValueRequired(issue.code, `${field}[${index}].code`),
      message: stringValueRequired(issue.message, `${field}[${index}].message`),
      severity: assertEnum(issue.severity, ["info", "warning", "error"], `${field}[${index}].severity`),
    };
    if (issue.observation_id !== undefined) result.observation_id = stringValueRequired(issue.observation_id, `${field}[${index}].observation_id`);
    if (issue.source_id !== undefined) result.source_id = stringValueRequired(issue.source_id, `${field}[${index}].source_id`);
    return result;
  });
  return issues;
}

/** Validate a serialized profile before handing it to a standard exporter. */
export function validateProfile(value: unknown): CostProfile {
  const profileObject = objectValue(value, "profile");
  assertAllowedKeys(
    profileObject,
    [
      "schema_version",
      "id",
      "currency",
      "unit",
      "basis",
      "valuation_id",
      "dataset_id",
      "group_by",
      "cost_view",
      "total_nanos",
      "complete",
      "samples",
      "issues",
      "excluded_observation_ids",
      "assumptions",
      "metadata",
    ],
    "profile",
  );
  if (profileObject.schema_version !== SCHEMA_VERSION) {
    throw new ProfileError("unsupported_schema_version", `Profile schema version must be ${SCHEMA_VERSION}.`);
  }
  const declaredProfileId = stringValueRequired(profileObject.id, "profile.id");
  const currency = stringValueRequired(profileObject.currency, "profile.currency");
  if (!/^[A-Z]{3}$/u.test(currency)) throw new ProfileError("invalid_profile", "profile.currency must be an uppercase three-letter code.");
  const unit = stringValueRequired(profileObject.unit, "profile.unit");
  if (unit !== `nano${currency}`) throw new ProfileError("invalid_profile", "profile.unit must match profile.currency.");
  const basis = assertEnum(
    profileObject.basis,
    ["model_price_estimate", "provider_reported", "billed", "enterprise_scenario", "contract_estimate", "mixed"],
    "profile.basis",
  );
  const valuationId = stringValueRequired(profileObject.valuation_id, "profile.valuation_id");
  const datasetId = stringValueRequired(profileObject.dataset_id, "profile.dataset_id");
  const groupBy: Grouping[] = arrayValue(profileObject.group_by, "profile.group_by").map((grouping, index) =>
    assertEnum(grouping, ["work_item", "agent", "model", "operation", "session", "turn", "observation"], `profile.group_by[${index}]`),
  );
  if (new Set(groupBy).size !== groupBy.length) throw new ProfileError("invalid_profile", "profile.group_by must not repeat dimensions.");
  const costView = assertEnum(profileObject.cost_view, ["charges", "credits", "net"], "profile.cost_view");
  const totalNanos = exactInteger(profileObject.total_nanos, "profile.total_nanos");
  if (totalNanos < 0n) throw new ProfileError("invalid_profile", "profile.total_nanos must be nonnegative.");
  const complete = booleanValueRequired(profileObject.complete, "profile.complete");
  const issues = validateIssueList(profileObject.issues, "profile.issues");
  const excludedObservationIds = arrayValue(profileObject.excluded_observation_ids, "profile.excluded_observation_ids").map((item, index) =>
    stringValueRequired(item, `profile.excluded_observation_ids[${index}]`),
  );
  assertSortedUnique(excludedObservationIds, "profile.excluded_observation_ids");
  const assumptions = arrayValue(profileObject.assumptions, "profile.assumptions").map((item, index) =>
    stringValueRequired(item, `profile.assumptions[${index}]`),
  );

  const sampleRecords = arrayValue(profileObject.samples, "profile.samples").map((item, index) => {
    const sample = objectValue(item, `profile.samples[${index}]`);
    assertAllowedKeys(sample, ["observation_id", "stack", "value_nanos"], `profile.samples[${index}]`);
    const observationId = stringValueRequired(sample.observation_id, `profile.samples[${index}].observation_id`);
    const stack = arrayValue(sample.stack, `profile.samples[${index}].stack`).map((frameValue, frameIndex) => {
      const frame = objectValue(frameValue, `profile.samples[${index}].stack[${frameIndex}]`);
      assertAllowedKeys(frame, ["id", "name", "kind"], `profile.samples[${index}].stack[${frameIndex}]`);
      return {
        id: stringValueRequired(frame.id, `profile.samples[${index}].stack[${frameIndex}].id`),
        name: stringValueRequired(frame.name, `profile.samples[${index}].stack[${frameIndex}].name`),
        kind: stringValueRequired(frame.kind, `profile.samples[${index}].stack[${frameIndex}].kind`),
      } satisfies Frame;
    });
    if (stack.length === 0) throw new ProfileError("invalid_profile", `profile.samples[${index}].stack must not be empty.`);
    const valueNanos = exactInteger(sample.value_nanos, `profile.samples[${index}].value_nanos`);
    if (valueNanos < 0n) throw new ProfileError("negative_profile_value", "Profile samples must be nonnegative.");
    return { observation_id: observationId, stack, value_nanos: valueNanos.toString() } satisfies ProfileSample;
  });
  const sampleSum = sampleRecords.reduce((sum, sample) => sum + BigInt(sample.value_nanos), 0n);
  if (sampleSum !== totalNanos) {
    throw new ProfileError("profile_total_mismatch", "profile.total_nanos must equal the sum of its sample values.");
  }

  if (profileObject.metadata === undefined) {
    // The schema permits externally produced profiles without this project's
    // optional metadata extension. Their samples are still fully checked;
    // profiles using our generated id scheme must carry the metadata needed
    // to verify that scheme and the projection semantics.
    if (/^profile:[0-9a-f]{64}$/u.test(declaredProfileId)) {
      throw new ProfileError("missing_profile_metadata", "Generated profile ids require profile.metadata.");
    }
    return value as CostProfile;
  }
  const metadataObject = objectValue(profileObject.metadata, "profile.metadata");
  for (let index = 1; index < sampleRecords.length; index += 1) {
    if (compareProfileSamples(sampleRecords[index - 1]!, sampleRecords[index]!) > 0) {
      throw new ProfileError("noncanonical_profile", "profile.samples must be in deterministic path order.");
    }
  }
  assertAllowedKeys(
    metadataObject,
    [
      "projection",
      "projection_version",
      "cost_view",
      "currency",
      "unit",
      "selected_observation_ids",
      "included_observation_ids",
      "zero_observation_ids",
      "unknown_cost_observation_ids",
      "source_complete",
      "charges_nanos",
      "credits_nanos",
      "net_nanos",
      "signed_net_summary",
      "allocation",
      "root_label",
      "selection_policy",
      "path_order",
      "frame_manifest",
    ],
    "profile.metadata",
  );
  if (metadataObject.projection !== PROFILE_PROJECTION || metadataObject.projection_version !== SCHEMA_VERSION) {
    throw new ProfileError("invalid_profile_metadata", "Profile metadata projection and version do not match the profile contract.");
  }
  if (metadataObject.cost_view !== costView || metadataObject.currency !== currency || metadataObject.unit !== unit) {
    throw new ProfileError("invalid_profile_metadata", "Profile metadata measure does not match the profile.");
  }
  const rootLabel = stringValueRequired(metadataObject.root_label, "profile.metadata.root_label");
  if (metadataObject.selection_policy !== "direct-only-v1" || metadataObject.path_order !== "root-first") {
    throw new ProfileError("invalid_profile_metadata", "Profile metadata semantics do not match the v0.1 projection.");
  }
  const selectedObservationIds = arrayValue(metadataObject.selected_observation_ids, "profile.metadata.selected_observation_ids").map((item, index) =>
    stringValueRequired(item, `profile.metadata.selected_observation_ids[${index}]`),
  );
  const includedObservationIds = arrayValue(metadataObject.included_observation_ids, "profile.metadata.included_observation_ids").map((item, index) =>
    stringValueRequired(item, `profile.metadata.included_observation_ids[${index}]`),
  );
  const zeroObservationIds = arrayValue(metadataObject.zero_observation_ids, "profile.metadata.zero_observation_ids").map((item, index) =>
    stringValueRequired(item, `profile.metadata.zero_observation_ids[${index}]`),
  );
  const unknownCostObservationIds = arrayValue(metadataObject.unknown_cost_observation_ids, "profile.metadata.unknown_cost_observation_ids").map((item, index) =>
    stringValueRequired(item, `profile.metadata.unknown_cost_observation_ids[${index}]`),
  );
  for (const [values, field] of [
    [selectedObservationIds, "profile.metadata.selected_observation_ids"],
    [includedObservationIds, "profile.metadata.included_observation_ids"],
    [zeroObservationIds, "profile.metadata.zero_observation_ids"],
    [unknownCostObservationIds, "profile.metadata.unknown_cost_observation_ids"],
  ] as const) assertSortedUnique(values, field);
  const sampleObservationIds = [...new Set(sampleRecords.map((sample) => sample.observation_id))].sort(compareStrings);
  if (canonicalJson(sampleObservationIds) !== canonicalJson(includedObservationIds)) {
    throw new ProfileError("invalid_profile_metadata", "metadata.included_observation_ids must match the sample observations.");
  }
  const selectedSet = new Set(selectedObservationIds);
  const includedSet = new Set(includedObservationIds);
  const excludedSet = new Set(excludedObservationIds);
  for (const id of selectedObservationIds) if (excludedSet.has(id)) throw new ProfileError("invalid_profile_metadata", `Observation ${id} cannot be both selected and excluded.`);
  for (const id of zeroObservationIds) if (!selectedSet.has(id)) throw new ProfileError("invalid_profile_metadata", `Zero observation ${id} is not selected.`);
  for (const id of includedObservationIds) if (!selectedSet.has(id)) throw new ProfileError("invalid_profile_metadata", `Included observation ${id} is not selected.`);
  for (const id of unknownCostObservationIds) if (!excludedSet.has(id)) throw new ProfileError("invalid_profile_metadata", `Unknown observation ${id} is not excluded.`);
  const sourceComplete = booleanValueRequired(metadataObject.source_complete, "profile.metadata.source_complete");
  const chargesNanos = exactInteger(metadataObject.charges_nanos, "profile.metadata.charges_nanos");
  const creditsNanos = exactInteger(metadataObject.credits_nanos, "profile.metadata.credits_nanos");
  const netNanos = exactInteger(metadataObject.net_nanos, "profile.metadata.net_nanos");
  if (chargesNanos < 0n || creditsNanos < 0n || netNanos < 0n) throw new ProfileError("invalid_profile_metadata", "Profile monetary metadata must be nonnegative.");
  const expectedTotal = costView === "charges" ? chargesNanos : costView === "credits" ? creditsNanos : netNanos;
  if (totalNanos !== expectedTotal) {
    throw new ProfileError("profile_total_mismatch", "profile.total_nanos must match the selected metadata cost view.");
  }
  const signedNetSummaryObject = objectValue(metadataObject.signed_net_summary, "profile.metadata.signed_net_summary");
  assertAllowedKeys(signedNetSummaryObject, ["total_nanos", "negative_observation_ids"], "profile.metadata.signed_net_summary");
  const signedNetTotal = exactInteger(signedNetSummaryObject.total_nanos, "profile.metadata.signed_net_summary.total_nanos");
  if (signedNetTotal !== netNanos) throw new ProfileError("invalid_profile_metadata", "Signed net metadata total must match net_nanos.");
  const negativeObservationIds = arrayValue(signedNetSummaryObject.negative_observation_ids, "profile.metadata.signed_net_summary.negative_observation_ids").map((item, index) =>
    stringValueRequired(item, `profile.metadata.signed_net_summary.negative_observation_ids[${index}]`),
  );
  assertSortedUnique(negativeObservationIds, "profile.metadata.signed_net_summary.negative_observation_ids");

  const allocationObject = objectValue(metadataObject.allocation, "profile.metadata.allocation");
  assertAllowedKeys(allocationObject, ["policy", "tie_break", "manifest"], "profile.metadata.allocation");
  const allocationPolicy = assertEnum(allocationObject.policy, ["none", "largest_remainder"], "profile.metadata.allocation.policy");
  if (allocationObject.tie_break !== "work_item_id_ascending") throw new ProfileError("invalid_profile_metadata", "Unsupported allocation tie break.");
  const allocationManifest = arrayValue(allocationObject.manifest, "profile.metadata.allocation.manifest").map((item, index) => {
    const entry = objectValue(item, `profile.metadata.allocation.manifest[${index}]`);
    assertAllowedKeys(entry, ["observation_id", "allocations"], `profile.metadata.allocation.manifest[${index}]`);
    const observationId = stringValueRequired(entry.observation_id, `profile.metadata.allocation.manifest[${index}].observation_id`);
    const allocations = arrayValue(entry.allocations, `profile.metadata.allocation.manifest[${index}].allocations`).map((allocationValue, allocationIndex) => {
      const allocationObjectValue = objectValue(allocationValue, `profile.metadata.allocation.manifest[${index}].allocations[${allocationIndex}]`);
      assertAllowedKeys(allocationObjectValue, ["work_item_id", "weight"], `profile.metadata.allocation.manifest[${index}].allocations[${allocationIndex}]`);
      const workItemId = stringValueRequired(allocationObjectValue.work_item_id, "allocation.work_item_id");
      const weight = exactInteger(allocationObjectValue.weight, "allocation.weight");
      if (weight <= 0n) throw new ProfileError("invalid_profile_metadata", "Allocation weights must be positive integers.");
      return { work_item_id: workItemId, weight: weight.toString() } satisfies Allocation;
    });
    if (allocations.length === 0) throw new ProfileError("invalid_profile_metadata", "Allocation entries must contain at least one work item.");
    for (let allocationIndex = 1; allocationIndex < allocations.length; allocationIndex += 1) {
      if (compareStrings(allocations[allocationIndex - 1]!.work_item_id, allocations[allocationIndex]!.work_item_id) >= 0) {
        throw new ProfileError("noncanonical_profile", "Allocation work items must be sorted and unique.");
      }
    }
    return { observation_id: observationId, allocations } satisfies AllocationManifestEntry;
  });
  for (let index = 1; index < allocationManifest.length; index += 1) {
    if (compareStrings(allocationManifest[index - 1]!.observation_id, allocationManifest[index]!.observation_id) >= 0) {
      throw new ProfileError("noncanonical_profile", "Allocation manifest observations must be sorted and unique.");
    }
  }
  if (allocationPolicy === "none" && allocationManifest.length > 0) {
    throw new ProfileError("invalid_profile_metadata", "An unallocated profile cannot carry allocation entries.");
  }
  const frameManifest = arrayValue(metadataObject.frame_manifest, "profile.metadata.frame_manifest").map((item, index) => {
    const frame = objectValue(item, `profile.metadata.frame_manifest[${index}]`);
    assertAllowedKeys(frame, ["id", "name", "kind"], `profile.metadata.frame_manifest[${index}]`);
    return {
      id: stringValueRequired(frame.id, `profile.metadata.frame_manifest[${index}].id`),
      name: stringValueRequired(frame.name, `profile.metadata.frame_manifest[${index}].name`),
      kind: stringValueRequired(frame.kind, `profile.metadata.frame_manifest[${index}].kind`),
    } satisfies Frame;
  });
  const frameById = new Map<string, Frame>();
  for (const frame of frameManifest) {
    if (frameById.has(frame.id)) throw new ProfileError("invalid_profile_metadata", `Frame ${frame.id} is repeated in the manifest.`);
    frameById.set(frame.id, frame);
  }
  for (let index = 1; index < frameManifest.length; index += 1) {
    if (compareStrings(frameManifest[index - 1]!.id, frameManifest[index]!.id) >= 0) {
      throw new ProfileError("noncanonical_profile", "Frame manifest entries must be sorted and unique.");
    }
  }
  const sampleFrames = new Map<string, Frame>();
  for (const sample of sampleRecords) {
    for (const frame of sample.stack) {
      const prior = sampleFrames.get(frame.id);
      if (prior && (prior.name !== frame.name || prior.kind !== frame.kind)) {
        throw new ProfileError("frame_identity_conflict", `Frame ${frame.id} has conflicting display names.`);
      }
      sampleFrames.set(frame.id, frame);
    }
  }
  if (sampleFrames.size !== frameById.size || [...sampleFrames.keys()].some((id) => !frameById.has(id))) {
    throw new ProfileError("invalid_profile_metadata", "Frame manifest does not match sample frame identities.");
  }
  for (const [id, frame] of sampleFrames) {
    const manifestFrame = frameById.get(id)!;
    if (manifestFrame.name !== frame.name || manifestFrame.kind !== frame.kind) {
      throw new ProfileError("frame_identity_conflict", `Frame ${id} differs between samples and manifest.`);
    }
  }
  if (complete && (!sourceComplete || unknownCostObservationIds.length > 0 || issues.some((issue) => issue.severity !== "info"))) {
    throw new ProfileError("invalid_profile_completeness", "A complete profile cannot contain uncovered observations or warning/error issues.");
  }

  const normalized: ProfileWithMetadata = {
    schema_version: SCHEMA_VERSION,
    id: declaredProfileId,
    currency,
    unit,
    basis,
    valuation_id: valuationId,
    dataset_id: datasetId,
    group_by: [...groupBy],
    cost_view: costView,
    total_nanos: totalNanos.toString(),
    complete,
    samples: sampleRecords,
    issues,
    excluded_observation_ids: excludedObservationIds,
    assumptions,
    metadata: {
      projection: PROFILE_PROJECTION,
      projection_version: SCHEMA_VERSION,
      cost_view: costView,
      currency,
      unit,
      selected_observation_ids: selectedObservationIds,
      included_observation_ids: includedObservationIds,
      zero_observation_ids: zeroObservationIds,
      unknown_cost_observation_ids: unknownCostObservationIds,
      source_complete: sourceComplete,
      charges_nanos: chargesNanos.toString(),
      credits_nanos: creditsNanos.toString(),
      net_nanos: netNanos.toString(),
      signed_net_summary: { total_nanos: signedNetTotal.toString(), negative_observation_ids: negativeObservationIds },
      allocation: { policy: allocationPolicy, tie_break: "work_item_id_ascending", manifest: allocationManifest },
      root_label: rootLabel,
      selection_policy: "direct-only-v1",
      path_order: "root-first",
      frame_manifest: frameManifest,
    },
  };
  if (/^profile:[0-9a-f]{64}$/u.test(declaredProfileId) && declaredProfileId !== profileId(normalized)) {
    throw new ProfileError("noncanonical_profile_id", "profile.id does not match canonical profile semantics.");
  }
  return value as CostProfile;
}

export function createCostProfile(
  evidence: EvidenceBundle,
  valuation: Valuation,
  options: ProfileOptions = {},
): CostProfile {
  // Keep runtime callers on the same evidence contract as the valuation
  // pipeline; TypeScript annotations alone do not protect JSON entry points.
  validateEvidence(evidence);
  validateValuationShape(valuation);
  validateInputs(evidence, valuation, options);
  const groupBy = options.group_by ?? DEFAULT_GROUP_BY;
  const costView = options.cost_view ?? "charges";
  const samples: ProfileSample[] = [];
  const excludedObservationIds: string[] = [];
  const zeroObservationIds: string[] = [];
  const unknownCostObservationIds: string[] = [];
  const valueByObservation = new Map<string, bigint>();
  for (const valued of valuation.observations) {
    if (valued.amount_nanos !== null) valueByObservation.set(valued.observation_id, parseInteger(valued.amount_nanos, `valuation amount for ${valued.observation_id}`));
  }
  const netProjection = costView === "net" ? netAmounts(evidence, valueByObservation) : undefined;
  const projectionAmounts = netProjection?.effective ?? valueByObservation;
  const sortedObservations = [...evidence.observations].sort((left, right) => compareStrings(left.id, right.id));

  for (const observation of sortedObservations) {
    if (observation.accounting_scope !== "direct") {
      excludedObservationIds.push(observation.id);
      continue;
    }
    const originalAmount = valueByObservation.get(observation.id);
    if (originalAmount === undefined) {
      excludedObservationIds.push(observation.id);
      unknownCostObservationIds.push(observation.id);
      continue;
    }
    if (originalAmount === 0n) zeroObservationIds.push(observation.id);
    const amount = projectionAmounts.get(observation.id);
    if (amount === undefined) continue;
    const value = valueForView(amount, costView);
    if (value === undefined) continue;
    const allocationList = options.allocations?.[observation.id];
    const lines = allocationList
      ? allocateInteger(amount, allocationList).map((allocation) => ({
          work_item_id: allocation.work_item_id,
          value: allocation.amount < 0n ? -allocation.amount : allocation.amount,
        }))
      : [{ work_item_id: observation.work_item_id, value }];
    for (const line of lines) {
      const stack: Frame[] = [
        frameFor("root", options.root_label ?? "flAImegraph"),
        ...groupBy.map((grouping) =>
          frameFor(
            grouping,
            grouping === "work_item" && line.work_item_id !== undefined
              ? line.work_item_id
              : valueForGrouping(observation, grouping),
          ),
        ),
      ];
      samples.push({ observation_id: observation.id, stack, value_nanos: line.value.toString() });
    }
  }

  samples.sort((left, right) => {
    const stackOrder = compareStrings(
      left.stack.map((frame) => frame.id).join(";"),
      right.stack.map((frame) => frame.id).join(";"),
    );
    return stackOrder || compareStrings(left.observation_id, right.observation_id) || compareStrings(left.value_nanos, right.value_nanos);
  });

  const chargesTotal = [...valueByObservation.values()].reduce((sum, amount) => sum + (amount > 0n ? amount : 0n), 0n);
  const creditsTotal = [...valueByObservation.values()].reduce((sum, amount) => sum + (amount < 0n ? -amount : 0n), 0n);
  const netTotal = [...valueByObservation.values()].reduce((sum, amount) => sum + amount, 0n);
  const total = (costView === "charges" ? chargesTotal : costView === "credits" ? creditsTotal : [...projectionAmounts.values()].reduce((sum, amount) => sum + amount, 0n)).toString();
  const sourceComplete = evidence.sources.length > 0 && evidence.sources.every((source) => source.coverage === "complete");
  const hasBlockingIssues = [...evidence.issues, ...valuation.issues].some((issue) => issue.severity === "warning" || issue.severity === "error");
  const allocationManifest = canonicalAllocationManifest(options);
  const sourceIssues: CoverageIssue[] = evidence.sources
    .filter((source) => source.coverage !== "complete")
    .map((source) => ({
      code: source.coverage === "partial" ? "source_coverage_partial" : "source_coverage_unknown",
      message: `Source ${source.id} declares ${source.coverage} capture coverage.`,
      severity: "warning" as const,
      source_id: source.id,
    }));
  if (evidence.sources.length === 0) {
    sourceIssues.push({
      code: "source_coverage_unknown",
      message: "Evidence declares no source capture boundary.",
      severity: "warning" as const,
      source_id: undefined,
    });
  }
  const profile = {
    schema_version: SCHEMA_VERSION,
    id: "",
    currency: valuation.currency,
    unit: `nano${valuation.currency}`,
    basis: valuation.basis,
    valuation_id: valuation.id,
    dataset_id: evidence.dataset_id,
    group_by: [...groupBy],
    cost_view: costView,
    total_nanos: total,
    complete: valuation.complete && sourceComplete && unknownCostObservationIds.length === 0 && !hasBlockingIssues,
    samples,
    issues: [
      ...evidence.issues,
      ...valuation.issues,
      ...sourceIssues,
      ...unknownCostObservationIds.map((observation_id) => ({
        code: "missing_cost",
        message: "No monetary valuation is available for this direct observation.",
        severity: "warning" as const,
        observation_id,
      })),
    ],
    excluded_observation_ids: [...new Set(excludedObservationIds)].sort(),
    assumptions: [
      ...new Set([
        ...valuation.assumptions,
        "profile selects each non-null direct valuation line at most once",
        "attribution paths are synthetic and root-first; pprof reverses them to leaf-first",
        "values are exact integer nano-currency units",
        "manual allocations use largest remainders with work_item_id ascending ties",
      ]),
    ],
  };
  const profileWithMetadata = Object.assign(profile, {
    metadata: {
      projection: PROFILE_PROJECTION,
      projection_version: "0.1.0",
      cost_view: costView,
      currency: valuation.currency,
      unit: `nano${valuation.currency}`,
      selected_observation_ids: sortedObservations
        .filter((observation) => observation.accounting_scope === "direct" && valueByObservation.get(observation.id) !== undefined)
        .map((observation) => observation.id)
        .sort(),
      included_observation_ids: [...new Set(samples.map((sample) => sample.observation_id))].sort(),
      zero_observation_ids: [...new Set(zeroObservationIds)].sort(),
      unknown_cost_observation_ids: [...new Set(unknownCostObservationIds)].sort(),
      source_complete: sourceComplete,
      charges_nanos: chargesTotal.toString(),
      credits_nanos: creditsTotal.toString(),
      net_nanos: netTotal.toString(),
      root_label: options.root_label ?? "flAImegraph",
      selection_policy: valuation.selection_policy,
      path_order: "root-first",
      signed_net_summary: {
        total_nanos: netTotal.toString(),
        negative_observation_ids: [...valueByObservation.entries()]
          .filter(([, amount]) => amount < 0n)
          .map(([observationId]) => observationId)
          .sort(),
      },
      allocation: {
        policy: options.allocations ? "largest_remainder" : "none",
        tie_break: "work_item_id_ascending",
        manifest: allocationManifest,
      },
      frame_manifest: [...new Map(samples.flatMap((sample) => sample.stack.map((frame) => [frame.id, frame] as const))).values()]
        .sort((left, right) => compareStrings(left.id, right.id)),
    } satisfies ProfileMetadata,
  }) as ProfileWithMetadata;
  profileWithMetadata.id = profileId(profileWithMetadata);
  return profileWithMetadata;
}

export function exportFolded(profile: CostProfile): string {
  const validated = validateProfile(profile);
  const byPath = new Map<string, bigint>();
  const frameNames = frameNamesFor(validated.samples);
  for (const sample of validated.samples) {
    let value: bigint;
    try {
      value = BigInt(sample.value_nanos);
    } catch {
      throw new ProfileError("invalid_sample_value", `Sample ${sample.observation_id} has a non-integer value.`);
    }
    if (value < 0n) {
      throw new ProfileError("negative_folded_value", "Folded cost samples must be nonnegative.");
    }
    if (sample.stack.length === 0) {
      throw new ProfileError("empty_stack", `Sample ${sample.observation_id} has an empty attribution stack.`);
    }
    if (value === 0n) continue;
    const path = sample.stack.map((frame) => {
      const name = frameNames.get(frame.id);
      if (name === undefined) throw new ProfileError("unknown_frame", `Sample ${sample.observation_id} references an unknown frame.`);
      return name;
    }).join(";");
    byPath.set(path, (byPath.get(path) ?? 0n) + value);
  }
  return [...byPath.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([path, value]) => `${path} ${value.toString()}`)
    .join("\n");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeFrameLabel(frame: Frame): string {
  // Older callers may provide a name that already contains an identity
  // appendix. Remove that appendix before adding the compact form below so
  // profile display names do not grow on every projection.
  const withoutIdentity = frame.name.replace(/ \[id=[A-Za-z0-9_-]+\]$/u, "");
  if (
    withoutIdentity.length > 0 &&
    !withoutIdentity.includes(";") &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(withoutIdentity) &&
    !/\s/u.test(withoutIdentity)
  ) {
    return withoutIdentity;
  }
  return `${frame.kind}:${readableEncoding(withoutIdentity || frame.name)}`;
}

function frameIdentityToken(frame: Frame): string {
  const separator = frame.id.indexOf(":");
  const identity = separator >= 0 ? frame.id.slice(separator + 1) : stableEncoding(frame.id);
  return readableEncoding(identity || "empty");
}

function frameNamesFor(samples: readonly ProfileSample[]): Map<string, string> {
  const frameById = new Map<string, Frame>();
  for (const sample of samples) {
    for (const frame of sample.stack) {
      const existing = frameById.get(frame.id);
      if (existing && (existing.name !== frame.name || existing.kind !== frame.kind)) {
        throw new ProfileError("frame_identity_conflict", `Frame ${frame.id} has conflicting display names.`);
      }
      frameById.set(frame.id, frame);
    }
  }
  const frames = [...frameById.values()].sort((left, right) => compareStrings(left.id, right.id));
  const candidateById = new Map<string, string>();
  const usedNames = new Map<string, string>();
  for (const frame of frames) {
    const token = frameIdentityToken(frame);
    const base = safeFrameLabel(frame);
    let candidate = `${base} [id=${token.slice(0, 12)}]`;
    const owner = usedNames.get(candidate);
    if (owner !== undefined && owner !== frame.id) {
      // A compact prefix is enough for ordinary labels. Expand colliding
      // labels to their complete token; the full frame.id remains the
      // authoritative identity in the manifest either way.
      candidate = `${base} [id=${token}]`;
      if (usedNames.has(candidate) && usedNames.get(candidate) !== frame.id) {
        // This only occurs for malformed/manual frames whose token is not
        // derived injectively from id. The encoded full id is the final
        // deterministic disambiguator.
        candidate = `${base} [id=${token}~${stableEncoding(frame.id)}]`;
      }
    }
    usedNames.set(candidate, frame.id);
    candidateById.set(frame.id, candidate);
  }
  return candidateById;
}

interface PprofLongConstructor {
  fromString(value: string, unsigned?: boolean): { toString(): string };
}

function asLong(value: bigint, field: string): protobuf.Long {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new ProfileError("int64_overflow", `${field} does not fit in a signed int64.`);
  }
  const LongConstructor = protobuf.util.Long as unknown as PprofLongConstructor | undefined;
  if (!LongConstructor) throw new ProfileError("missing_long_support", "protobufjs Long support is unavailable.");
  return LongConstructor.fromString(value.toString(), false) as unknown as protobuf.Long;
}

let pprofType: protobuf.Type | undefined;

function getPprofType(): protobuf.Type {
  if (!pprofType) {
    const source = readFileSync(new URL("../vendor/pprof/profile.proto", import.meta.url), "utf8");
    pprofType = protobuf.parse(source).root.lookupType("perftools.profiles.Profile");
  }
  return pprofType;
}

export function exportPprof(profile: CostProfile): Uint8Array {
  const validated = validateProfile(profile);
  const type = getPprofType();
  const frameNames = frameNamesFor(validated.samples);
  const orderedSamples = [...validated.samples].sort((left, right) => {
    const stackOrder = compareStrings(
      left.stack.map((frame) => frame.id).join(";"),
      right.stack.map((frame) => frame.id).join(";"),
    );
    return stackOrder || compareStrings(left.observation_id, right.observation_id) || compareStrings(left.value_nanos, right.value_nanos);
  });
  const strings: string[] = [""];
  const stringIndices = new Map<string, number>([["", 0]]);
  const stringIndex = (value: string): protobuf.Long => {
    let index = stringIndices.get(value);
    if (index === undefined) {
      index = strings.length;
      strings.push(value);
      stringIndices.set(value, index);
    }
    return asLong(BigInt(index), `string table index for ${value}`);
  };

  const frameById = new Map<string, Frame>();
  for (const sample of orderedSamples) {
    for (const frame of sample.stack) frameById.set(frame.id, frame);
  }
  const frames = [...frameById.values()].sort((left, right) => compareStrings(left.id, right.id));
  const locationIds = new Map<string, protobuf.Long>();
  const functions = frames.map((frame, index) => {
    const id = asLong(BigInt(index + 1), "pprof location id");
    locationIds.set(frame.id, id);
    const name = frameNames.get(frame.id);
    if (name === undefined) throw new ProfileError("unknown_frame", `Frame ${frame.id} is not present in the sample map.`);
    return {
      id,
      name: stringIndex(name),
      systemName: stringIndex(name),
      filename: stringIndex(""),
      startLine: asLong(0n, "function start line"),
    };
  });
  const locations = functions.map((func) => ({
    id: func.id,
    line: [{ functionId: func.id, line: asLong(0n, "line number"), column: asLong(0n, "column number") }],
  }));
  const labelKey = (name: string) => stringIndex(name);
  const labelsFor = (sample: ProfileSample) => [
    { key: labelKey("observation"), str: stringIndex(sample.observation_id) },
    { key: labelKey("valuation"), str: stringIndex(validated.valuation_id) },
    { key: labelKey("dataset"), str: stringIndex(validated.dataset_id) },
    { key: labelKey("flAImegraph.cost_view"), str: stringIndex(validated.cost_view) },
    { key: labelKey("flAImegraph.currency"), str: stringIndex(validated.currency) },
  ];
  const samples = orderedSamples.map((sample) => {
    let value: bigint;
    try {
      value = BigInt(sample.value_nanos);
    } catch {
      throw new ProfileError("invalid_sample_value", `Sample ${sample.observation_id} has a non-integer value.`);
    }
    if (value < 0n) throw new ProfileError("negative_pprof_value", "Pprof cost samples must be nonnegative.");
    const locationId = sample.stack
      .slice()
      .reverse()
      .map((frame) => locationIds.get(frame.id));
    if (locationId.some((id) => id === undefined)) {
      throw new ProfileError("unknown_frame", `Sample ${sample.observation_id} references an unknown frame.`);
    }
    return {
      locationId,
      value: [asLong(value, `sample ${sample.observation_id}`)],
      label: labelsFor(sample),
    };
  });
  const object = {
    sampleType: [{ type: stringIndex("cost"), unit: stringIndex(validated.unit) }],
    sample: samples,
    location: locations,
    function: functions,
    stringTable: strings,
    docUrl: stringIndex(PROFILE_DOC_URL),
  };
  const message = type.fromObject(object);
  return gzipSync(type.encode(message).finish());
}

type OtlpAttribute = { key: string; value: Record<string, unknown> };

function stringValue(value: string): OtlpAttribute["value"] {
  return { stringValue: value };
}

function attribute(key: string, value: string | number | boolean): OtlpAttribute {
  if (typeof value === "string") return { key, value: stringValue(value) };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (Number.isInteger(value) && Number.isSafeInteger(value)) {
    return { key, value: { intValue: String(value) } };
  }
  return { key, value: { doubleValue: value } };
}

function integerAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { intValue: value } };
}

function deterministicHex(seed: string, length: 32 | 16): string {
  let result = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, length);
  if (/^0+$/.test(result)) result = `${"1"}${result.slice(1)}`;
  return result;
}

function isValidTraceId(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{32}$/iu.test(value) && !/^0+$/u.test(value);
}

function isValidSpanId(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{16}$/iu.test(value) && !/^0+$/u.test(value);
}

function traceparentParts(value: string | undefined): { traceId: string; spanId: string; flags: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/iu.exec(value);
  if (!match || !isValidTraceId(match[1]) || !isValidSpanId(match[2])) return undefined;
  return { traceId: match[1]!.toLowerCase(), spanId: match[2]!.toLowerCase(), flags: Number.parseInt(match[3]!, 16) };
}

function floorDivide(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder < 0n ? quotient - 1n : quotient;
}

function daysFromCivil(year: bigint, month: bigint, day: bigint): bigint {
  const adjustedYear = year - (month <= 2n ? 1n : 0n);
  const era = floorDivide(adjustedYear, 400n);
  const yearOfEra = adjustedYear - era * 400n;
  const monthPrime = month + (month > 2n ? -3n : 9n);
  const dayOfYear = (153n * monthPrime + 2n) / 5n + day - 1n;
  const dayOfEra = yearOfEra * 365n + yearOfEra / 4n - yearOfEra / 100n + dayOfYear;
  return era * 146097n + dayOfEra - 719468n;
}

function timestampToUnixNano(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (/^-?\d+$/u.test(value)) {
    try {
      const integer = BigInt(value);
      return integer >= 0n ? integer.toString() : undefined;
    } catch {
      return undefined;
    }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return undefined;
  const year = BigInt(match[1]!);
  const month = BigInt(match[2]!);
  const day = BigInt(match[3]!);
  const hour = BigInt(match[4]!);
  const minute = BigInt(match[5]!);
  const second = BigInt(match[6]!);
  const zone = match[8]!;
  const offsetMinutes = zone === "Z" ? 0n : BigInt(zone.slice(1, 3)) * 60n + BigInt(zone.slice(4, 6));
  const signedOffsetMinutes = zone === "Z" || zone[0] === "+" ? offsetMinutes : -offsetMinutes;
  const fraction = (match[7] ?? "").padEnd(9, "0").slice(0, 9);
  const nanos = BigInt(fraction || "0");
  const seconds = daysFromCivil(year, month, day) * 86400n + hour * 3600n + minute * 60n + second - signedOffsetMinutes * 60n;
  const total = seconds * 1_000_000_000n + nanos;
  return total >= 0n ? total.toString() : undefined;
}

function sourceAttributeName(key: string): string {
  return `flAImegraph.source_attribute.${readableEncoding(key)}`;
}

function arrayAttribute(values: string[]): Record<string, unknown> {
  return { arrayValue: { values: values.map((value) => stringValue(value)) } };
}

function uniqueAttributes(attributes: OtlpAttribute[], context: string): OtlpAttribute[] {
  const seen = new Set<string>();
  for (const item of attributes) {
    if (seen.has(item.key)) {
      throw new ProfileError("duplicate_otlp_attribute", `${context} contains duplicate attribute key ${item.key}.`);
    }
    seen.add(item.key);
  }
  return attributes;
}

export function exportOtlp(evidence: EvidenceBundle): object {
  // Reconciliation is deliberately part of this boundary. It validates the
  // evidence contract, coalesces idempotent replay, and rejects a conflicting
  // duplicate observation before any OTLP identity is assigned.
  const normalizedEvidence = reconcileEvidence([evidence]);
  const observations = [...normalizedEvidence.observations].sort((left, right) => compareStrings(left.id, right.id));
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  const traceparentById = new Map<string, ReturnType<typeof traceparentParts>>();
  const traceIdById = new Map<string, string>();
  const generatedTraceIdById = new Map<string, boolean>();
  const spanIdById = new Map<string, string>();
  const generatedSpanIdById = new Map<string, boolean>();

  type ParentEdge = { parentId: string; childId: string };
  const parentEdges: ParentEdge[] = [];
  const parentEdgeKeys = new Set<string>();
  const parentByChild = new Map<string, string>();
  const parentConflictChildren = new Set<string>();
  const addParentEdge = (parentId: string, childId: string): void => {
    if (!observationsById.has(parentId) || !observationsById.has(childId)) return;
    const key = `${parentId}\u0000${childId}`;
    if (!parentEdgeKeys.has(key)) {
      parentEdgeKeys.add(key);
      parentEdges.push({ parentId, childId });
    }
    const prior = parentByChild.get(childId);
    if (prior !== undefined && prior !== parentId) {
      parentConflictChildren.add(childId);
    } else if (!parentConflictChildren.has(childId)) {
      parentByChild.set(childId, parentId);
    }
  };
  for (const observation of observations) {
    if (observation.parent_id !== undefined) addParentEdge(observation.parent_id, observation.id);
  }
  for (const relationship of normalizedEvidence.relationships) {
    if (relationship.kind === "parent") addParentEdge(relationship.from, relationship.to);
  }

  // Parent edges define the connected components whose trace identity must be
  // coherent. A source trace/traceparent identity is authoritative when the
  // component agrees; a component without one receives one deterministic
  // generated trace ID. Conflicting source identities stay visible on their
  // spans, but cannot be emitted as cross-trace OTLP parent links.
  const observationIndex = new Map(observations.map((observation, index) => [observation.id, index]));
  const roots = observations.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (roots[root] !== root) root = roots[root]!;
    while (roots[index] !== index) {
      const next = roots[index]!;
      roots[index] = root;
      index = next;
    }
    return root;
  };
  const unionRoots = (left: number, right: number): void => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) roots[rightRoot] = leftRoot;
  };
  for (const edge of parentEdges) {
    const parentIndex = observationIndex.get(edge.parentId);
    const childIndex = observationIndex.get(edge.childId);
    if (parentIndex !== undefined && childIndex !== undefined) unionRoots(parentIndex, childIndex);
  }
  const componentMembers = new Map<number, string[]>();
  for (const observation of observations) {
    const root = findRoot(observationIndex.get(observation.id)!);
    const members = componentMembers.get(root) ?? [];
    members.push(observation.id);
    componentMembers.set(root, members);
  }
  for (const members of componentMembers.values()) {
    members.sort(compareStrings);
  }

  const usedSpanIds = new Set<string>();
  const reservedNativeSpanIds = new Set(
    observations
      .map((observation) => (isValidSpanId(observation.span_id) ? observation.span_id.toLowerCase() : undefined))
      .filter((value): value is string => value !== undefined),
  );
  const firstNativeSpanOwner = new Map<string, string>();
  for (const observation of observations) {
    if (isValidSpanId(observation.span_id)) {
      const spanId = observation.span_id.toLowerCase();
      if (!firstNativeSpanOwner.has(spanId)) firstNativeSpanOwner.set(spanId, observation.id);
    }
  }

  for (const observation of observations) {
    const rawAttributes = observation.attributes ?? {};
    const traceparent = typeof rawAttributes.traceparent === "string" ? rawAttributes.traceparent : undefined;
    const parsedTraceparent = traceparentParts(traceparent);
    traceparentById.set(observation.id, parsedTraceparent);
    let spanId = isValidSpanId(observation.span_id) && firstNativeSpanOwner.get(observation.span_id.toLowerCase()) === observation.id
      ? observation.span_id.toLowerCase()
      : "";
    if (!spanId || usedSpanIds.has(spanId)) {
      let attempt = 0;
      do {
        spanId = deterministicHex(`span:${normalizedEvidence.dataset_id}:${observation.id}:${attempt}`, 16);
        attempt += 1;
      } while (usedSpanIds.has(spanId) || reservedNativeSpanIds.has(spanId));
    }
    usedSpanIds.add(spanId);
    spanIdById.set(observation.id, spanId);
    generatedSpanIdById.set(observation.id, !isValidSpanId(observation.span_id) || firstNativeSpanOwner.get(observation.span_id.toLowerCase()) !== observation.id);
  }

  const exportDiagnostics = new Set<string>();
  const diagnosticsByObservation = new Map<string, string[]>();
  const addDiagnostic = (message: string, observationIds: string[] = []): void => {
    exportDiagnostics.add(message);
    for (const observationId of observationIds) {
      const diagnostics = diagnosticsByObservation.get(observationId) ?? [];
      if (!diagnostics.includes(message)) diagnostics.push(message);
      diagnosticsByObservation.set(observationId, diagnostics);
    }
  };

  for (const [root, members] of componentMembers) {
    const candidates = new Set<string>();
    for (const observationId of members) {
      const observation = observationsById.get(observationId)!;
      if (isValidTraceId(observation.trace_id)) candidates.add(observation.trace_id.toLowerCase());
      const rawAttributes = observation.attributes ?? {};
      const traceparent = typeof rawAttributes.traceparent === "string" ? rawAttributes.traceparent : undefined;
      const parsedTraceparent = traceparentParts(traceparent);
      if (parsedTraceparent) candidates.add(parsedTraceparent.traceId);
    }
    const sortedCandidates = [...candidates].sort(compareStrings);
    const conflict = sortedCandidates.length > 1;
    const sharedTraceId = conflict
      ? undefined
      : sortedCandidates[0] ?? deterministicHex(`trace:${normalizedEvidence.dataset_id}:${members.join("\u001f")}`, 32);
    if (conflict) {
      addDiagnostic(
        `Connected parent component ${members.join(", ")} contains conflicting source trace identities; affected OTLP parent links are omitted.`,
        members,
      );
    }
    for (const observationId of members) {
      const observation = observationsById.get(observationId)!;
      const nativeTraceId = isValidTraceId(observation.trace_id) ? observation.trace_id.toLowerCase() : undefined;
      const rawAttributes = observation.attributes ?? {};
      const traceparent = typeof rawAttributes.traceparent === "string" ? rawAttributes.traceparent : undefined;
      const parsedTraceparent = traceparentParts(traceparent);
      const traceId = conflict
        ? nativeTraceId ?? parsedTraceparent?.traceId ?? deterministicHex(`trace-conflict:${normalizedEvidence.dataset_id}:${observationId}`, 32)
        : sharedTraceId!;
      traceIdById.set(observationId, traceId);
      generatedTraceIdById.set(observationId, nativeTraceId === undefined && parsedTraceparent === undefined);
      if (nativeTraceId && parsedTraceparent?.traceId && nativeTraceId !== parsedTraceparent.traceId) {
        addDiagnostic(`Observation ${observationId} supplies conflicting trace_id and traceparent identities.`, [observationId]);
      }
    }
    // `root` is only used to make the iteration's intent explicit and to keep
    // this component traversal independent of object insertion order.
    void root;
  }

  for (const edge of parentEdges) {
    const childTraceId = traceIdById.get(edge.childId);
    const parentTraceId = traceIdById.get(edge.parentId);
    if (childTraceId !== parentTraceId) {
      addDiagnostic(
        `OTLP parentSpanId omitted for ${edge.childId}: asserted parent ${edge.parentId} has a different trace identity.`,
        [edge.childId],
      );
    }
  }
  for (const observationId of parentConflictChildren) {
    addDiagnostic(`OTLP parentSpanId omitted for ${observationId}: evidence contains conflicting parent relationships.`, [observationId]);
  }

  const resourceAttributes: OtlpAttribute[] = [
    attribute("service.name", "flAImegraph"),
    attribute("flAImegraph.dataset_id", normalizedEvidence.dataset_id),
    attribute("flAImegraph.schema_version", normalizedEvidence.schema_version),
  ];
  if (exportDiagnostics.size > 0) {
    resourceAttributes.push({ key: "flAImegraph.export_diagnostics", value: arrayAttribute([...exportDiagnostics].sort(compareStrings)) });
  }
  const spans = observations.map((observation) => {
    const rawAttributes = observation.attributes ?? {};
    const parsedTraceparent = traceparentById.get(observation.id);
    const attributes: OtlpAttribute[] = [
      attribute("flAImegraph.observation_id", observation.id),
      attribute("flAImegraph.observation.kind", observation.kind),
      attribute("flAImegraph.accounting_scope", observation.accounting_scope),
      attribute("flAImegraph.status", observation.status),
      attribute("flAImegraph.operation", observation.operation),
      { key: "flAImegraph.source_refs", value: arrayAttribute(observation.source_refs.map((sourceRef) => `${sourceRef.source_id}:${sourceRef.record}`)) },
    ];
    if (observation.subject_id !== undefined) attributes.push(attribute("flAImegraph.subject_id", observation.subject_id));
    if (observation.grain !== undefined) attributes.push(attribute("flAImegraph.grain", observation.grain));
    if (observation.count_basis !== undefined) attributes.push(attribute("flAImegraph.count_basis", observation.count_basis));
    if (observation.model_identity !== undefined) attributes.push(attribute("flAImegraph.model_identity", observation.model_identity));
    if (observation.trace_id !== undefined) {
      attributes.push(attribute("flAImegraph.original_trace_id", observation.trace_id));
    }
    if (observation.span_id !== undefined) {
      attributes.push(attribute("flAImegraph.original_span_id", observation.span_id));
    }
    if (observation.parent_id !== undefined) attributes.push(attribute("flAImegraph.original_parent_id", observation.parent_id));
    const parentObservationId = parentByChild.get(observation.id);
    if (parentObservationId !== undefined && observation.parent_id === undefined) {
      attributes.push(attribute("flAImegraph.parent_observation_id", parentObservationId));
    }
    if (rawAttributes.traceparent !== undefined) {
      attributes.push(attribute("flAImegraph.traceparent", String(rawAttributes.traceparent)));
    }
    attributes.push(attribute("flAImegraph.normalized_trace_id", traceIdById.get(observation.id)!));
    attributes.push(attribute("flAImegraph.normalized_span_id", spanIdById.get(observation.id)!));
    if (generatedTraceIdById.get(observation.id) === true) attributes.push(attribute("flAImegraph.trace_id_generated", true));
    if (generatedSpanIdById.get(observation.id) === true) attributes.push(attribute("flAImegraph.span_id_generated", true));
    if (observation.timestamp !== undefined) attributes.push(attribute("flAImegraph.timestamp", observation.timestamp));
    if (observation.end_time !== undefined) attributes.push(attribute("flAImegraph.end_time", observation.end_time));
    const observationDiagnostics = diagnosticsByObservation.get(observation.id);
    if (observationDiagnostics && observationDiagnostics.length > 0) {
      attributes.push(attribute("flAImegraph.export_diagnostic", observationDiagnostics.join(" ")));
    }
    if (observation.agent_id !== undefined) attributes.push(attribute("flAImegraph.agent_id", observation.agent_id));
    if (observation.session_id !== undefined) attributes.push(attribute("flAImegraph.session_id", observation.session_id));
    if (observation.turn_id !== undefined) attributes.push(attribute("flAImegraph.turn_id", observation.turn_id));
    if (observation.work_item_id !== undefined) attributes.push(attribute("flAImegraph.work_item_id", observation.work_item_id));
    if (observation.product !== undefined) attributes.push(attribute("flAImegraph.product", observation.product));
    if (observation.model !== undefined) {
      attributes.push(attribute("flAImegraph.model", observation.model));
      if (observation.kind === "model" && observation.model_identity === "response") {
        attributes.push(attribute("gen_ai.response.model", observation.model));
      } else if (observation.kind === "model" && observation.model_identity === "setting") {
        attributes.push(attribute("gen_ai.request.model", observation.model));
      }
    }
    if (observation.provider !== undefined) {
      attributes.push(attribute("flAImegraph.provider", observation.provider));
      if (observation.kind === "model") {
        attributes.push(attribute("gen_ai.provider.name", observation.provider));
      }
    }
    if (observation.kind === "model") {
      attributes.push(attribute("gen_ai.operation.name", observation.operation));
      if (observation.usage) {
        const usage = observation.usage;
        if (usage.input_tokens !== null) {
          attributes.push(integerAttribute("gen_ai.usage.input_tokens", usage.input_tokens));
          attributes.push(integerAttribute("flAImegraph.usage.input_tokens", usage.input_tokens));
        }
        if (usage.output_tokens !== null) {
          attributes.push(integerAttribute("gen_ai.usage.output_tokens", usage.output_tokens));
          attributes.push(integerAttribute("flAImegraph.usage.output_tokens", usage.output_tokens));
        }
        if (usage.cache_read_input_tokens !== null) {
          attributes.push(integerAttribute("flAImegraph.usage.cache_read_input_tokens", usage.cache_read_input_tokens));
        }
        if (usage.cache_write_input_tokens !== null) {
          attributes.push(integerAttribute("flAImegraph.usage.cache_write_input_tokens", usage.cache_write_input_tokens));
        }
        if (usage.reasoning_output_tokens !== null) {
          attributes.push(integerAttribute("flAImegraph.usage.reasoning_output_tokens", usage.reasoning_output_tokens));
        }
        if (usage.unclassified_tokens !== undefined && usage.unclassified_tokens !== null) {
          attributes.push(integerAttribute("flAImegraph.usage.unclassified_tokens", usage.unclassified_tokens));
        }
      }
    }
    if (observation.recorded_cost) {
      attributes.push(attribute("flAImegraph.recorded_cost.amount", observation.recorded_cost.amount));
      attributes.push(attribute("flAImegraph.recorded_cost.currency", observation.recorded_cost.currency));
      attributes.push(attribute("flAImegraph.recorded_cost.basis", observation.recorded_cost.basis));
    }
    for (const [key, value] of Object.entries(rawAttributes)) {
      if (key !== "traceparent") {
        attributes.push(attribute(sourceAttributeName(key), value));
      }
    }

    let parentSpanId: string | undefined;
    const parentObservation = parentByChild.get(observation.id);
    if (parentObservation !== undefined && !parentConflictChildren.has(observation.id)) {
      const parentTraceId = traceIdById.get(parentObservation);
      if (parentTraceId === traceIdById.get(observation.id)) {
        parentSpanId = spanIdById.get(parentObservation);
      }
    } else if (parentObservation === undefined && parsedTraceparent && parsedTraceparent.traceId === traceIdById.get(observation.id)) {
      parentSpanId = parsedTraceparent.spanId;
    }
    const uniqueSpanAttributes = uniqueAttributes(attributes, `observation ${observation.id}`);
    const span: Record<string, unknown> = {
      traceId: traceIdById.get(observation.id),
      spanId: spanIdById.get(observation.id),
      name: observation.operation,
      kind: 1,
      attributes: uniqueSpanAttributes,
    };
    if (parentSpanId) span.parentSpanId = parentSpanId;
    const traceparentFlags = parsedTraceparent?.flags;
    if (traceparentFlags !== undefined) span.flags = traceparentFlags;
    const startTimeUnixNano = timestampToUnixNano(observation.timestamp);
    const endTimeUnixNano = timestampToUnixNano(observation.end_time);
    if (startTimeUnixNano !== undefined) span.startTimeUnixNano = startTimeUnixNano;
    if (endTimeUnixNano !== undefined) span.endTimeUnixNano = endTimeUnixNano;
    if (observation.status === "ok") span.status = { code: 1 };
    else if (observation.status === "error" || observation.status === "cancelled") {
      span.status = { code: 2, message: observation.status };
    } else span.status = { code: 0 };
    return span;
  });

  uniqueAttributes(resourceAttributes, "OTLP resource");
  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes },
        scopeSpans: [
          {
            scope: { name: "flAImegraph", version: "0.1.0" },
            spans,
          },
        ],
      },
    ],
  };
}
