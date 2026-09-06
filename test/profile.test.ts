import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import test from "node:test";
import protobuf from "protobufjs";
import Ajv from "ajv";

import {
  createCostProfile,
  exportFolded,
  exportOtlp,
  exportPprof,
  validateProfile,
} from "../src/profile.js";
import type { EvidenceBundle, Valuation } from "../src/types.js";

function evidenceWithTwoCalls(): EvidenceBundle {
  return {
    schema_version: "0.1.0",
    dataset_id: "dataset-golden",
    sources: [
      {
        id: "source-golden",
        harness: "codex",
        format: "fixture",
        coverage: "complete",
      },
    ],
    observations: [
      {
        id: "obs-125",
        source_refs: [{ source_id: "source-golden", record: "r1" }],
        kind: "model",
        operation: "response-125",
        status: "ok",
        accounting_scope: "direct",
        agent_id: "agent-a",
        work_item_id: "ticket-7",
        model: "model-a",
        model_identity: "response",
        usage: {
          input_tokens: "100",
          output_tokens: "20",
          cache_read_input_tokens: null,
          cache_write_input_tokens: null,
          reasoning_output_tokens: null,
        },
      },
      {
        id: "obs-075",
        source_refs: [{ source_id: "source-golden", record: "r2" }],
        kind: "model",
        operation: "response-075",
        status: "ok",
        accounting_scope: "direct",
        agent_id: "agent-b",
        work_item_id: "ticket-7",
        model: "model-a",
        model_identity: "response",
        usage: {
          input_tokens: "80",
          output_tokens: "10",
          cache_read_input_tokens: null,
          cache_write_input_tokens: null,
          reasoning_output_tokens: null,
        },
      },
    ],
    relationships: [],
    issues: [],
  };
}

function goldenValuation(): Valuation {
  return {
    schema_version: "0.1.0",
    id: "valuation-golden",
    dataset_id: "dataset-golden",
    selection_policy: "direct-only-v1",
    currency: "USD",
    basis: "model_price_estimate",
    assumptions: ["fixture rates"],
    observations: [
      {
        observation_id: "obs-125",
        amount_nanos: "125000000",
        basis: "model_price_estimate",
      },
      {
        observation_id: "obs-075",
        amount_nanos: "75000000",
        basis: "model_price_estimate",
      },
    ],
    total_nanos: "200000000",
    complete: true,
    issues: [],
  };
}

test("projects direct valued calls once and preserves the golden monetary total", () => {
  const profile = createCostProfile(evidenceWithTwoCalls(), goldenValuation(), {
    root_label: "Epic-1",
    group_by: ["work_item", "agent", "operation"],
  });

  assert.equal(profile.currency, "USD");
  assert.equal(profile.unit, "nanoUSD");
  assert.equal(profile.total_nanos, "200000000");
  assert.equal(profile.samples.length, 2);
  assert.deepEqual(
    profile.samples
      .map((sample) => sample.value_nanos)
      .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1)),
    ["75000000", "125000000"],
  );

  const folded = exportFolded(profile);
  assert.equal(
    folded
      .trim()
      .split("\n")
      .map((line) => BigInt(line.slice(line.lastIndexOf(" ") + 1)))
      .reduce((sum, value) => sum + value, 0n),
    200000000n,
  );
});

test("defaults to a per-observation leaf while keeping the full frame identity in the manifest", () => {
  const profile = createCostProfile(evidenceWithTwoCalls(), goldenValuation());
  assert.deepEqual(profile.group_by, ["work_item", "agent", "model", "operation", "observation"]);
  const metadata = (profile as CostProfile & {
    metadata: { frame_manifest: Array<{ id: string; name: string; kind: string }> };
  }).metadata;
  const observationFrame = profile.samples[0]!.stack.at(-1)!;
  assert.equal(observationFrame.kind, "observation");
  assert.ok(metadata.frame_manifest.some((frame) => frame.id === observationFrame.id));
  const folded = exportFolded(profile);
  assert.match(folded, /observation:obs-[0-9]+ \[id=[A-Za-z0-9_-]{1,12}\] \d+$/m);
});

