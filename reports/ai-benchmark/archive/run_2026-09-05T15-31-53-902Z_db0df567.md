# AI Benchmark — latest run

- **Mode:** LIVE
- **Status:** NOT READY
- **Run:** `run_2026-09-05T15-31-53-902Z_db0df567` (suite: smoke, benchmark v16.0.0)
- **Commit:** a7797f9
- **Timestamp:** 2026-09-05T15:33:22.281Z
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
| gemini | gemini | gemini-3.6-flash | LIVE | 3 | 3 | 66.9 | 0.0% |
| routed | gemini | gemini-3.6-flash | LIVE | 1 | 1 | 64.6 | 0.0% |
| gemini | gemini | gemini-3.6-flash | LIVE | 1 | 1 | 63.9 | 0.0% |
| routed | gemini | gemini-3.6-flash | LIVE | 2 | 2 | 53.3 | 0.0% |
| routed | gemini | gemini-3.1-pro-preview | DEGRADED | 1 | 5 | 50.0 | 0.0% |
| openai | openai | gpt-5.4-mini | UNAVAILABLE | 2 | 4 | n/a | 100.0% |
| openai | openai | gpt-5.4-mini | UNAVAILABLE | 1 | 2 | n/a | 100.0% |
| openai | openai | gpt-5.6 | UNAVAILABLE | 1 | 2 | n/a | 100.0% |

## Rubric dimensions (0-100)

| Dimension | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| factualCorrectness | 66.7 | 100.0 | 100.0 | 50.0 | 50.0 | n/a | n/a | n/a |
| groundedness | 66.7 | 100.0 | 100.0 | 100.0 | n/a | n/a | n/a | n/a |
| citationCorrectness | 100.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | n/a | n/a |
| researchReasoning | 100.0 | n/a | n/a | n/a | 50.0 | n/a | n/a | n/a |
| khmerQuality | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| englishQuality | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| hallucinationResistance | 40.0 | 20.0 | 20.0 | 20.0 | n/a | n/a | n/a | n/a |
| instructionFollowing | 100.0 | n/a | n/a | n/a | 0.0 | n/a | n/a | n/a |
| conciseness | 64.3 | 100.0 | 90.9 | 89.1 | 100.0 | n/a | n/a | n/a |

## Category scores (0-100)

| Category | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hallucination | 44.0 | n/a | n/a | 42.3 | n/a | n/a | n/a | n/a |
| rag_grounding | 99.4 | 64.6 | 63.9 | 64.2 | n/a | n/a | n/a | n/a |
| structured_output | 57.1 | n/a | n/a | n/a | 50.0 | n/a | n/a | n/a |

## RAG, citation and hallucination

| Metric | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Citation precision | 100.0% | 50.0% | 50.0% | 50.0% | n/a | n/a | n/a | n/a |
| Citation recall | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a |
| Fabricated citation rate | 33.3% | 100.0% | 100.0% | 100.0% | 0.0% | n/a | n/a | n/a |
| Unsupported claim rate | 33.3% | 0.0% | 0.0% | 0.0% | 0.0% | n/a | n/a | n/a |
| Hallucination rate | 100.0% | n/a | n/a | 100.0% | n/a | n/a | n/a | n/a |
| Abstention accuracy | 100.0% | n/a | n/a | 100.0% | n/a | n/a | n/a | n/a |
| Dataset-guard block rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

### RAG by answerability class

| Class | Metric | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| class_1 | n | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| class_1 | overall | 99.4 | 64.6 | 63.9 | 64.2 | n/a | n/a | n/a | n/a |
| class_1 | groundedness | 100.0 | 100.0 | 100.0 | 100.0 | n/a | n/a | n/a | n/a |
| class_1 | citation precision | 100.0% | 50.0% | 50.0% | 50.0% | n/a | n/a | n/a | n/a |
| class_1 | citation recall | 100.0% | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a |
| class_1 | abstention accuracy | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | n | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| class_3 | overall | 44.0 | n/a | n/a | 42.3 | n/a | n/a | n/a | n/a |
| class_3 | groundedness | 100.0 | n/a | n/a | 100.0 | n/a | n/a | n/a | n/a |
| class_3 | citation precision | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | citation recall | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| class_3 | abstention accuracy | 100.0% | n/a | n/a | 100.0% | n/a | n/a | n/a | n/a |

