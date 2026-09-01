# AI Benchmark — latest run

- **Status:** NOT READY
- **Run:** `run_2026-09-01T10-17-18-256Z_8cc4f100` (suite: smoke, benchmark v16.0.0)
- **Commit:** f67f3cd
- **Timestamp:** 2026-09-01T10:17:36.651Z
- **Execution modes:** UNAVAILABLE=12

> **Read this before quoting any number below.**
> - **Cost figures are unavailable.** No verified rate file was supplied (`AI_BENCH_RATE_FILE`), so no USD figure is reported rather than one derived from the placeholder rates in `src/lib/ai/token-manager.ts`.
> - **1 repetition(s) per scenario.** Latency percentiles from fewer than 3 runs describe this run, not the model.
> - **Smoke suite only.** A subset of scenarios ran; category coverage is incomplete.

## Provider status

| Provider | Status | Credential | SDK | API mode | Models | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| gemini | LIVE | yes | 2.19.0 | google-genai models.generateContent (Gemini Developer API) | 52 listed | Credential accepted; 52 models listed. |
| openai | LIVE | yes | 7.8.0 | openai responses.create (Responses API) | 118 listed | Credential accepted; 118 models listed. Configured model(s) not enumerated by this key's model list, benchmarked anyway (an unlisted id may still be a served alias): gpt-5.6. |

## Overall

| Model | Mode | Scenarios | Overall | Failure rate | Retry rate |
| --- | --- | --- | --- | --- | --- |
| gemini / gemini-3.5-flash-lite (variant A) | UNAVAILABLE | 3 | n/a | 100.0% | 0.0% |
| gemini / gemini-3.5-flash-lite (variant B) | UNAVAILABLE | 1 | n/a | 100.0% | 0.0% |
| gemini / gemini-3.6-flash (variant A) | UNAVAILABLE | 3 | n/a | 100.0% | 0.0% |
| gemini / gemini-3.6-flash (variant B) | UNAVAILABLE | 1 | n/a | 100.0% | 0.0% |
| openai / gpt-5.6 (variant A) | UNAVAILABLE | 3 | n/a | 100.0% | 0.0% |
| openai / gpt-5.6 (variant B) | UNAVAILABLE | 1 | n/a | 100.0% | 0.0% |

## Rubric dimensions (0-100)

| Dimension | gemini / gemini-3.5-flash-lite (variant A) | gemini / gemini-3.5-flash-lite (variant B) | gemini / gemini-3.6-flash (variant A) | gemini / gemini-3.6-flash (variant B) | openai / gpt-5.6 (variant A) | openai / gpt-5.6 (variant B) |
| --- | --- | --- | --- | --- | --- | --- |
| factualCorrectness | n/a | n/a | n/a | n/a | n/a | n/a |
| groundedness | n/a | n/a | n/a | n/a | n/a | n/a |
| citationCorrectness | n/a | n/a | n/a | n/a | n/a | n/a |
| researchReasoning | n/a | n/a | n/a | n/a | n/a | n/a |
| khmerQuality | n/a | n/a | n/a | n/a | n/a | n/a |
| englishQuality | n/a | n/a | n/a | n/a | n/a | n/a |
| hallucinationResistance | n/a | n/a | n/a | n/a | n/a | n/a |
| instructionFollowing | n/a | n/a | n/a | n/a | n/a | n/a |
| conciseness | n/a | n/a | n/a | n/a | n/a | n/a |

## Category scores (0-100)

| Category | gemini / gemini-3.5-flash-lite (variant A) | gemini / gemini-3.5-flash-lite (variant B) | gemini / gemini-3.6-flash (variant A) | gemini / gemini-3.6-flash (variant B) | openai / gpt-5.6 (variant A) | openai / gpt-5.6 (variant B) |
| --- | --- | --- | --- | --- | --- | --- |

## RAG, citation and hallucination

