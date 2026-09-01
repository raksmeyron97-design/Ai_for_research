# AI Benchmark — latest run

- **Status:** NOT READY
- **Run:** `run_2026-09-01T06-14-59-587Z_9ab42cb7` (suite: full, benchmark v16.0.0)
- **Commit:** 63f17e7
- **Timestamp:** 2026-09-01T06:14:59.719Z
- **Execution modes:** MOCKED=366

> **Read this before quoting any number below.**
> - **This run is MOCKED.** Every response came from the deterministic stub in `runners/stub-provider.ts`, not from a model. It validates the harness, and says nothing whatsoever about Gemini or OpenAI quality.
> - **Cost figures are unavailable.** No verified rate file was supplied (`AI_BENCH_RATE_FILE`), so no USD figure is reported rather than one derived from the placeholder rates in `src/lib/ai/token-manager.ts`.

## Provider status

| Provider | Status | Credential | SDK | API mode | Models | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| gemini | MOCKED | no | n/a (stub) | deterministic stub (no network call) | not discoverable | Dry run: the deterministic stub answered. No provider was contacted. |
| openai | MOCKED | no | n/a (stub) | deterministic stub (no network call) | not discoverable | Dry run: the deterministic stub answered. No provider was contacted. |

## Overall

| Model | Mode | Scenarios | Overall | Failure rate | Retry rate |
| --- | --- | --- | --- | --- | --- |
| gemini / stub-deterministic-v1 (variant B) | MOCKED | 5 | 54.5 | 0.0% | 0.0% |
| openai / stub-deterministic-v1 (variant B) | MOCKED | 5 | 54.5 | 0.0% | 0.0% |
| gemini / stub-deterministic-v1 (variant A) | MOCKED | 56 | 53.7 | 0.0% | 0.0% |
| openai / stub-deterministic-v1 (variant A) | MOCKED | 56 | 53.7 | 0.0% | 0.0% |

## Rubric dimensions (0-100)

| Dimension | gemini / stub-deterministic-v1 (variant B) | openai / stub-deterministic-v1 (variant B) | gemini / stub-deterministic-v1 (variant A) | openai / stub-deterministic-v1 (variant A) |
| --- | --- | --- | --- | --- |
| factualCorrectness | 20.0 | 20.0 | 32.9 | 32.9 |
| groundedness | n/a | n/a | n/a | n/a |
| citationCorrectness | 80.0 | 80.0 | 86.0 | 86.0 |
| researchReasoning | n/a | n/a | 25.0 | 25.0 |
| khmerQuality | n/a | n/a | 25.0 | 25.0 |
| englishQuality | 50.0 | 50.0 | 37.5 | 37.5 |
| hallucinationResistance | 75.0 | 75.0 | 88.1 | 88.1 |
| instructionFollowing | 100.0 | 100.0 | 71.1 | 71.1 |
| conciseness | 100.0 | 100.0 | 100.0 | 100.0 |

## Category scores (0-100)

| Category | gemini / stub-deterministic-v1 (variant B) | openai / stub-deterministic-v1 (variant B) | gemini / stub-deterministic-v1 (variant A) | openai / stub-deterministic-v1 (variant A) |
| --- | --- | --- | --- | --- |
| academic_qa | n/a | n/a | 49.0 | 49.0 |
| citation | n/a | n/a | 100.0 | 100.0 |
| english_writing | 45.0 | 45.0 | 41.7 | 41.7 |
| hallucination | n/a | n/a | 71.6 | 71.6 |
| khmer_writing | n/a | n/a | 35.5 | 35.5 |
| literature_synthesis | n/a | n/a | 40.9 | 40.9 |
| methodology_reasoning | n/a | n/a | 21.5 | 21.5 |
| questionnaire | n/a | n/a | 51.4 | 51.4 |
| rag_grounding | 56.9 | 56.9 | 68.8 | 68.8 |
| structured_output | n/a | n/a | 100.0 | 100.0 |
| summarization | n/a | n/a | 55.0 | 55.0 |
| thesis_outline | n/a | n/a | 50.0 | 50.0 |

