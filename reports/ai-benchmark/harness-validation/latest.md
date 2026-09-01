# AI Benchmark — latest run

- **Status:** NOT READY
- **Run:** `run_2026-09-01T11-59-03-061Z_1800f24b` (suite: full, benchmark v16.0.0)
- **Commit:** a591921
- **Timestamp:** 2026-09-01T11:59:03.321Z
- **Completeness:** complete (765 planned calls, none skipped)
- **Execution modes:** MOCKED=765

> **Read this before quoting any number below.**
> - **This run is MOCKED.** Every response came from the deterministic stub in `runners/stub-provider.ts`, not from a model. It validates the harness, and says nothing whatsoever about Gemini or OpenAI quality.
> - **No cost figure for gemini-3.6-flash, gpt-5.4-mini, gpt-5.6.** Neither `src/lib/ai/pricing.ts` nor any supplied rate file prices these models, so they contribute nothing to the cost totals rather than contributing a guess.
> - **18 execution(s) have locally estimated token counts**, not provider-reported usage. Treat their token and cost figures as approximate.

## Provider status

| Provider | Status | Credential | SDK | API mode | Models | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| gemini | MOCKED | no | n/a (stub) | deterministic stub (no network call) | not discoverable | Dry run: the deterministic stub answered. No provider was contacted. |
| openai | MOCKED | no | n/a (stub) | deterministic stub (no network call) | not discoverable | Dry run: the deterministic stub answered. No provider was contacted. |

## Overall

| Group | Provider | Model | Mode | Scenarios | Provider calls | Overall | Failure rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai | openai | gpt-5.6 | MOCKED | 4 | 18 | 74.3 | 0.0% |
| routed | openai | gpt-5.6 | MOCKED | 4 | 18 | 74.3 | 0.0% |
| gemini | gemini | gemini-3.6-flash | MOCKED | 5 | 15 | 54.5 | 0.0% |
| openai | openai | gpt-5.4-mini | MOCKED | 5 | 15 | 54.5 | 0.0% |
| routed | gemini | gemini-3.6-flash | MOCKED | 5 | 15 | 54.5 | 0.0% |
| gemini | gemini | gemini-3.6-flash | MOCKED | 67 | 195 | 53.1 | 0.0% |
| openai | openai | gpt-5.4-mini | MOCKED | 63 | 186 | 51.7 | 0.0% |
| routed | gemini | gemini-3.6-flash | MOCKED | 63 | 186 | 51.7 | 0.0% |
| gemini | gemini | gemini-3.5-flash-lite | MOCKED | 13 | 39 | 49.1 | 0.0% |
| openai | openai | gpt-5.6-luna | MOCKED | 13 | 39 | 49.1 | 0.0% |
| routed | gemini | gemini-3.5-flash-lite | MOCKED | 13 | 39 | 49.1 | 0.0% |

## Rubric dimensions (0-100)

| Dimension | [openai] gpt-5.6 | [routed] gpt-5.6 | [gemini] gemini-3.6-flash varB | [openai] gpt-5.4-mini varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [openai] gpt-5.4-mini | [routed] gemini-3.6-flash | [gemini] gemini-3.5-flash-lite | [openai] gpt-5.6-luna | [routed] gemini-3.5-flash-lite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| factualCorrectness | 75.0 | 75.0 | 20.0 | 20.0 | 20.0 | 34.6 | 31.9 | 31.9 | 31.8 | 31.8 | 31.8 |
| groundedness | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| citationCorrectness | 66.7 | 66.7 | 80.0 | 80.0 | 80.0 | 83.9 | 84.6 | 84.6 | 100.0 | 100.0 | 100.0 |
| researchReasoning | 66.7 | 66.7 | n/a | n/a | n/a | 26.5 | 17.9 | 17.9 | 0.0 | 0.0 | 0.0 |
| khmerQuality | 0.0 | 0.0 | n/a | n/a | n/a | 15.6 | 16.7 | 16.7 | 0.0 | 0.0 | 0.0 |
| englishQuality | n/a | n/a | 50.0 | 50.0 | 50.0 | 55.0 | 55.0 | 55.0 | 37.5 | 37.5 | 37.5 |
| hallucinationResistance | 100.0 | 100.0 | 75.0 | 75.0 | 75.0 | 85.8 | 85.3 | 85.3 | 100.0 | 100.0 | 100.0 |
| instructionFollowing | 66.7 | 66.7 | 100.0 | 100.0 | 100.0 | 48.4 | 46.4 | 46.4 | 50.0 | 50.0 | 50.0 |
| conciseness | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |

