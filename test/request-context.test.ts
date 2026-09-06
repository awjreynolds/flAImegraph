import assert from "node:assert/strict";
import test from "node:test";

import { createHarnessProfile } from "../src/context-capture.js";
import { captureProviderRequest, captureRequestContext } from "../src/request-context.js";
import type { CaptureContextInput, ContextBundle } from "../src/context-types.js";
import type { Source } from "../src/types.js";

const artifact: Source = { id: "capture-json", harness: "test", format: "json", coverage: "complete" };
const profile = createHarnessProfile({ harness: "test-harness", provider: "test-provider", model: "base-model" });

function capture(overrides: Partial<CaptureContextInput> = {}): ContextBundle {
  return captureRequestContext({
    dataset_id: "dataset-context-capture",
    request_id: "request-1",
    profile,
    boundary: "client_request",
    coverage: "partial",
    artifact,
    record: "/request",
    blocks: [
      {
        source_id: "source-user",
        origin: "user_prompt",
        origin_evidence: "observed",
        label: "user prompt",
        identity_basis: "producer",
        representation: "original",
        media: "text",
        role: "user",
        placement: "current_turn",
        record: "/input/0",
        content: "abc",
      },
    ],
    ...overrides,
  });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (caught: unknown) {
    return caught instanceof Error && "code" in caught ? String(caught.code) : undefined;
  }
}

