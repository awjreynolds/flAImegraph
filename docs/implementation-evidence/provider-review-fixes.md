# Provider capture review corrections

Independent Sol review identified false complete-coverage claims for fields that appeared in parser allowlists but were not represented, and a default source identity collision across separate requests. Root reproduced each issue with failing public capture tests before correction.

The adapters now limit recognized fields to those represented by source blocks or observed scalar request overrides. Unhandled root fields, nested settings, wrapper fields, text-block metadata and media metadata emit `UNSUPPORTED_PROVIDER_FIELD`, making coverage partial even when the caller requested complete coverage. Configured cache controls are not treated as observed cache hits. Unsupported arrays and structured settings remain explicit gaps rather than being serialized into misleading scalar facts.

Anonymous source identity now includes the capture namespace, request ID, provider format and JSON pointer. Producers opt into cross-request source identity using annotations. Bare OpenAI input items and Gemini's snake_case system-instruction alias now carry their actual source pointers.

Verification: `node --import tsx --test test/request-context.test.ts` passes 14 tests, including the review reproductions. `npm run typecheck` passes. The browser validator is generated from the same runtime validation and allocation code, with schemas compiled ahead of time; provider payload parsing remains a local library/CLI operation.
