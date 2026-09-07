import { OperationRecorder, createPiOperationBridge } from "flaimegraph";
import { createReadTool } from "@mariozechner/pi-coding-agent";

const cwd = process.cwd();
const target = process.argv[2] ?? "README.md";
const recorder = new OperationRecorder({
  dataset_id: "pi-example",
  namespace: "pi-example-run",
});
const bridge = createPiOperationBridge(recorder);
const read = bridge.wrapTool(createReadTool(cwd, {
  operations: bridge.readOperations,
}));

const result = await read.execute("example-read", { path: target });
const bundle = bridge.snapshot();
console.log(JSON.stringify({
  result_content_blocks: Array.isArray(result?.content) ? result.content.map((block) => block.type) : [],
  operations: bundle.spans.map((span) => ({
    kind: span.kind,
    label: span.label,
    parent_id: span.parent_id,
    status: span.status,
    io: span.io === null ? null : {
      resource_id: span.io.resource_id,
      resource_label: span.io.resource_label,
      requested_range: span.io.requested_range,
      read_bytes: span.io.read_bytes,
      returned_bytes: span.io.returned_bytes,
    },
  })),
}, null, 2));