test("generic capture hashes UTF-8 text, records exact bytes, and never exports raw text", () => {
  const result = capture();
  const revision = result.revisions[0]!;

  assert.equal(revision.content_sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(revision.bytes, {
    value: "3",
    unit: "utf8_bytes",
    evidence: "derived",
    method: "utf8-byte-length-v1",
    source_refs: [{ source_id: artifact.id, record: "/input/0" }],
  });
  assert.equal(revision.tokens.value, null);
  assert.equal(revision.tokens.evidence, "unavailable");
  assert.equal(JSON.stringify(result).includes("abc"), false);
});

test("binary capture hashes bytes with a binary method and keeps token quantity unavailable", () => {
  const result = capture({
    blocks: [{
      source_id: "source-image",
      origin: "attachment",
      origin_evidence: "observed",
      label: "image",
      identity_basis: "producer",
      representation: "original",
      media: "image",
      role: "user",
      placement: "attachment",
      content_bytes: new Uint8Array([0, 255, 1]),
      record: "/input/1/content",
    }],
  });
  const revision = result.revisions.find((item) => item.source_id === "source-image")!;
  assert.equal(revision.content_sha256, "47ffa3ea45a70b8a41c2c0825df323c00a8b7a01c1ea06083cc41dddcc001123");
  assert.deepEqual(revision.bytes, {
    value: "3",
    unit: "utf8_bytes",
    evidence: "derived",
    method: "raw-byte-length-v1",
    source_refs: [{ source_id: artifact.id, record: "/input/1/content" }],
  });
  assert.equal(revision.tokens.value, null);
});

test("repeated revisions are distinct ordered occurrences while replay remains deterministic", () => {
  const blocks = [
    {
      source_id: "source-repeated",
      origin: "user_prompt" as const,
      label: "repeated",
      representation: "original" as const,
      media: "text" as const,
      role: "user" as const,
      placement: "history" as const,
      content: "same",
    },
    {
      source_id: "source-repeated",
      origin: "user_prompt" as const,
      label: "repeated",
      representation: "original" as const,
      media: "text" as const,
      role: "user" as const,
      placement: "current_turn" as const,
      content: "same",
    },
  ];
  const first = capture({ request_id: "request-repeated", blocks });
  const replay = capture({ request_id: "request-repeated", blocks: structuredClone(blocks) });
  assert.equal(first.revisions.length, 1);
  assert.equal(first.requests[0]!.occurrences.length, 2);
  assert.equal(first.requests[0]!.occurrences[0]!.revision_id, first.requests[0]!.occurrences[1]!.revision_id);
  assert.notEqual(first.requests[0]!.occurrences[0]!.id, first.requests[0]!.occurrences[1]!.id);
  assert.deepEqual(replay, first);
});

test("reusing a source and revision across request captures retains identity and distinct provenance", () => {
  const first = capture({ request_id: "request-a", blocks: [{
    source_id: "shared-file",
    origin: "repository_file",
    origin_evidence: "observed",
    label: "README",
    identity_basis: "producer",
    representation: "original",
    media: "text",
    role: "developer",
    placement: "instruction",
    content: "shared",
    record: "/files/readme",
  }] });
  const second = capture({ request_id: "request-b", blocks: [{
    source_id: "shared-file",
    origin: "repository_file",
    origin_evidence: "observed",
    label: "README",
    identity_basis: "producer",
    representation: "original",
    media: "text",
    role: "developer",
    placement: "instruction",
    content: "shared",
    record: "/files/readme-copy",
  }] });
  assert.equal(first.sources[0]!.id, second.sources[0]!.id);
  assert.equal(first.revisions[0]!.id, second.revisions[0]!.id);
  assert.notDeepEqual(first.sources[0]!.source_refs, second.sources[0]!.source_refs);
  assert.notDeepEqual(first.requests[0]!.id, second.requests[0]!.id);
});

test("caller hashes are declared, explicit token measurements remain separate, and mismatches fail closed", () => {
  const declared = capture({ blocks: [{
    source_id: "declared-hash",
    origin: "attachment",
    origin_evidence: "declared",
    label: "remote image",
    identity_basis: "producer",
    representation: "original",
    media: "image",
    role: "user",
    placement: "attachment",
    content: "https://example.test/image.png",
    content_sha256: "AB".repeat(32),
    tokens: { value: "7", unit: "tokens", evidence: "observed", method: "provider-token-count-v1", source_refs: [] },
  }] });
  const revision = declared.revisions[0]!;
  assert.equal(revision.content_sha256, "ab".repeat(32));
  assert.equal(revision.fingerprint_evidence, "declared");
  assert.equal(revision.bytes.value, null);
  assert.equal(revision.tokens.value, "7");
  assert.equal(declared.issues[0]?.code, "CONTENT_NOT_HASHED");
  assert.equal(codeOf(() => capture({ blocks: [{
    source_id: "bad-hash",
    origin: "user_prompt",
    label: "bad",
    representation: "original",
    media: "text",
    role: "user",
    placement: "current_turn",
    content: "abc",
    content_sha256: "00".repeat(32),
  }] })), "CONTEXT_CAPTURE_HASH_CONFLICT");
});

test("provider adapters preserve fields, typed media, pointers, overrides, and explicit annotations", () => {
  const result = captureProviderRequest("openai-responses", {
    model: "request-model",
    instructions: "Follow the repository skill.",
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "https://example.test/image" }] }],
    tools: [{ type: "function", name: "search", parameters: { type: "object" } }],
    text: { format: { type: "json_schema", name: "answer", schema: { type: "object" } } },
    previous_response_id: "resp-prev",
  }, {
    dataset_id: "dataset-provider",
    namespace: "producer-a",
    request_id: "provider-request",
    profile,
    artifact: { id: "provider-artifact", harness: "openai", format: "json", coverage: "complete" },
    producer_annotations: {
      "/instructions": { origin: "skill", source_id: "skill-search", label: "search skill", identity_basis: "producer" },
    },
  });
  const sourcesByOrigin = new Map(result.sources.map((source) => [source.origin, source]));
  assert.equal(sourcesByOrigin.get("skill")?.label, "search skill");
  assert.ok(result.sources.some((source) => source.origin === "tool_schema"));
  assert.ok(result.sources.some((source) => source.origin === "output_schema"));
  assert.ok(result.revisions.some((revision) => revision.media === "image" && revision.content_sha256 === null));
  assert.ok(result.revisions.some((revision) => revision.representation === "reference" && revision.media === "structured"));
  assert.equal(result.requests[0]!.overrides.model?.value, "request-model");
  assert.equal(result.profiles[0]!.model.name.value, "base-model");
  assert.equal(result.requests[0]!.occurrences.every((occurrence) => occurrence.treatment.value === "unknown"), true);
  assert.ok(result.requests[0]!.occurrences.every((occurrence) => occurrence.treatment.evidence === "unknown"));
  assert.ok(result.requests[0]!.occurrences.some((occurrence) => occurrence.revision_id));
});

