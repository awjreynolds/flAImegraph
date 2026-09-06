# Readiness for detailed tokenomics analysis

Status on 2026-09-06: **wayfinding is not complete**. Standards and existing formats have been investigated. No capture integration has been enabled for this effort, no representative run has been reconciled, and no detailed visual prototype has been tested with the user.

The user's clarified destination is to understand what an agent did in enough detail to drill down, aggregate, and examine an entire ticket or epic. A single spend number per agent is insufficient. This requirement strengthens the original goal and preserves the adoption-first preference.

## Proposed depth to prove

| Analysis question | Evidence required | Current position |
| --- | --- | --- |
| Which model calls consumed usage? | Call-level quantities, model identity, observation grain, and stable correspondence | Documented possibilities; actual capture unverified |
| What happened between calls? | Tool and delegation events, identifiers, timestamps, and outcomes | Documented possibilities; coverage unverified |
| Why did input grow across calls? | Context revisions, compaction events, message/source provenance, and tokenization basis | No chosen source has been validated for this detail |
| Which retrieved material contributed to input? | Evidence connecting tool results or files to later model inputs | Not established; reading a file does not prove all its contents were subsequently sent |
| How much repeated work came from retries or loops? | Attempt identity, logical grouping, repeated-operation evidence, and missing-usage handling | Accounting ambiguity identified; no representative trace tested |
| Can the same activity be regrouped without changing totals? | Preserved execution identity, declared aggregation and allocation policies | Proposed conservation cases; no implementation demonstrated |

These are proposed observable acceptance cases, not promises that every harness exposes them. The user's confirmation is about depth; detailed policy choices remain open.

## Boundaries the analysis must preserve

Operation usage, contextual attribution, and monetary valuation are separate claims. A model call can have a provider-reported input total without an exact per-file breakdown. A tool response may be summarized, truncated, cached, repeated, or excluded before a later call. A chronological predecessor is not automatically the cause of that call's entire cost.

Tool execution may have no directly billed model tokens while its output contributes input tokens to subsequent calls. The collector should retain both relationships if observable. Shared or replayed context must not be billed twice within the same selected accounting view, while genuinely repeated model input across distinct calls still contributes repeated usage.

Descriptions of phases such as research, implementation, and validation may be explicitly declared or inferred labels; views must preserve that distinction. Reasoning-token quantities do not reveal the model's internal reasoning process. The proposed analysis concerns observable execution and reported usage.

## What completion of this planning effort requires

1. A representative workflow and selected capture surface, with the actual available fields inspected.
2. An explicit mapping to existing standards and implementations, including which detail is lost or unsupported.
3. Agreed rules separating direct usage, inclusive totals, context attribution, and cost basis.
4. A concrete profile that the user can drill into and regroup, with numbers traced back to evidence and gaps disclosed.
5. An implementation route with the remaining architectural choices settled. A complete production build remains outside this planning effort.

The current next milestone is proving capture fidelity against the representative workflow. Database, MCP packaging, and hook selection should follow what evidence is accessible; none of those choices by itself guarantees analytical depth.