| Metric | gemini / gemini-3.5-flash-lite (variant A) | gemini / gemini-3.5-flash-lite (variant B) | gemini / gemini-3.6-flash (variant A) | gemini / gemini-3.6-flash (variant B) | openai / gpt-5.6 (variant A) | openai / gpt-5.6 (variant B) |
| --- | --- | --- | --- | --- | --- | --- |
| Citation precision | n/a | n/a | n/a | n/a | n/a | n/a |
| Citation recall | n/a | n/a | n/a | n/a | n/a | n/a |
| Fabricated citation rate | n/a | n/a | n/a | n/a | n/a | n/a |
| Unsupported claim rate | n/a | n/a | n/a | n/a | n/a | n/a |
| Hallucination rate | n/a | n/a | n/a | n/a | n/a | n/a |
| Abstention accuracy | n/a | n/a | n/a | n/a | n/a | n/a |

## Latency

| Metric | gemini / gemini-3.5-flash-lite (variant A) | gemini / gemini-3.5-flash-lite (variant B) | gemini / gemini-3.6-flash (variant A) | gemini / gemini-3.6-flash (variant B) | openai / gpt-5.6 (variant A) | openai / gpt-5.6 (variant B) |
| --- | --- | --- | --- | --- | --- | --- |
| n | 0 | 0 | 0 | 0 | 0 | 0 |
| min | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| median | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| p95 | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| max | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |

## Tokens and cost

| Metric | gemini / gemini-3.5-flash-lite (variant A) | gemini / gemini-3.5-flash-lite (variant B) | gemini / gemini-3.6-flash (variant A) | gemini / gemini-3.6-flash (variant B) | openai / gpt-5.6 (variant A) | openai / gpt-5.6 (variant B) |
| --- | --- | --- | --- | --- | --- | --- |
| Median input tokens | n/a | n/a | n/a | n/a | n/a | n/a |
| Median output tokens | n/a | n/a | n/a | n/a | n/a | n/a |
| Median total tokens | n/a | n/a | n/a | n/a | n/a | n/a |
| Median reasoning/thinking tokens | n/a | n/a | n/a | n/a | n/a | n/a |
| Median retrieved-context tokens | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Usage from provider / estimated | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Cost per request | n/a | n/a | n/a | n/a | n/a | n/a |
| Cost per successful answer | n/a | n/a | n/a | n/a | n/a | n/a |
| Rate source | unknown_model | unknown_model | unknown_model | unknown_model | unknown_model | unknown_model |
| Quality per 1K tokens | n/a | n/a | n/a | n/a | n/a | n/a |

## Failures

| Scenario | Model | Type | Severity | Reproducible | Probable cause |
| --- | --- | --- | --- | --- | --- |
| rag-c1-prevalence-single | gemini/gemini-3.5-flash-lite | RATE_LIMIT | medium | yes | Gemini generate failed: {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage you |
| rag-c3-cost-effectiveness | gemini/gemini-3.5-flash-lite | RATE_LIMIT | medium | not yet | Gemini generate failed: {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage you |
| struct-quality-check | gemini/gemini-3.5-flash-lite | RATE_LIMIT | medium | not yet | Gemini generate failed: {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage you |
| rag-c1-prevalence-single | gemini/gemini-3.6-flash | RATE_LIMIT | medium | yes | Gemini generate failed: {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage you |
| rag-c3-cost-effectiveness | gemini/gemini-3.6-flash | RATE_LIMIT | medium | not yet | Gemini generate failed: {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage you |
| struct-quality-check | gemini/gemini-3.6-flash | RATE_LIMIT | medium | not yet | Gemini generate failed: {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage you |
| rag-c1-prevalence-single | openai/gpt-5.6 | RATE_LIMIT | medium | yes | OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/. |
| rag-c3-cost-effectiveness | openai/gpt-5.6 | RATE_LIMIT | medium | not yet | OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/. |
| struct-quality-check | openai/gpt-5.6 | RATE_LIMIT | medium | not yet | OpenAI generate failed: 429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/. |

## Recommendations

- No live model measurement exists despite a working credential for gemini and openai: every generation call failed. See the failure table for the provider error before re-running.