test("provider adapters cover Anthropic system/message roles and Gemini media/schema/server references", () => {
  const anthropic = captureProviderRequest("anthropic-messages", {
    model: "claude-test",
    system: [{ type: "text", text: "system" }],
    messages: [{ role: "system", content: "mid-system" }, { role: "user", content: [{ type: "text", text: "question" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } }] }],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
    output_config: { format: { type: "json_schema", schema: { type: "object" } } },
    container: { id: "server-state" },
  }, {
    dataset_id: "dataset-provider",
    namespace: "producer-a",
    request_id: "anthropic-request",
    profile,
    artifact: { id: "anthropic-artifact", harness: "claude", format: "json", coverage: "complete" },
  });
  assert.ok(anthropic.sources.some((source) => source.origin === "system_instruction"));
  assert.ok(anthropic.revisions.some((revision) => revision.media === "image" && revision.content_sha256 === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  assert.ok(anthropic.revisions.some((revision) => revision.representation === "reference"));
  assert.ok(anthropic.sources.some((source) => source.origin === "output_schema"));

  const gemini = captureProviderRequest("gemini-content", {
    model: "gemini-test",
    systemInstruction: { parts: [{ text: "system" }] },
    contents: [{ role: "user", parts: [{ text: "question" }, { inlineData: { mimeType: "image/png", data: "YWJj" } }, { fileData: { fileUri: "https://example.test/file", mimeType: "application/pdf" } }, { functionCall: { name: "lookup", args: {} } }] }],
    tools: [{ functionDeclarations: [{ name: "lookup", parameters: { type: "object" } }] }],
    generationConfig: { responseSchema: { type: "object" } },
    cachedContent: "cached-content-ref",
  }, {
    dataset_id: "dataset-provider",
    namespace: "producer-a",
    request_id: "gemini-request",
    profile,
    artifact: { id: "gemini-artifact", harness: "gemini", format: "json", coverage: "complete" },
  });
  assert.ok(gemini.revisions.some((revision) => revision.media === "image" && revision.content_sha256 === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  assert.ok(gemini.revisions.some((revision) => revision.media === "document" && revision.representation === "reference"));
  assert.ok(gemini.sources.some((source) => source.origin === "output_schema"));
  assert.ok(gemini.sources.some((source) => source.origin === "memory"));
});

test("provider options require explicit namespace and matching profile/artifact identities", () => {
  const base = {
    dataset_id: "dataset-provider",
    namespace: "producer-a",
    request_id: "provider-request",
    profile,
    artifact: { id: "provider-artifact", harness: "openai", format: "json", coverage: "complete" } as Source,
  };
  assert.equal(codeOf(() => captureProviderRequest("unknown", {}, base)), "CONTEXT_PROVIDER_FORMAT_UNSUPPORTED");
  assert.equal(codeOf(() => captureProviderRequest("openai-responses", {}, { ...base, profile_id: "other" })), "CONTEXT_PROFILE_REFERENCE_MISMATCH");
  assert.equal(codeOf(() => captureProviderRequest("openai-responses", {}, { ...base, artifact_id: "other" })), "CONTEXT_ARTIFACT_REFERENCE_MISMATCH");
});

test("provider annotations validate JSON pointers and can merge one producer source across pointers", () => {
  const options = {
    dataset_id: "dataset-provider",
    namespace: "producer-a",
    request_id: "annotated-request",
    profile,
    artifact: { id: "annotated-artifact", harness: "openai", format: "json", coverage: "complete" } as Source,
    annotations: {
      "/input/0": { origin: "repository_file" as const, source_id: "shared-file", label: "README", identity_basis: "producer" as const },
      "/input/1": { origin: "repository_file" as const, source_id: "shared-file", label: "README", identity_basis: "producer" as const },
    },
  };
  const result = captureProviderRequest("openai-responses", { input: ["one", "two"] }, options);
  assert.equal(result.sources.filter((source) => source.id === "shared-file").length, 1);
  assert.deepEqual(result.sources.find((source) => source.id === "shared-file")?.source_refs, [
    { source_id: "annotated-artifact", record: "/input/0" },
    { source_id: "annotated-artifact", record: "/input/1" },
  ]);
  assert.equal(codeOf(() => captureProviderRequest("openai-responses", {}, { ...options, annotations: { input: { origin: "user_prompt" } } })), "CONTEXT_SOURCE_ANNOTATION_INVALID");
  assert.equal(codeOf(() => captureProviderRequest("openai-responses", {}, { ...options, annotations: { "/input": null as never } })), "CONTEXT_CAPTURE_INVALID_SHAPE");
});

test("provider data URLs and unpadded base64 attachments hash decoded bytes", () => {
  const result = captureProviderRequest("openai-responses", {
    input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,YWJj" }, { type: "input_audio", input_audio: { data: "YWJj" } }] }],
  }, {
    dataset_id: "dataset-provider",
    namespace: "producer-a",
    request_id: "data-url-request",
    profile,
    artifact: { id: "data-url-artifact", harness: "openai", format: "json", coverage: "complete" },
  });
  const media = result.revisions.filter((revision) => revision.media === "image" || revision.media === "audio");
  assert.equal(media.length, 2);
  assert.ok(media.every((revision) => revision.content_sha256 === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
});

test("provider coverage downgrades whenever recognized fields or nested shapes are not represented", () => {
  const options={dataset_id:'coverage',namespace:'test',request_id:'r',profile,artifact};
  const cases:Array<[string,unknown]>=[
    ['openai-responses',{input:'hi',text:'bad'}],
    ['openai-responses',{input:'hi',prompt_cache_key:'key'}],
    ['openai-responses',{input:'hi',reasoning:{effort:'low',future_setting:true}}],
    ['openai-responses',{input:[{role:'user',content:[{type:'input_text',text:'hi',cache_control:{type:'ephemeral'}}]}]}],
    ['anthropic-messages',{messages:[{role:'user',content:'hi'}],cache_control:{type:'ephemeral'}}],
    ['anthropic-messages',{messages:[{role:'user',content:'hi'}],output_config:'bad'}],
    ['gemini-content',{contents:[],tools:{functionDeclarations:[]}}],
    ['gemini-content',{contents:[],safetySettings:{bad:true}}],
    ['gemini-content',{contents:[],generationConfig:{thinkingConfig:{thinkingBudget:100}}}],
  ];
  for(const [format,input] of cases){const result=captureProviderRequest(format,input,options);assert.equal(result.requests[0]!.coverage,'partial',JSON.stringify(input));assert.ok(result.issues.some(issue=>issue.code==='UNSUPPORTED_PROVIDER_FIELD'));}
});

test("anonymous provider sources are scoped to a request; explicit annotations opt into shared identity", () => {
  const base={dataset_id:'identity',namespace:'run',profile,artifact};
  const first=captureProviderRequest('openai-responses',{input:'first prompt'},{...base,request_id:'first'});
  const second=captureProviderRequest('openai-responses',{input:'unrelated prompt'},{...base,request_id:'second'});
  assert.notEqual(first.sources[0]!.id,second.sources[0]!.id);
  const annotations={'/input':{origin:'user_prompt' as const,source_id:'explicit-shared-prompt'}};
  const explicitFirst=captureProviderRequest('openai-responses',{input:'first prompt'},{...base,request_id:'first',annotations});
  const explicitSecond=captureProviderRequest('openai-responses',{input:'updated prompt'},{...base,request_id:'second',annotations});
  assert.equal(explicitFirst.sources[0]!.id,explicitSecond.sources[0]!.id);
});

test("provider source pointers refer to actual payload locations, including native items and aliases", () => {
  const base={dataset_id:'pointers',namespace:'run',request_id:'r',profile,artifact};
  const openai=captureProviderRequest('openai-responses',{input:[{type:'function_call',name:'read',arguments:'{}',call_id:'x'}]},base);
  assert.equal(openai.revisions[0]!.source_refs[0]!.record,'/input/0');
  const gemini=captureProviderRequest('gemini-content',{system_instruction:{parts:[{text:'instruction'}]},contents:[]},base);
  assert.equal(gemini.revisions[0]!.source_refs[0]!.record,'/system_instruction/parts/0/text');
});

test("media capture never silently drops rendering, cache or nested media configuration", () => {
  const options={dataset_id:'media-coverage',namespace:'test',request_id:'r',profile,artifact};
  const cases:Array<[string,unknown]>=[
    ['openai-responses',{input:[{role:'user',content:[{type:'input_image',image_url:'https://example.test/x',detail:'high'}]}]}],
    ['openai-responses',{input:[{role:'user',content:[{type:'input_audio',input_audio:{data:'YWJj'},extra:true}]}]}],
    ['openai-responses',{input:[{role:'user',content:[{type:'input_image',image_url:{url:'https://example.test/x',detail:'high'}}]}]}],
    ['anthropic-messages',{messages:[{role:'user',content:[{type:'image',source:{type:'base64',data:'YWJj'},cache_control:{type:'ephemeral'}}]}]}],
    ['gemini-content',{contents:[{role:'user',parts:[{inlineData:{mimeType:'image/png',data:'YWJj'},thoughtSignature:'opaque'}]}]}],
    ['gemini-content',{contents:[{role:'user',parts:[{inlineData:{mimeType:'image/png',data:'YWJj',extra:true}}]}]}],
  ];
  for(const [format,input] of cases){const result=captureProviderRequest(format,input,options);assert.equal(result.requests[0]!.coverage,'partial',JSON.stringify(input));assert.ok(result.issues.some(issue=>issue.code==='UNSUPPORTED_PROVIDER_FIELD'));}
});