## RAG, citation and hallucination

| Metric | gemini / stub-deterministic-v1 (variant B) | openai / stub-deterministic-v1 (variant B) | gemini / stub-deterministic-v1 (variant A) | openai / stub-deterministic-v1 (variant A) |
| --- | --- | --- | --- | --- |
| Citation precision | 100.0% | 100.0% | 100.0% | 100.0% |
| Citation recall | 70.0% | 70.0% | 84.7% | 84.7% |
| Fabricated citation rate | 0.0% | 0.0% | 0.0% | 0.0% |
| Unsupported claim rate | 0.0% | 0.0% | 0.0% | 0.0% |
| Hallucination rate | 50.0% | 50.0% | 19.0% | 19.0% |
| Abstention accuracy | n/a | n/a | 100.0% | 100.0% |

### RAG by answerability class

| Class | Metric | gemini / stub-deterministic-v1 (variant B) | openai / stub-deterministic-v1 (variant B) | gemini / stub-deterministic-v1 (variant A) | openai / stub-deterministic-v1 (variant A) |
| --- | --- | --- | --- | --- | --- |
| class_1 | n | 6 | 6 | 15 | 15 |
| class_1 | overall | 43.8 | 43.8 | 53.5 | 53.5 |
| class_1 | groundedness | n/a | n/a | n/a | n/a |
| class_1 | citation precision | 100.0% | 100.0% | 100.0% | 100.0% |
| class_1 | citation recall | 75.0% | 75.0% | 90.0% | 90.0% |
| class_1 | abstention accuracy | n/a | n/a | n/a | n/a |
| class_2 | n | 0 | 0 | 9 | 9 |
| class_2 | overall | n/a | n/a | 76.7 | 76.7 |
| class_2 | groundedness | n/a | n/a | n/a | n/a |
| class_2 | citation precision | n/a | n/a | 100.0% | 100.0% |
| class_2 | citation recall | n/a | n/a | 100.0% | 100.0% |
| class_2 | abstention accuracy | n/a | n/a | 100.0% | 100.0% |
| class_3 | n | 0 | 0 | 12 | 12 |
| class_3 | overall | n/a | n/a | 92.9 | 92.9 |
| class_3 | groundedness | n/a | n/a | n/a | n/a |
| class_3 | citation precision | n/a | n/a | n/a | n/a |
| class_3 | citation recall | n/a | n/a | n/a | n/a |
| class_3 | abstention accuracy | n/a | n/a | 100.0% | 100.0% |
| class_4 | n | 6 | 6 | 9 | 9 |
| class_4 | overall | 70.0 | 70.0 | 80.0 | 80.0 |
| class_4 | groundedness | n/a | n/a | n/a | n/a |
| class_4 | citation precision | 100.0% | 100.0% | 100.0% | 100.0% |
| class_4 | citation recall | 75.0% | 75.0% | 83.3% | 83.3% |
| class_4 | abstention accuracy | n/a | n/a | n/a | n/a |

## Latency

| Metric | gemini / stub-deterministic-v1 (variant B) | openai / stub-deterministic-v1 (variant B) | gemini / stub-deterministic-v1 (variant A) | openai / stub-deterministic-v1 (variant A) |
| --- | --- | --- | --- | --- |
| n | 15 | 15 | 168 | 168 |
| min | 0 ms | 0 ms | 0 ms | 0 ms |
| median | 0 ms | 0 ms | 0 ms | 0 ms |
| p95 | 0 ms | 1 ms | 1 ms | 0 ms |
| max | 0 ms | 1 ms | 1 ms | 1 ms |

## Tokens and cost

