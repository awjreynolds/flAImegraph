import type { AdapterCapability, EvidenceBundle, Harness, ImportOptions } from "../types.js";
import {
  addActivityObservation,
  addModelObservation,
  addToolObservation,
  addPartialCoverageIssue,
  asRecord,
  capability,
  firstNested,
  firstString,
  inferStatus,
  makeBundle,
  nativeIdentity,
  parseJsonInput,
  recordedCost,
  addQuantities,
  hashNativeId,
  quantity,
  finalizeBundle,
  normalizeTimestamp,
  stableJson,
  usageFromFields,
} from "./common.js";

const CODEX_VERSION = "0.153.4-capture-contract";

const PI_LEGACY_VERSION = "legacy-session-jsonl";
const PI_V4_VERSION = "v4-storage-jsonl";

/** A physical JSONL line plus a stable nested-write coordinate for v4 transactions. */
type PiLine = { value: Record<string, unknown>; line: number; ordinal?: string };

function piFallbackCoordinate(line: number, ordinal?: string): string {
  return ordinal && ordinal !== "0" ? `line:${line}:${ordinal}` : `line:${line}`;
}

function piUsage(raw: Record<string, unknown> | undefined, issues: import("../types.js").CoverageIssue[], context: string) {
  return usageFromFields(raw, {
    input: ["input", "input_tokens", "inputTokens"],
    output: ["output", "output_tokens", "outputTokens"],
    cacheRead: ["cacheRead", "cache_read_input_tokens", "cacheReadInputTokens", "cache_read"],
    cacheWrite: ["cacheWrite", "cache_write_input_tokens", "cacheWriteInputTokens", "cache_write"],
    reasoning: ["reasoning", "reasoning_output_tokens", "reasoningOutputTokens"],
    unclassified: ["orchestration", "orchestration_tokens"],
  }, issues, context);
}

function piDirectUsage(raw: Record<string, unknown> | undefined, issues: import("../types.js").CoverageIssue[], context: string) {
  const usage = piUsage(raw, issues, context);
  if (!usage) return null;
  return {
    ...usage,
    input_tokens: addQuantities(usage.input_tokens, usage.cache_read_input_tokens, usage.cache_write_input_tokens),
  };
}

function piMessageRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(value.message) ?? (firstString(value.role) ? value : undefined);
}

function piCost(raw: Record<string, unknown> | undefined, issues?: import("../types.js").CoverageIssue[], context = "Pi native cost") {
  return recordedCost(raw, "model_price_estimate", "USD", issues, context);
}

function ompUsage(raw: Record<string, unknown> | undefined, issues: import("../types.js").CoverageIssue[], context: string) {
  const base = usageFromFields(raw, {
    input: ["input", "input_tokens", "inputTokens"],
    output: ["output", "output_tokens", "outputTokens"],
    cacheRead: ["cacheRead", "cache_read_input_tokens", "cacheReadInputTokens", "cache_read"],
    cacheWrite: ["cacheWrite", "cache_write_input_tokens", "cacheWriteInputTokens", "cache_write"],
    reasoning: ["reasoning", "reasoning_output_tokens", "reasoningOutputTokens"],
  }, issues, context);
  const orchestration = asRecord(raw?.orchestration);
  const orchestrationValue = orchestration?.input ?? orchestration?.input_tokens ?? raw?.orchestration_tokens;
  const orchestrationQuantity = quantity(orchestrationValue);
  if (orchestrationQuantity.invalid) issues.push({ code: "invalid_quantity", message: `${context} has an invalid orchestration quantity.`, severity: "error" });
  if (!base && orchestrationQuantity.value === null) return null;
  const usage = base ?? { input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_write_input_tokens: null, reasoning_output_tokens: null };
  return {
    ...usage,
    input_tokens: addQuantities(usage.input_tokens, usage.cache_read_input_tokens, usage.cache_write_input_tokens),
    ...(orchestrationQuantity.value !== null ? { unclassified_tokens: orchestrationQuantity.value } : {}),
  };
}

function ompMessage(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const nestedMessage = asRecord(record.message);
  if (nestedMessage) return nestedMessage;
  return firstString(record.role) ? record : undefined;
}

