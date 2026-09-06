# Tokenomics interoperability: findings and proposed way forward

Assessment date: 2026-09-06. Status: research synthesis, updated after the user's adoption-first decision. This document does not select an architecture or declare a new standard.

## Main finding

First establish and adopt the existing industry direction. The user explicitly prioritises a shared understanding of emerging standards and avoiding duplicated work. The current evidence does not justify inventing a new transport, token vocabulary, accounting convention, or flame-graph renderer. A standards-based integration and useful visualisation may be the complete outcome.

This space already contains closely related standards work and implementations. Industry adoption remains an ambition, not an inference from finding a technical gap.

## What can be reused, and what remains a hypothesis

| Area | Research conclusion | Status of the proposed contribution |
| --- | --- | --- |
| AI telemetry | GenAI conventions and OpenInference already represent usage and agent operations; their detail and accounting grains require careful interpretation. | Reuse and map existing semantics. Do not treat every token field as additive or every span as a physical request. |
| Money and allocation | Released FOCUS 1.4 defines billed/effective/list/contracted costs, allocation conservation, invoice lineage and correction handling; 1.5 development already includes related AI work. | Determine how execution evidence corresponds to charges and work attribution, rather than invent new meanings for familiar cost types. |
| Visual exchange | pprof, folded stacks, and existing viewers already support useful projections; their loss and unit limitations are material. | Define a reproducible projection, if existing conventions do not already suffice. |
| Accounting correctness | Aggregate overlap, retries, and delayed usage are active upstream topics. | Contribute evidence and targeted rules to existing discussions. |
| Work attribution | The examined telemetry conventions do not define a complete ticket/epic allocation contract. | A candidate interoperability gap, subject to deeper comparison with existing allocation and AgentMeasure work. |

Detailed evidence: [AI telemetry](telemetry-coverage.md), [financial accounting](accounting-coverage.md), [profile formats](profile-projection.md), and [existing implementations and validation cases](ecosystem-and-validation.md).

## Three relationships that must not silently become one

This is a proposed analytical distinction, not a new wire schema:

1. **Execution ancestry:** which operation initiated another operation.
2. **Work attribution:** which ticket or other unit of work owns or benefits from the usage, under a declared policy.
3. **Evidence correspondence:** which exported observations, usage summaries, or billing records describe the same activity or charge.

A flame graph can project those relationships into a chosen hierarchy, but the underlying evidence must retain their differences. For example, a research subagent can have one execution parent and two ticket beneficiaries. Showing its full cost beneath both beneficiaries would change the total unless the view explicitly represents duplicated benefit rather than allocated spend.

## Corrections to the initial discussion

- OpenTelemetry's normalized token usage can prefer billable counts over model-consumed counts. Captured usage should preserve its count basis; it should not automatically be described as raw physical consumption. [GenAI registry](https://github.com/open-telemetry/semantic-conventions-genai/blob/94f432d7126f5884d30a2cdde6f4e89908ebb6fd/model/gen-ai/registry.yaml).
- A logical GenAI operation can encompass retries. One span is not a guarantee of one actual attempt. [GenAI operation conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/94f432d7126f5884d30a2cdde6f4e89908ebb6fd/docs/gen-ai/gen-ai-spans.md).
- Token-weighted pprof and flame-graph exports already exist. Their existence reduces the case for format invention; it does not prove their accounting is appropriate for every workload. [AgentSight agentpprof](https://github.com/eunomia-bpf/agentsight/blob/master/docs/agentpprof.md).
- A conformance-oriented measurement effort already exists in AgentMeasure. It requires a more detailed compatibility comparison before proposing another contract. [AgentMeasure core](https://github.com/roy-tong/AgentMeasure/blob/main/standard/CORE.md).

## An adoption route to evaluate

**First, map one representative workflow onto existing and planned standards.** Preserve the user's ticket-to-epic accounting motivation, including conversations and subagents. Classify each requirement as covered by a released standard, covered by a draft, implemented with product-specific semantics, planned upstream, dependent on missing evidence, or unresolved. Do not choose an estimates-only scope or define new fields before this assessment.

**Extend the versioned validation corpus across actual producers.** Include an ordinary call, delegated work, a resumed conversation, duplicate observations, cache/reasoning subsets, a retry, and missing final usage. Capture and version the source format and settings. Follow-up research inspected this conversation and its linked subagents, and public Pi fixtures; see [capture validation](codex-capture-validation.md). No workplace data or raw transcripts were published.

**Compare existing rules against that corpus before drafting new ones.** Review AgentMeasure's conformance semantics, OpenTelemetry's reference cases and pending cost/aggregation work, and FOCUS's financial allocation meanings. Record an existing rule that passes, a reproducible disagreement, an implementation defect, or insufficient source evidence. Those are different outcomes.

**Use existing rules wherever they meet the requirement.** Candidate checks include stable correspondence between observations and work allocation; self/inclusive interpretation; late usage; explicit count and cost basis; and declared projection losses. A fixture should include the expected result or why it cannot be determined. No encoding can recover usage that its source never exposed. A new convention is an option only after checking whether a necessary gap is already addressed in planned upstream work.

**Demonstrate with existing exporters, then seek external review.** A later reference implementation could emit folded stacks and pprof while preserving provenance elsewhere. Contributions should be scoped to the owning project rather than submitted as one large universal-standard proposal. External outreach is a later action requiring user authorisation; none has occurred.

Useful existing discussions: [Aggregated token usage attributes](https://github.com/open-telemetry/semantic-conventions-genai/issues/19), [Operations versus attempts](https://github.com/open-telemetry/semantic-conventions-genai/issues/476), and [Per-operation cost conventions](https://github.com/open-telemetry/semantic-conventions-genai/pull/443). Their open status is a snapshot; proposals are not accepted requirements.

## Decision now available

The user resolved [Should adoption take priority over a new tokenomics convention?](../../.scratch/tokenomics-standard/issues/04-standardisation-boundary.md) in favour of understanding and adoption first. The next decision is [Which ticket workflow should test the existing standards?](../../.scratch/tokenomics-standard/issues/05-representative-workflow.md). No accounting scope or architecture has been selected.

## Concrete industry direction checked on 2026-09-06

FOCUS 1.4 is published; its official 1.5 roadmap targets ratification on 3 December and announcement on 10 December 2026. Model identity, price catalogs, AI billing examples and actor attribution are core planned work; cached/fresh token pricing dimensions are stretch work. Planned scope remains subject to review and is not released functionality. [FOCUS release scope](https://focus.finops.org/focus-1-5-release-scope/).

OpenTelemetry GenAI is actively progressing conventions through its SIG, with cost proposals and aggregation questions still open. The aggregation issue is associated with a draft stable-v1 project; a firm stabilisation date was not established by this check. [Contributor process](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/CONTRIBUTING.md), [Aggregation discussion](https://github.com/open-telemetry/semantic-conventions-genai/issues/19), [Cost proposal](https://github.com/open-telemetry/semantic-conventions-genai/pull/443).

These are complementary efforts at different layers. This review has not verified a committed release of one specification covering the entire agent-execution-to-ticket-to-epic-to-bill workflow. That uncertainty is a reason to assess and align, not evidence that a competing standard is needed.

This assessment does not choose ledger storage, a finalized schema, a new standard name, pricing policy, or a production architecture. Those decisions follow the selected guarantee and the evidence available in real records.