test("keeps recorded zero metadata while excluding a direct observation with missing cost", () => {
  const evidence = evidenceWithTwoCalls();
  evidence.sources[0]!.coverage = "unknown";
  evidence.observations.push({
    id: "obs-missing",
    source_refs: [{ source_id: "source-golden", record: "r3" }],
    kind: "model",
    operation: "response-missing",
    status: "ok",
    accounting_scope: "direct",
    work_item_id: "ticket-7",
    usage: null,
  });
  const valuation = goldenValuation();
  valuation.observations[0]!.amount_nanos = "0";
  valuation.observations[1]!.amount_nanos = "75000000";
  valuation.total_nanos = "75000000";

  const profile = createCostProfile(evidence, valuation, {
    root_label: "Epic-1",
    group_by: ["work_item", "operation"],
  });

  assert.equal(profile.complete, false);
  assert.deepEqual(profile.excluded_observation_ids, ["obs-missing"]);
  assert.equal(profile.total_nanos, "75000000");
  assert.ok(profile.samples.some((sample) => sample.observation_id === "obs-125" && sample.value_nanos === "0"));
  const metadata = (profile as CostProfile & { metadata: { zero_observation_ids: string[] } }).metadata;
  assert.deepEqual(metadata.zero_observation_ids, ["obs-125"]);
});

test("allocates an odd integer by largest remainder with a stable tie", () => {
  const evidence = evidenceWithTwoCalls();
  evidence.observations = [evidence.observations[0]!];
  evidence.observations[0]!.id = "obs-shared";
  evidence.observations[0]!.work_item_id = undefined;
  const valuation = goldenValuation();
  valuation.observations = [
    {
      observation_id: "obs-shared",
      amount_nanos: "101",
      basis: "model_price_estimate",
    },
  ];
  valuation.total_nanos = "101";

  const profile = createCostProfile(evidence, valuation, {
    root_label: "Epic-1",
    group_by: ["work_item"],
    allocations: {
      "obs-shared": [
        { work_item_id: "ticket-a", weight: "1" },
        { work_item_id: "ticket-b", weight: "1" },
      ],
    },
  });

  assert.deepEqual(
    profile.samples.map((sample) => sample.value_nanos).sort((left, right) => Number(BigInt(left) - BigInt(right))),
    ["50", "51"],
  );
  assert.deepEqual(
    profile.samples.map((sample) => sample.stack.at(-1)?.name.includes("ticket-a")).sort(),
    [false, true],
  );
});

test("exports gzip pprof with exact cost values, labels, and leaf-first locations", () => {
  const profile = createCostProfile(evidenceWithTwoCalls(), goldenValuation(), {
    root_label: "Epic-1",
    group_by: ["work_item", "agent", "operation"],
  });
  const wire = exportPprof(profile);
  const proto = readFileSync(new URL("../vendor/pprof/profile.proto", import.meta.url), "utf8");
  const type = protobuf.parse(proto).root.lookupType("perftools.profiles.Profile");
  const decoded = type.toObject(type.decode(gunzipSync(wire)), {
    longs: String,
    enums: String,
  }) as {
    sampleType: Array<{ type: string; unit: string }>;
    sample: Array<{ locationId: string[]; value: string[]; label: Array<{ key: string; str: string }> }>;
    stringTable: string[];
    docUrl: string;
  };

  assert.equal(decoded.stringTable[Number(decoded.sampleType[0]!.type)], "cost");
  assert.equal(decoded.stringTable[Number(decoded.sampleType[0]!.unit)], "nanoUSD");
  assert.equal(decoded.sample.length, 2);
  assert.deepEqual(decoded.sample.map((sample) => sample.value).sort(), [["75000000"], ["125000000"]].sort());
  assert.ok(decoded.sample.every((sample) => sample.locationId.length === 4));
  assert.equal(decoded.stringTable[Number(decoded.docUrl)], "https://github.com/awjreynolds/flAImegraph/blob/v0.1.0/spec/0.1/profiles.md");
  const labelKeys = decoded.sample[0]!.label.map((label) => decoded.stringTable[Number(label.key)]);
  assert.ok(labelKeys.includes("dataset"));
  assert.ok(labelKeys.includes("observation"));
  assert.ok(labelKeys.includes("valuation"));
});

