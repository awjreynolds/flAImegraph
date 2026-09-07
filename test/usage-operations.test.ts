import test from "node:test";
import assert from "node:assert/strict";
import { OperationRecorder } from "../src/operation-recorder.js";
import { operationUsage } from "../src/usage-operations.js";
import { createUsageReport } from "../src/usage.js";
import { createUsageProfile } from "../src/usage-profile.js";

test("a real operation capture becomes a pricing-free execution profile with independent IO meters", async () => {
  const recorder = new OperationRecorder({ dataset_id: "files", namespace: "files" });
  await recorder.run({ kind: "work", label: "Task" }, async () => {
    await recorder.run({ kind: "file_read", label: "Read", io: { resource_id: "file", resource_label: "File", read_bytes: "120", returned_bytes: "50" } }, async () => {});
  });
  const bundle = operationUsage(recorder.snapshot());
  const report = createUsageReport(bundle);
  assert.equal(report.meter_totals.find(meter => meter.meter_id === "operation_count")!.known_total, "2");
  assert.equal(report.meter_totals.find(meter => meter.meter_id === "read_bytes")!.known_total, "120");
  assert.equal(report.meter_totals.find(meter => meter.meter_id === "returned_bytes")!.known_total, "50");
  assert.ok(!bundle.meters.some(meter => meter.id === "input_tokens"));
  assert.equal(Math.max(...createUsageProfile(report, { meter_id: "operation_count", group_by: ["execution"] }).samples.map(sample => sample.stack.length)), 3);
  assert.ok(bundle.observations.every(observation => observation.measurements.elapsed_ns?.aggregation === "unknown"));
});