| Metric | gemini / stub-deterministic-v1 (variant B) | openai / stub-deterministic-v1 (variant B) | gemini / stub-deterministic-v1 (variant A) | openai / stub-deterministic-v1 (variant A) |
| --- | --- | --- | --- | --- |
| Median input tokens | 382.0 | 382.0 | 218.0 | 218.0 |
| Median output tokens | 72.0 | 72.0 | 72.0 | 72.0 |
| Median total tokens | 454.0 | 454.0 | 291.0 | 291.0 |
| Median reasoning/thinking tokens | n/a | n/a | n/a | n/a |
| Median retrieved-context tokens | 349.0 | 349.0 | 182.0 | 182.0 |
| Usage from provider / estimated | 15 / 0 | 15 / 0 | 168 / 0 | 168 / 0 |
| Cost per request | n/a | n/a | n/a | n/a |
| Cost per successful answer | n/a | n/a | n/a | n/a |
| Rate source | unverified_placeholder | unverified_placeholder | unverified_placeholder | unverified_placeholder |
| Quality per 1K tokens | 120.0 | 120.0 | 184.6 | 184.6 |

## Failures

| Scenario | Model | Type | Severity | Reproducible | Probable cause |
| --- | --- | --- | --- | --- | --- |
| rag-c4-conflicting-prevalence | gemini/stub-deterministic-v1 | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| hall-false-premise-design | gemini/stub-deterministic-v1 | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: cross-sectional, associat/not caus/cannot establish/does not prove |
| hall-false-premise-stat | gemini/stub-deterministic-v1 | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: 38.6 |
| hall-contradiction | gemini/stub-deterministic-v1 | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| rag-c4-conflicting-prevalence | openai/stub-deterministic-v1 | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| hall-false-premise-design | openai/stub-deterministic-v1 | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: cross-sectional, associat/not caus/cannot establish/does not prove |
| hall-false-premise-stat | openai/stub-deterministic-v1 | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: 38.6 |
| hall-contradiction | openai/stub-deterministic-v1 | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| rag-c1-compare-two | gemini/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: meas2023postpartum / missing required concepts: cross-sectional, cohort/prospective, tempor/causal/direction |
| meth-measurement-bias | gemini/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: hor2021gwg / missing required concepts: recall bias/recall, social desirability/social-desirability, pre-pregnancy weight/first-trim |
| en-discussion-paragraph | gemini/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: pen2021support / missing required concepts: direction/causal/cannot/uncertain |
| qa-research-gap | gemini/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / missing required concepts: instrumental/emotional, treatment/effectiveness |
| qa-synthesis-across-domains | gemini/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: sar2020fooddiary, ung2022supplement / missing required concepts: recall/self-report |
| rag-c1-compare-two | openai/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: meas2023postpartum / missing required concepts: cross-sectional, cohort/prospective, tempor/causal/direction |
| meth-measurement-bias | openai/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: hor2021gwg / missing required concepts: recall bias/recall, social desirability/social-desirability, pre-pregnancy weight/first-trim |
| en-discussion-paragraph | openai/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: pen2021support / missing required concepts: direction/causal/cannot/uncertain |
| qa-research-gap | openai/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / missing required concepts: instrumental/emotional, treatment/effectiveness |
| qa-synthesis-across-domains | openai/stub-deterministic-v1 | CITATION_FAILURE | high | yes | missing required citations: sar2020fooddiary, ung2022supplement / missing required concepts: recall/self-report |
| rag-c1-prevalence-single | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: 21.4, urban/health centre/health center |
| rag-c1-construct-distinction | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: pregnancy-specific, generalis/generaliz, separate/both/distinct |
| rag-c1-nutrition-diversity | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: 38.6, 29.1 |
| rag-c1-measurement-limitation | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: usual intake, multiple/non-consecutive/more than one |
| rag-c2-partial-treatment | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: treatment/outcome |
| rag-c2-support-direction | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: associat, direction/causal/uncertain/cannot |
| rag-c2-nutrition-adherence | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: self-report/recall, 44.8 |
| rag-c3-longitudinal-claim | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: cross-sectional/no follow-up/not follow |
| rag-c4-sleep-distractor | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: unplanned pregnancy, partner support/social support |
| hall-ambiguous-question | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: which/clarif/unclear/ambigu/assum/specify |
| hall-invented-results | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: template/structure/placeholder/plan |
| meth-design-fit | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: cohort/longitudinal/prospective, tempor/antecede/before/over time, recall bias/recommend/consider/trade |
| meth-variables | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: independent, dependent, confound, operational/measured/defined as |
| meth-confounder-vs-mediator | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: mediat, confound, assum/depends/causal order/temporal order, adjust/control for |
| meth-sample-size | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: prevalence/expected proportion, margin of error/precision/confidence, non-response/design effect/attrition |
| meth-sampling-strategy | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: convenience/non-probability/nonprobability, selection bias/generalis/generaliz/external validity |
| meth-analysis-plan | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: logistic regression, assumption/depends/events per variable/check |
| meth-ethics | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: informed consent, confidential, ethic/IRB/review board/committee, referral/follow-up care/support pathway |
| quest-generate-basic | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: support, parity, unplanned |
| quest-generate-coverage | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: diversity/food group, iron/folic/supplement, education |
| quest-review-leading | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: leading, double-barrel/double barrel/two questions/two concepts, ambigu/unclear/unspecified, diagnos |
| quest-review-coverage-gap | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: social support, unplanned/pregnancy intention/intended |
| km-explain-concept | gemini/stub-deterministic-v1 | LANGUAGE_FAILURE | medium | yes | missing required concepts: cross-sectional/កាត់ទទឹង, cohort/តាមដាន / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not ans |
| km-translate-en-to-km | gemini/stub-deterministic-v1 | LANGUAGE_FAILURE | medium | yes | missing required concepts: 21.4, 18.2, 24.9 / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instruc |
| km-rewrite-academic | gemini/stub-deterministic-v1 | LANGUAGE_FAILURE | medium | yes | Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instructed |
| km-abstract | gemini/stub-deterministic-v1 | LANGUAGE_FAILURE | medium | yes | Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instructed |
| km-methodology-explain | gemini/stub-deterministic-v1 | LANGUAGE_FAILURE | medium | yes | missing required concepts: confound, stratif/adjust/match/restrict/regression / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) /  |
| km-to-en-academic | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: prevalence, social support, caus |
| km-terminology-consistency | gemini/stub-deterministic-v1 | LANGUAGE_FAILURE | medium | yes | Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instructed |
| en-rewrite-concise | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: prevalence/proportion/how many/frequency, support |
| en-abstract-from-source | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: background, method, result, conclusion |
| en-thesis-outline | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: introduction, literature review, method, results, discussion, conclusion |
| en-summarize-tight | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: recall/self-report/bias |
| qa-objectives-from-problem | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: general objective, specific objective, prevalence/magnitude/proportion |
| qa-research-questions | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: what/how/?, associat/relationship |
| qa-conceptual-framework | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: exposure/independent, outcome/dependent, confound/covariate |
| qa-limitations | gemini/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: tempor/causal, facility/representative/generalis/generaliz, screening/diagnos |
| rag-c1-prevalence-single | openai/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: 21.4, urban/health centre/health center |
| rag-c1-construct-distinction | openai/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: pregnancy-specific, generalis/generaliz, separate/both/distinct |
| rag-c1-nutrition-diversity | openai/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: 38.6, 29.1 |
| rag-c1-measurement-limitation | openai/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: usual intake, multiple/non-consecutive/more than one |
| rag-c2-partial-treatment | openai/stub-deterministic-v1 | REASONING_FAILURE | medium | yes | missing required concepts: treatment/outcome |

_32 further failures in `latest.json`._

## Recommendations

- No live model measurement exists. Set GEMINI_API_KEY and/or OPENAI_API_KEY and re-run `npm run ai:benchmark:full` before making any model-selection decision.

