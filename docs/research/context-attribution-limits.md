# How deeply can a token profile attribute context?

Research date: 2026-09-06. Scope: OpenAI Responses, Anthropic Messages, and Gemini GenerateContent/native cache APIs. Provider documentation changes frequently; model generation, endpoint, beta features, and SDK version must accompany an implementation. No inference requests, token-count requests, or private user data were used in this research.

## Verdict

**Per-request consumption is substantially observable; per-source context composition requires additional capture; causal responsibility for the output is not established by either.** Native APIs can report input/output, cache, reasoning, and some transformation-specific quantities. They do not generally return a complete accounting of “this repository file contributed this many billed tokens, caused these reasoning tokens, and saved this amount.” That richer statement combines different evidence classes and should be split apart.

A useful profiler can still explain which content persists through an agent run and accumulates repeated input usage. Its instrumentation must follow the content through harness transformations and repeated requests. A transcript alone is insufficient when tools are truncated, instructions are assembled separately, context is compacted, or server-side state is referenced.

## Provider coverage and limits

| Surface | Native observation or count | Exact boundary for attribution |
| --- | --- | --- |
| OpenAI Responses input counting | The native input-count endpoint accepts full Responses inputs and documents an exact model-input count, including request formatting. | It returns an aggregate, not a per-file or per-message billing partition. Plain-text tokenization excludes request structure, tools, schemas, and multimodal processing. [Counting tokens](https://developers.openai.com/api/docs/guides/token-counting) |
| OpenAI usage/cache | Response input/output totals and detailed cache/reasoning categories. Current caching guidance includes `cache_write_tokens` for newer models, alongside `cached_tokens`. | Use the versioned provider formula: ordinary input = total input − cached input − cache writes. These categories partition consumption treatment, not semantic origin. A cache hit alone does not identify an original request or file. [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| OpenAI state/compaction | Chained responses reuse server-held state; explicit compaction returns its own usage and an encrypted compacted item. | Referencing history does not eliminate its input usage. Compacted state is opaque; its size cannot be recovered by tokenizing ciphertext or distributing it exactly among original sources. [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [Compact endpoint](https://developers.openai.com/api/reference/java/resources/responses/methods/compact) |
| Anthropic Messages input/cache | `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` are separate contributions to total input. | Unlike OpenAI/Gemini aggregate input, Anthropic's `input_tokens` alone excludes cached and cache-written input. Prefix breakpoints express caching structure, not a complete attribution map. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Anthropic token counting | Counts structured system/messages/tools/images/PDF input; documented as an estimate. | May differ from generation usage and include unbilled system-added optimization tokens. It does not perform cache lookup; a count cannot prove cache hits. [Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) |
| Anthropic thinking | Current documentation exposes `usage.output_tokens_details.thinking_tokens`, a subset of inclusive output. | It measures raw internal thinking, not visible summary length. Streaming supplies this detail at the final `message_delta`; older records may omit it. [Thinking cost and pricing](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) |
| Anthropic context transformations | Context editing reports cleared token counts and cleared tool/thinking counts; compaction exposes sampling iterations. | These give genuine transformation measurements, but not automatically a per-original-block partition or proof of future savings. [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing), [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) |
| Gemini GenerateContent | `promptTokenCount` includes cached content; native usage also includes candidate, thought, tool-use-prompt, and modality counts. | These are provider categories, not system/history/file-source labels. Preserve native totals and avoid blindly adding every detail field: the reference's total formula is prompt + thoughts + candidates, and does not separately explain tool-use overlap. [UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata) |
| Gemini counting/cache objects | `countTokens` can receive the full `generateContentRequest`, including system instructions/functions. Explicit caches have named metadata and usage counts. | Cache metadata can be retrieved but its content cannot; retain a creation manifest to know its sources. Cached tokens still occupy context, and storage duration is separately priced. [CountTokens](https://ai.google.dev/api/tokens), [Context caching](https://ai.google.dev/gemini-api/docs/generate-content/caching) |

## Four evidence classes

These are analytical distinctions for this research, not claimed industry-standard field names.

**Observed:** returned provider usage; native transformation statistics; the exact client-side payload that the harness submitted; cache object IDs; actual tool-result text after truncation. “Observed” specifies the observer: capturing a client request does not reveal hidden provider instructions or the final internal model representation.

**Derived:** arithmetic over known measurements using documented semantics, such as Anthropic total input = ordinary + cache read + cache creation. A source's known appearances across captured requests can also be counted deterministically. Derived results inherit missing-data and source-definition limitations.

**Estimated:** local token counts standing in for full request consumption, heuristics for per-source shares, or reconstructed payloads from incomplete logs. A tokenizer may exactly count a particular text string while that number remains an estimate of the string's billed contribution inside the provider's rendered request.

**Counterfactual:** a predicted or measured difference under a changed request or configuration. A native count of a request with one source removed is an observation of that altered request's token count; the difference is a counterfactual input-size comparison. It does not observe the original run's output, cache behavior, or successful outcome without that source.

Keep these classes on individual measurements. A record may contain an observed input total, derived uncached total, estimated per-file allocation, and counterfactual savings simultaneously. One record-level “accurate” flag would conceal that distinction.

## The capture boundary must be explicit

For each physical request, capture a manifest of the **final client-side request after harness processing**, including source identifiers, role/content type, order, truncation or summary lineage, tools and output schemas, model/configuration, and referenced server state. Separately retain provider-reported usage and context-editing events. This is a recommendation inferred from the API boundaries above.

Do not describe that manifest as the provider's full rendered prompt. OpenAI documents caching its rendered prefix, including provider instructions and settings-dependent formatting. Even an unchanged visible transcript can have a different cache prefix after tool or configuration changes. [Rendered cache context](https://developers.openai.com/api/docs/guides/prompt-caching) Similarly, Anthropic can preserve or strip earlier thinking according to model and configuration. [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)

Three axes need to remain independent:

- **Origin:** system template, user request, repository file, tool result, earlier model output.
- **Current representation:** system/developer message, history item, tool-result block, image, opaque compaction item.
- **Treatment:** ordinary input, cache read, cache write, cleared content, generated output.

For example, a repository excerpt arrives as tool output, becomes history in later requests, then contributes to a summary. Labelling it “history” should not erase its origin. Conversely, attributing every summary token back to that file would imply precision that summarization does not supply. The excerpt's original generation/read event and later repeated model-input appearances are different events; repeated input is real consumption, not duplicate data ingestion.

## Tokenization does not supply a unique source allocation

OpenAI explicitly distinguishes plain text from full request counting and includes roles/boundaries in native counts. [Full versus local counting](https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens) Gemini's full-request counting supports system instructions and function declarations, while its text-only example even shows a different preflight text count and generated prompt count. [CountTokens request semantics](https://ai.google.dev/api/tokens) Anthropic warns that estimates vary with model tokenizers and server additions. [Anthropic counting limitations](https://platform.claude.com/docs/en/build-with-claude/token-counting)

Consequently, a defensible component method must document where it assigns shared formatting overhead and how it handles token boundaries. Summing counts of isolated components does not establish a partition of the rendered request. Prefix-difference counting can produce a telescoping total when supported, but assigns marginal structure/boundary effects according to the selected order. Leave unexplained differences visible; proportionally scaling all components to force agreement changes the result into an allocation estimate.

Cached prefixes can tighten attribution when the full ordered representation and exact matched boundary are known. They cannot generally prove it from a scalar cached-token count. Hidden formatting, rounding, multiple breakpoints, omitted state, and changing model configuration complicate reconstruction. A repeated content hash identifies content reuse, not guaranteed reuse of cached computation or its financial benefit.

## Context occupancy, reasoning, and compaction are separate accounting problems

**Occupancy is a state at a specified phase; consumption is accumulated work.** An illustrative 10,000-token context presented to five calls creates 50,000 input-token appearances, while it never implies a 50,000-token simultaneous context. Cache treatment changes processing and price, not the fact that the content occupies the input window. Gemini explicitly includes cached tokens in limits. [Gemini cache semantics](https://ai.google.dev/gemini-api/docs/generate-content/caching)

**Generated reasoning is not displayed reasoning.** OpenAI's reasoning tokens contribute to output usage even though answer text does not expose them. [OpenAI token categories](https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens) Anthropic bills full thinking while optionally displaying a summary; its native thinking count is the appropriate observation. [Anthropic thinking usage](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) Gemini likewise reports thoughts separately and notes that returning thought signatures in later turns increases input usage. [Gemini thought counting](https://ai.google.dev/gemini-api/docs/generate-content/tokens) None of these counters tells us which input paragraph caused which reasoning tokens.

**Compaction can add consumption while reducing occupancy.** Anthropic's compaction guide makes a particularly important distinction: top-level input/output omit compaction iterations; `usage.iterations` contains the additional sampling work. For total request consumption, aggregate the iterations with their cache categories, without adding the top-level summary again. The final iteration describes post-compaction context; the sum describes accumulated work. Existing compaction blocks do not incur a fresh compaction pass merely by being reused. [Anthropic compaction usage](https://platform.claude.com/docs/en/build-with-claude/compaction)

OpenAI explicit compaction exposes a separate pass's usage, while server-side compaction can happen inside response creation. The resulting item is opaque and carries prior state forward. [OpenAI compaction behavior](https://developers.openai.com/api/docs/guides/compaction) Count the pass once where telemetry exposes it; do not infer its consumption from the reduction in context size. Capture lineage to prior sources as a many-to-many transformation, with the output item treated as a new representation.

Anthropic context editing additionally reports `cleared_input_tokens` with counts of affected tool uses or thinking turns. Its count endpoint can compare original and post-edit input size. These are stronger observations than guessing from the transcript, but an immediate decrease is not measured net savings over a future run. [Context-editing response and counting](https://platform.claude.com/docs/en/build-with-claude/context-editing)

## Consequence for a trustworthy flame graph

Use provider usage for the **consumption profile**, and a separately labelled composition view for source attribution. An exact top-level total should not make estimated children look exact. Preserve unassigned residuals, distinguish missing fields from measured zero, and retain the normalization rule's provider/model/version.

A convincing prototype would show one tool result across its lifecycle: initial captured size, each retained appearance, observed cache treatment where available, clearing/compaction, and the request totals that contain it. It can support “this material was repeatedly present in costly requests.” It should reserve “removing it saves this cost without harming completion” for a controlled comparison with outcome evidence. Neither rectangle width nor token occupancy is a measure of causal usefulness.
