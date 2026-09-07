import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import type { OperationBundle } from "./operation-types.js";
import { OPERATION_IO_MEASURES } from "./operation-types.js";

let shape: ValidateFunction | undefined;
export class OperationError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "OperationError"; }
}
function fail(code: string, message: string): never { throw new OperationError(code, message); }

/** Validate transport shape and actual execution ancestry without guessing missing parents. */
export function validateOperationBundle(value: unknown): OperationBundle {
  shape ??= new Ajv({ strict: true, allErrors: true, allowUnionTypes: true }).compile(JSON.parse(readFileSync(new URL("../spec/0.3/schemas/operations.schema.json", import.meta.url), "utf8")));
  if (!shape(value)) fail("OPERATION_SCHEMA_INVALID", `Invalid operations: ${shape.errors?.[0]?.instancePath} ${shape.errors?.[0]?.message}`);
  const bundle = value as OperationBundle;
  const spans = new Map(bundle.spans.map(span => [span.id, span]));
  if (spans.size !== bundle.spans.length) fail("OPERATION_DUPLICATE", "Duplicate operation identity");
  const sources = new Set(bundle.artifacts.map(source => source.id));
  if (sources.size !== bundle.artifacts.length) fail("OPERATION_DUPLICATE", "Duplicate operation source identity");
  const sequences = new Set<string>();
  const observations = new Set<string>();
  if (bundle.coverage.complete && bundle.coverage.dropped_spans > 0) fail("OPERATION_COVERAGE", "Complete coverage cannot contain dropped spans");
  if (bundle.coverage.complete && (bundle.coverage.boundary !== "instrumented" || bundle.artifacts.some(source => source.coverage !== "complete"))) fail("OPERATION_COVERAGE", "Complete operation coverage requires instrumented boundaries and complete supporting artifacts");
  const dropSum = Object.values(bundle.coverage.dropped_spans_by_stream).reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(dropSum) || dropSum !== bundle.coverage.dropped_spans) fail("OPERATION_COVERAGE", "Dropped spans must equal the cumulative per-stream loss counters");
  const linkDropSum = Object.values(bundle.coverage.dropped_links_by_stream).reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(linkDropSum) || linkDropSum !== bundle.coverage.dropped_links || (bundle.coverage.complete && linkDropSum > 0)) fail("OPERATION_COVERAGE", "Dropped links must equal the per-stream loss counters and imply incomplete coverage");
  for (const span of bundle.spans) {
    const sequence = JSON.stringify([span.stream_id, span.sequence]);
    if (sequences.has(sequence)) fail("OPERATION_SEQUENCE", `Duplicate sequence in stream ${span.stream_id}`);
    sequences.add(sequence);
    if ((span.parent_id === null) !== (span.parentage === null)) fail("OPERATION_PARENT", "Parent identity and parentage evidence must be supplied together");
    if (span.parent_id !== null && !spans.has(span.parent_id)) fail("OPERATION_PARENT", `Missing execution parent for ${span.id}`);
    if (span.parentage?.evidence === "unknown") fail("OPERATION_PARENT", "An unknown parent must not create execution ancestry");
    if (span.source_refs.length === 0 || span.source_refs.some(ref => !sources.has(ref.source_id))) fail("OPERATION_SOURCE", `Missing provenance source for ${span.id}`);
    if (span.observation_id !== null) {
      if (observations.has(span.observation_id)) fail("OPERATION_OBSERVATION", "An observation may bind to at most one operation");
      observations.add(span.observation_id);
    }
    for (const time of [span.started_at, span.ended_at]) if (time !== null && !Number.isFinite(Date.parse(time))) fail("OPERATION_TIME", "Invalid operation timestamp");
    if (span.started_at !== null && span.ended_at !== null && Date.parse(span.ended_at) < Date.parse(span.started_at)) fail("OPERATION_TIME", "Operation end time precedes start time");
    for (const measure of ["started_at", "ended_at", "duration_ns"] as const) {
      if ((span[measure] === null) !== (span.timing[measure].evidence === "unknown")) fail("OPERATION_TIMING", `Timing ${measure}: unknown evidence requires null, present values require timing evidence`);
    }
    if ((span.duration_ns === null) !== (span.timing.duration_ns.clock === "unknown")) fail("OPERATION_TIMING", "Duration clock must be specified only with a known duration");
    if (span.status === "running" && span.ended_at !== null) fail("OPERATION_TIMING", "Running operation cannot have an end timestamp");
    if (span.io?.requested_range?.end_line != null && span.io.requested_range.end_line < span.io.requested_range.start_line) fail("OPERATION_RANGE", "Invalid requested line range");
    if (span.io !== null) for (const measure of OPERATION_IO_MEASURES) {
      if ((span.io[measure] === null) !== (span.io.measurements[measure].evidence === "unknown")) fail("OPERATION_MEASUREMENT", `IO ${measure}: unknown evidence requires null, measured values require their own evidence and method`);
    }
  }
  const linkIds = new Set<string>();
  for (const link of bundle.links) {
    const identity = canonical(link);
    if (linkIds.has(identity)) fail("OPERATION_LINK", "Duplicate operation link");
    linkIds.add(identity);
    if (link.source_refs.length === 0 || link.source_refs.some(ref => !sources.has(ref.source_id))) fail("OPERATION_PROVENANCE", "Link provenance must resolve to operation artifacts");
    if (!spans.has(link.from_operation_id)) fail("OPERATION_LINK", "Unknown link source operation");
    if (link.kind === "depends_on" || link.kind === "delegates") {
      if (link.to_operation_id === null || !spans.has(link.to_operation_id) || link.context_revision_id !== null || link.request_id !== null || link.occurrence_id !== null) fail("OPERATION_LINK", "Operation dependency needs only a target operation");
      if (link.to_operation_id === link.from_operation_id) fail("OPERATION_LINK", "Operation cannot have a self dependency or delegation");
    } else if (link.to_operation_id !== null || link.context_revision_id === null) fail("OPERATION_LINK", "Context link needs a context revision and no target operation");
    if (link.kind === "produces_context" && (link.request_id !== null || link.occurrence_id !== null)) fail("OPERATION_LINK", "Production link cannot identify a consuming occurrence");
    if (link.kind === "consumes_context" && (link.request_id === null || link.occurrence_id === null)) fail("OPERATION_LINK", "Consumption link requires a request and occurrence");
  }
  const done = new Set<string>();
  for (const span of bundle.spans) {
    const active = new Set<string>();
    let current: typeof span | undefined = span;
    while (current && !done.has(current.id)) {
      if (active.has(current.id)) fail("OPERATION_CYCLE", `Execution parent cycle at ${current.id}`);
      active.add(current.id);
      current = current.parent_id === null ? undefined : spans.get(current.parent_id);
    }
    for (const id of active) done.add(id);
  }
  return structuredClone(bundle);
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Replay-safe merge of completed immutable captures. Live snapshots are inspection views only. */
export function reconcileOperationBundles(inputs: OperationBundle[]): OperationBundle {
  if (!Array.isArray(inputs) || inputs.length === 0) fail("OPERATION_MERGE", "At least one operation bundle is required");
  const bundles = inputs.map(validateOperationBundle);
  if (bundles.some(bundle => bundle.spans.some(span => span.status === "running"))) fail("OPERATION_MERGE_RUNNING", "Live snapshots with running operations cannot be reconciled; replace the inspection view or wait for completion");
  const dataset = bundles[0]!.dataset_id;
  if (bundles.some(bundle => bundle.dataset_id !== dataset)) fail("OPERATION_DATASET", "Operation datasets differ");
  const merge = <T extends { id: string }>(items: T[]): T[] => {
    const byId = new Map<string, T>();
    for (const item of items) {
      const old = byId.get(item.id);
      if (old && canonical(old) !== canonical(item)) fail("OPERATION_CONFLICT", `Conflicting immutable operation capture identity ${item.id}`);
      byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => compare(a.id, b.id));
  };
  const losses: Record<string, number> = {};
  const linkLosses: Record<string, number> = {};
  for (const bundle of bundles) for (const [stream, count] of Object.entries(bundle.coverage.dropped_links_by_stream)) {
    Object.defineProperty(linkLosses, stream, { value: Math.max(Object.hasOwn(linkLosses, stream) ? linkLosses[stream]! : 0, count), enumerable: true, configurable: true });
  }
  for (const bundle of bundles) for (const [stream, count] of Object.entries(bundle.coverage.dropped_spans_by_stream)) {
    Object.defineProperty(losses, stream, { value: Math.max(Object.hasOwn(losses, stream) ? losses[stream]! : 0, count), enumerable: true, configurable: true });
  }
  const boundaries = new Set(bundles.map(bundle => bundle.coverage.boundary));
  return validateOperationBundle({ schema_version: "0.3.0", dataset_id: dataset,
    artifacts: merge(bundles.flatMap(bundle => bundle.artifacts)),
    spans: merge(bundles.flatMap(bundle => bundle.spans)).sort((a, b) => compare(a.stream_id, b.stream_id) || a.sequence - b.sequence || compare(a.id, b.id)),
    links: [...new Map(bundles.flatMap(bundle => bundle.links).map(link => [canonical(link), link])).entries()].sort(([a], [b]) => compare(a, b)).map(([, link]) => link),
    coverage: { boundary: boundaries.size === 1 ? bundles[0]!.coverage.boundary : "mixed", complete: bundles.every(bundle => bundle.coverage.complete),
      dropped_spans: Object.values(losses).reduce((sum, count) => sum + count, 0), dropped_spans_by_stream: losses,
      dropped_links: Object.values(linkLosses).reduce((sum, count) => sum + count, 0), dropped_links_by_stream: linkLosses,
      limitations: [...new Set(bundles.flatMap(bundle => bundle.coverage.limitations))].sort(compare) },
  });
}

