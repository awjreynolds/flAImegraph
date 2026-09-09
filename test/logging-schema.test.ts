import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { getLoggingSchema, LOGGING_SCHEMA_KINDS, type LoggingSchemaKind } from "../src/logging-schema.js";
import { validateUsageBundle } from "../src/usage.js";
import { validateLifecycleCapture, validateLifecycleEvent } from "../src/lifecycle.js";

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
const validators = Object.fromEntries(LOGGING_SCHEMA_KINDS.map(kind => [kind, ajv.compile(getLoggingSchema(kind))]));
const semantic = { usage: validateUsageBundle, lifecycle: validateLifecycleCapture, "lifecycle-event": validateLifecycleEvent };
const corpus = JSON.parse(await readFile(new URL("../spec/fixtures/logging/conformance.json", import.meta.url), "utf8")) as Array<{ name: string; kind: keyof typeof semantic; value: unknown; structural: boolean; semantic: boolean }>;

test("portable schemas match the published files", async () => {
  for (const kind of LOGGING_SCHEMA_KINDS) {
    const version = kind === "usage" ? "0.4" : "0.5";
    const published = JSON.parse(await readFile(new URL(`../spec/${version}/${kind}.schema.json`, import.meta.url), "utf8"));
    assert.deepEqual(published, getLoggingSchema(kind));
  }
});

for (const fixture of corpus) test(`logging conformance: ${fixture.name}`, () => {
  const validate = validators[fixture.kind]!;
  assert.equal(validate(fixture.value), fixture.structural, JSON.stringify(validate.errors));
  if (fixture.semantic) assert.doesNotThrow(() => semantic[fixture.kind](fixture.value));
  else assert.throws(() => semantic[fixture.kind](fixture.value));
});

test("portable schemas accept representative usage and lifecycle captures", async () => {
  for (const [kind, path] of [["usage", "v04/native-usage.json"], ["lifecycle", "v05/lifecycle.json"]] as const) {
    const value = JSON.parse(await readFile(new URL(`../examples/dogfood/${path}`, import.meta.url), "utf8"));
    assert.equal(validators[kind]!(value), true, JSON.stringify(validators[kind]!.errors));
  }
});

test("journal frame syntax rejects unknown fields and malformed digests", () => {
  const validate = validators["journal-frame"]!;
  const frame = { event: corpus.find(c => c.name === "epoch")!.value, previous_hash: null, hash: "a".repeat(64) };
  assert.equal(validate(frame), true, "Digest verification belongs to the journal reader");
  assert.equal(validate({ ...frame, hash: "bad" }), false);
  assert.equal(validate({ ...frame, previous_hash: "A".repeat(64) }), false);
  assert.equal(validate({ ...frame, extra: true }), false);
});
