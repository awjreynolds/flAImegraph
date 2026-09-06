# Software sizing standards and AI delivery effort

Research date: 6 September 2026. This bounded review covers public primary material from IFPUG, COSMIC, research authors, estimation vendors and a coding-agent provider. It distinguishes a method's existence from evidence that it forecasts an autonomous coding task's resource consumption. No tools were installed or model calls made.

**There is substantial prior work on estimating delivery resources from specifications, including AI-assisted sizing. The established separation is software size → empirically calibrated effort/cost.** The standards examined do not define a universal “token point” that replaces functional size. That is a finding about these sources, not a claim that nobody has proposed such a measure.

## What the established points actually measure

| Method | Quantity measured | Relationship to delivery resources |
| --- | --- | --- |
| IFPUG Function Point Analysis | Functionality requested by and supplied to users, represented through inputs, outputs, inquiries and logical data | Supplies a technology-independent size denominator for effort/FP and cost/FP. It does not directly count hours or tokens. |
| COSMIC Function Points | Functional requirements modeled as Entry, Exit, Read and Write data movements; each movement contributes one CFP | Specifications can be sized before implementation, then linked to observed resource use through an estimating model. |
| IFPUG SNAP | Non-functional user requirements, complementary to functional size | Extends the sizing information available for resource forecasts; forecasting still requires historical or benchmark productivity. |

The definitions above come from the methods' owners. COSMIC explicitly approximates data manipulation rather than measuring it separately, so equal CFP counts need not imply equal algorithmic work. IFPUG explicitly lists effort per function point and cost per function point as derived metrics. [IFPUG FPA](https://ifpug.org/ifpug-standards/fpa), [COSMIC introduction](https://cosmic-sizing.org/cosmic-sizing/intro/), [IFPUG SNAP](https://ifpug.org/ifpug-standards/snap).

Early estimation is already part of this practice. IFPUG's public description of **uTip #03 – Early FPA** covers sizing and cost estimation early in the lifecycle and identifies Simple Function Points as a lightweight functional measurement method. This is relevant when the input is an incomplete specification; it does not make missing scope or delivery uncertainty disappear. [Official uTip description](https://ifpug.mclms.net/en/package/19895/course/36519/view).

## The conversion to effort is explicitly empirical

COSMIC provides a concrete worked method: collect functional sizes and implementation hours for completed applications, fit a regression, and estimate hours for a new size. Its illustrative equation is `hours = 2.5 × CFP + 109`; those coefficients belong to its example, not to software in general. The guidance requires consistent implementation activities, organizational calibration, use within the observed size range, updates when new data arrives, and correction of the measured size when delivered functionality changes. It also allows separate models for different software environments or types. [COSMIC estimating guidance](https://cosmic-sizing.org/cosmic-sizing/estimating-with-software-size/).

This offers a direct precedent for the proposed AI estimator: replace or supplement the historical hours outcome with observed agent tokens and priced cost, while preserving the specification-derived size and execution context as explanatory variables. **That extension is our inference, not a COSMIC-endorsed token model.** A conversion needs calibration; renaming a function point “token point” supplies none.

## Work explicitly addressing AI

**IFPUG is discussing exactly the output/resource distinction in AI delivery.** Its July 27, 2026 Knowledge Café, presented by the chair of its Forecasting and Software Estimation Committee, argues that AI changes effort, cost and cycle time more directly than the functionality supplied to users. The public abstract retains effort/FP, cost/FP and defects/FP and identifies AI consumption as an emerging research area. This is an official professional discussion, not a published token-counting standard or a validated predictor. Only the public abstract was inspected; the recording requires membership. [Software Productivity Measurement in the AI Era](https://ifpug.org/event/software-productivity-measurement-in-the-ai-era).

**COSMIC has an AI Software Sizing Taskforce.** Its stated program examines AI functional characteristics, algorithm sizing, tailored measurement procedures, case studies and validation. The target is sizing software that incorporates AI. Its public scope does not establish a method for estimating the inference consumption of an AI that builds arbitrary software. [COSMIC AI Software Sizing](https://cosmic-sizing.org/cosmic-projects/artificial-intelligence-software-sizing/).

**CosMet is a concrete specification-to-size research system.** De Vito and colleagues use GPT-4 to turn natural-language use cases into COSMIC analyses. They evaluate seven systems containing 123 use cases against counts prepared by two certified professionals, followed by evaluation involving seven measurers. The abstract reports 60–80% less manual measurement time. The paper retains review and validation and discusses terminology, sample size and nondeterminism limits; its comparison table says layer and measurement scope cannot be identified. These results concern measuring requirements, not reducing software implementation effort by 60–80% or forecasting coding-agent tokens. [Author-hosted paper, abstract and §§6–7](https://gadevito.github.io/pdf/J77.pdf), [COSMIC announcement](https://cosmic-sizing.org/2026/04/30/31737/).

**A 2024 paper proposes scoping LLM-interface projects through generated task inventories.** Coelho and colleagues expand representative user questions, ask an agent planner to enumerate required data sources, algorithms and interfaces, and manually validate and deduplicate the results. The food-ordering example yields an implementation inventory. This is a concrete requirements-discovery procedure for developing agent-based products; the paper does not demonstrate a calibrated forecast of the coding agent's tokens, dollars or completion probability. [Paper, “Estimating Effort in AI Agents,” v2](https://arxiv.org/html/2402.07158v2).

Commercial prior art also exists for AI-assisted estimation: Galorath describes a **Software Sizing Agent** that converts user stories into software size and effort models, integrated with its estimation platform. This establishes a vendor offering, not independent validation or a published token-point method. [SEERai agent catalogue](https://galorath.com/seerai/).

## Implication for flAImegraph

Actual token consumption belongs on the resource side of this model. Anthropic's coding-agent documentation says costs vary with model choice, codebase size and usage patterns, and documents context management, caching and thinking settings as cost controls. Its SDK guidance also requires accounting for failed conversations and cache pricing. Thus a raw token total cannot, by itself, identify either delivered functionality or its monetary cost. [Claude Code costs](https://code.claude.com/docs/en/costs), [SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

The following is a proposed application of the measurement principles, not an existing standard:

1. Retain a versioned specification, acceptance conditions and a scope estimate, whether functional points or a locally defined relative size.
2. Associate completed and failed attempts with that work item; record resource categories, model/harness configuration, human work and accepted outcome.
3. Fit resource forecasts for comparable configurations and task classes; validate on later work and report uncertainty. A simple size multiplier is a baseline to test, not an assumed law.
4. Report resource consumption per accepted unit of work separately from the work's estimated size. Keep any “AI points” explicitly local until their repeatability and predictive value are demonstrated.

This leaves room for a useful new estimator while acknowledging its predecessors: functional measurement supplies scope, trace accounting supplies observations, and calibration connects the two. The bounded search found explicit work on the first two concepts and AI-assisted scope estimation; it did not establish a cross-model standardized point unit that predicts autonomous delivery consumption from a specification alone.
