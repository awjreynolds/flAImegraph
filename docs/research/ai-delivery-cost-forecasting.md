# Forecasting AI delivery tokens and cost from a specification

Research checked 6 September 2026. **Direct prior work exists:** researchers have tested pre-execution coding-agent token prediction, proposed mappings from software sizing to tokens, and measured how specification detail changes spend. The strongest empirical findings remain conditional on particular tasks, models, harnesses and execution policies. They do not establish a universal conversion from a ticket's story points to the total cost of accepted delivery.

This review used primary papers and author-maintained material. No models, agents or provider APIs were run. It is a bounded literature review, not proof that no other work exists. The recent forecasting papers below are preprints; their reported results have not been independently reproduced here.

## The closest research

### ACEM: an explicit software-sizing-to-token model

Mohammad El-Ramly's **ACEM: A Cost Estimation Model for Agentic Software Engineering** (August 2026) directly addresses this proposal. It separates LLM, human oversight and infrastructure costs. Base tokens are adjusted by a Revision Factor and Context Factor; a Human-in-the-Loop Intensity Score describes oversight. Proposed sizing mappings include:

- Base tokens = unadjusted function points × a calibrated tokens-per-point constant.
- Base tokens = story points × a calibrated constant × complexity weight.
- An analogous mapping uses unadjusted use-case points.

