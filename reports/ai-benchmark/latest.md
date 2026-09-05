# AI Benchmark — latest run

- **Mode:** LIVE
- **Status:** NOT READY
- **Run:** `run_2026-09-05T16-18-26-795Z_6a74f04f` (suite: smoke, benchmark v16.0.0)
- **Commit:** c707620
- **Timestamp:** 2026-09-05T16:19:43.644Z
- **Completeness:** complete (12 planned calls, none skipped)
- **Execution modes:** LIVE=7, UNAVAILABLE=4, DEGRADED=1

> **Read this before quoting any number below.**
> - **No cost figure for gemini-3.1-pro-preview.** Neither `src/lib/ai/pricing.ts` nor any supplied rate file prices these models, so they contribute nothing to the cost totals rather than contributing a guess.
> - **1 repetition(s) per scenario.** Latency percentiles from fewer than 3 runs describe this run, not the model.
> - **Smoke suite only.** A subset of scenarios ran; category coverage is incomplete.

## Provider status

| Provider | Status | Credential | SDK | API mode | Models | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| gemini | LIVE | yes | 2.19.0 | google-genai models.generateContent (Gemini Developer API) | 54 listed | Credential accepted; 54 models listed. |
| openai | LIVE | yes | 7.8.0 | openai responses.create (Responses API) | 119 listed | Credential accepted; 119 models listed. Configured model(s) not enumerated by this key's model list, benchmarked anyway (an unlisted id may still be a served alias): gpt-5.6. |

## Overall

| Group | Provider | Model | Mode | Scenarios | Provider calls | Overall | Failure rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gemini | gemini | gemini-3.6-flash | LIVE | 1 | 1 | 100.0 | 0.0% |
| routed | gemini | gemini-3.6-flash | LIVE | 1 | 1 | 99.7 | 0.0% |
| gemini | gemini | gemini-3.6-flash | LIVE | 3 | 3 | 85.7 | 0.0% |
| routed | gemini | gemini-3.6-flash | LIVE | 2 | 2 | 74.9 | 0.0% |
| routed | gemini | gemini-3.1-pro-preview | DEGRADED | 1 | 5 | 11.1 | 0.0% |
| openai | openai | gpt-5.4-mini | UNAVAILABLE | 2 | 4 | n/a | 100.0% |
| openai | openai | gpt-5.4-mini | UNAVAILABLE | 1 | 2 | n/a | 100.0% |
| openai | openai | gpt-5.6 | UNAVAILABLE | 1 | 2 | n/a | 100.0% |

## Rubric dimensions (0-100)

| Dimension | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| factualCorrectness | 100.0 | 100.0 | 100.0 | 50.0 | 0.0 | n/a | n/a | n/a |
| groundedness | 100.0 | 100.0 | 66.7 | 100.0 | n/a | n/a | n/a | n/a |
| citationCorrectness | 100.0 | 100.0 | 100.0 | 100.0 | n/a | n/a | n/a | n/a |
| researchReasoning | n/a | n/a | 100.0 | n/a | 0.0 | n/a | n/a | n/a |
| khmerQuality | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| englishQuality | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| hallucinationResistance | 100.0 | 100.0 | 66.7 | 75.0 | n/a | n/a | n/a | n/a |
| instructionFollowing | n/a | n/a | 100.0 | n/a | 0.0 | n/a | n/a | n/a |
| conciseness | 100.0 | 96.1 | 66.5 | 99.3 | 100.0 | n/a | n/a | n/a |

## Category scores (0-100)

| Category | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hallucination | n/a | n/a | 100.0 | 49.9 | n/a | n/a | n/a | n/a |
| rag_grounding | 100.0 | 99.7 | 100.0 | 99.9 | n/a | n/a | n/a | n/a |
| structured_output | n/a | n/a | 57.1 | n/a | 11.1 | n/a | n/a | n/a |

## RAG, citation and hallucination

| Metric | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Citation precision | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a |
| Citation recall | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a |
| Fabricated citation rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | n/a | n/a | n/a |
| Unsupported claim rate | 0.0% | 0.0% | 33.3% | 0.0% | 0.0% | n/a | n/a | n/a |
| Hallucination rate | n/a | n/a | 0.0% | 100.0% | n/a | n/a | n/a | n/a |
| Abstention accuracy | n/a | n/a | 100.0% | 0.0% | n/a | n/a | n/a | n/a |
| Dataset-guard block rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

### RAG by answerability class

