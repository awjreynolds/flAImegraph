# Work Item sidecars and Context Points

**Status: experimental 0.1.0.** A Work Item sidecar records the human-facing scope, acceptance endpoint, Context Points estimates and attempt links that make an evidence dataset useful for delivery planning. It is separate from the [EvidenceBundle](evidence.md) and from a [Valuation](valuation.md); `dataset_id` is the explicit join key.

The sidecar can be implemented independently of flAImegraph. The machine-readable shape is [work-item.schema.json](schemas/work-item.schema.json). Unknown fields and unsupported schema versions are rejected. Schema validity is necessary but does not establish that a point scale is calibrated or that evidence is complete.

## Work Item identity and scope

A sidecar MUST contain:

- `schema_version`, exactly `0.1.0`;
- the evidence `dataset_id` and stable `work_item_id`;
- a `scope` with a non-empty `revision` and description;
- one or more `acceptance_criteria` strings;
- an `outcome.status`;
- zero or more `attempts`; and
- one or more immutable `estimates`.

The scope revision identifies the specification and conditions for which the estimates apply. An optional specification description and repository revision may provide more context. A later scope change receives a new revision; the earlier estimate remains part of the record it described.

Outcome status is one of `planned`, `in_progress`, `accepted`, `failed`, `interrupted`, `capped`, `cancelled` or `unknown`. Failed and incomplete work are first-class outcomes. An accepted outcome means the declared endpoint was met; it does not mean that every Attempt succeeded or that the evidence is complete.

An Attempt has an immutable `attempt_id`, its own status and an array of evidence `observation_ids`. An observation ID can be linked to at most one Attempt in a sidecar. An empty array records an attempt for which no observation was linked; it does not invent zero usage.

## Context Points estimates

An estimate has a unique `estimate_id`, a positive `estimate_version`, `scope_revision`, RFC3339 `created_at`, `information_basis`, `timing`, `estimator` and `point_estimate`.

`information_basis` records what was available when the estimate was made:

- `specification_only`: the estimator used the declared specification and acceptance criteria;
- `repository_inspection`: the estimator also inspected the repository or working tree; and
- `probe_assisted`: the estimator used a bounded probe that consumed resources or performed work.

`timing` records when the estimate was made:

- `pre_execution`: before the delivery Attempt began;
- `during_execution`: while the delivery was in progress; and
- `post_execution`: after the delivery evidence existed, for retrospective comparison.

Consumers MUST preserve these meanings. A post-execution estimate is descriptive evidence about a later judgement; it MUST NOT be presented as a pre-execution forecast. The reference join output marks it as `post_execution_retrospective`.

When a point is available, `point_estimate` contains:

```json
{
  "scale_id": "team-context",
  "scale_version": "v1",
  "kind": "decimal",
  "value": "3.125"
}
```

`kind: "decimal"` uses a canonical non-negative decimal string, preserving exactness. `kind: "ordinal"` uses a non-empty label such as `XS`, `M` or `XL`. Both kinds MUST name a local `scale_id` and `scale_version`; a label or number has no portable meaning without them. A point value is not a token count, a dollar amount or a context-window occupancy measure.

An unavailable point is represented by `point_estimate: null` and a non-empty `unestimated_reason`. Producers MUST NOT fill in a plausible point for research or historical work merely to make a row look complete. The example [research sidecar](../../examples/work-items/research.json) intentionally uses a nullable, unestimated point.

Estimate records are append-only versions. `estimate_id` and `estimate_version` are unique within the sidecar. Version 1 has no predecessor; each later version names a prior `supersedes_estimate_id` with a lower version. Estimates retain the scope revision they describe. A re-estimate after a scope, acceptance, repository, Harness, Model or policy change is a new version with a reason in the surrounding record or rationale.

## Joining evidence and valuation

The sidecar does not copy model usage, tool results or financial lines into its wire shape. A join operation:

1. validates the sidecar and the evidence bundle;
2. requires matching `dataset_id` values;
3. resolves every `attempt.observation_ids` reference, failing on a missing observation or an explicit observation belonging to another Work Item;
4. retains the selected observations in attempt order and carries source coverage and evidence issues into the joined row; and
5. optionally attaches a Valuation after checking its dataset and observation references.

The resulting row keeps the original Work Item, every estimate including pre-execution estimates, linked observations, coverage, and the optional valuation. It also labels estimate timing so retrospective estimates cannot silently become forecasts. The row is shaped for a calibration/training dataset; it does not claim a calibrated Context Points scale, a universal points-to-token/$ mapping, or a complete provider bill.

Observed Resource Usage, Coverage and selected USD Valuation remain separate from Context Points. A selected enterprise scenario can value captured usage, while the original point estimate and original usage quantities remain unchanged. The same Work Item can therefore be compared against multiple valuation scenarios without rewriting its planning record.

## Adoption and conformance

Teams may begin with ordinal or decimal local anchors and record the scale version on every estimate. Calibration requires completed, failed, interrupted and capped Work Items joined to observed evidence and Acceptance Outcomes. Evaluation should report ranking quality, error, interval coverage, drift, expensive failures and estimator overhead on unseen work. No numeric formula is fixed by this specification.

The sidecar complements existing interoperability work: OpenTelemetry/OTLP can carry execution evidence, FOCUS concepts can describe financial quantities, and pprof/folded stacks can carry profile projections. These mappings are experimental reuse, not formal industry endorsement. Independent producers and consumers must publish conformance evidence before this sidecar or its bindings are called stable.
