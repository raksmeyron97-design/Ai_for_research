import {
  alignmentResponseSchema,
  qualityCheckResponseSchema,
  questionnaireResponseSchema,
} from "@/lib/ai/schemas";
import type { BenchmarkScenario, EvaluationDetail } from "../types";

/**
 * Structured output is validated with the *production* Zod schemas, so a
 * pass here means the app could actually persist the response — not merely
 * that it was JSON. This is the one dimension where the benchmark's notion
 * of correct is identical to production's, by construction.
 */
const SCHEMAS = {
  questionnaire: questionnaireResponseSchema,
  quality_check: qualityCheckResponseSchema,
  alignment: alignmentResponseSchema,
} as const;

export function evaluateStructure(scenario: BenchmarkScenario, output: string): EvaluationDetail | null {
  const which = scenario.expect.schema;
  if (!which) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(output));
  } catch {
    return {
      evaluator: "structured_output",
      passed: false,
      score: 0,
      notes: [`response was not valid JSON for the ${which} schema`],
    };
  }

  const result = SCHEMAS[which].safeParse(parsed);
  if (!result.success) {
    return {
      evaluator: "structured_output",
      passed: false,
      score: 0,
      notes: [
        `JSON did not satisfy the production ${which} schema`,
        ...result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      ],
    };
  }

  return {
    evaluator: "structured_output",
    passed: true,
    score: 100,
    notes: [`valid against the production ${which} schema`],
  };
}

/**
 * Providers asked for JSON sometimes wrap it in a markdown fence. That is
 * a real production parsing hazard (`quality-check.ts` and
 * `questionnaire-generator.ts` both call `JSON.parse` on the raw content),
 * so the benchmark strips it here but the fence is reported as a note by
 * the caller rather than being silently forgiven.
 */
export function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1] : text.trim();
}

export function hadCodeFence(text: string): boolean {
  return /^```/.test(text.trim());
}