| Class | Metric | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| class_1 | n | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| class_1 | overall | 100.0 | 99.7 | 100.0 | 99.9 | n/a | n/a | n/a | n/a |
| class_1 | groundedness | 100.0 | 100.0 | 100.0 | 100.0 | n/a | n/a | n/a | n/a |
| class_1 | citation precision | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a |
| class_1 | citation recall | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a |
| class_1 | abstention accuracy | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | n | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| class_3 | overall | n/a | n/a | 100.0 | 49.9 | n/a | n/a | n/a | n/a |
| class_3 | groundedness | n/a | n/a | 100.0 | 100.0 | n/a | n/a | n/a | n/a |
| class_3 | citation precision | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | citation recall | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | abstention accuracy | n/a | n/a | 100.0% | 0.0% | n/a | n/a | n/a | n/a |

## Latency

| Metric | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n | 1 | 1 | 3 | 2 | 1 | 0 | 0 | 0 |
| min | 5696 ms | 7275 ms | 5294 ms | 7506 ms | 34065 ms | 0 ms | 0 ms | 0 ms |
| median | 5696 ms | 7275 ms | 9456 ms | 7763 ms | 34065 ms | 0 ms | 0 ms | 0 ms |
| p95 | 5696 ms | 7275 ms | 9569 ms | 8020 ms | 34065 ms | 0 ms | 0 ms | 0 ms |
| max | 5696 ms | 7275 ms | 9569 ms | 8020 ms | 34065 ms | 0 ms | 0 ms | 0 ms |

## Tokens and cost

| Metric | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Median input tokens | 713.0 | 713.0 | 713.0 | 793.0 | 644.0 | n/a | n/a | n/a |
| Median output tokens | 176.0 | 197.0 | 376.0 | 281.5 | 67.0 | n/a | n/a | n/a |
| Median total tokens | 889.0 | 910.0 | 1223.0 | 1074.5 | 711.0 | n/a | n/a | n/a |
| Median reasoning/thinking tokens | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Median retrieved-context tokens | 248.0 | 248.0 | 248.0 | 326.5 | 0.0 | 0.0 | 0.0 | 0.0 |
| Usage from provider / estimated | 1 / 0 | 1 / 0 | 3 / 0 | 2 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Cost per request | $0.003842 | $0.005376 | $0.005431 | $0.005175 | n/a | n/a | n/a | n/a |
| Cost per successful answer | $0.003842 | $0.005376 | $0.005431 | $0.005175 | n/a | n/a | n/a | n/a |
| Rate source | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | unknown_model | unknown_model | unknown_model | unknown_model |
| Verified-cost share | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | n/a | n/a | n/a |
| Quality per 1K tokens | 112.5 | 109.6 | 70.1 | 69.7 | 15.6 | n/a | n/a | n/a |

## Failures

| Scenario | Model | Type | Severity | Reproducible | Probable cause |
| --- | --- | --- | --- | --- | --- |
| rag-c3-cost-effectiveness | gemini/gemini-3.6-flash | HALLUCINATION | critical | not yet | answered without flagging that the evidence does not support it (false confidence) / produced forbidden content: cost per case / $ / cost-effectiveness ratio |
| struct-quality-check | gemini/gemini-3.6-flash | GROUNDING_FAILURE | high | not yet | 1/1 numeric claims not traceable to the provided evidence / 100 (in: ""message": "Using convenience sampling of 100 women at a single health centre creates high |
| struct-quality-check | gemini/gemini-3.1-pro-preview | PARSING_FAILURE | high | not yet | missing required concepts: social support / response was not valid JSON for the quality_check schema |
| rag-c1-prevalence-single | openai/gpt-5.4-mini | RATE_LIMIT | medium | yes | All AI providers failed: openai: OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com |
| rag-c3-cost-effectiveness | openai/gpt-5.4-mini | RATE_LIMIT | medium | not yet | All AI providers failed: openai: OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com |
| struct-quality-check | openai/gpt-5.6 | RATE_LIMIT | medium | not yet | All AI providers failed: openai: OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com |

## Recommendations

- Highest overall score: gemini/gemini-3.6-flash (100.0).
- Best grounding for RAG/citation work: gemini/gemini-3.6-flash.
- Best quality per 1K tokens (high-volume/low-cost tier): gemini/gemini-3.6-flash.
- Prompt/context A/B: variant B (citation-keyed context + citation contract) changed citation correctness by 0.0 points. This does not yet justify a production prompt change.

