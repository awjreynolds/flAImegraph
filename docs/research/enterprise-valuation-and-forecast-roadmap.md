# From measured work to enterprise-valued delivery forecasts

Scope clarified by the user on 6 September 2026: monetary cost is the primary flame-graph width; observed usage should be valuatable under a selected enterprise rate card even if originally generated under a subscription; the longer-term aim is to estimate delivery resources from developed specifications and tickets.

## Preserve usage; select the commercial scenario

A captured usage observation and its valuation are separate records. Preserve model identity and its evidence, execution timestamp, disjoint chargeable categories, provider/product channel, service tier and other known pricing dimensions. Attach a versioned valuation containing currency, rate source, applicable interval when known, contract or scenario identity, retrieval time, calculation version and explicit assumptions. Several valuations can reference the same usage without changing it.

Distinguish three questions:

- **Historical contractual valuation:** what the relevant agreement would charge for this activity at execution time, subject to discounts, tiers, commitments and fees. Validate against billing evidence before calling it an actual charge.
- **Enterprise-equivalent scenario:** what captured activity would cost under a chosen enterprise schedule and configuration, even if the original run used a personal subscription.
- **Repricing scenario:** what past activity would cost under today's or another selected rate schedule. This does not establish which rates applied historically.

Model plus timestamp and token categories can price a simple schedule. They are insufficient if eligibility, speed, region, product channel, commitment allocation or non-token fees affect the price. Missing dimensions require a stated scenario or an unpriced residual, rather than a silent default presented as contractual fact. A public price page cannot reveal a customer's negotiated terms.

OpenAI's current Enterprise token rate card covers ChatGPT Work and Codex, applies to particular agreements, and directs customers to their agreement for rates and discounts. It lists model-category prices and feature-dependent fees, including an Astra Codex long-context exception. Therefore an enterprise scenario need not be an API-list-price substitute. Its publication/retrieval date alone does not prove historical validity. [Official Enterprise rate card](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing).

Capacity purchasing introduces another distinction: OpenAI Scale Tier purchases token throughput capacity for a minimum period, so utilization and allocation affect average cost. Per-call marginal usage and allocated committed capacity are different valuations. [Official Scale Tier](https://openai.com/api-scale-tier/).

Adopt existing financial vocabulary and catalogue structures where applicable. FOCUS's contracted/billed/effective cost meanings must not be applied to arbitrary simulations, and its evolving price-catalogue work should be checked before defining an interchange. [Financial standards review](accounting-coverage.md).

## Sequence of work

1. **Trustworthy cost profiles.** Validate native capture and reusable adapters, reconcile observations and lineage, select a price basis, and conserve monetary widths. Missing usage remains visible.
2. **Calibration dataset.** Join a versioned pre-execution specification, its size estimate, repository/configuration and acceptance endpoint to all attempts, failures, reviews, rework and the final outcome. Keep human and infrastructure resources separate. Store original scope and subsequent changes.
3. **Forecast evaluation.** Compare similar-ticket/cohort baselines, sizing regressions and ACEM. Separate specification-only estimates from repository-inspection or probe-assisted estimates, including estimation overhead. Hold out whole projects and later time periods, assess bias, interval coverage and expensive failures, and avoid features available only after delivery.
4. **Planning integration.** Present resource and enterprise-cost ranges conditional on configuration, rate scenario and acceptance criteria. Recalibrate when models, harnesses or policies change. Decide whether a local points display helps only after its usefulness is measured.

This is a roadmap and evaluation plan, not a commissioned production estimator. Existing sizing methods and [forecasting research](ai-delivery-cost-forecasting.md) provide candidates; no universal point-to-token conversion is established by the examined evidence. ACEM expressly needs calibration data, and that data can support competing estimators as well as its particular equations. [Sizing standards](software-sizing-and-ai-work.md).

The useful unit of observation is the **specified work item and its delivery outcome**, with execution evidence underneath it. A single successful agent attempt is not automatically the cost of accepted delivery. Cancelled or budget-capped work must not disappear from the dataset or be mislabeled as completed work.
