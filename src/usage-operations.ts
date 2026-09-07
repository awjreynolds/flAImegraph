import { validateOperationBundle } from "./operation-capture.js";
import type { OperationBundle, OperationClassification } from "./operation-types.js";
import type { UsageBundle, UsageEvidence, UsageMeasurement, UsageMeter, UsageTimestamp } from "./usage-types.js";
import { validateUsageBundle } from "./usage.js";
import { normalizeUsageTimestamp } from "./usage-import.js";

const ioUnits: Record<string, string> = { read_bytes: "bytes", returned_bytes: "bytes", written_bytes: "bytes", inserted_bytes: "bytes", deleted_bytes: "bytes", entry_count: "entries", examined_entries: "entries" };
const evidence = (fact: OperationClassification): UsageEvidence => fact.evidence;

/** Convert recorded operations/IO to independent resource meters, retaining real ancestry. */
export function operationUsage(input: OperationBundle): UsageBundle {
  const operations = validateOperationBundle(input);
  const meters: UsageMeter[] = [
    { id: "operation_count", unit: "operations", description: "One recorded operation scope", subset_of: null, overlap: "disjoint" },
    { id: "elapsed_ns", unit: "nanoseconds", description: "Inclusive elapsed interval; overlapping scopes are not additive", subset_of: null, overlap: "overlap" },
    ...Object.entries(ioUnits).map(([id, unit]) => ({ id, unit, description: `Recorded ${id.replaceAll("_", " ")}`, subset_of: null, overlap: "unknown" as const })),
  ];
  const observations = operations.spans.map(span => {
    const timestamp = (value: string | null, fact: OperationClassification): UsageTimestamp | null => value === null ? null : { value: normalizeUsageTimestamp(value), evidence: evidence(fact), method: fact.method, source_refs: span.source_refs };
    const measurement = (value: string | null, fact: OperationClassification, aggregation: UsageMeasurement["aggregation"] = "delta", scope: UsageMeasurement["scope"] = "event"): UsageMeasurement => ({ value, evidence: evidence(fact), method: fact.method, source_refs: span.source_refs, count_basis: "consumed", aggregation, scope });
    const measurements: Record<string, UsageMeasurement> = {
      operation_count: measurement("1", { evidence: "observed", method: "recorded-operation-scope" }),
      elapsed_ns: measurement(span.duration_ns, span.timing.duration_ns, "unknown", "interval"),
    };
    if (span.io) for (const key of Object.keys(ioUnits)) {
      const typed = key as keyof typeof span.io.measurements;
      measurements[key] = measurement(span.io[typed], span.io.measurements[typed]);
    }
    const fact = (value: string, method: string) => ({ value, evidence: "declared" as const, method, source_refs: span.source_refs });
    return {
      id: `operation:${span.id}`, source_refs: span.source_refs, subject: `${span.kind}: ${span.label}`, accounting_scope: "direct" as const,
      operation_id: span.id, parent_id: span.parent_id === null ? null : `operation:${span.parent_id}`, agent_id: span.agent_id, session_id: span.stream_id,
      work_item_id: null, task_id: null, status: span.status,
      event_at: null, started_at: timestamp(span.started_at, span.timing.started_at), ended_at: timestamp(span.ended_at, span.timing.ended_at), collected_at: null,
      measurements,
      dimensions: {
        ...(span.executing_model === null ? {} : { model: fact(span.executing_model, "operation executing_model; response identity unconfirmed") }),
        extensions: {
          "flaimegraph.operation.kind": { value: span.kind, evidence: evidence(span.classification), method: span.classification.method, source_refs: span.source_refs },
          ...(span.requesting_model === null ? {} : { "flaimegraph.operation.requesting_model": fact(span.requesting_model, "operation requesting_model; does not execute this tool") }),
          ...(span.observation_id === null ? {} : { "flaimegraph.operation.observation_id": fact(span.observation_id, "legacy operation usage binding") }),
        },
      },
    };
  });
  return validateUsageBundle({ schema_version: "0.4.0", dataset_id: operations.dataset_id, sources: operations.artifacts, meters, observations,
    coverage: { boundary: operations.coverage.boundary, complete: operations.coverage.complete, dropped_observations: operations.coverage.dropped_spans,
      limitations: [...operations.coverage.limitations, "Inclusive elapsed intervals are retained but are not additive across overlapping operations.",
        ...(operations.coverage.dropped_links ? [`${operations.coverage.dropped_links} operation links were dropped by the source capture.`] : [])] },
  });
}
