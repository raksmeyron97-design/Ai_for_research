import { describe, expect, it } from "vitest";
import { evaluateBehavior } from "../evaluators/behavior";
import { evaluateCitations } from "../evaluators/citation";
import { evaluateGrounding } from "../evaluators/grounding";
import { evaluateLanguage } from "../evaluators/language";
import { evaluateStructure, hadCodeFence, stripCodeFence } from "../evaluators/structure";
import { countWords, extractNumbers, khmerCharRatio, latinCharRatio } from "../evaluators/text";
import { RUBRIC_WEIGHTS, weightedOverall } from "../evaluators";
import type { BenchmarkScenario } from "../types";

function scenario(overrides: Partial<BenchmarkScenario> = {}): BenchmarkScenario {
  return {
    id: "test",
    category: "rag_grounding",
    difficulty: "easy",
    language: "en",
    task: "chat",
    input: "q",
    expected_behavior: "b",
    ground_truth: "g",
    retrieval_required: true,
    citation_required: true,
    corpus: "domain_a_perinatal_mental_health",
    retrievedKeys: ["sok2024antenatal"],
    expect: {},
    ...overrides,
  };
}

describe("citation evaluator", () => {
  it("counts a correct citation as correct, not merely present", () => {
    const s = scenario({ expect: { mustCite: ["sok2024antenatal"] } });
    const { metrics, detail } = evaluateCitations(s, "Prevalence was 21.4% [sok2024antenatal].");
    expect(metrics.correct).toBe(1);
    expect(metrics.fabricated).toEqual([]);
    expect(detail.passed).toBe(true);
  });

  it("flags a citation key that exists in no corpus as fabricated", () => {
    const s = scenario({ expect: { mustCite: ["sok2024antenatal"] } });
    const { metrics, detail } = evaluateCitations(s, "As shown [chhim2019battambang], prevalence was high.");
    expect(metrics.fabricated).toEqual(["chhim2019battambang"]);
    expect(detail.score).toBe(0);
  });

  it("flags a real source cited where it does not support the claim", () => {
    const s = scenario({ expect: { mustCite: ["sok2024antenatal"], mustNotCite: ["rith2019sleep"] } });
    const { metrics } = evaluateCitations(s, "Sleep matters [rith2019sleep] and [sok2024antenatal] agrees.");
    expect(metrics.mismatched).toEqual(["rith2019sleep"]);
  });

  it("ignores numeric bracket tokens that are formatting, not citations", () => {
    const s = scenario({ expect: { mustCite: ["sok2024antenatal"] } });
    const { metrics } = evaluateCitations(s, "Excerpt [1] and [2] show this [sok2024antenatal].");
    expect(metrics.cited).toEqual(["sok2024antenatal"]);
  });

  it("reports missing required citations", () => {
    const s = scenario({ expect: { mustCite: ["sok2024antenatal"] } });
    const { detail } = evaluateCitations(s, "Prevalence was 21.4%.");
    expect(detail.passed).toBe(false);
    expect(detail.notes.join(" ")).toContain("missing required citations");
  });
});

describe("grounding evaluator", () => {
  it("accepts numbers present in the retrieved evidence", () => {
    const { detail, unsupported } = evaluateGrounding(scenario(), "Prevalence was 21.4% (95% CI 18.2-24.9).");
    expect(unsupported).toEqual([]);
    expect(detail.passed).toBe(true);
  });

  it("flags a number that appears nowhere in the evidence", () => {
    const { unsupported } = evaluateGrounding(scenario(), "Prevalence was 47.3% in this sample.");
    expect(unsupported.join(" ")).toContain("47.3");
  });

  // Phase 22 §22G. Found as a false positive in the first live run:
  // `struct-quality-check` puts the material under review in the prompt
  // rather than in a retrieved corpus, so the model quoting the researcher's
  // own "convenience sample of 100 women" back at them was scored as an
  // unsupported numeric claim, and the scenario as a GROUNDING_FAILURE.
  it("does not flag a number the request itself supplied", () => {
    const { unsupported } = evaluateGrounding(
      scenario({ input: "Review this study: a convenience sample of 512 women at one centre." }),
      "The convenience sample of 512 women is not justified by a power calculation.",
    );
    expect(unsupported).toEqual([]);
  });

  it("still flags a fabricated number in a scenario whose prompt carries figures", () => {
    // The relaxation must not become a way for an invented figure to pass
    // simply because the prompt happened to contain some other number.
    const { unsupported } = evaluateGrounding(
      scenario({ input: "Review this study: a convenience sample of 512 women at one centre." }),
      "The sample of 512 women yielded a response rate of 87.4%.",
    );
    expect(unsupported.join(" ")).toContain("87.4");
  });

  it("does not flag years or small ordinals as unsupported claims", () => {
    const { unsupported } = evaluateGrounding(scenario(), "In 2024, the first of 3 findings was reported.");
    expect(unsupported).toEqual([]);
  });

  it("reports groundedness as not-evaluable when the answer asserts no figures", () => {
    const { detail } = evaluateGrounding(scenario(), "The sources do not provide this information.");
    expect(detail.score).toBeNull();
    expect(detail.notes[0]).toContain("not evaluable");
  });

  it("honours an explicit empty allowance as 'assert no figures'", () => {
    const s = scenario({ corpus: undefined, retrievedKeys: undefined, expect: { allowedNumbers: [] } });
    const { unsupported } = evaluateGrounding(s, "About 62.5% of women were affected.");
    expect(unsupported.length).toBe(1);
  });
});

