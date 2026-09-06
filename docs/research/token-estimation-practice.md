# Token estimation in current planning practice

Checked 6 September 2026 against the creators' public descriptions. These sources establish concrete prior art for planning AI usage, with different levels of automation. This review did not operate the products, create accounts, request demonstrations, contact creators, or test forecast accuracy. Product claims below are attributed to their publishers; availability of a method does not establish widespread adoption or a standard unit.

## TokenPoker: team estimates recorded as a second vote

TokenPoker describes a planning room in which each participant votes on **story points and expected AI usage separately**, then reveals both. The estimate comes from the team's judgement and discussion. The site recommends selecting previously completed tickets as references for new estimates. Its stated objective is an early indication of relatively expensive work, rather than exact token prediction. [Product explanation](https://tokenpoker.dev/ai-token-estimation)

Its creator's June 2026 articles explicitly retain separate effort and usage axes. The default token deck comprises five qualitative tiers ranging from a small prompt to extensive exploration. Teams anchor the tiers to familiar tickets; the articles do not assign universal numeric token ranges. This is a usable analogy-based planning workflow, not evidence of an automatic specification parser, learned regression, or provider billing calculator. [Story points versus token estimates](https://tokenpoker.dev/blog/story-points-vs-token-estimates), [tier definitions](https://tokenpoker.dev/blog/ai-token-estimation-tiers-explained)

The inspected guidance suggests using estimates for model choice, scope discussion and rough sprint budgets. It publishes no training corpus, calibration coefficients, observed error distribution or held-out evaluation. Historical anchoring is a recommended human practice; it should not be described as a demonstrated automatically calibrated prediction engine. [Cost-planning workflow](https://tokenpoker.dev/blog/how-to-estimate-ai-coding-costs-in-sprint-planning)

## Fabio Italiano: AI-assisted ranges and retrospective heuristics

The June 13, 2026 **Token Points** article describes a personal workflow developed on one application. A slash command proposes a row per story: input/output token ranges, model, intensity and confidence. The author discusses and revises those rows. Sprint files preserve predictions and actuals; later prompts consult previous files and calibration notes. The author reports tightening heuristics over six weeks.

This is more than human voting: an AI proposes estimates using historical artifacts. However, consulting prior files is not evidence of model-weight training or a fitted statistical predictor. The article provides examples and a method, but no paired evaluation dataset, error metrics, coverage study or reproducible estimator implementation. The claimed improvement is a practitioner's account.

It explicitly discusses human thinking/review bottlenecks and multi-session limitations. Its numeric ranges are contextual examples, not transferable defaults. The useful prior art is the predicted-versus-actual artifact and feedback loop. The article does not establish a shared token-point unit or reliable whole-delivery cost forecasting. [Original article](https://www.linkedin.com/pulse/token-points-fabio-italiano-wkuce)

## ReqPOOL: automated sizing and proprietary cost benchmarks

ReqPOOL's **Estimation Manager** is advertised as a consultant-operated platform. Seven structural inputs—screens, use cases, business objects, interfaces, scheduled processes, languages and roles—produce what the vendor describes as an IFPUG-compliant function-point estimate using calibrated ReqPOOL productivity benchmarks. It compares classic, agile and agentic delivery, explicitly including estimated AI token consumption, cost by phase, and best/expected/worst bands. Scope snapshots preserve rates and parameters for reproducibility.

This is a direct commercial claim of automated scope-to-token/cost estimation, rather than voting. However, the public page does not disclose token equations, model/harness coverage, calibration sample size, input/output/cache treatment, training procedure or held-out accuracy. “Calibrated productivity benchmarks” does not by itself demonstrate a validated token-consumption model; function-point compliance likewise does not validate the token conversion. The tool is part of ReqPOOL consulting engagements, not advertised here as a standalone public estimator.

The page's statement that client data does not train AI models addresses data handling; it does not disclose how forecasting benchmarks were calibrated. [Vendor product page](https://www.reqpool.com/en/tools/estimation-manager/)

## What this means for flAImegraph

The opportunity already has human-planning, AI-assisted and proprietary automated implementations. A comparison should test the same versioned tickets and acceptance endpoint, count estimation overhead, retain failed attempts, and measure interval coverage on unseen work. Requesting underlying validation evidence would be appropriate before relying on any claimed automation; absence from these public pages is not proof that private validation does not exist.

Keep usage forecasts separate from valuation under the selected enterprise contract and execution-date rates. Preserve both the original forecast and later reforecasts. Those requirements make any planning method auditable without assuming that a human vote, an AI-generated range, or a function-point calculation is already an accurate delivery-cost forecast.