These are model structures, **not validated conversion rates**. Constants remain symbolic; worked examples use assumed numbers. Calibration and held-out comparisons are future work. Section 3.8 limits the model to sequential pipelines, excludes task-decomposition effort, assumes stationary rejection rates, and acknowledges that overlapping factors can be statistically unidentifiable. Agent/model changes require recalibration. Its chief value here is a concrete hypothesis to test against simpler predictors, including whether revision/context adjustments explain additional variance after task size. [ACEM, especially §§3.5–3.8 and 5](https://arxiv.org/pdf/2608.02582)

### Bai et al.: actually predicting coding-agent consumption before execution

**How Do AI Agents Spend Your Money?** (April 2026) studies OpenHands on 500 SWE-bench Verified issues with eight models and four executions per issue/model. For prediction, the same agent inspects the repository and estimates phase-level input/output consumption rather than fixing the issue; there are three predictions per model/issue.

The best reported Pearson correlation is **0.39 for output tokens**, not 39% accuracy or a calibrated cost interval. Input prediction is generally harder, and estimates systematically undershoot actual usage. Prediction itself costs resources: GPT-5.2's overhead is below 6% of task cost, whereas older Sonnet estimators exceed twice execution cost. Human difficulty has only a modest association with token usage, and repeat runs can differ greatly.

This is unusually direct prior art for preflight estimation with repository access. Its benchmark unit is one autonomous issue-resolution attempt, not a business ticket encompassing deployment, human acceptance and subsequent rework. [Paper, §§2 and 6](https://arxiv.org/html/2604.22750v1), [author project and replication resources](https://longjubai.github.io/agent_token_consumption/)

### Smékal: specification variants plus a measured probe

**Can your AI agent be cheaper?** (August 2026) tests Kimi K3 with mini-swe-agent: **five** SWE-bench tasks × twelve specifications × three thinking efforts × fifteen repeats = 2,700 runs. Full specifications follow a Spec Kit structure. Reducing them to a bare user story raises pooled spend 29.7%; variation between tasks remains substantial.

The predictor learns relative log-cost patterns across specification/effort settings from four tasks, then uses a completed low-effort, full-specification run to calibrate the fifth. Across 160 held-out settings, one probe gives 36% median error and places 67% within ±50%; multiplying predictions by 1.9 covers 90% of settings. Those are empirical setting-level results, not guaranteed per-run bounds. The probe averages $0.11 under the study's price schedule.

This is **probe-assisted forecasting**, not specification-only prediction before any implementation. Without a probe, median error is 161%. The small task set, single model and largely high solve rates limit extrapolation to difficult enterprise tickets or other stacks. [Paper, §§3.4, 4.4 and Appendix A](https://arxiv.org/html/2608.25399v1)

### BAGEN: remaining-budget forecasting and feasibility

Lin et al.'s **BAGEN: Are LLM Agents Budget-Aware?** evaluates five models across four environments, including SWE-bench. It records unconstrained trajectories, then replays prefixes and asks for remaining-resource intervals or a declaration that completion is impossible. This separates interval calibration, feasibility and early failure detection.

Its preliminary point-estimation experiment uses Sokoban and Search-R1; the broader progressive protocol includes coding. The work finds optimistic bias and late failure recognition. It also trains estimators and tests stopping policies, with training conducted on Sokoban. This is useful methodology for updating a ticket forecast during execution, but its replay evaluation is not validation of a specification-to-delivery estimator. [BAGEN, §§2–6](https://arxiv.org/html/2606.00198v1)

## Adjacent work that answers different questions

| Research area | Concrete primary example | What it establishes—and does not |
| --- | --- | --- |
| Per-request length prediction | Fu et al., [Efficient LLM Scheduling by Learning to Rank, NeurIPS 2024](https://papers.neurips.cc/paper_files/paper/2024/hash/6c8985579293e0209bdaa4f21bb1d237-Abstract-Conference.html) | Predicts relative output-length ranks to improve scheduling. It does not forecast how many future agent requests, tool cycles or revisions a ticket needs. |
| Cost-aware model routing | Ong et al., [RouteLLM](https://arxiv.org/abs/2406.18665) | Learns stronger/weaker-model selection from preference data, evaluating quality/cost tradeoffs. Selecting a cheaper model is not an estimate of a whole delivery's resource distribution. |
| Execution budget control | Gao and Peng, [More with Less](https://arxiv.org/abs/2510.16786) | Compares unrestricted, fixed and dynamically extended turn budgets on SWE-bench with three models. It measures how a policy changes cost and success, rather than predicting an unconstrained ticket from its specification. |
| Measured lifecycle costs | Salim et al., [Tokenomics](https://arxiv.org/abs/2601.14470) | Analyzes 30 ChatDev/GPT-5 tasks by development phase, finding substantial review consumption. This supplies candidate accounting categories and historical observations, not an independently validated pre-execution regression. |

The phrase **“Token Points”** already appears in Fabio Italiano's June 2026 practitioner proposal, based on experience with one project. That establishes prior use of the term, not a standardized unit, audited forecast accuracy or interoperability between organizations. None of the primary forecasting studies above supplies a shared, validated token-point scale. [Original proposal](https://www.linkedin.com/pulse/token-points-fabio-italiano-wkuce)

## What a defensible ticket estimator would need

The following is a proposed evaluation design, not a finding that an existing product implements it.

**Define the endpoint first.** “One attempt,” “patch passes tests,” “review accepted,” and “deployed and accepted” are different labels. Store the specified acceptance endpoint, specification version, repository revision and delivery policy with each forecast. Include failed/cancelled attempts, escalation and agent-generated review/rework in the observed outcome. Report any excluded human or infrastructure costs separately.

**Forecast a usage vector and outcome probability.** Estimate distributions for independently chargeable input/cache/output categories, alongside probability of reaching acceptance within a stated budget. Preserve reasoning and cached-token subsets without adding them twice. A single total-token number hides price composition. A budget cap is a policy input; it is not evidence that the task can finish within that cap.

**Keep commercial valuation separate.** Apply the selected enterprise contract, model/service tier and effective execution-date rates to predicted or observed usage. Preserve contract version and valuation date. Repricing a historical usage vector is a scenario calculation; it must not rewrite what was measured or be represented as an invoice. At planning time, explicitly use a chosen future-rate scenario if execution rates are not yet known.

**Start with simple, testable baselines.** Compare a cohort median, recent similar-ticket retrieval, calibrated sizing regression, and a feature-based distributional predictor. Candidate preflight features include repository/task family, localized versus unknown change surface, acceptance-test availability, dependencies, documentation quality, model, harness, reasoning effort, tool permissions and retry policy. Evaluate repository inspection or a cheap probe as separate options, charging their overhead and identifying any implementation they perform.

**Validate on genuinely unseen work.** Hold out whole tickets and repositories, rather than randomly splitting repeats of the same issue. Use chronological holdouts to expose model/harness drift. Never use final changed-line counts, realized turns or observed retries as if they were available before execution. For interrupted or capped runs, record censoring rather than treating the cap as the true completion requirement.

**Measure calibration and decision value.** Report median absolute error, systematic bias, interval coverage and width, and error on expensive tails. Evaluate success-conditioned spend separately from the cost of all attempts under the retry/escalation policy. Compare whether the forecast improves decisions after estimator overhead: model choice, batching, clarification, task decomposition or approval of a larger budget. A good rank ordering can help triage even when point estimates remain poor.

A useful first experiment would retain existing team sizing and compare it against measured, versioned delivery outcomes. Add a “token points” display only if a locally calibrated scale makes planning easier; retain the underlying ranges, configuration and quantity definitions. The evidence supports a research-backed forecasting programme, with uncertainty and local calibration central to its design, rather than an immediate universal exchange rate between points and tokens.
