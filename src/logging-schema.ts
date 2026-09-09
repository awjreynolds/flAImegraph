/** Portable syntax schemas. Graph, identity, calendar and hash invariants also require semantic validation. */
export type LoggingSchemaKind = "usage" | "lifecycle" | "lifecycle-event" | "journal-frame";
type Schema = Record<string, unknown>;
const text: Schema = { type: "string", minLength: 1 };
const integer: Schema = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const enumeration = (...values: string[]): Schema => ({ enum: values });
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const array = (items: Schema): Schema => ({ type: "array", items });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const map = (values: Schema): Schema => ({ type: "object", propertyNames: text, additionalProperties: values });
const evidence = enumeration("observed", "declared", "derived", "estimated", "unknown");
const utc = (fraction: string): Schema => ({ type: "string", pattern: `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]${fraction})?Z$` });
const unknownWhenNull = {
  if: { properties: { value: { type: "null" } }, required: ["value"] },
  then: { properties: { evidence: { const: "unknown" } } },
  else: { properties: { evidence: { not: { const: "unknown" } } } },
};
const factFields = { value: { type: ["string", "number", "boolean", "null"] }, evidence, method: text, source_refs: array(ref("source-ref")) };
const measurementFields = { value: nullable({ type: "string", pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$" }), evidence, method: text, source_refs: array(ref("source-ref")), count_basis: enumeration("provider_native", "consumed", "billable", "allocated", "unknown"), aggregation: enumeration("delta", "cumulative", "unknown"), scope: enumeration("event", "interval", "snapshot", "aggregate", "unknown") };
const dimensionNames = ["requested_provider", "actual_provider", "provider", "service", "product", "api_operation", "requested_model", "actual_model", "model", "requested_tier", "actual_tier", "tier", "requested_reasoning", "actual_reasoning", "reasoning", "requested_region", "actual_region", "region", "cache_ttl", "cache_behavior", "deployment", "sku"];
const associationNames = ["parent_id", "retry_of", "work_item_id", "task_id", "agent_id", "session_id"];
const associations = Object.fromEntries(associationNames.map(name => [name, nullable(text)]));
const hash: Schema = { type: "string", pattern: "^[a-f0-9]{64}$" };
const defs: Record<string, Schema> = {
  "source-ref": object({ source_id: text, record: text }),
  source: object({ id: text, harness: text, format: text, version: text, sha256: { type: "string", pattern: "^[A-Fa-f0-9]{64}$" }, coverage: enumeration("complete", "partial", "unknown"), description: text }, ["id", "harness", "format", "coverage"]),
  fact: { ...object(factFields), allOf: [unknownWhenNull] },
  timestamp: { ...object({ ...factFields, value: nullable(utc("+")) }), allOf: [unknownWhenNull] },
  dimensions: object({ ...Object.fromEntries(dimensionNames.map(name => [name, ref("fact")])), extensions: { type: "object", propertyNames: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*(?:[.:/][A-Za-z0-9_.:/-]+)+$" }, additionalProperties: ref("fact") } }, []),
  meter: object({ id: text, unit: text, description: text, subset_of: nullable(text), overlap: enumeration("disjoint", "subset", "overlap", "unknown") }),
  measurement: { ...object(measurementFields), allOf: [unknownWhenNull] },
  "event-measurement": { ...object(Object.fromEntries(Object.entries(measurementFields).filter(([key]) => key !== "source_refs"))), allOf: [unknownWhenNull] },
  observation: object({ id: text, source_refs: array(ref("source-ref")), subject: nullable(text), accounting_scope: enumeration("direct", "aggregate", "snapshot", "unknown"), operation_id: nullable(text), ...Object.fromEntries(associationNames.filter(name => name !== "retry_of").map(name => [name, nullable(text)])), status: enumeration("running", "ok", "error", "cancelled", "unknown"), ...Object.fromEntries(["event_at", "started_at", "ended_at", "collected_at"].map(name => [name, nullable(ref("timestamp"))])), measurements: map(ref("measurement")), dimensions: ref("dimensions") }),
  "usage-issue": object({ code: text, message: text, severity: enumeration("info", "warning", "error"), observation_id: text, meter_id: text, source_id: text }, ["code", "message", "severity"]),
  coverage: { ...object({ boundary: enumeration("instrumented", "native_transcript", "mixed", "unknown"), complete: { type: "boolean" }, dropped_observations: integer, dropped_by_source: map(integer), limitations: array(text) }, ["boundary", "complete", "dropped_observations", "limitations"]), allOf: [{ if: { properties: { complete: { const: true } }, required: ["complete"] }, then: { properties: { dropped_observations: { const: 0 } } } }] },
  usage: object({ schema_version: { const: "0.4.0" }, dataset_id: text, sources: array(ref("source")), meters: array(ref("meter")), observations: array(ref("observation")), coverage: ref("coverage"), issues: array(ref("usage-issue")) }, ["schema_version", "dataset_id", "sources", "meters", "observations"]),
  reason: { ...object({ code: enumeration("quota", "rate_limit", "network", "service", "sleep", "user", "unknown"), evidence: enumeration("observed", "declared", "unknown"), method: text, reset_at: nullable(utc("{1,9}")) }, ["code", "evidence", "method"]), allOf: [{ if: { properties: { code: { const: "unknown" } }, required: ["code"] }, then: { properties: { evidence: { const: "unknown" } } }, else: { properties: { evidence: { not: { const: "unknown" } } } } }] },
  data: { oneOf: [object({ kind: { const: "epoch" } }), object({ kind: { const: "start" }, action_id: text, subject: text, ...associations, dimensions: ref("dimensions") }, ["kind", "action_id", "subject"]), object({ kind: { const: "pause" }, action_id: text, reason: ref("reason") }), ...["resume", "heartbeat"].map(kind => object({ kind: { const: kind }, action_id: text })), object({ kind: { const: "end" }, action_id: text, status: enumeration("ok", "error", "cancelled", "unknown"), reason: ref("reason") }, ["kind", "action_id", "status"]), object({ kind: { const: "measurement" }, action_id: text, meter: ref("meter"), measurement: ref("event-measurement") })] },
  "lifecycle-event": { ...object({ schema_version: { const: "0.5.0" }, dataset_id: text, producer_id: text, epoch: text, sequence: integer, event_id: text, wall_at: utc("{1,9}"), monotonic_ns: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }, data: ref("data") }), allOf: [{ if: { properties: { sequence: { const: 0 } }, required: ["sequence"] }, then: { properties: { data: { type: "object", properties: { kind: { const: "epoch" } } } } }, else: { properties: { data: { type: "object", properties: { kind: { not: { const: "epoch" } } } } } } }] },
  "lifecycle-issue": object({ code: text, message: text, action_id: text }, ["code", "message"]),
  lifecycle: object({ schema_version: { const: "0.5.0" }, kind: { const: "lifecycle" }, dataset_id: text, events: array(ref("lifecycle-event")), issues: array(ref("lifecycle-issue")) }),
  "journal-frame": object({ event: ref("lifecycle-event"), previous_hash: nullable(hash), hash }),
};

export const LOGGING_SCHEMA_KINDS: readonly LoggingSchemaKind[] = ["usage", "lifecycle", "lifecycle-event", "journal-frame"];
/** Self-contained Draft 2020-12 schema; consumers need no network resolution. */
export function getLoggingSchema(kind: LoggingSchemaKind): Schema {
  if (!LOGGING_SCHEMA_KINDS.includes(kind)) throw new Error(`Unknown logging schema: ${kind}`);
  const version = kind === "usage" ? "0.4" : "0.5";
  return structuredClone({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://raw.githubusercontent.com/awjreynolds/flAImegraph/main/spec/${version}/${kind}.schema.json`, title: `flAImegraph ${kind} ${version}`, $comment: "Structural validation only. Apply the normative semantic and journal integrity rules before accepting evidence.", $ref: `#/$defs/${kind}`, $defs: defs });
}