function omp(input: string, options?: ImportOptions): EvidenceBundle {
  const parsed = parseJsonInput(input);
  const bundle = makeBundle("omp", "oh-my-pi-session-jsonl", input, options, "Oh My Pi transcript and operational model-usage JSONL.", "oh-my-pi-session-jsonl-v1");
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  const sourceId = bundle.sources[0]?.id ?? "source";
  const directIds = new Map<string, string>();
  const addDirect = (record: Record<string, unknown>, message: Record<string, unknown>, line: number) => {
    const rawUsage = asRecord(message.usage) ?? asRecord(record.usage);
    const identity = firstString(message.id, message.message_id, message.responseId, message.response_id) ?? nativeIdentity(record, `line:${line}`);
    const usage = ompUsage(rawUsage, bundle.issues, `Oh My Pi line ${line}`);
    const responseModel = firstString(message.responseModel, message.response_model, record.responseModel, record.response_model);
    const model = responseModel ?? firstString(message.model, record.model);
    const cost = piCost(rawUsage, bundle.issues, `Oh My Pi line ${line}`);
    const signature = stableJson({ usage, model, provider: firstString(message.provider, record.provider), cost });
    const previous = directIds.get(identity);
    if (previous !== undefined) {
      if (previous !== signature) bundle.issues.push({ code: "conflicting_duplicate_usage", message: `Oh My Pi usage identity ${identity} has conflicting quantities or metadata.`, severity: "error", source_id: sourceId });
      else bundle.issues.push({ code: "duplicate_usage_identity", message: `Oh My Pi usage identity ${identity} was repeated and counted once.`, severity: "info", source_id: sourceId });
      return;
    }
    directIds.set(identity, signature);
    const observation = addModelObservation({
      bundle,
      harness: "omp",
      line,
      identity,
      operation: "omp.model",
      usage,
      sourceRecord: `response:${identity}`,
      status: inferStatus(message.stopReason ?? message.stop_reason ?? record.status),
      accountingScope: "direct",
      subjectId: firstString(message.responseId, message.response_id, record.responseId, record.response_id) ?? identity,
      grain: "operation",
      countBasis: "provider_native",
      product: "oh-my-pi",
      timestamp: firstString(message.timestamp, message.time, record.timestamp),
      endTime: firstString(message.endTime, message.end_time, record.endTime, record.end_time),
      agentId: firstString(record.agentId, record.agent_id, message.agentId, message.agent_id),
      sessionId: firstString(record.sessionId, record.session_id, message.sessionId, message.session_id),
      parentId: firstString(record.parentToolCallId, record.parent_tool_call_id, record.parentSessionId, record.parent_session_id),
      provider: firstString(message.provider, record.provider),
      model,
      modelIdentity: responseModel ? "response" : model ? "setting" : "unknown",
      workItemId: options?.work_item_id,
      recordedCost: cost,
      attributes: {
        source_record_type: firstString(record.type, record.kind) ?? "assistant",
        ...(rawUsage && rawUsage.totalTokens !== undefined ? { native_total_tokens: String(rawUsage.totalTokens) } : {}),
      },
    });
    if (!usage) bundle.issues.push({ code: "missing_usage", message: `Oh My Pi assistant record on line ${line} has no usable usage.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
  };
  for (const item of parsed.records) {
    const record = item.value;
    const type = (firstString(record.type, record.kind) ?? "").toLowerCase();
    const message = ompMessage(record);
    const role = firstString(message?.role)?.toLowerCase();
    if (role === "assistant" || type === "assistant") {
      addDirect(record, message ?? record, item.line);
      continue;
    }
    if (type === "model_usage" || type === "model-usage" || type === "modelusage") {
      const payload = asRecord(record.payload) ?? record;
      const rawUsage = asRecord(payload.usage) ?? asRecord(record.usage);
      const identity = nativeIdentity(record, `model-usage:${item.line}`);
      addModelObservation({ bundle, harness: "omp", line: item.line, identity, operation: "omp.model_usage", usage: ompUsage(rawUsage, bundle.issues, `Oh My Pi model_usage line ${item.line}`), sourceRecord: `model_usage:${identity}`, accountingScope: "aggregate", subjectId: identity, grain: "session", countBasis: "provider_native", product: "oh-my-pi", sessionId: firstString(record.sessionId, record.session_id, payload.sessionId, payload.session_id), model: firstString(record.model, payload.model), modelIdentity: "unknown", attributes: { operational: true, aggregate: true } });
      bundle.issues.push({ code: "omp_aggregate_non_additive", message: `Oh My Pi model_usage on line ${item.line} is operational aggregate evidence and is not added to direct usage.`, severity: "warning", source_id: sourceId });
      continue;
    }
    if (type === "toolresult" || type === "tool_result" || type === "task_result" || type === "agent_run") {
      const details = asRecord(record.details) ?? asRecord(record.payload) ?? record;
      const rawUsage = asRecord(details.usage) ?? asRecord(record.usage);
      const identity = nativeIdentity(record, `aggregate:${item.line}`);
      const operation = type === "agent_run" ? "omp.child_aggregate" : "omp.task";
      const aggregate = addToolObservation({ bundle, harness: "omp", line: item.line, identity, operation, usage: ompUsage(rawUsage, bundle.issues, `Oh My Pi aggregate line ${item.line}`), sourceRecord: `${operation}:${identity}`, accountingScope: "aggregate", subjectId: identity, grain: "operation", countBasis: "provider_native", product: "oh-my-pi", sessionId: firstString(record.sessionId, record.session_id, details.sessionId, details.session_id), parentId: firstString(record.parentToolCallId, record.parent_tool_call_id, details.parentToolCallId, details.parent_tool_call_id), workItemId: options?.work_item_id, attributes: { tool_name: firstString(record.toolName, record.tool_name, details.toolName, details.tool_name) ?? "task", aggregate: true, ...(firstString(details.agentId, details.agent_id) ? { child_agent_id: firstString(details.agentId, details.agent_id) as string } : {}) } });
      bundle.issues.push({ code: "omp_aggregate_non_additive", message: `Oh My Pi ${operation} on line ${item.line} is child/operational aggregate evidence and is not added to direct usage.`, severity: "warning", source_id: sourceId, observation_id: aggregate.id });
    }
  }
  addPartialCoverageIssue(bundle, "Oh My Pi assistant usage is direct; operational model_usage and child/task aggregates are retained separately. Hidden retries, fork attribution and exporter completeness remain unresolved.");
  return finalizeBundle(bundle, options);
}

function claudeUsage(raw: Record<string, unknown> | undefined, issues: import("../types.js").CoverageIssue[], context: string) {
  const base = usageFromFields(raw, {
    input: ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
    output: ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
    cacheRead: ["cache_read_input_tokens", "cacheReadInputTokens", "cache_read_tokens"],
    cacheWrite: ["cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens", "cacheWriteInputTokens"],
    reasoning: ["reasoning_output_tokens", "reasoningOutputTokens", "reasoning_tokens"],
  }, issues, context);
  if (!base) return null;
  return { ...base, input_tokens: addQuantities(base.input_tokens, base.cache_read_input_tokens, base.cache_write_input_tokens) };
}

function claude(input: string, options?: ImportOptions): EvidenceBundle {
  const parsed = parseJsonInput(input);
  const bundle = makeBundle("claude", "claude-code-transcript-jsonl", input, options, "Claude Code transcript JSONL with streaming message usage, tools and lifecycle evidence.", "claude-code-transcript-v1");
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  const sourceId = bundle.sources[0]?.id ?? "source";
  const streams = new Map<string, { record: Record<string, unknown>; message: Record<string, unknown>; line: number; rawUsage: Record<string, unknown> }>();
  const streamOrder: string[] = [];
  for (const item of parsed.records) {
    const record = item.value;
    const type = (firstString(record.type, record.kind) ?? "").toLowerCase();
    const message = asRecord(record.message) ?? (firstString(record.role) ? record : undefined);
    const role = firstString(message?.role)?.toLowerCase();
    if (type === "assistant" || role === "assistant") {
      const rawUsage = asRecord(message?.usage) ?? asRecord(record.usage);
      const messageId = firstString(message?.id, message?.message_id, record.message_id, record.messageId, record.request_id, record.requestId);
      if (!rawUsage || !messageId) {
        bundle.issues.push({ code: "missing_usage", message: `Claude assistant record on line ${item.line} lacks a response identity or usage.`, severity: "warning", source_id: sourceId });
      } else {
        const previous = streams.get(messageId);
        const normalized = claudeUsage(rawUsage, bundle.issues, `Claude line ${item.line}`);
        const signature = JSON.stringify(normalized);
        if (previous) {
          const oldNormalized = claudeUsage(previous.rawUsage, [], `Claude line ${previous.line}`);
          if (JSON.stringify(oldNormalized) !== signature) bundle.issues.push({ code: "claude_stream_revision", message: `Claude streaming message ${messageId} was revised; the latest usage row is selected.`, severity: "info", source_id: sourceId });
        } else streamOrder.push(messageId);
        streams.set(messageId, { record, message: message ?? record, line: item.line, rawUsage });
      }
      continue;
    }
    if (type === "tool_use" || type === "tool" || type === "tool_result" || type === "toolresult") {
      const toolName = firstString(record.name, record.tool_name, record.toolName, asRecord(record.tool)?.name) ?? "unknown";
      const toolId = firstString(record.tool_use_id, record.toolUseId, record.tool_call_id, record.toolCallId, record.id) ?? `line:${item.line}`;
      addToolObservation({ bundle, harness: "claude", line: item.line, identity: `tool:${toolId}`, operation: `claude.tool.${toolName}`, usage: null, sourceRecord: `tool:${toolId}`, status: inferStatus(record.status ?? record.error), sessionId: firstString(record.session_id, record.sessionId), parentId: firstString(record.parent_tool_use_id, record.parentToolUseId), product: "claude-code", workItemId: options?.work_item_id, attributes: { tool_name: toolName, tool_call_id_hash: hashNativeId(toolId) } });
      continue;
    }
    if (type === "subagent_completed" || type === "subagent-completed" || type === "agent_completed") {
      const total = quantity(record.total_tokens ?? record.totalTokens ?? asRecord(record.usage)?.total_tokens ?? asRecord(record.usage)?.totalTokens);
      if (total.invalid) bundle.issues.push({ code: "invalid_quantity", message: `Claude subagent completion on line ${item.line} has invalid total_tokens.`, severity: "error", source_id: sourceId });
      const identity = nativeIdentity(record, `subagent:${item.line}`);
      addModelObservation({ bundle, harness: "claude", line: item.line, identity, operation: "claude.subagent_completed", usage: total.value === null ? null : { input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_write_input_tokens: null, reasoning_output_tokens: null, unclassified_tokens: total.value }, sourceRecord: `subagent:${identity}`, accountingScope: "aggregate", subjectId: identity, grain: "operation", countBasis: "provider_native", product: "claude-code", agentId: firstString(record.agent_id, record.agentId), sessionId: firstString(record.session_id, record.sessionId), parentId: firstString(record.parent_id, record.parentId, record.parent_tool_use_id, record.parentToolUseId), attributes: { final_request_footprint: true } });
      bundle.issues.push({ code: "claude_subagent_footprint", message: `Claude subagent total_tokens on line ${item.line} is a final request footprint, not cumulative child expenditure.`, severity: "warning", source_id: sourceId });
      continue;
    }
    if (type === "compaction" || type === "compact" || type === "postcompact") {
      const identity = nativeIdentity(record, `compaction:${item.line}`);
      addActivityObservation({ bundle, harness: "claude", line: item.line, identity, operation: "claude.compaction", sourceRecord: `compaction:${identity}`, accountingScope: "unknown", sessionId: firstString(record.session_id, record.sessionId), product: "claude-code", attributes: { compaction_usage: "unknown" } });
      bundle.issues.push({ code: "compaction_usage_unknown", message: `Claude compaction on line ${item.line} has no model usage record.`, severity: "warning", source_id: sourceId });
    }
  }
  for (const messageId of streamOrder) {
    const item = streams.get(messageId);
    if (!item) continue;
    const message = item.message;
    const rawUsage = item.rawUsage;
    const responseModel = firstString(message.response_model, message.responseModel, item.record.response_model, item.record.responseModel, message.model);
    const identity = firstString(message.id, message.message_id, item.record.request_id, item.record.requestId) ?? messageId;
    const requestId = firstString(item.record.request_id, item.record.requestId, message.request_id, message.requestId);
    const observation = addModelObservation({ bundle, harness: "claude", line: item.line, identity: `response:${identity}`, operation: "claude.model", usage: claudeUsage(rawUsage, bundle.issues, `Claude line ${item.line}`), sourceRecord: `response:${identity}`, status: inferStatus(message.stop_reason ?? message.stopReason ?? item.record.status), accountingScope: "direct", subjectId: identity, grain: "operation", countBasis: "provider_native", product: "claude-code", timestamp: firstString(item.record.timestamp, item.record.timestamp_ms, message.timestamp), sessionId: firstString(item.record.session_id, item.record.sessionId, message.session_id, message.sessionId), turnId: firstString(item.record.turn_id, item.record.turnId), parentId: firstString(item.record.parent_tool_use_id, item.record.parentToolUseId, message.parent_tool_use_id, message.parentToolUseId), provider: firstString(item.record.provider, message.provider) ?? "anthropic", model: responseModel, modelIdentity: responseModel ? "response" : "unknown", workItemId: options?.work_item_id, attributes: { stream_message_id_hash: hashNativeId(messageId), ...(requestId ? { request_id_hash: hashNativeId(requestId) } : {}) }, recordedCost: recordedCost(rawUsage, "provider_reported", "USD", bundle.issues, `Claude line ${item.line} cost`) });
    if (observation.usage === null) bundle.issues.push({ code: "missing_usage", message: `Claude response ${messageId} has no usable terminal usage.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
  }
  addPartialCoverageIssue(bundle, "Claude Code streaming usage uses the latest usage-bearing row per message identity; tool attribution, hidden retries and compaction request usage remain unresolved.");
  return finalizeBundle(bundle, options);
}

function geminiUsage(raw: Record<string, unknown> | undefined, issues: import("../types.js").CoverageIssue[], context: string) {
  // Gemini's prompt/input count is inclusive when cachedContentTokenCount is
  // present. Gemini chat records historically store candidate output and
  // thoughts separately, so use the native total when available to determine
  // whether candidates already includes thoughts before normalizing.
  const usage = usageFromFields(raw, {
    input: ["input", "input_tokens", "inputTokens", "promptTokenCount", "prompt_token_count"],
    output: ["output", "output_tokens", "outputTokens", "candidatesTokenCount", "candidates_token_count"],
    cacheRead: ["cached", "cached_tokens", "cachedContentTokenCount", "cached_content_token_count", "cache_read_input_tokens"],
    cacheWrite: ["cacheWrite", "cache_write_input_tokens", "cacheCreationInputTokens"],
    reasoning: ["thoughts", "thoughts_tokens", "thoughtsTokenCount", "thoughts_token_count", "reasoning_output_tokens"],
  }, issues, context);
  if (!raw || !usage || usage.output_tokens === null || usage.reasoning_output_tokens === null) return usage;
  const outputIsStandardInclusive = raw.output_tokens !== undefined || raw.outputTokens !== undefined;
  if (outputIsStandardInclusive) return usage;
  const inputRaw = raw.input ?? raw.input_tokens ?? raw.inputTokens ?? raw.promptTokenCount ?? raw.prompt_token_count;
  const totalRaw = raw.total ?? raw.total_tokens ?? raw.totalTokens ?? raw.totalTokenCount ?? raw.total_token_count;
  const inputResult = quantity(inputRaw);
  const totalResult = quantity(totalRaw);
  if (inputResult.invalid) issues.push({ code: "invalid_quantity", message: `${context} has an invalid input quantity while reconciling output semantics.`, severity: "error" });
  if (totalResult.invalid) issues.push({ code: "invalid_quantity", message: `${context} has an invalid total quantity while reconciling output semantics.`, severity: "error" });
  const input = inputResult.value;
  const total = totalResult.value;
  if (total !== null && input !== null) {
    const inclusive = addQuantities(input, usage.output_tokens);
    const exclusive = addQuantities(input, usage.output_tokens, usage.reasoning_output_tokens);
    if (total === exclusive && total !== inclusive) return { ...usage, output_tokens: exclusive };
    if (total === inclusive) return usage;
    issues.push({ code: "gemini_output_reasoning_semantics_unknown", message: `${context} has a total that does not establish whether candidates include thoughts; output is retained conservatively.`, severity: "warning" });
    return usage;
  }
  // The native chat-recording field names are candidates/output + thoughts;
  // absent a reconciliation total, include thoughts in normalized output.
  return { ...usage, output_tokens: addQuantities(usage.output_tokens, usage.reasoning_output_tokens) };
}

function gemini(input: string, options?: ImportOptions): EvidenceBundle {
  const parsed = parseJsonInput(input);
  const bundle = makeBundle("gemini", "gemini-cli-chat-jsonl", input, options, "Gemini CLI chat/DevTools JSONL with model usage and lifecycle records.", "gemini-cli-chat-jsonl-v1");
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  const sourceId = bundle.sources[0]?.id ?? "source";
  const calls = new Map<string, { record: Record<string, unknown>; message: Record<string, unknown>; usage?: Record<string, unknown>; line: number }>();
  const order: string[] = [];
  for (const item of parsed.records) {
    const record = item.value;
    const type = (firstString(record.type, record.kind) ?? "").toLowerCase();
    const response = asRecord(record.response);
    const message = asRecord(record.message) ?? response ?? (firstString(record.role) ? record : undefined);
    const candidateUsage = asRecord(message?.usage) ?? asRecord(message?.usageMetadata) ?? asRecord(record.usage) ?? asRecord(record.usageMetadata) ?? asRecord(response?.usageMetadata) ?? asRecord(record.tokens);
    // An empty/cost-only metadata object is not a usage-bearing streaming
    // update. Keep the previous measured row when such a trailer arrives.
    const usage = candidateUsage && geminiUsage(candidateUsage, [], `Gemini line ${item.line}`) ? candidateUsage : undefined;
    const role = firstString(message?.role)?.toLowerCase();
    const modelRecord = type === "message" || type === "model" || type === "gemini" || type === "response" || type === "network" || role === "model" || role === "assistant";
    if (modelRecord) {
      const identity = firstString(message?.id, message?.messageId, record.id, record.message_id, record.messageId, record.requestId, record.request_id) ?? `line:${item.line}`;
      const previous = calls.get(identity);
      if (previous && usage) {
        const oldUsage = geminiUsage(previous.usage, [], `Gemini line ${previous.line}`);
        const newUsage = geminiUsage(usage, [], `Gemini line ${item.line}`);
        if (JSON.stringify(oldUsage) !== JSON.stringify(newUsage)) bundle.issues.push({ code: "gemini_stream_revision", message: `Gemini message ${identity} was revised; the latest usage-bearing record is selected.`, severity: "info", source_id: sourceId });
      } else if (!previous) order.push(identity);
      // A later usage-bearing row supersedes an earlier missing-usage row;
      // a trailing metadata-only row must not erase measured usage.
      calls.set(identity, { record, message: message ?? record, usage: usage ?? previous?.usage, line: item.line });
      continue;
    }
    if (["toolcall", "tool_call", "tool", "toolresult", "tool_result"].includes(type)) {
      const toolName = firstString(record.name, record.tool_name, record.toolName, asRecord(record.tool)?.name) ?? "unknown";
      const toolId = firstString(record.id, record.toolCallId, record.tool_call_id, record.toolUseId, record.tool_use_id) ?? `line:${item.line}`;
      addToolObservation({ bundle, harness: "gemini", line: item.line, identity: `tool:${toolId}`, operation: `gemini.tool.${toolName}`, usage: null, sourceRecord: `tool:${toolId}`, status: inferStatus(record.status ?? record.error), sessionId: firstString(record.sessionId, record.session_id), parentId: firstString(record.parentSessionId, record.parent_session_id), product: "gemini-cli", workItemId: options?.work_item_id, attributes: { tool_name: toolName, tool_call_id_hash: hashNativeId(toolId) } });
      continue;
    }
    if (type === "subagent" || type === "agent" || type === "subagent_completed") {
      addActivityObservation({ bundle, harness: "gemini", line: item.line, identity: nativeIdentity(record, `subagent:${item.line}`), operation: "gemini.subagent", sourceRecord: `subagent:${item.line}`, accountingScope: "unknown", agentId: firstString(record.agentId, record.agent_id), sessionId: firstString(record.sessionId, record.session_id), parentId: firstString(record.parentSessionId, record.parent_session_id), product: "gemini-cli", attributes: { lifecycle: type } });
      continue;
    }
    if (type.includes("context") && (record.estimate !== undefined || record.breakdown !== undefined || record.contextBreakdown !== undefined)) {
      addActivityObservation({ bundle, harness: "gemini", line: item.line, identity: nativeIdentity(record, `context:${item.line}`), operation: "gemini.context_breakdown", sourceRecord: `context:${item.line}`, accountingScope: "unknown", sessionId: firstString(record.sessionId, record.session_id), product: "gemini-cli", attributes: { estimate: true } });
      bundle.issues.push({ code: "context_estimate_not_usage", message: `Gemini context breakdown on line ${item.line} is an estimate and is not model usage.`, severity: "warning", source_id: sourceId });
    }
  }
  for (const identity of order) {
    const call = calls.get(identity);
    if (!call) continue;
    const responseModel = firstString(call.message.responseModel, call.message.response_model, call.record.responseModel, call.record.response_model, call.message.model, call.record.model);
    const usage = geminiUsage(call.usage, bundle.issues, `Gemini line ${call.line}`);
    const observation = addModelObservation({ bundle, harness: "gemini", line: call.line, identity: `response:${identity}`, operation: "gemini.model", usage, sourceRecord: `response:${identity}`, status: inferStatus(call.message.finishReason ?? call.message.finish_reason ?? call.record.status), accountingScope: "direct", subjectId: firstString(call.message.responseId, call.message.response_id, call.record.responseId, call.record.response_id) ?? identity, grain: "operation", countBasis: "provider_native", product: "gemini-cli", timestamp: firstString(call.record.timestamp, call.message.timestamp), sessionId: firstString(call.record.sessionId, call.record.session_id, call.message.sessionId, call.message.session_id), turnId: firstString(call.record.turnId, call.record.turn_id), parentId: firstString(call.record.parentSessionId, call.record.parent_session_id, call.message.parentSessionId, call.message.parent_session_id), provider: firstString(call.record.provider, call.message.provider) ?? "google", model: responseModel, modelIdentity: responseModel ? "response" : "unknown", workItemId: options?.work_item_id, recordedCost: recordedCost(call.usage, "provider_reported", "USD", bundle.issues, `Gemini line ${call.line} cost`), attributes: { message_id_hash: hashNativeId(identity), ...(call.usage?.totalTokenCount !== undefined ? { native_total_tokens: String(call.usage.totalTokenCount) } : {}), ...(call.usage?.total_tokens !== undefined ? { native_total_tokens: String(call.usage.total_tokens) } : {}) } });
    if (observation.usage === null) bundle.issues.push({ code: "missing_usage", message: `Gemini response ${identity} has no usable usage.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
  }
  addPartialCoverageIssue(bundle, "Gemini input is treated as inclusive when native prompt counts include cached content; context estimates and nested session discovery remain separate and partial.");
  return finalizeBundle(bundle, options);
}

function opencodeUsage(raw: Record<string, unknown> | undefined, issues: import("../types.js").CoverageIssue[], context: string) {
  const tokens = asRecord(raw?.tokens) ?? raw;
  const cache = asRecord(tokens?.cache);
  const base = usageFromFields(tokens, {
    input: ["input", "input_tokens", "inputTokens"],
    output: ["output", "output_tokens", "outputTokens"],
    cacheRead: ["cache_read", "cacheRead", "cache_read_input_tokens", "cacheReadInputTokens"],
    cacheWrite: ["cache_write", "cacheWrite", "cache_write_input_tokens", "cacheWriteInputTokens"],
    reasoning: ["reasoning", "reasoning_output_tokens", "reasoningOutputTokens"],
  }, issues, context);
  if (!base) return null;
  // Current OpenCode step tokens are exclusive: cache is separate from input,
  // and reasoning is separate from output.
  const nestedQuantity = (value: unknown, name: string): string | null => {
    const result = quantity(value);
    if (result.invalid) {
      issues.push({ code: "invalid_quantity", message: `${context} has an invalid token quantity for ${name}.`, severity: "error" });
    }
    return result.value;
  };
  const cacheRead = base.cache_read_input_tokens ?? nestedQuantity(cache?.read, "cache.read");
  const cacheWrite = base.cache_write_input_tokens ?? nestedQuantity(cache?.write, "cache.write");
  const input = addQuantities(base.input_tokens, cacheRead, cacheWrite);
  const output = addQuantities(base.output_tokens, base.reasoning_output_tokens);
  return { ...base, input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_write_input_tokens: cacheWrite };
}

function opencode(input: string, options?: ImportOptions): EvidenceBundle {
  const parsed = parseJsonInput(input);
  const bundle = makeBundle("opencode", "opencode-step-jsonl", input, options, "OpenCode step-finish/session telemetry JSONL.", "opencode-step-jsonl-v1");
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  const sourceId = bundle.sources[0]?.id ?? "source";
  const directIds = new Map<string, string>();
  for (const item of parsed.records) {
    const record = item.value;
    const type = (firstString(record.type, record.kind, record.event) ?? "").toLowerCase().replace(/_/g, "-");
    const part = asRecord(record.part) ?? record;
    const tokens = asRecord(part.tokens) ?? asRecord(record.tokens);
    const isStep = type === "step-finish" || type === "stepfinish" || type === "step" || (tokens !== undefined && type !== "session-total" && type !== "session" && type !== "aggregate");
    if (isStep) {
      const messageId = firstString(record.messageID, record.messageId, record.message_id, part.messageID, part.messageId);
      const stepId = firstString(part.id, part.stepID, part.stepId, record.id, record.partID, record.partId);
      const identity = messageId && stepId ? `${messageId}:${stepId}` : messageId ?? stepId ?? `line:${item.line}`;
      const usage = tokens ? opencodeUsage({ tokens }, bundle.issues, `OpenCode line ${item.line}`) : null;
      const model = firstString(record.modelID, record.modelId, record.model_id, part.modelID, part.modelId, record.model);
      const provider = firstString(record.providerID, record.providerId, record.provider, part.providerID, part.providerId);
      const responseModel = firstString(record.responseModel, record.response_model, part.responseModel, part.response_model);
      const nativeCost = part.cost !== undefined ? part.cost : record.cost;
      const signature = stableJson({ usage, model, provider, responseModel, cost: nativeCost, status: part.reason ?? record.reason ?? record.status });
      const previous = directIds.get(identity);
      if (previous !== undefined) {
        if (previous !== signature) bundle.issues.push({ code: "conflicting_duplicate_usage", message: `OpenCode step identity ${identity} has conflicting quantities or metadata.`, severity: "error", source_id: sourceId });
        else bundle.issues.push({ code: "duplicate_usage_identity", message: `OpenCode step ${identity} was repeated and counted once.`, severity: "info", source_id: sourceId });
        continue;
      }
      directIds.set(identity, signature);
      const rawCost = nativeCost !== undefined ? { cost: nativeCost } : undefined;
      const observation = addModelObservation({ bundle, harness: "opencode", line: item.line, identity: `step:${identity}`, operation: "opencode.model", usage, sourceRecord: `step:${identity}`, status: inferStatus(part.reason ?? record.reason ?? record.status), accountingScope: "direct", subjectId: firstString(record.responseID, record.responseId, record.response_id, part.responseID, part.responseId) ?? identity, grain: "operation", countBasis: "provider_native", product: "opencode", timestamp: firstString(record.timestamp, record.time, part.timestamp), endTime: firstString(record.endTime, record.end_time, part.endTime, part.end_time), sessionId: firstString(record.sessionID, record.sessionId, record.session_id, part.sessionID, part.sessionId), parentId: firstString(record.parentID, record.parentId, record.parent_id, part.parentID, part.parentId), provider, model: responseModel ?? model, modelIdentity: responseModel ? "response" : model ? "setting" : "unknown", workItemId: options?.work_item_id, recordedCost: recordedCost(rawCost, "model_price_estimate", "USD", bundle.issues, `OpenCode line ${item.line}`), attributes: { step_id_hash: hashNativeId(identity), ...(firstString(part.reason) ? { finish_reason: firstString(part.reason) as string } : {}) } });
      if (observation.usage === null) bundle.issues.push({ code: "missing_usage", message: `OpenCode step ${identity} has no usable usage.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
      continue;
    }
    if (type === "session-total" || type === "session" || type === "aggregate" || type === "session-usage") {
      const rawTokens = asRecord(record.tokens) ?? asRecord(record.usage) ?? record;
      const identity = nativeIdentity(record, `session-total:${item.line}`);
      addModelObservation({ bundle, harness: "opencode", line: item.line, identity, operation: "opencode.session_total", usage: opencodeUsage(rawTokens, bundle.issues, `OpenCode aggregate line ${item.line}`), sourceRecord: `session-total:${identity}`, accountingScope: "aggregate", subjectId: identity, grain: "session", countBasis: "provider_native", product: "opencode", sessionId: firstString(record.sessionID, record.sessionId, record.session_id), modelIdentity: "unknown", recordedCost: recordedCost(record, "model_price_estimate", "USD", bundle.issues, `OpenCode aggregate line ${item.line} cost`), attributes: { aggregate: true } });
      bundle.issues.push({ code: "opencode_aggregate_non_additive", message: `OpenCode session total on line ${item.line} is aggregate evidence and is not added to direct usage.`, severity: "warning", source_id: sourceId });
      continue;
    }
    if (type.includes("tool")) {
      const name = firstString(record.name, record.toolName, record.tool_name, asRecord(record.tool)?.name) ?? "unknown";
      const toolId = firstString(record.callID, record.callId, record.call_id, record.id) ?? `line:${item.line}`;
      addToolObservation({ bundle, harness: "opencode", line: item.line, identity: `tool:${toolId}`, operation: `opencode.tool.${name}`, usage: null, sourceRecord: `tool:${toolId}`, status: inferStatus(record.status ?? record.error), sessionId: firstString(record.sessionID, record.sessionId, record.session_id), parentId: firstString(record.parentID, record.parentId), product: "opencode", workItemId: options?.work_item_id, attributes: { tool_name: name, tool_call_id_hash: hashNativeId(toolId) } });
      continue;
    }
    if (type === "retry" || type === "request" || type === "response" || type === "step-start" || type === "cancelled" || type === "canceled") {
      addActivityObservation({ bundle, harness: "opencode", line: item.line, identity: nativeIdentity(record, `${type}:${item.line}`), operation: `opencode.${type}`, sourceRecord: `${type}:${item.line}`, accountingScope: "unknown", status: type.includes("cancel") ? "cancelled" : inferStatus(record.status ?? record.error), sessionId: firstString(record.sessionID, record.sessionId, record.session_id), parentId: firstString(record.parentID, record.parentId), product: "opencode", attributes: { lifecycle: type } });
      if (type === "retry") bundle.issues.push({ code: "opencode_retry_unresolved", message: `OpenCode retry event on line ${item.line} is retained without physical-attempt billing evidence.`, severity: "warning", source_id: sourceId });
    }
  }
  addPartialCoverageIssue(bundle, "OpenCode step-finish input/output are normalized from exclusive cache/reasoning buckets; parent session totals and transport retries remain non-additive or unresolved.");
  return finalizeBundle(bundle, options);
}

interface OtlpSpanEntry {
  span: Record<string, unknown>;
  resource: Record<string, unknown>;
}

function attributeValue(value: unknown): unknown {
  if (!asRecord(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue", "bytesValue"]) {
    if (record[key] !== undefined) return record[key];
  }
  if (Array.isArray(record.arrayValue)) return record.arrayValue.map(attributeValue);
  if (asRecord(record.arrayValue)?.values && Array.isArray((asRecord(record.arrayValue) as Record<string, unknown>).values)) return ((asRecord(record.arrayValue) as Record<string, unknown>).values as unknown[]).map(attributeValue);
  return value;
}

function otelAttributes(raw: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const pair = asRecord(item);
      const key = firstString(pair?.key);
      if (key && pair) map.set(key, attributeValue(pair.value));
    }
  } else if (asRecord(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) map.set(key, attributeValue(value));
  }
  return map;
}

function flattenOtlp(value: Record<string, unknown>): OtlpSpanEntry[] {
  const result: OtlpSpanEntry[] = [];
  const resourceSpans = Array.isArray(value.resourceSpans) ? value.resourceSpans : Array.isArray(value.resource_spans) ? value.resource_spans : [];
  for (const resourceSpanValue of resourceSpans) {
    const resourceSpan = asRecord(resourceSpanValue);
    if (!resourceSpan) continue;
    const resource = asRecord(resourceSpan.resource) ?? {};
    const scopeSpans = Array.isArray(resourceSpan.scopeSpans) ? resourceSpan.scopeSpans : Array.isArray(resourceSpan.scope_spans) ? resourceSpan.scope_spans : [];
    for (const scopeSpanValue of scopeSpans) {
      const scopeSpan = asRecord(scopeSpanValue);
      const spans = Array.isArray(scopeSpan?.spans) ? scopeSpan.spans : Array.isArray(scopeSpan?.span) ? scopeSpan.span : [];
      for (const spanValue of spans) {
        const span = asRecord(spanValue);
        if (span) result.push({ span, resource });
      }
    }
  }
  const directSpans = Array.isArray(value.spans) ? value.spans : Array.isArray(value.span) ? value.span : [];
  for (const spanValue of directSpans) {
    const span = asRecord(spanValue);
    if (span) result.push({ span, resource: asRecord(value.resource) ?? {} });
  }
  return result;
}

function otelRawUsage(attrs: Map<string, unknown>): Record<string, unknown> | undefined {
  const get = (...keys: string[]): unknown => {
    for (const key of keys) if (attrs.has(key)) return attrs.get(key);
    return undefined;
  };
  const raw: Record<string, unknown> = {
    input_tokens: get("gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "llm.token_count.prompt", "llm.usage.prompt_tokens", "github.copilot.usage.input_tokens", "copilot.usage.input_tokens"),
    output_tokens: get("gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "llm.token_count.completion", "llm.usage.completion_tokens", "github.copilot.usage.output_tokens", "copilot.usage.output_tokens"),
    cache_read_input_tokens: get("flAImegraph.usage.cache_read_input_tokens", "gen_ai.usage.cache_read_input_tokens", "gen_ai.usage.cache_read_tokens", "gen_ai.usage.cached_input_tokens", "llm.token_count.cache_read", "github.copilot.usage.cache_read_input_tokens", "copilot.usage.cache_read_input_tokens"),
    cache_write_input_tokens: get("flAImegraph.usage.cache_write_input_tokens", "gen_ai.usage.cache_write_input_tokens", "gen_ai.usage.cache_write_tokens", "gen_ai.usage.cache_creation_input_tokens", "llm.token_count.cache_write", "github.copilot.usage.cache_write_input_tokens", "copilot.usage.cache_write_input_tokens"),
    reasoning_output_tokens: get("flAImegraph.usage.reasoning_output_tokens", "gen_ai.usage.reasoning_output_tokens", "gen_ai.usage.reasoning_tokens", "llm.token_count.reasoning", "github.copilot.usage.reasoning_output_tokens", "copilot.usage.reasoning_output_tokens"),
  };
  raw.unclassified_tokens = get("flAImegraph.usage.unclassified_tokens");
  if (Object.values(raw).every((value) => value === undefined || value === null)) return undefined;
  return raw;
}

function otelCost(attrs: Map<string, unknown>): Record<string, unknown> | undefined {
  const amount = attrs.get("flAImegraph.recorded_cost.amount") ?? attrs.get("gen_ai.usage.cost.amount") ?? attrs.get("gen_ai.usage.cost") ?? attrs.get("github.copilot.cost.amount") ?? attrs.get("github.copilot.cost") ?? attrs.get("copilot.cost.amount") ?? attrs.get("copilot.cost");
  if (amount === undefined || amount === null) return undefined;
  return { cost: { total: amount, currency: attrs.get("flAImegraph.recorded_cost.currency") ?? attrs.get("gen_ai.usage.cost.currency") ?? attrs.get("github.copilot.cost.currency") ?? attrs.get("copilot.cost.currency") ?? "USD" } };
}

function otelCostBasis(attrs: Map<string, unknown>): import("../types.js").RecordedCost["basis"] {
  const localBasis = firstString(attrs.get("flAImegraph.recorded_cost.basis"))?.toLowerCase();
  if (localBasis === "model_price_estimate" || localBasis === "provider_reported" || localBasis === "billed" || localBasis === "enterprise_scenario" || localBasis === "contract_estimate") return localBasis;
  const source = firstString(attrs.get("gen_ai.usage.cost.source"), attrs.get("github.copilot.cost.source"), attrs.get("copilot.cost.source"))?.toLowerCase();
  if (source === "billed" || source === "invoice") return "billed";
  if (source === "local" || source === "estimate" || source === "estimated") return "model_price_estimate";
  return "provider_reported";
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined;
}

function otelStatus(span: Record<string, unknown>): import("../types.js").Observation["status"] {
  const status = asRecord(span.status);
  const code = status?.code;
  if (code === 2 || code === "2" || firstString(status?.status)?.toLowerCase().includes("error")) return "error";
  if (code === 1 || code === "1") return "ok";
  return inferStatus(status?.message ?? span.status);
}

function importOtlp(harness: "otel" | "copilot", input: string, options?: ImportOptions): EvidenceBundle {
  const parsed = parseJsonInput(input);
  const isCopilot = harness === "copilot";
  const bundle = makeBundle(harness, isCopilot ? "copilot-otlp-json" : "otlp-json", input, options, isCopilot ? "GitHub Copilot native OTLP JSON spans." : "OpenTelemetry JSON resource spans with GenAI attributes.", isCopilot ? "copilot-otlp-json-v1" : "otlp-json-v1");
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  const entries: OtlpSpanEntry[] = parsed.records.flatMap(({ value }) => flattenOtlp(value));
  const sourceId = bundle.sources[0]?.id ?? "source";
  const spanObservations = new Map<string, string>();
  const seenSpans = new Map<string, string>();
  for (const [index, entry] of entries.entries()) {
    const span = entry.span;
    const resourceAttrs = otelAttributes(entry.resource.attributes);
    const attrs = otelAttributes(span.attributes);
    const spanId = firstString(span.spanId, span.span_id);
    const traceId = firstString(span.traceId, span.trace_id);
    const nativeOperation = firstString(attrs.get("gen_ai.operation.name"), span.name) ?? "span";
    const importedOperation = firstString(attrs.get("flAImegraph.operation"));
    const operation = importedOperation ?? nativeOperation;
    const normalizedOperation = nativeOperation.toLowerCase();
    const importedKind = enumValue(attrs.get("flAImegraph.observation.kind"), ["model", "tool", "activity"] as const);
    const importedScope = enumValue(attrs.get("flAImegraph.accounting_scope"), ["direct", "aggregate", "snapshot", "unknown"] as const);
    const isTool = importedKind === "tool" || (importedKind === undefined && /tool|execute_tool/.test(normalizedOperation));
    const isActivity = importedKind === "activity";
    const isAgent = importedScope === "aggregate" || (importedScope === undefined && /invoke_agent|agent|workflow|plan/.test(normalizedOperation) && !/chat|generate|inference|completion/.test(normalizedOperation));
    const rawUsage = otelRawUsage(attrs);
    const usage = rawUsage ? usageFromFields(rawUsage, { input: ["input_tokens"], output: ["output_tokens"], cacheRead: ["cache_read_input_tokens"], cacheWrite: ["cache_write_input_tokens"], reasoning: ["reasoning_output_tokens"] }, bundle.issues, `${harness} span ${spanId ?? index}`) : null;
    const signature = stableJson({
      operation,
      rawUsage,
      traceId,
      spanId,
      parentSpanId: firstString(span.parentSpanId, span.parent_span_id),
      name: span.name,
      startTime: span.startTime ?? span.start_time,
      startTimeUnixNano: span.startTimeUnixNano ?? span.start_time_unix_nano,
      endTime: span.endTime ?? span.end_time,
      endTimeUnixNano: span.endTimeUnixNano ?? span.end_time_unix_nano,
      status: span.status,
      attributes: [...attrs.entries()].sort(([left], [right]) => left.localeCompare(right)),
      resourceAttributes: [...resourceAttrs.entries()].sort(([left], [right]) => left.localeCompare(right)),
    });
    const originalObservationId = firstString(attrs.get("flAImegraph.observation_id"));
    const identity = originalObservationId ?? spanId ?? `${traceId ?? "trace"}:${index}`;
    const previous = seenSpans.get(identity);
    if (previous !== undefined) {
      if (previous !== signature) bundle.issues.push({ code: "conflicting_duplicate_span", message: `${harness} span ${identity} was delivered again with conflicting content.`, severity: "error", source_id: sourceId });
      continue;
    }
    seenSpans.set(identity, signature);
    const serviceName = firstString(resourceAttrs.get("service.name"), attrs.get("service.name"));
    const provider = firstString(
      attrs.get("flAImegraph.provider"),
      attrs.get("gen_ai.provider.name"),
      attrs.get("gen_ai.system"),
      attrs.get("gen_ai.provider"),
      resourceAttrs.get("gen_ai.provider.name"),
      resourceAttrs.get("gen_ai.system"),
      resourceAttrs.get("gen_ai.provider"),
      attrs.get("github.copilot.provider"),
      attrs.get("copilot.provider"),
      isCopilot ? "github-copilot" : undefined,
      // Keep compatibility with older generic OTLP fixtures that only carry
      // service.name, while ensuring an explicit GenAI provider always wins.
      serviceName,
    );
    const responseModel = firstString(attrs.get("gen_ai.response.model"), attrs.get("github.copilot.response.model"), attrs.get("copilot.response.model"));
    const requestedModel = firstString(attrs.get("gen_ai.request.model"), attrs.get("github.copilot.request.model"), attrs.get("copilot.request.model"));
    const responseId = firstString(attrs.get("gen_ai.response.id"), attrs.get("gen_ai.response_id"), attrs.get("github.copilot.response.id"), attrs.get("copilot.response.id"));
    const sessionId = firstString(attrs.get("flAImegraph.session_id"), attrs.get("gen_ai.conversation.id"), attrs.get("conversation.id"), attrs.get("session.id"), attrs.get("github.copilot.conversation.id"), attrs.get("copilot.conversation.id"));
    const turnId = firstString(attrs.get("flAImegraph.turn_id"), attrs.get("gen_ai.turn.id"), attrs.get("turn.id"), attrs.get("github.copilot.turn.id"), attrs.get("copilot.turn.id"));
    const agentId = firstString(attrs.get("flAImegraph.agent_id"));
    const workItemId = firstString(attrs.get("flAImegraph.work_item_id"), options?.work_item_id);
    const parentSpanId = firstString(span.parentSpanId, span.parent_span_id, attrs.get("parent.id"));
    const aiUnits = firstString(attrs.get("github.copilot.ai_units"), attrs.get("github.copilot.usage.ai_units"), attrs.get("copilot.ai_units"));
    const countBasisRaw = firstString(attrs.get("flAImegraph.count_basis"), attrs.get("gen_ai.usage.count_basis"), attrs.get("github.copilot.usage.count_basis"));
    const countBasis: import("../types.js").Observation["count_basis"] = countBasisRaw === "billable" ? "billable" : countBasisRaw === "consumed" ? "consumed" : countBasisRaw === "provider_native" ? "provider_native" : "unknown";
    const cost = otelCost(attrs);
    const operationKey = importedOperation ?? `${harness}.${operation.replace(/[^A-Za-z0-9_.-]+/g, "_")}`;
    const timestamp = normalizeTimestamp(
      firstString(span.startTime, span.start_time),
      span.startTimeUnixNano ?? span.start_time_unix_nano,
      bundle.issues,
      `${harness} span ${identity} start time`,
    );
    const endTime = normalizeTimestamp(
      firstString(span.endTime, span.end_time),
      span.endTimeUnixNano ?? span.end_time_unix_nano,
      bundle.issues,
      `${harness} span ${identity} end time`,
    );
    const normalizedTraceId = firstString(attrs.get("flAImegraph.original_trace_id"), traceId);
    const normalizedSpanId = firstString(attrs.get("flAImegraph.original_span_id"), spanId);
    const nativeStart = span.startTimeUnixNano ?? span.start_time_unix_nano;
    const nativeEnd = span.endTimeUnixNano ?? span.end_time_unix_nano;
    const importedStatus = enumValue(attrs.get("flAImegraph.status"), ["ok", "error", "cancelled", "unknown"] as const);
    const accountingScope = importedScope ?? (isAgent ? "aggregate" as const : isTool ? "unknown" as const : "direct" as const);
    const model = responseModel ?? requestedModel ?? firstString(attrs.get("flAImegraph.model"));
    const localModelIdentity = enumValue(attrs.get("flAImegraph.model_identity"), ["response", "setting", "unknown"] as const);
    const modelIdentity = responseModel ? "response" as const : requestedModel ? "setting" as const : localModelIdentity ?? "unknown" as const;
    const importedGrain = enumValue(attrs.get("flAImegraph.grain"), ["attempt", "operation", "session", "event", "unknown"] as const);
    const common = { bundle, harness, line: index + 1, identity: `span:${identity}`, operation: operationKey, usage, sourceRecord: `span:${identity}`, status: importedStatus ?? otelStatus(span), accountingScope, subjectId: firstString(attrs.get("flAImegraph.subject_id"), responseId, originalObservationId, identity), grain: importedGrain ?? (isAgent ? "session" as const : "operation" as const), countBasis, product: firstString(attrs.get("flAImegraph.product")) ?? (isCopilot ? "copilot" : "otel"), timestamp, endTime, agentId, sessionId, turnId, parentId: parentSpanId, traceId: normalizedTraceId, spanId: normalizedSpanId, provider, model, modelIdentity, workItemId, recordedCost: cost ? recordedCost(cost, otelCostBasis(attrs), "USD", bundle.issues, `${harness} span ${identity} cost`) : undefined, attributes: { span_name: firstString(span.name) ?? nativeOperation, ...(serviceName ? { "flAImegraph.otel.service_name": serviceName } : {}), ...(originalObservationId ? { "flAImegraph.original_observation_id": originalObservationId } : {}), ...(nativeStart !== undefined ? { "flAImegraph.otel.start_time_unix_nano": String(nativeStart) } : {}), ...(nativeEnd !== undefined ? { "flAImegraph.otel.end_time_unix_nano": String(nativeEnd) } : {}), ...(aiUnits ? { ai_units: aiUnits } : {}), ...(isCopilot ? { copilot_native: true } : {}), ...(isAgent ? { aggregate: true } : {}) } };
    let observation;
    if (isTool) {
      const toolName = firstString(attrs.get("gen_ai.tool.name"), attrs.get("tool.name"), attrs.get("github.copilot.tool.name"), attrs.get("copilot.tool.name")) ?? firstString(span.name) ?? "unknown";
      observation = addToolObservation({ ...common, operation: importedOperation ?? `${harness}.tool.${toolName}`, usage, attributes: { ...common.attributes, tool_name: toolName } });
    } else if (isActivity) {
      observation = addModelObservation(common);
      observation.kind = "activity";
    } else {
      observation = addModelObservation(common);
    }
    if (spanId) spanObservations.set(spanId, observation.id);
    if (isAgent && usage) bundle.issues.push({ code: "otel_aggregate_non_additive", message: `${harness} agent/workflow span ${identity} contains aggregate usage and is not added to direct inference usage.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
    if (!isAgent && !isTool && !isActivity && usage === null) bundle.issues.push({ code: "missing_usage", message: `${harness} model span ${identity} has no usage attributes.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
  }
  const relationships = new Set<string>();
  for (const entry of entries) {
    const span = entry.span;
    const from = firstString(span.spanId, span.span_id);
    const parent = firstString(span.parentSpanId, span.parent_span_id);
    if (from && parent && spanObservations.has(from) && spanObservations.has(parent)) {
      // `Observation.parent_id` points from child to parent, while a
      // relationship's parent edge is represented in the tree direction.
      const relationship = { from: spanObservations.get(parent) as string, to: spanObservations.get(from) as string, kind: "parent" as const };
      const key = JSON.stringify(relationship);
      if (!relationships.has(key)) {
        relationships.add(key);
        bundle.relationships.push(relationship);
      }
    }
    const links = Array.isArray(span.links) ? span.links : [];
    for (const linkValue of links) {
      const link = asRecord(linkValue);
      const linked = firstString(link?.spanId, link?.span_id);
      if (from && linked && spanObservations.has(from) && spanObservations.has(linked)) {
        const relationship = { from: spanObservations.get(from) as string, to: spanObservations.get(linked) as string, kind: "corresponds_to" as const };
        const key = JSON.stringify(relationship);
        if (!relationships.has(key)) {
          relationships.add(key);
          bundle.relationships.push(relationship);
        }
      }
    }
  }
  addPartialCoverageIssue(bundle, isCopilot ? "Copilot OTLP per-call usage is imported from native spans; parent agent aggregates, sampling, retries, delayed settlement and AI-unit billing semantics remain separate or unknown." : "OTLP GenAI spans preserve standard inclusive input/output subsets; agent aggregates, sampling, duplicate delivery, retries and physical billing semantics remain explicit and partial.");
  return finalizeBundle(bundle, options);
}

function pi(input: string, options?: ImportOptions): EvidenceBundle {
  const parsed = parseJsonInput(input);
  const isV4 = parsed.records.some(({ value }) => value.v === 4 || (value.kind === "header" && value.storageVersion !== undefined));
  const version = isV4 ? PI_V4_VERSION : PI_LEGACY_VERSION;
  const bundle = makeBundle("pi", isV4 ? "pi-v4-storage-jsonl" : "pi-legacy-transcript-jsonl", input, options, "Pi legacy transcript or v4 durable usage JSONL.", version);
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  const sourceId = bundle.sources[0]?.id ?? "source";
  const lines: PiLine[] = [];
  const headers: Record<string, unknown>[] = [];
  const appendPiWrite = (write: unknown, line: number, ordinal = "0"): void => {
    if (Array.isArray(write)) {
      for (const [index, child] of write.entries()) appendPiWrite(child, line, `${ordinal}.${index}`);
      return;
    }
    const record = asRecord(write);
    if (record) lines.push({ value: record, line, ordinal });
    else bundle.issues.push({ code: "invalid_pi_transaction_write", message: `Pi transaction on line ${line} contains a non-object write.`, severity: "error", source_id: sourceId });
  };
  for (const item of parsed.records) {
    if (item.value.kind === "transaction" && Array.isArray(item.value.writes)) {
      appendPiWrite(item.value.writes, item.line);
    } else {
      lines.push({ ...item, ordinal: "0" });
    }
    if (item.value.kind === "header" || item.value.v === 4) headers.push(item.value);
  }
  const sessionId = firstString(...headers.map((header) => firstString(header.sessionId, header.session_id, header.id)));
  const durableRows = new Map<string, { row: Record<string, unknown>; line: number; ordinal: string; entryId?: string; signature: string }>();
  const durableTotals: Array<{ totals: Record<string, unknown>; line: number }> = [];
  const entries = new Map<string, { entry: Record<string, unknown>; line: number; signature: string }>();
  for (const item of lines) {
    const record = item.value;
    const kind = firstString(record.kind, record.type) ?? "";
    const keyKind = firstString(record.key, record.table, record.target)?.toLowerCase() ?? "";
    if (kind === "entry" || kind === "entry_added" || keyKind.includes("entry")) {
      const entry = asRecord(record.entry) ?? asRecord(record.value) ?? asRecord(record.payload) ?? record;
      const id = firstString(entry.id, entry.entryId, entry.entry_id);
      if (id) {
        const signature = stableJson(entry);
        const previous = entries.get(id);
        if (!previous) entries.set(id, { entry, line: item.line, signature });
        else if (previous.signature !== signature) bundle.issues.push({ code: "conflicting_duplicate_entry", message: `Pi entry identity ${id} has conflicting payloads.`, severity: "error", source_id: sourceId });
        else bundle.issues.push({ code: "duplicate_entry_identity", message: `Pi entry identity ${id} was repeated and counted once.`, severity: "info", source_id: sourceId });
      }
    }
    if (kind === "usage" || kind === "usage_row" || kind === "usage_added" || keyKind.includes("usage")) {
      const row = asRecord(record.row) ?? asRecord(record.usage) ?? asRecord(record.value) ?? asRecord(record.payload) ?? record;
      const id = firstString(row.id, row.usageId, row.usage_id, row.entryId, row.entry_id) ?? piFallbackCoordinate(item.line, item.ordinal);
      const signature = stableJson(row);
      const previous = durableRows.get(id);
      if (!previous) durableRows.set(id, { row, line: item.line, ordinal: item.ordinal ?? "0", entryId: firstString(row.entryId, row.entry_id), signature });
      else if (previous.signature !== signature) bundle.issues.push({ code: "conflicting_duplicate_usage", message: `Pi durable usage identity ${id} has conflicting payloads.`, severity: "error", source_id: sourceId });
      else bundle.issues.push({ code: "duplicate_usage_identity", message: `Pi durable usage identity ${id} was repeated and counted once.`, severity: "info", source_id: sourceId });
      const totals = asRecord(record.totals) ?? asRecord(row.totals);
      if (totals) durableTotals.push({ totals, line: item.line });
    }
  }
  const seenDirect = new Map<string, string>();
  const addPiDirect = (args: { rawUsage: Record<string, unknown> | undefined; identity: string; line: number; entry?: Record<string, unknown>; sourceRecord: string; status?: import("../types.js").Observation["status"]; attributes?: Record<string, string | number | boolean> }) => {
    const message = args.entry ? piMessageRecord(args.entry) : undefined;
    const raw = args.rawUsage;
    const usage = piDirectUsage(raw, bundle.issues, `Pi line ${args.line}`);
    const signature = stableJson({ usage, model: message?.model ?? args.entry?.model });
    const previous = seenDirect.get(args.identity);
    if (previous !== undefined) {
      if (previous !== signature) bundle.issues.push({ code: "conflicting_duplicate_usage", message: `Pi usage identity ${args.identity} has conflicting quantities.`, severity: "error", source_id: sourceId });
      return;
    }
    seenDirect.set(args.identity, signature);
    const responseModel = firstString(message?.responseModel, message?.response_model);
    const requestedModel = firstString(message?.model, args.entry?.model);
    const provider = firstString(message?.provider, args.entry?.provider);
    const providerNativeId = firstString(message?.responseId, message?.response_id, args.entry?.responseId, args.entry?.response_id);
    const model = responseModel ?? requestedModel;
    const observation = addModelObservation({
      bundle,
      harness: "pi",
      line: args.line,
      identity: args.identity,
      operation: "pi.model",
      usage,
      sourceRecord: args.sourceRecord,
      status: args.status ?? inferStatus(message?.stopReason ?? message?.stop_reason),
      accountingScope: "direct",
      subjectId: providerNativeId ?? args.identity,
      grain: "operation",
      countBasis: "provider_native",
      product: "pi",
      timestamp: firstString(message?.timestamp, message?.time, args.entry?.timestamp),
      sessionId: firstString(message?.sessionId, message?.session_id, args.entry?.sessionId, args.entry?.session_id, sessionId),
      turnId: firstString(args.entry?.turnId, args.entry?.turn_id),
      parentId: firstString(args.entry?.parentId, args.entry?.parent_id),
      provider,
      model,
      modelIdentity: responseModel ? "response" : model ? "setting" : "unknown",
      workItemId: options?.work_item_id,
      attributes: { ...(args.attributes ?? {}), ...(firstString(message?.stopReason, message?.stop_reason) ? { stop_reason: firstString(message?.stopReason, message?.stop_reason) as string } : {}), ...(firstString(args.entry?.id) ? { entry_id_hash: hashNativeId(firstString(args.entry?.id) as string) } : {}) },
      recordedCost: piCost(raw, bundle.issues, `Pi line ${args.line}`),
    });
    if (!usage) bundle.issues.push({ code: "missing_usage", message: `Pi direct record on line ${args.line} has no usable usage.`, severity: "warning", source_id: sourceId, observation_id: observation.id });
  };

  if (isV4 && durableRows.size > 0) {
    for (const { row, line, ordinal, entryId } of durableRows.values()) {
      const entry = entryId ? entries.get(entryId)?.entry : undefined;
      const rawUsage = asRecord(row.usage) ?? asRecord(row);
      const identity = firstString(row.id, row.usageId, row.usage_id, entryId) ?? piFallbackCoordinate(line, ordinal);
      addPiDirect({ rawUsage, identity: `usage:${identity}`, line, entry, sourceRecord: `usage:${identity}`, attributes: { ledger_row_id_hash: identity } });
      if (asRecord(row.adjustment)) bundle.issues.push({ code: "pi_adjustment_unresolved", message: `Pi usage adjustment on line ${line} is retained as direct ledger evidence but its correction semantics are not inferred.`, severity: "warning", source_id: sourceId });
    }
    for (const { totals, line } of durableTotals) {
      const identity = `totals:${sessionId ?? "unknown"}:${line}`;
      addModelObservation({ bundle, harness: "pi", line, identity, operation: "pi.usage_totals", usage: piDirectUsage(totals, bundle.issues, `Pi totals line ${line}`), sourceRecord: identity, accountingScope: "snapshot", subjectId: identity, grain: "session", countBasis: "provider_native", product: "pi", sessionId, modelIdentity: "unknown", attributes: { snapshot: true } });
      bundle.issues.push({ code: "pi_v4_snapshot_non_additive", message: `Pi v4 cumulative totals on line ${line} are snapshot evidence and are not added to direct usage.`, severity: "warning", source_id: sourceId });
    }
    for (const item of lines) {
      const record = item.value;
      const entry = asRecord(record.entry) ?? record;
      const message = piMessageRecord(entry);
      if (!message || firstString(message.role)?.toLowerCase() !== "assistant") continue;
      const entryId = firstString(entry.id, entry.entryId, entry.entry_id);
      if (!entryId || ![...durableRows.values()].some((row) => row.entryId === entryId)) bundle.issues.push({ code: "pi_v4_missing_usage_row", message: `Pi assistant entry on line ${item.line} has no linked durable usage row.`, severity: "warning", source_id: sourceId });
    }
  } else {
    for (const item of lines) {
      const record = item.value;
      const entry = record.type === "message" || record.kind === "message" ? record : asRecord(record.entry) ?? record;
      const message = piMessageRecord(entry);
      const role = firstString(message?.role)?.toLowerCase();
      if (role === "assistant") {
        if (!message) continue;
        const rawUsage = asRecord(message?.usage) ?? asRecord(entry.usage);
        const identity = firstString(entry.id, message?.responseId, message?.response_id) ?? piFallbackCoordinate(item.line, item.ordinal);
        addPiDirect({ rawUsage, identity: `message:${identity}`, line: item.line, entry, sourceRecord: `message:${identity}` });
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const [blockIndex, block] of content.entries()) {
          const toolCall = asRecord(block);
          if (!toolCall || !["toolcall", "tool_call"].includes((firstString(toolCall.type) ?? "").toLowerCase())) continue;
          const callId = firstString(toolCall.id, toolCall.callId, toolCall.call_id) ?? `${piFallbackCoordinate(item.line, item.ordinal)}:${blockIndex}`;
          addToolObservation({ bundle, harness: "pi", line: item.line, identity: `tool:${callId}`, operation: `pi.tool.${firstString(toolCall.name) ?? "unknown"}`, usage: null, sourceRecord: `tool:${callId}`, sessionId: firstString(message.sessionId, message.session_id, sessionId), parentId: firstString(entry.id), product: "pi", workItemId: options?.work_item_id, attributes: { tool_name: firstString(toolCall.name) ?? "unknown", tool_call_id_hash: callId } });
        }
      } else if (role === "toolresult" || role === "tool_result") {
        const details = asRecord(message?.details);
        const nestedUsage = asRecord(details?.usage) ?? asRecord(message?.usage);
        if (nestedUsage) {
          const callId = firstString(message?.toolCallId, message?.tool_call_id) ?? piFallbackCoordinate(item.line, item.ordinal);
          addToolObservation({ bundle, harness: "pi", line: item.line, identity: `tool-result:${callId}`, operation: `pi.tool.${firstString(message?.toolName, message?.tool_name) ?? "unknown"}`, usage: piDirectUsage(nestedUsage, bundle.issues, `Pi tool result line ${item.line}`), sourceRecord: `tool-result:${callId}`, status: message?.isError === true ? "error" : "ok", sessionId: firstString(message?.sessionId, message?.session_id, sessionId), product: "pi", attributes: { tool_name: firstString(message?.toolName, message?.tool_name) ?? "unknown", tool_call_id_hash: callId } });
        }
      } else if ((record.type === "compaction" || record.kind === "compaction" || record.type === "branch_summary") && !asRecord(record.usage)) {
        const identity = firstString(record.id) ?? (item.ordinal && item.ordinal !== "0" ? `compaction:${item.line}:${item.ordinal}` : `compaction:${item.line}`);
        addActivityObservation({ bundle, harness: "pi", line: item.line, identity, operation: "pi.compaction", sourceRecord: `compaction:${item.line}`, accountingScope: "unknown", sessionId, product: "pi", attributes: { compaction_usage: "unknown" } });
        bundle.issues.push({ code: "compaction_usage_unknown", message: `Pi compaction on line ${item.line} has no model usage record.`, severity: "warning", source_id: sourceId });
      } else if ((record.type === "compaction" || record.kind === "compaction" || record.type === "branch_summary") && asRecord(record.usage)) {
        const identity = firstString(record.id) ?? (item.ordinal && item.ordinal !== "0" ? `compaction:${item.line}:${item.ordinal}` : `compaction:${item.line}`);
        addModelObservation({ bundle, harness: "pi", line: item.line, identity, operation: "pi.compaction", usage: piDirectUsage(asRecord(record.usage), bundle.issues, `Pi compaction line ${item.line}`), sourceRecord: `compaction:${item.line}`, accountingScope: "aggregate", subjectId: identity, grain: "operation", countBasis: "provider_native", product: "pi", sessionId, attributes: { compaction_usage: "aggregate" } });
      }
    }
  }
  addPartialCoverageIssue(bundle, isV4 ? "Pi v4 durable usage rows are authoritative for inspected storage evidence; hidden retries, missing writes and compaction details remain unresolved." : "Pi legacy assistant usage is imported from transcript records; response identity, hidden retries and compaction usage may be unavailable.");
  return finalizeBundle(bundle, options);
}

function codex(input: string, options?: ImportOptions): EvidenceBundle {
  const bundle = makeBundle("codex", "codex-rollout-jsonl", input, options, "Codex rollout JSONL with additive response usage and legacy token snapshots.", CODEX_VERSION);
  const parsed = parseJsonInput(input);
  bundle.issues.push(...parsed.issues.map((issue) => ({ ...issue, source_id: bundle.sources[0]?.id })));
  let currentContext: Record<string, unknown> | undefined;
  let nativeSessionId: string | undefined;
  let nativeParentThreadId: string | undefined;
  const seenResponses = new Map<string, string>();
  for (const item of parsed.records) {
    const value = item.value;
    const payload = asRecord(value.payload) ?? value;
    const type = firstString(value.type, payload.type) ?? "";
    if (type === "session_meta") {
      nativeSessionId = firstString(payload.session_id, payload.sessionId, payload.id) ?? nativeSessionId;
      nativeParentThreadId = firstString(payload.parent_thread_id, payload.parentThreadId) ?? nativeParentThreadId;
      const cliVersion = firstString(payload.cli_version, payload.cliVersion);
      if (cliVersion && !options?.version && bundle.sources[0]) bundle.sources[0].version = cliVersion;
    }
  }

  for (const item of parsed.records) {
    const record = item.value;
    const payload = asRecord(record.payload) ?? record;
    const type = firstString(record.type, payload.type) ?? "";
    if (type === "session_meta") continue;
    if (type === "turn_context") {
      currentContext = payload;
      continue;
    }
    if (type === "event_msg" && firstString(payload.type) !== "token_count") {
      const eventItem = asRecord(payload.item) ?? asRecord(record.item);
      const eventType = firstString(eventItem?.type, payload.type) ?? "event";
      const eventId = nativeIdentity(eventItem ?? payload, `${eventType}:${item.line}`);
      const isSubagent = /sub.?agent|collab|agent/i.test(eventType);
      addActivityObservation({ bundle, harness: "codex", line: item.line, identity: `activity:${eventId}`, operation: isSubagent ? "codex.subagent" : `codex.${eventType.toLowerCase()}`, sourceRecord: `activity:${eventId}`, accountingScope: "unknown", status: inferStatus(eventItem?.status ?? payload.status), agentId: firstString(eventItem?.agent_id, eventItem?.agentId, payload.agent_id, payload.agentId), sessionId: firstString(payload.session_id, record.session_id, nativeSessionId), turnId: firstString(payload.turn_id, record.turn_id), parentId: firstString(payload.parent_id, record.parent_id), product: "codex", attributes: { event_type: eventType } });
      continue;
    }
    if (type === "token_usage_record" || type === "response_usage" || type === "usage_record") {
      const usageRecord = asRecord(record.payload) ?? record;
      const rawUsage = asRecord(usageRecord.usage) ?? asRecord(usageRecord.token_usage) ?? asRecord(record.usage);
      const issuesBefore = bundle.issues.length;
      const usage = usageFromFields(rawUsage, {
        input: ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
        output: ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
        cacheRead: ["cached_input_tokens", "cache_read_input_tokens", "cacheReadInputTokens", "cache_read_tokens"],
        cacheWrite: ["cache_write_input_tokens", "cacheWriteInputTokens", "cache_creation_input_tokens", "cache_write_tokens"],
        reasoning: ["reasoning_output_tokens", "reasoningOutputTokens", "reasoning_tokens"],
      }, bundle.issues, `Codex line ${item.line}`);
      const threadId = firstString(usageRecord.thread_id, usageRecord.threadId);
      const turnId = firstString(usageRecord.turn_id, usageRecord.turnId);
      const context = currentContext && (!turnId || firstString(currentContext.turn_id, currentContext.turnId) === turnId) ? currentContext : undefined;
      const responseModel = firstString(usageRecord.response_model, usageRecord.responseModel, usageRecord.model);
      const identity = nativeIdentity(usageRecord, `line:${item.line}`);
      const dedupeSignature = JSON.stringify({ usage: rawUsage, thread: threadId, turn: turnId, session: firstString(usageRecord.session_id, usageRecord.sessionId) });
      const previousResponse = seenResponses.get(identity);
      if (previousResponse !== undefined) {
        if (previousResponse !== dedupeSignature) bundle.issues.push({ code: "conflicting_duplicate_usage", message: `Codex response identity ${identity} was observed with conflicting usage.`, severity: "error", source_id: bundle.sources[0]?.id });
        else bundle.issues.push({ code: "duplicate_usage_identity", message: `Codex response identity ${identity} was repeated and counted once.`, severity: "info", source_id: bundle.sources[0]?.id });
        continue;
      }
      seenResponses.set(identity, dedupeSignature);
      const observation = addModelObservation({
        bundle,
        harness: "codex",
        line: item.line,
        identity,
        operation: "codex.model",
        usage,
        sourceRecord: `response:${identity}`,
        status: inferStatus(usageRecord.status ?? usageRecord.terminal_reason),
        accountingScope: "direct",
        subjectId: identity,
        grain: "operation",
        countBasis: "provider_native",
        product: "codex",
        timestamp: firstString(usageRecord.timestamp, usageRecord.started_at, usageRecord.startedAt),
        endTime: firstString(usageRecord.end_time, usageRecord.ended_at, usageRecord.endedAt),
        agentId: firstString(usageRecord.agent_id, usageRecord.agentId),
        sessionId: firstString(usageRecord.session_id, usageRecord.sessionId, usageRecord.thread_id, usageRecord.threadId, nativeSessionId),
        turnId,
        parentId: firstString(usageRecord.parent_id, usageRecord.parentId, usageRecord.parent_thread_id),
        provider: firstString(usageRecord.provider) ?? "openai",
        model: responseModel ?? firstString(context?.model, context?.model_name),
        modelIdentity: responseModel ? "response" : context ? "setting" : "unknown",
        workItemId: options?.work_item_id,
        attributes: {
          source_record_type: type,
          ...(firstString(usageRecord.root_turn_id, usageRecord.rootTurnId) ? { root_turn_id: firstString(usageRecord.root_turn_id, usageRecord.rootTurnId) as string } : {}),
          ...(rawUsage && "total_tokens" in rawUsage ? { native_total_tokens: String(rawUsage.total_tokens) } : {}),
          ...(firstString(currentContext?.effort, currentContext?.reasoning_effort) ? { effort: firstString(currentContext?.effort, currentContext?.reasoning_effort) as string } : {}),
          ...(nativeParentThreadId ? { parent_thread_id: nativeParentThreadId } : {}),
        },
      });
      if (usage === null) addPartialCoverageIssue(bundle, `Codex response on line ${item.line} has no usable token usage.`, "missing_usage");
      if (bundle.issues.length === issuesBefore) continue;
      continue;
    }
    if (type === "event_msg" && firstString(payload.type) === "token_count") {
      const info = asRecord(payload.info) ?? asRecord(record.info) ?? {};
      const last = asRecord(info.last_token_usage) ?? asRecord(info.lastTokenUsage);
      const total = asRecord(info.total_token_usage) ?? asRecord(info.totalTokenUsage);
      if (last) {
        const identity = `snapshot:${firstString(payload.thread_id, record.thread_id) ?? "unknown"}:${firstString(payload.turn_id, record.turn_id) ?? "unknown"}:${item.line}:last`;
        addModelObservation({
          bundle,
          harness: "codex",
          line: item.line,
          identity,
          operation: "codex.token_count",
          usage: usageFromFields(last, {
            input: ["input_tokens", "inputTokens"],
            output: ["output_tokens", "outputTokens"],
            cacheRead: ["cached_input_tokens", "cache_read_input_tokens", "cacheReadInputTokens"],
            cacheWrite: ["cache_write_input_tokens", "cacheWriteInputTokens"],
            reasoning: ["reasoning_output_tokens", "reasoningOutputTokens"],
          }, bundle.issues, `Codex snapshot line ${item.line}`),
          sourceRecord: identity,
          accountingScope: "snapshot",
          subjectId: identity,
          grain: "event",
          countBasis: "provider_native",
          product: "codex",
          sessionId: firstString(payload.session_id, record.session_id, nativeSessionId),
          turnId: firstString(payload.turn_id, record.turn_id),
          model: firstString(payload.model, record.model, currentContext?.model, currentContext?.model_name),
          modelIdentity: "unknown",
          attributes: { source_record_type: "event_msg.token_count", snapshot_kind: "last_token_usage" },
        });
      } else {
        addPartialCoverageIssue(bundle, `Codex token_count line ${item.line} has no last_token_usage snapshot.`, "missing_snapshot_usage");
      }
      if (total) {
        const identity = `snapshot:${firstString(payload.thread_id, record.thread_id) ?? "unknown"}:${item.line}:total`;
        addModelObservation({
          bundle,
          harness: "codex",
          line: item.line,
          identity,
          operation: "codex.token_count.total",
          usage: usageFromFields(total, {
            input: ["input_tokens", "inputTokens"],
            output: ["output_tokens", "outputTokens"],
            cacheRead: ["cached_input_tokens", "cache_read_input_tokens", "cacheReadInputTokens"],
            cacheWrite: ["cache_write_input_tokens", "cacheWriteInputTokens"],
            reasoning: ["reasoning_output_tokens", "reasoningOutputTokens"],
          }, bundle.issues, `Codex aggregate snapshot line ${item.line}`),
          sourceRecord: identity,
          accountingScope: "aggregate",
          subjectId: identity,
          grain: "session",
          countBasis: "provider_native",
          product: "codex",
          sessionId: firstString(payload.session_id, record.session_id, nativeSessionId),
          turnId: firstString(payload.turn_id, record.turn_id),
          model: firstString(payload.model, record.model, currentContext?.model, currentContext?.model_name),
          modelIdentity: "unknown",
          attributes: { source_record_type: "event_msg.token_count", snapshot_kind: "total_token_usage" },
        });
      }
      bundle.issues.push({ code: "legacy_snapshot_non_additive", message: `Codex token_count line ${item.line} is retained as snapshot evidence and is not added to direct usage.`, severity: "warning", source_id: bundle.sources[0]?.id });
    }
  }
  addPartialCoverageIssue(bundle, "Codex additive usage is authoritative only for the inspected capture contract; legacy snapshots and hidden/provider retries remain unresolved.");
  return finalizeBundle(bundle, options);
}

const CAPABILITIES: AdapterCapability[] = [
  capability("codex", ["codex-rollout-jsonl"], [CODEX_VERSION], "Direct token_usage_record.usage is imported as per-response usage; cached input and reasoning remain subsets. Legacy token_count rows are snapshots/aggregates.", "Preserves hashed response identity plus thread, session, turn, root-turn and parent fields when supplied.", ["Inspected against Codex 0.153.4 capture evidence only.", "Legacy snapshot delta reconciliation is not claimed.", "Provider retries, hidden calls, and exact prompt/tool attribution are unknown."]),
  capability("pi", ["pi-legacy-transcript-jsonl", "pi-v4-storage-jsonl"], [PI_LEGACY_VERSION, PI_V4_VERSION], "Legacy assistant usage and v4 durable usage rows are normalized with cache-exclusive input plus cache subsets; cumulative totals remain snapshots.", "Preserves entry, usage-row, session and parent identities as hashed/native metadata when supplied.", ["Inspected legacy and v4 public source shapes; installed release and hidden retry coverage remain unknown.", "Compaction usage may be missing or aggregate."]),
  capability("omp", ["oh-my-pi-session-jsonl"], ["oh-my-pi-session-jsonl-v1"], "Assistant usage is direct; operational model_usage and child/task usage are aggregate evidence; orchestration is unclassified.", "Preserves session, parent session, parent tool and child agent identifiers when supplied.", ["Inspected source revision only; fork/retry/export completeness and hidden calls remain unknown."]),
  capability("claude", ["claude-code-transcript-jsonl"], ["claude-code-transcript-v1"], "Streaming assistant chunks are grouped by message identity and latest usage-bearing data; cache creation/read are input subsets and reasoning is an output subset.", "Preserves hashed message/request/tool/subagent identities plus session, turn and parent fields when supplied.", ["Inspected integration source and documented native spans; installed version, retry attempts and compaction usage completeness remain unknown."]),
  capability("gemini", ["gemini-cli-chat-jsonl"], ["gemini-cli-chat-jsonl-v1"], "Native Gemini input is treated as inclusive of cached content; thoughts are a subset of output; repeated message identities use the latest usage-bearing row.", "Preserves hashed response/message/tool/session identities and parent session fields when supplied.", ["Inspected Gemini CLI development source and fixture shape; context breakdowns are estimates and nested subagent discovery is partial."]),
  capability("opencode", ["opencode-step-jsonl"], ["opencode-step-jsonl-v1"], "OpenCode step usage adds cache-exclusive input and reasoning-exclusive output once; parent/session totals are aggregate checks.", "Preserves hashed step/message/tool/session identities plus parent session fields when supplied.", ["Inspected OpenCode source and profiler mappings; transport coverage, hidden retries and incomplete turns remain unknown."]),
  capability("otel", ["otlp-json"], ["otlp-json-v1"], "Imports OTLP JSON GenAI inference usage and preserves overlapping cache/reasoning subsets; agent/workflow usage is aggregate evidence.", "Preserves trace/span/response/conversation IDs and parent/link relationships when supplied.", ["OTLP transport and GenAI semantic conventions are versioned independently; sampling, duplicate delivery, retries and physical billing coverage remain unknown."]),
  capability("copilot", ["copilot-otlp-json"], ["copilot-otlp-json-v1"], "Imports Copilot native OTLP per-call usage, cost and AI-unit attributes; parent agent usage is aggregate evidence.", "Preserves Copilot conversation, turn, response, trace/span and parent relationships when supplied.", ["Inspected documented/native export shape; wrapper/native duplication, sampling, retries and durable billing settlement remain unknown."]),
];

export function importEvidence(harness: Harness, input: string, options?: ImportOptions): EvidenceBundle {
  if (harness === "codex") return codex(input, options);
  if (harness === "pi") return pi(input, options);
  if (harness === "omp") return omp(input, options);
  if (harness === "claude") return claude(input, options);
  if (harness === "gemini") return gemini(input, options);
  if (harness === "opencode") return opencode(input, options);
  if (harness === "otel") return importOtlp("otel", input, options);
  if (harness === "copilot") return importOtlp("copilot", input, options);
  const bundle = makeBundle(harness, `${harness}-jsonl`, input, options, `${harness} adapter is not yet implemented in this release.`);
  bundle.issues.push({ code: "unsupported_harness_format", message: `No importer is registered for harness ${harness}.`, severity: "error", source_id: bundle.sources[0]?.id });
  return finalizeBundle(bundle, options);
}

export function adapterCapabilities(): AdapterCapability[] {
  return CAPABILITIES.map((entry) => ({ ...entry, formats: [...entry.formats], tested_versions: [...entry.tested_versions], limitations: [...entry.limitations] }));
}
