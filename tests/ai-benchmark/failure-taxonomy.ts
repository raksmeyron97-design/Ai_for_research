import type { FailureRecord, FailureType, ScenarioResult, BenchmarkScenario } from "./types";

/**
 * Maps an API-level error to a failure type. String matching on provider
 * error text is inherently brittle, so anything unrecognised stays
 * API_FAILURE rather than being guessed into a more specific bucket.
 */
export function classifyApiError(message: string): FailureType {
  const m = message.toLowerCase();
  if (m.includes("timeout") || m.includes("timed out") || m.includes("aborted")) return "TIMEOUT";
  if (m.includes("429") || m.includes("rate limit") || m.includes("quota") || m.includes("resource_exhausted")) return "RATE_LIMIT";
  if (m.includes("context length") || m.includes("too many tokens") || m.includes("maximum context")) return "CONTEXT_OVERFLOW";
  if (m.includes("safety") || m.includes("blocked") || m.includes("recitation") || m.includes("refus")) return "SAFETY_REFUSAL";
  if (m.includes("json") || m.includes("parse") || m.includes("schema")) return "PARSING_FAILURE";
  return "API_FAILURE";
}

/**
 * Classifies a *behavioural* failure — a call that succeeded but produced
 * the wrong thing. Ordered by severity of consequence for a thesis: an
 * invented citation outranks a missing one, which outranks a style problem.
 */
export function classifyResult(scenario: BenchmarkScenario, result: ScenarioResult): FailureRecord | null {
  if (!result.execution.ok) {
    const failureType = result.execution.failureType ?? "API_FAILURE";
    return {
      scenarioId: scenario.id,
      provider: result.execution.provider,
      model: result.execution.model,
      failureType,
      severity: failureType === "RATE_LIMIT" ? "medium" : "high",
      reproducible: false,
      probableCause: result.execution.errorMessage ?? "unknown provider error",
      recommendedFix:
        failureType === "TIMEOUT"
          ? "Enforce the timeout at the provider call (withRetry's AbortSignal is currently never passed to the SDK)."
          : "Inspect the provider error; retry policy and fallback are in src/lib/ai/errors.ts and router.ts.",
      observed: result.execution.errorMessage ?? "",
      expected: scenario.expected_behavior,
    };
  }

  const failed = result.details.filter((d) => !d.passed && d.score !== null);
  if (failed.length === 0) return null;

  const names = new Set(failed.map((d) => d.evaluator));
  const has = (n: string) => names.has(n);

  let failureType: FailureType;
  let severity: FailureRecord["severity"];
  let recommendedFix: string;

  if (result.citations?.fabricated.length) {
    failureType = "HALLUCINATION";
    severity = "critical";
    recommendedFix =
      "Fabricated citation keys reached the output. verifyCitationKeys() would flag these as warnings post-hoc, but nothing blocks them — consider refusing to render unverified keys in the UI.";
  } else if (has("abstention") || has("false_premise") || has("conflict_detection") || has("forbidden_content")) {
    failureType = "HALLUCINATION";
    severity = "critical";
    recommendedFix =
      "Strengthen the abstention/uncertainty rule in research-integrity-guard.ts and verify with the Class 3 scenarios.";
  } else if (has("grounding")) {
    failureType = "GROUNDING_FAILURE";
    severity = "high";
    recommendedFix = "Numbers not present in the retrieved context reached the answer; tighten the no-new-numbers rule per task prompt.";
  } else if (has("citation")) {
    failureType = "CITATION_FAILURE";
    severity = "high";
    recommendedFix =
      "Check whether the context format gave the model any citable key at all (see fixtures/context.ts) before changing the prompt.";
  } else if (has("structured_output")) {
    failureType = "PARSING_FAILURE";
    severity = "high";
    recommendedFix = "Response did not satisfy the production schema; the caller discards it and shows placeholder scores.";
  } else if (has("khmer_script") || has("terminology_consistency")) {
    failureType = "LANGUAGE_FAILURE";
    severity = "medium";
    recommendedFix = "Reinforce the language/terminology rule in prompts/default.ts for this task type.";
  } else if (has("concept_coverage")) {
    failureType = "REASONING_FAILURE";
    severity = "medium";
    recommendedFix = "Required reasoning content was absent; candidate for a task-specific prompt change.";
  } else {
    failureType = "UNEXPECTED_OUTPUT";
    severity = "low";
    recommendedFix = "Review the evaluator notes; may be an evaluator limitation rather than a model failure.";
  }

  return {
    scenarioId: scenario.id,
    provider: result.execution.provider,
    model: result.execution.model,
    failureType,
    severity,
    reproducible: false,
    probableCause: failed.flatMap((d) => d.notes).slice(0, 4).join(" | "),
    recommendedFix,
    observed: result.execution.output.slice(0, 600),
    expected: scenario.expected_behavior,
  };
}