## Category scores (0-100)

| Category | [openai] gpt-5.6 | [routed] gpt-5.6 | [gemini] gemini-3.6-flash varB | [openai] gpt-5.4-mini varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [openai] gpt-5.4-mini | [routed] gemini-3.6-flash | [gemini] gemini-3.5-flash-lite | [openai] gpt-5.6-luna | [routed] gemini-3.5-flash-lite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| academic_qa | n/a | n/a | n/a | n/a | n/a | 49.0 | 49.0 | 49.0 | n/a | n/a | n/a |
| citation | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 100.0 | 100.0 | 100.0 |
| english_writing | n/a | n/a | 45.0 | 45.0 | 45.0 | 53.4 | 53.4 | 53.4 | 38.6 | 38.6 | 38.6 |
| hallucination | 70.0 | 70.0 | n/a | n/a | n/a | 71.0 | 71.1 | 71.1 | 70.0 | 70.0 | 70.0 |
| khmer_writing | n/a | n/a | n/a | n/a | n/a | 33.4 | 33.4 | 33.4 | 29.4 | 29.4 | 29.4 |
| literature_synthesis | 27.3 | 27.3 | n/a | n/a | n/a | 40.9 | 54.5 | 54.5 | n/a | n/a | n/a |
| methodology_reasoning | n/a | n/a | n/a | n/a | n/a | 21.5 | 21.5 | 21.5 | n/a | n/a | n/a |
| questionnaire | n/a | n/a | n/a | n/a | n/a | 51.4 | 51.4 | 51.4 | n/a | n/a | n/a |
| rag_grounding | n/a | n/a | 56.9 | 56.9 | 56.9 | 65.8 | 65.8 | 65.8 | n/a | n/a | n/a |
| structured_output | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | n/a | n/a | n/a | n/a |
| summarization | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 55.0 | 55.0 | 55.0 |
| thesis_outline | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 50.0 | 50.0 | 50.0 |

## RAG, citation and hallucination

| Metric | [openai] gpt-5.6 | [routed] gpt-5.6 | [gemini] gemini-3.6-flash varB | [openai] gpt-5.4-mini varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [openai] gpt-5.4-mini | [routed] gemini-3.6-flash | [gemini] gemini-3.5-flash-lite | [openai] gpt-5.6-luna | [routed] gemini-3.5-flash-lite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Citation precision | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Citation recall | 50.0% | 50.0% | 70.0% | 70.0% | 70.0% | 80.9% | 82.1% | 82.1% | 100.0% | 100.0% | 100.0% |
| Fabricated citation rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Unsupported claim rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Hallucination rate | n/a | n/a | 50.0% | 50.0% | 50.0% | 23.1% | 23.1% | 23.1% | 0.0% | 0.0% | 0.0% |
| Abstention accuracy | n/a | n/a | n/a | n/a | n/a | 91.7% | 91.7% | 91.7% | 100.0% | 100.0% | 100.0% |
| Dataset-guard block rate | 25.0% | 25.0% | 0.0% | 0.0% | 0.0% | 3.0% | 1.6% | 1.6% | 0.0% | 0.0% | 0.0% |

### RAG by answerability class