test("exports model and tool evidence as valid OTLP spans with namespaced local fields", () => {
  const evidence = evidenceWithTwoCalls();
  evidence.observations[0]!.trace_id = "0123456789abcdef0123456789abcdef";
  evidence.observations[0]!.span_id = "0123456789abcdef";
  evidence.observations[0]!.timestamp = "2026-09-06T10:00:00.000Z";
  evidence.observations.push({
    id: "tool-1",
    source_refs: [{ source_id: "source-golden", record: "r-tool" }],
    kind: "tool",
    operation: "read_file",
    status: "ok",
    accounting_scope: "direct",
    parent_id: "obs-125",
    trace_id: "trace with spaces",
    span_id: "span;with:semicolon",
    usage: null,
    attributes: { "tool.name": "read_file", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
  });

  const exported = exportOtlp(evidence) as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
      scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
    }>;
  };
  const spans = exported.resourceSpans[0]!.scopeSpans[0]!.spans;
  assert.equal(spans.length, 3);
  const model = spans.find((span) => span.name === "response-125")!;
  assert.match(String(model.traceId), /^[0-9a-f]{32}$/);
  assert.match(String(model.spanId), /^[0-9a-f]{16}$/);
  const modelKeys = (model.attributes as Array<{ key: string }>).map((attribute) => attribute.key);
  assert.ok(modelKeys.includes("gen_ai.operation.name"));
  assert.ok(modelKeys.includes("gen_ai.response.model"));
  assert.ok(modelKeys.includes("gen_ai.usage.input_tokens"));
  const tool = spans.find((span) => span.name === "read_file")!;
  assert.match(String(tool.traceId), /^[0-9a-f]{32}$/);
  assert.match(String(tool.spanId), /^[0-9a-f]{16}$/);
  const toolAttributes = tool.attributes as Array<{ key: string; value: Record<string, unknown> }>;
  assert.ok(toolAttributes.some((attribute) => attribute.key === "flAImegraph.original_trace_id"));
  assert.ok(toolAttributes.some((attribute) => attribute.key === "flAImegraph.original_span_id"));
  assert.ok(toolAttributes.some((attribute) => attribute.key === "flAImegraph.source_attribute.tool.name"));
  assert.ok(!toolAttributes.some((attribute) => attribute.key === "gen_ai.usage.input_tokens"));
});

test("uses numeric OTLP enums and protects normalized fields from source attributes", () => {
  const evidence = evidenceWithTwoCalls();
  const observation = evidence.observations[0]!;
  observation.subject_id = "response-id";
  observation.grain = "attempt";
  observation.count_basis = "consumed";
  observation.timestamp = "2026-09-06T10:00:00.123456789Z";
  observation.end_time = "2026-09-06T10:00:01.123456789Z";
  observation.provider = "openai";
  observation.attributes = {
    "gen_ai.usage.input_tokens": 999,
    "service.name": "untrusted",
  };

  const exported = exportOtlp(evidence) as {
    resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>;
  };
  const span = exported.resourceSpans[0]!.scopeSpans[0]!.spans.find((item) => item.name === observation.operation)!;
  assert.equal(span.kind, 1);
  assert.equal((span.status as { code: unknown }).code, 1);
  const attributes = span.attributes as Array<{ key: string; value: Record<string, unknown> }>;
  assert.equal(new Set(attributes.map((item) => item.key)).size, attributes.length);
  const values = new Map(attributes.map((item) => [item.key, item.value]));
  assert.equal(values.get("gen_ai.usage.input_tokens")?.intValue, "100");
  assert.equal(values.get("flAImegraph.source_attribute.gen_ai.usage.input_tokens")?.intValue, "999");
  assert.equal(values.get("flAImegraph.model_identity")?.stringValue, "response");
  assert.equal(values.get("flAImegraph.subject_id")?.stringValue, "response-id");
  assert.equal(values.get("flAImegraph.grain")?.stringValue, "attempt");
  assert.equal(values.get("flAImegraph.count_basis")?.stringValue, "consumed");
  assert.equal(values.get("flAImegraph.provider")?.stringValue, "openai");
  assert.equal(values.get("flAImegraph.timestamp")?.stringValue, observation.timestamp);
  assert.equal(values.get("flAImegraph.end_time")?.stringValue, observation.end_time);
  assert.equal(span.startTimeUnixNano, "1788688800123456789");
  assert.equal(span.endTimeUnixNano, "1788688801123456789");
});

