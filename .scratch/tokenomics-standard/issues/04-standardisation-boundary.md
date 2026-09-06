# Should adoption take priority over a new tokenomics convention?

Type: grilling
Label: wayfinder:grilling
Status: resolved
GitHub: https://github.com/awjreynolds/flAImegraph/issues/5
Assignee: awjre
Parent: ../map.md
Blocked by: 01, 02, 03

## Question

Given the existing research and the user's clarification, should the effort first establish and adopt the industry direction before proposing a new convention? What evidence would justify departing from existing or planned work?

## Discussion context

The research has resolved this ticket's prerequisites. [Assessment and proposed route](../../../docs/research/standards-gap-assessment.md) and [existing implementations and validation cases](../../../docs/research/ecosystem-and-validation.md) provide the shared starting point.

The earlier assistant proposal to choose a first accounting guarantee was premature. The user clarified that shared understanding of industry movement and avoiding duplication must precede that choice. No usage-versus-billing scope choice has been made.

## Answer

Resolved through the user's live clarification on 2026-09-06. Prioritise understanding and adopting existing or emerging standards. A new convention is conditional, not the destination. Before proposing one, demonstrate a necessary use-case failure, distinguish missing implementation/data from missing semantics, and check whether relevant planned work already addresses it.

OpenTelemetry GenAI and FOCUS are leading candidates in different layers, not an architecture selection or a claim that one complete standard is about to ship. Existing OpenInference, AgentMeasure, and profiler implementations also remain reuse candidates. A standard-backed application or integration is a valid complete outcome.

The next question is which representative ticket workflow to use for evaluating those candidates. Preserve the user's full-use-of-effort motivation; do not narrow it to estimates-only without a later decision.