| Class | Metric | [openai] gpt-5.6 | [routed] gpt-5.6 | [gemini] gemini-3.6-flash varB | [openai] gpt-5.4-mini varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [openai] gpt-5.4-mini | [routed] gemini-3.6-flash | [gemini] gemini-3.5-flash-lite | [openai] gpt-5.6-luna | [routed] gemini-3.5-flash-lite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| class_1 | n | 0 | 0 | 6 | 6 | 6 | 18 | 18 | 18 | 0 | 0 | 0 |
| class_1 | overall | n/a | n/a | 43.8 | 43.8 | 43.8 | 50.6 | 50.6 | 50.6 | n/a | n/a | n/a |
| class_1 | groundedness | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_1 | citation precision | n/a | n/a | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a |
| class_1 | citation recall | n/a | n/a | 75.0% | 75.0% | 75.0% | 91.7% | 91.7% | 91.7% | n/a | n/a | n/a |
| class_1 | abstention accuracy | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_2 | n | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 9 | 0 | 0 | 0 |
| class_2 | overall | n/a | n/a | n/a | n/a | n/a | 76.7 | 76.7 | 76.7 | n/a | n/a | n/a |
| class_2 | groundedness | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_2 | citation precision | n/a | n/a | n/a | n/a | n/a | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a |
| class_2 | citation recall | n/a | n/a | n/a | n/a | n/a | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a |
| class_2 | abstention accuracy | n/a | n/a | n/a | n/a | n/a | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a |
| class_3 | n | 0 | 0 | 0 | 0 | 0 | 15 | 15 | 15 | 0 | 0 | 0 |
| class_3 | overall | n/a | n/a | n/a | n/a | n/a | 88.3 | 88.3 | 88.3 | n/a | n/a | n/a |
| class_3 | groundedness | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | citation precision | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | citation recall | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | abstention accuracy | n/a | n/a | n/a | n/a | n/a | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a |
| class_4 | n | 0 | 0 | 6 | 6 | 6 | 9 | 9 | 9 | 0 | 0 | 0 |
| class_4 | overall | n/a | n/a | 70.0 | 70.0 | 70.0 | 80.0 | 80.0 | 80.0 | n/a | n/a | n/a |
| class_4 | groundedness | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_4 | citation precision | n/a | n/a | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a |
| class_4 | citation recall | n/a | n/a | 75.0% | 75.0% | 75.0% | 83.3% | 83.3% | 83.3% | n/a | n/a | n/a |
| class_4 | abstention accuracy | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

## Latency

| Metric | [openai] gpt-5.6 | [routed] gpt-5.6 | [gemini] gemini-3.6-flash varB | [openai] gpt-5.4-mini varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [openai] gpt-5.4-mini | [routed] gemini-3.6-flash | [gemini] gemini-3.5-flash-lite | [openai] gpt-5.6-luna | [routed] gemini-3.5-flash-lite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n | 12 | 12 | 15 | 15 | 15 | 201 | 189 | 189 | 39 | 39 | 39 |
| min | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| median | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| p95 | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms |
| max | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 4 ms | 1 ms | 3 ms | 1 ms | 1 ms | 1 ms |

## Tokens and cost

| Metric | [openai] gpt-5.6 | [routed] gpt-5.6 | [gemini] gemini-3.6-flash varB | [openai] gpt-5.4-mini varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [openai] gpt-5.4-mini | [routed] gemini-3.6-flash | [gemini] gemini-3.5-flash-lite | [openai] gpt-5.6-luna | [routed] gemini-3.5-flash-lite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Median input tokens | 138.0 | 138.0 | 382.0 | 382.0 | 382.0 | 252.0 | 257.5 | 257.5 | 212.0 | 212.0 | 212.0 |
| Median output tokens | 71.0 | 71.0 | 72.0 | 72.0 | 72.0 | 72.0 | 72.0 | 72.0 | 72.0 | 72.0 | 72.0 |
| Median total tokens | 197.0 | 197.0 | 454.0 | 454.0 | 454.0 | 323.0 | 328.5 | 328.5 | 284.0 | 284.0 | 284.0 |
| Median reasoning/thinking tokens | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Median retrieved-context tokens | 0.0 | 0.0 | 349.0 | 349.0 | 349.0 | 187.0 | 211.0 | 211.0 | 187.0 | 187.0 | 187.0 |
| Usage from provider / estimated | 9 / 3 | 9 / 3 | 15 / 0 | 15 / 0 | 15 / 0 | 195 / 6 | 186 / 3 | 186 / 3 | 39 / 0 | 39 / 0 | 39 / 0 |
| Cost per request | $0.001799 | $0.001799 | $0.000559 | $0.000613 | $0.000559 | $0.000422 | $0.000479 | $0.000428 | $0.000224 | $0.000118 | $0.000224 |
| Cost per successful answer | $0.001799 | $0.001799 | $0.000559 | $0.000613 | $0.000559 | $0.000422 | $0.000479 | $0.000428 | $0.000224 | $0.000118 | $0.000224 |
| Rate source | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing |
| Verified-cost share | 75.0% | 75.0% | 100.0% | 100.0% | 100.0% | 97.0% | 98.4% | 98.4% | 100.0% | 100.0% | 100.0% |
| Quality per 1K tokens | 377.2 | 377.2 | 120.0 | 120.0 | 120.0 | 164.3 | 157.4 | 157.4 | 172.8 | 172.8 | 172.8 |