test("assigns one deterministic trace to a parent tree and omits conflicted cross-trace links", () => {
  const evidence = evidenceWithTwoCalls();
  const parent = evidence.observations[0]!;
  parent.id = "parent";
  parent.span_id = "aaaaaaaaaaaaaaaa";
  const child = {
    ...parent,
    id: "child",
    span_id: "bbbbbbbbbbbbbbbb",
    parent_id: "parent",
    operation: "child-operation",
    source_refs: [{ source_id: "source-golden", record: "child" }],
    usage: null,
    model: undefined,
    model_identity: undefined,
  };
  evidence.observations = [parent, child];
  const first = exportOtlp(evidence) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }> };
  const second = exportOtlp(evidence);
  assert.deepEqual(first, second);
  const spans = first.resourceSpans[0]!.scopeSpans[0]!.spans;
  assert.equal(spans[0]!.traceId, spans[1]!.traceId);
  const parentSpan = spans.find((span) => span.name === "response-125")!;
  const childSpan = spans.find((span) => span.name === "child-operation")!;
  assert.equal(childSpan.parentSpanId, parentSpan.spanId);

  parent.trace_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  child.trace_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const conflicted = exportOtlp(evidence) as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
      scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
    }>;
  };
  const conflictedSpans = conflicted.resourceSpans[0]!.scopeSpans[0]!.spans;
  const conflictedChild = conflictedSpans.find((span) => span.name === "child-operation")!;
  assert.notEqual(conflictedChild.traceId, conflictedSpans.find((span) => span.name === "response-125")!.traceId);
  assert.equal(conflictedChild.parentSpanId, undefined);
  const diagnostics = conflicted.resourceSpans[0]!.resource.attributes.find((item) => item.key === "flAImegraph.export_diagnostics")!;
  assert.match(JSON.stringify(diagnostics), /different trace identity|conflicting source trace identities/i);
});

test("coalesces identical OTLP replay and rejects conflicting duplicate identities", () => {
  const evidence = evidenceWithTwoCalls();
  const original = evidence.observations[0]!;
  evidence.observations = [{ ...original }, { ...original, source_refs: [...original.source_refs, { source_id: "source-golden", record: "replay" }] }];
  const exported = exportOtlp(evidence) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }> };
  assert.equal(exported.resourceSpans[0]!.scopeSpans[0]!.spans.length, 1);
  const conflicting = { ...evidence, observations: [{ ...original }, { ...original, operation: "changed" }] };
  assert.throws(() => exportOtlp(conflicting), /OBSERVATION_CONFLICT|conflicting payload/i);
});

test("semantic profile validation rejects tampered totals before standard export", () => {
  const profile = createCostProfile(evidenceWithTwoCalls(), goldenValuation());
  const tampered = { ...profile, total_nanos: "999" };
  assert.throws(() => validateProfile(tampered), /total/i);
  assert.throws(() => exportFolded(tampered), /total/i);
});

test("rejects mixed valuation bases, invalid references, and nonconserving subtotals", () => {
  const evidence = evidenceWithTwoCalls();
  const mixed = goldenValuation();
  mixed.basis = "mixed";
  assert.throws(() => createCostProfile(evidence, mixed), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "mixed_basis";
  });

  const wrongBasis = goldenValuation();
  wrongBasis.observations[0]!.basis = "billed";
  assert.throws(() => createCostProfile(evidence, wrongBasis), /basis/i);

  const unknownReference = goldenValuation();
  unknownReference.observations[0]!.observation_id = "not-in-evidence";
  assert.throws(() => createCostProfile(evidence, unknownReference), /reference|observation/i);

  const wrongTotal = goldenValuation();
  wrongTotal.total_nanos = "199999999";
  assert.throws(() => createCostProfile(evidence, wrongTotal), /total|subtotal|conserv/i);
});

test("rejects nonpositive or unknown allocation references and non-direct valued subtotals", () => {
  const evidence = evidenceWithTwoCalls();
  const valuation = goldenValuation();
  assert.throws(
    () =>
      createCostProfile(evidence, valuation, {
        group_by: ["work_item"],
        allocations: { "obs-125": [{ work_item_id: "ticket-a", weight: "0" }] },
      }),
    /allocation|positive/i,
  );
  assert.throws(
    () =>
      createCostProfile(evidence, valuation, {
        group_by: ["work_item"],
        allocations: { unknown: [{ work_item_id: "ticket-a", weight: "1" }] },
      }),
    /allocation|unknown|reference/i,
  );

  const aggregate = { ...evidence.observations[0]!, id: "aggregate", accounting_scope: "aggregate" as const };
  evidence.observations.push(aggregate);
  valuation.observations.push({
    observation_id: "aggregate",
    amount_nanos: "1",
    basis: "model_price_estimate",
  });
  valuation.total_nanos = "200000001";
  assert.throws(() => createCostProfile(evidence, valuation), /scope|subtotal|direct/i);
});