describe("behaviour evaluator", () => {
  it("detects an explicit abstention", () => {
    const s = scenario({ expect: { mustAbstain: true } });
    const { details, abstained } = evaluateBehavior(s, "The provided sources do not contain cost data.");
    expect(abstained).toBe(true);
    expect(details.find((d) => d.evaluator === "abstention")?.passed).toBe(true);
  });

  it("scores a confident non-answer as a false-confidence failure", () => {
    const s = scenario({ expect: { mustAbstain: true } });
    const { details } = evaluateBehavior(s, "The cost per case detected is approximately 42 USD.");
    expect(details.find((d) => d.evaluator === "abstention")?.passed).toBe(false);
  });

  it("detects conflict acknowledgement", () => {
    const s = scenario({ expect: { mustAcknowledgeConflict: true } });
    const { details } = evaluateBehavior(s, "The two estimates disagree: 17.9% and 8.2%.");
    expect(details.find((d) => d.evaluator === "conflict_detection")?.passed).toBe(true);
  });

  it("detects a false-premise correction", () => {
    const s = scenario({ expect: { mustCorrectPremise: true } });
    const { details } = evaluateBehavior(s, "A cross-sectional study cannot establish causation, so that is not accurate.");
    expect(details.find((d) => d.evaluator === "false_premise")?.passed).toBe(true);
  });

  it("fails forbidden content regardless of how good the rest is", () => {
    const s = scenario({ expect: { mustNotContain: ["night-shift"] } });
    const { details } = evaluateBehavior(s, "An excellent answer that mentions night-shift staff.");
    expect(details.find((d) => d.evaluator === "forbidden_content")?.passed).toBe(false);
  });

  it("scores partial concept coverage proportionally", () => {
    const s = scenario({ expect: { mustMention: [["cohort"], ["cross-sectional"], ["temporal"]] } });
    const { details } = evaluateBehavior(s, "A cohort design differs from a cross-sectional one.");
    expect(details.find((d) => d.evaluator === "concept_coverage")?.score).toBeCloseTo((2 / 3) * 100, 5);
  });
});

describe("language evaluator", () => {
  it("passes Khmer output for a Khmer scenario", () => {
    const s = scenario({ language: "km", expect: {} });
    const details = evaluateLanguage(s, "ការសិក្សាបែបកាត់ទទឹងមិនអាចបញ្ជាក់ពីមូលហេតុបានទេ។ វាវាស់នៅពេលតែមួយ។");
    expect(details.find((d) => d.evaluator === "khmer_script")?.passed).toBe(true);
  });

  it("fails an English answer to a Khmer scenario", () => {
    const s = scenario({ language: "km", expect: {} });
    const details = evaluateLanguage(s, "A cross-sectional study cannot establish causation.");
    expect(details.find((d) => d.evaluator === "khmer_script")?.passed).toBe(false);
  });

  it("flags terminology drift", () => {
    const s = scenario({ expect: { consistentTerms: ["cohort"] } });
    const details = evaluateLanguage(s, "A Cohort study. Another cohort study. A COHORT study.");
    expect(details.find((d) => d.evaluator === "terminology_consistency")?.passed).toBe(false);
  });
});

describe("structure evaluator", () => {
  it("validates against the production alignment schema", () => {
    const s = scenario({ expect: { schema: "alignment" } });
    const output = JSON.stringify({
      issues: [{ severity: "high", category: "alignment", section: "", message: "m", recommendation: "r" }],
    });
    expect(evaluateStructure(s, output)?.passed).toBe(true);
  });

  it("rejects JSON that does not satisfy the production schema", () => {
    const s = scenario({ expect: { schema: "alignment" } });
    expect(evaluateStructure(s, JSON.stringify({ issues: [{ severity: "urgent" }] }))?.passed).toBe(false);
  });

  it("rejects non-JSON for a structured scenario", () => {
    const s = scenario({ expect: { schema: "quality_check" } });
    expect(evaluateStructure(s, "Here are the scores: methodology 80.")?.passed).toBe(false);
  });

  it("detects and strips a markdown code fence", () => {
    const fenced = "```json\n{\"issues\":[]}\n```";
    expect(hadCodeFence(fenced)).toBe(true);
    expect(stripCodeFence(fenced)).toBe('{"issues":[]}');
  });

  it("returns null when the scenario expects no schema", () => {
    expect(evaluateStructure(scenario(), "prose")).toBeNull();
  });
});

describe("text primitives", () => {
  it("extracts and normalises numeric tokens", () => {
    expect(extractNumbers("21.4% of 1,200 women")).toEqual(["21.4", "1200"]);
  });

  it("counts Khmer text without spaces as more than one word", () => {
    expect(countWords("ការសិក្សាបែបកាត់ទទឹង")).toBeGreaterThan(1);
  });

  it("measures script ratios", () => {
    expect(khmerCharRatio("ការសិក្សា")).toBe(1);
    expect(latinCharRatio("study")).toBe(1);
  });
});

describe("rubric", () => {
  it("uses the Phase 16 Step 17 weights, summing to 1", () => {
    const total = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("renormalises over the dimensions a scenario can actually evaluate", () => {
    const scores = {
      factualCorrectness: 80,
      groundedness: 80,
      citationCorrectness: null,
      researchReasoning: null,
      khmerQuality: null,
      englishQuality: null,
      hallucinationResistance: null,
      instructionFollowing: null,
      conciseness: null,
    };
    expect(weightedOverall(scores)).toBeCloseTo(80, 10);
  });

  it("returns null when nothing could be evaluated", () => {
    const scores = {
      factualCorrectness: null, groundedness: null, citationCorrectness: null,
      researchReasoning: null, khmerQuality: null, englishQuality: null,
      hallucinationResistance: null, instructionFollowing: null, conciseness: null,
    };
    expect(weightedOverall(scores)).toBeNull();
  });
});