## Latency

| Metric | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n | 3 | 1 | 1 | 2 | 1 | 0 | 0 | 0 |
| min | 5990 ms | 8258 ms | 7442 ms | 7475 ms | 34833 ms | 0 ms | 0 ms | 0 ms |
| median | 8301 ms | 8258 ms | 7442 ms | 8258 ms | 34833 ms | 0 ms | 0 ms | 0 ms |
| p95 | 8411 ms | 8258 ms | 7442 ms | 9041 ms | 34833 ms | 0 ms | 0 ms | 0 ms |
| max | 8411 ms | 8258 ms | 7442 ms | 9041 ms | 34833 ms | 0 ms | 0 ms | 0 ms |

## Tokens and cost

| Metric | [gemini] gemini-3.6-flash | [routed] gemini-3.6-flash varB | [gemini] gemini-3.6-flash varB | [routed] gemini-3.6-flash | [routed] gemini-3.1-pro-preview | [openai] gpt-5.4-mini | [openai] gpt-5.4-mini varB | [openai] gpt-5.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Median input tokens | 713.0 | 713.0 | 713.0 | 793.0 | 644.0 | n/a | n/a | n/a |
| Median output tokens | 330.0 | 170.0 | 217.0 | 358.5 | 70.0 | n/a | n/a | n/a |
| Median total tokens | 974.0 | 883.0 | 930.0 | 1151.5 | 714.0 | n/a | n/a | n/a |
| Median reasoning/thinking tokens | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Median retrieved-context tokens | 248.0 | 248.0 | 248.0 | 326.5 | 0.0 | 0.0 | 0.0 | 0.0 |
| Usage from provider / estimated | 3 / 0 | 1 / 0 | 1 / 0 | 2 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Cost per request | $0.005060 | $0.004011 | $0.004225 | $0.005235 | n/a | n/a | n/a | n/a |
| Cost per successful answer | $0.005060 | $0.004011 | $0.004225 | $0.005235 | n/a | n/a | n/a | n/a |
| Rate source | verified_app_pricing | verified_app_pricing | verified_app_pricing | verified_app_pricing | unknown_model | unknown_model | unknown_model | unknown_model |
| Verified-cost share | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | n/a | n/a | n/a |
| Quality per 1K tokens | 68.6 | 73.2 | 68.7 | 46.3 | 70.0 | n/a | n/a | n/a |

## Failures

| Scenario | Model | Type | Severity | Reproducible | Probable cause |
| --- | --- | --- | --- | --- | --- |
| rag-c1-prevalence-single | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | fabricated citation keys: VERIFIED |
| rag-c3-cost-effectiveness | gemini/gemini-3.6-flash | HALLUCINATION | critical | yes | produced forbidden content: cost per case |
| struct-quality-check | gemini/gemini-3.6-flash | GROUNDING_FAILURE | high | not yet | 1/1 numeric claims not traceable to the provided evidence / 100 (in: "{"scores":{"methodology":45,"evidence":30,"alignment":50,"writing":60,"references":20,"dat |
| struct-quality-check | gemini/gemini-3.1-pro-preview | PARSING_FAILURE | high | not yet | response was not valid JSON for the quality_check schema |
| rag-c1-prevalence-single | openai/gpt-5.4-mini | RATE_LIMIT | medium | yes | All AI providers failed: openai: OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com |
| rag-c3-cost-effectiveness | openai/gpt-5.4-mini | RATE_LIMIT | medium | not yet | All AI providers failed: openai: OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com |
| struct-quality-check | openai/gpt-5.6 | RATE_LIMIT | medium | not yet | All AI providers failed: openai: OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com |

## Recommendations

- Highest overall score: gemini/gemini-3.6-flash (66.9).
- Best grounding for RAG/citation work: gemini/gemini-3.6-flash.
- Best quality per 1K tokens (high-volume/low-cost tier): gemini/gemini-3.6-flash.
- Prompt/context A/B: variant B (citation-keyed context + citation contract) changed citation correctness by -50.0 points. This does not yet justify a production prompt change.