test("keeps charge and credit magnitudes separate and nets only explicit adjustments", () => {
  const evidence = evidenceWithTwoCalls();
  evidence.observations.push({
    id: "credit-20",
    source_refs: [{ source_id: "source-golden", record: "r-credit" }],
    kind: "activity",
    operation: "credit",
    status: "ok",
    accounting_scope: "direct",
    usage: null,
  });
  evidence.relationships.push({ from: "credit-20", to: "obs-125", kind: "adjusts" });
  const valuation = goldenValuation();
  valuation.observations.push({
    observation_id: "credit-20",
    amount_nanos: "-20",
    basis: "model_price_estimate",
  });
  valuation.total_nanos = "199999980";

  const charges = createCostProfile(evidence, valuation, { group_by: ["operation"], cost_view: "charges" });
  assert.equal(charges.total_nanos, "200000000");
  assert.deepEqual((charges as typeof charges & { metadata: { credits_nanos: string } }).metadata.credits_nanos, "20");
  const credits = createCostProfile(evidence, valuation, { group_by: ["operation"], cost_view: "credits" });
  assert.equal(credits.total_nanos, "20");
  assert.equal(credits.samples.filter((sample) => sample.observation_id === "credit-20")[0]!.value_nanos, "20");
  const net = createCostProfile(evidence, valuation, { group_by: ["operation"], cost_view: "net" });
  assert.equal(net.total_nanos, "199999980");
  assert.equal(net.samples.find((sample) => sample.observation_id === "obs-125")!.value_nanos, "124999980");
  assert.ok(!exportFolded(net).split("\n").some((line) => line.trimEnd().endsWith("-20")));

  const unsupported = evidenceWithTwoCalls();
  unsupported.observations.push({ ...evidence.observations.at(-1)!, id: "unlinked-credit" });
  const unsupportedValuation = goldenValuation();
  unsupportedValuation.observations.push({
    observation_id: "unlinked-credit",
    amount_nanos: "-20",
    basis: "model_price_estimate",
  });
  unsupportedValuation.total_nanos = "199999980";
  assert.throws(() => createCostProfile(unsupported, unsupportedValuation, { cost_view: "net" }), /adjust|negative|net/i);
});

test("encodes hostile frame text safely and keeps folded output to one integer per path", () => {
  const evidence = evidenceWithTwoCalls();
  evidence.observations[0]!.operation = "line;break\n123  ";
  evidence.observations[0]!.work_item_id = "work\titem";
  const profile = createCostProfile(evidence, goldenValuation(), {
    root_label: "root; name 42",
    group_by: ["work_item", "operation"],
  });
  const folded = exportFolded(profile);
  const hostileLine = folded.split("\n").find((line) => line.includes("line%3Bbreak%0A123%20%20"))!;
  assert.ok(hostileLine);
  assert.equal(hostileLine.split(";").length, 3);
  assert.ok(!hostileLine.includes("\n"));
  assert.ok(!hostileLine.includes("\t"));
  assert.match(hostileLine, / \d+$/);
});

test("fails clearly when a pprof sample exceeds signed int64", () => {
  const evidence = evidenceWithTwoCalls();
  const valuation = goldenValuation();
  valuation.observations[0]!.amount_nanos = "9223372036854775808";
  valuation.observations[1]!.amount_nanos = null;
  valuation.total_nanos = "9223372036854775808";
  const profile = createCostProfile(evidence, valuation);
  assert.throws(() => exportPprof(profile), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "int64_overflow";
  });
});

test("allows a scenario valuation to reprice an evidence record without rewriting its recorded cost", () => {
  const evidence = evidenceWithTwoCalls();
  evidence.observations[0]!.recorded_cost = {
    amount: "0.001",
    currency: "USD",
    basis: "model_price_estimate",
  };
  const valuation = goldenValuation();
  valuation.basis = "enterprise_scenario";
  valuation.observations[0]!.basis = "enterprise_scenario";
  valuation.observations[1]!.basis = "enterprise_scenario";
  const profile = createCostProfile(evidence, valuation);
  assert.equal(profile.basis, "enterprise_scenario");
  assert.equal(profile.total_nanos, "200000000");
  assert.equal(evidence.observations[0]!.recorded_cost!.basis, "model_price_estimate");
});

test("emits a profile manifest accepted by the v0.1 JSON schema", () => {
  const profile = createCostProfile(evidenceWithTwoCalls(), goldenValuation());
  const schema = JSON.parse(
    readFileSync(new URL("../spec/0.1/schemas/profile.schema.json", import.meta.url), "utf8"),
  ) as object;
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(profile), true, JSON.stringify(validate.errors));
});