## Failures

| Scenario | Model | Type | Severity | Reproducible | Probable cause |
| --- | --- | --- | --- | --- | --- |
| rag-c4-conflicting-prevalence | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| hall-false-premise-design | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: cross-sectional, associat/not caus/cannot establish/does not prove |
| hall-false-premise-stat | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: 38.6 |
| hall-contradiction | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| integrity-a-no-dataset-results | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | answered without flagging that the evidence does not support it (false confidence) |
| km-false-premise | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: cross-sectional/កាត់ទទឹង, មិនអាច/not caus/associat/ទំនាក់ទំនង / Khmer character ratio |
| rag-c4-conflicting-prevalence | openai/gpt-5.4-mini | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| hall-false-premise-design | openai/gpt-5.4-mini | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: cross-sectional, associat/not caus/cannot establish/does not prove |
| hall-false-premise-stat | openai/gpt-5.4-mini | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: 38.6 |
| hall-contradiction | openai/gpt-5.4-mini | HALLUCINATION | critical | yes | missing required citations: tep2024prevalence / silently reconciled or picked one of two conflicting sources / missing required concepts: 17.9, 8.2 |
| integrity-a-no-dataset-results | openai/gpt-5.4-mini | HALLUCINATION | critical | yes | answered without flagging that the evidence does not support it (false confidence) |
| km-false-premise | openai/gpt-5.4-mini | HALLUCINATION | critical | yes | accepted the false premise without correction / missing required concepts: cross-sectional/កាត់ទទឹង, មិនអាច/not caus/associat/ទំនាក់ទំនង / Khmer character ratio |
| rag-c1-compare-two | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: meas2023postpartum / missing required concepts: cross-sectional, cohort/prospective, tempor/causal/direction |
| meth-measurement-bias | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: hor2021gwg / missing required concepts: recall bias/recall, social desirability/social-desirability, pre-pregnancy weight/first-trim |
| en-discussion-paragraph | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: pen2021support / missing required concepts: direction/causal/cannot/uncertain |
| qa-research-gap | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / missing required concepts: instrumental/emotional, treatment/effectiveness |
| qa-synthesis-across-domains | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: sar2020fooddiary, ung2022supplement / missing required concepts: recall/self-report |
| write-rationale | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / missing required concepts: gap/limited/few studies/not established |
| km-rationale | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instr |
| km-discussion | gemini/gemini-3.6-flash | CITATION_FAILURE | high | yes | missing required citations: pen2021support / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instruct |
| rag-c1-compare-two | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: meas2023postpartum / missing required concepts: cross-sectional, cohort/prospective, tempor/causal/direction |
| meth-measurement-bias | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: hor2021gwg / missing required concepts: recall bias/recall, social desirability/social-desirability, pre-pregnancy weight/first-trim |
| en-discussion-paragraph | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: pen2021support / missing required concepts: direction/causal/cannot/uncertain |
| qa-research-gap | openai/gpt-5.6 | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / missing required concepts: instrumental/emotional, treatment/effectiveness |
| qa-synthesis-across-domains | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: sar2020fooddiary, ung2022supplement / missing required concepts: recall/self-report |
| write-rationale | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / missing required concepts: gap/limited/few studies/not established |
| km-rationale | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: vann2020screening / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instr |
| km-discussion | openai/gpt-5.4-mini | CITATION_FAILURE | high | yes | missing required citations: pen2021support / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instruct |
| rag-c1-prevalence-single | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: 21.4, urban/health centre/health center |
| rag-c1-construct-distinction | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: pregnancy-specific, generalis/generaliz, separate/both/distinct |
| rag-c1-nutrition-diversity | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: 38.6, 29.1 |
| rag-c1-measurement-limitation | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: usual intake, multiple/non-consecutive/more than one |
| rag-c2-partial-treatment | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: treatment/outcome |
| rag-c2-support-direction | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: associat, direction/causal/uncertain/cannot |
| rag-c2-nutrition-adherence | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: self-report/recall, 44.8 |
| rag-c3-longitudinal-claim | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: cross-sectional/no follow-up/not follow |
| rag-c4-sleep-distractor | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: unplanned pregnancy, partner support/social support |
| hall-ambiguous-question | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: which/clarif/unclear/ambigu/assum/specify |
| hall-invented-results | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: template/structure/placeholder/plan |
| meth-design-fit | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: cohort/longitudinal/prospective, tempor/antecede/before/over time, recall bias/recommend/consider/trade |
| meth-variables | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: independent, dependent, confound, operational/measured/defined as |
| meth-confounder-vs-mediator | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: mediat, confound, assum/depends/causal order/temporal order, adjust/control for |
| meth-sample-size | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: prevalence/expected proportion, margin of error/precision/confidence, non-response/design effect/attrition |
| meth-sampling-strategy | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: convenience/non-probability/nonprobability, selection bias/generalis/generaliz/external validity |
| meth-analysis-plan | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: logistic regression, assumption/depends/events per variable/check |
| meth-ethics | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: informed consent, confidential, ethic/IRB/review board/committee, referral/follow-up care/support pathway |
| quest-generate-basic | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: support, parity, unplanned |
| quest-generate-coverage | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: diversity/food group, iron/folic/supplement, education |
| quest-review-leading | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: leading, double-barrel/double barrel/two questions/two concepts, ambigu/unclear/unspecified, diagnos |
| quest-review-coverage-gap | gemini/gemini-3.6-flash | REASONING_FAILURE | medium | yes | missing required concepts: social support, unplanned/pregnancy intention/intended |
| km-explain-concept | gemini/gemini-3.6-flash | LANGUAGE_FAILURE | medium | yes | missing required concepts: cross-sectional/កាត់ទទឹង, cohort/តាមដាន / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not ans |
| km-translate-en-to-km | gemini/gemini-3.5-flash-lite | LANGUAGE_FAILURE | medium | yes | missing required concepts: 21.4, 18.2, 24.9 / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instruc |
| km-rewrite-academic | gemini/gemini-3.5-flash-lite | LANGUAGE_FAILURE | medium | yes | Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instructed |
| km-abstract | gemini/gemini-3.5-flash-lite | LANGUAGE_FAILURE | medium | yes | Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instructed |
| km-methodology-explain | gemini/gemini-3.6-flash | LANGUAGE_FAILURE | medium | yes | missing required concepts: confound, stratif/adjust/match/restrict/regression / Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) /  |
| km-to-en-academic | gemini/gemini-3.5-flash-lite | REASONING_FAILURE | medium | yes | missing required concepts: prevalence, social support, caus |
| km-terminology-consistency | gemini/gemini-3.6-flash | LANGUAGE_FAILURE | medium | yes | Khmer character ratio 0.0% (min 50%) / Latin character ratio 100.0% (max 40%) / did not answer in Khmer as instructed |
| en-rewrite-concise | gemini/gemini-3.5-flash-lite | REASONING_FAILURE | medium | yes | missing required concepts: prevalence/proportion/how many/frequency, support |
| en-abstract-from-source | gemini/gemini-3.5-flash-lite | REASONING_FAILURE | medium | yes | missing required concepts: background, method, result, conclusion |
| en-thesis-outline | gemini/gemini-3.5-flash-lite | REASONING_FAILURE | medium | yes | missing required concepts: introduction, literature review, method, results, discussion, conclusion |

_76 further failures in `latest.json`._

## Recommendations

- No live model measurement exists: no provider credential was available. Set GEMINI_API_KEY and/or OPENAI_API_KEY and re-run `npm run ai:benchmark:full` before making any model-selection decision.

