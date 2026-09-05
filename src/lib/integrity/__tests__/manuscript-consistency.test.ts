import { describe, expect, it } from "vitest";
import { buildManuscriptConsistencyFindings } from "../manuscript-consistency";
import { EMPTY_MODEL } from "../../methodology/model";
import type { MethodologyModel } from "../../methodology/model";

function claim(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    claim_text: "Motivation was associated with performance.",
    section_type: "results",
    ...over,
  };
}

describe("buildManuscriptConsistencyFindings — causal language", () => {
  it("flags causal language in Results/Discussion when no question is classified as causal", () => {
    const claims = [claim({ id: "c1", claim_text: "The intervention caused a significant increase in scores." })];
    const findings = buildManuscriptConsistencyFindings(claims as never, EMPTY_MODEL, []);
    const causal = findings.filter((f) => f.id.startsWith("methodology:causal-language:"));
    expect(causal).toHaveLength(1);
    expect(causal[0].severity).toBe("warning");
  });

  it("does not flag causal language when a causal research question exists", () => {
    const model: MethodologyModel = {
      ...EMPTY_MODEL,
      questions: [
        {
          id: "q1", project_id: "p1", question_text: "Does the intervention cause improvement?",
          question_kind: "causal", provenance: "user", confirmed: true, order_index: 0,
        } as never,
      ],
    };
    const claims = [claim({ claim_text: "The intervention caused a significant increase in scores." })];
    const findings = buildManuscriptConsistencyFindings(claims as never, model, []);
    expect(findings.filter((f) => f.id.startsWith("methodology:causal-language:"))).toHaveLength(0);
  });

  it("does not flag causal language outside results/discussion/conclusion", () => {
    const claims = [claim({ claim_text: "The intervention caused an increase.", section_type: "methodology" })];
    const findings = buildManuscriptConsistencyFindings(claims as never, EMPTY_MODEL, []);
    expect(findings.filter((f) => f.id.startsWith("methodology:causal-language:"))).toHaveLength(0);
  });
});

describe("buildManuscriptConsistencyFindings — construct terminology drift", () => {
  const model: MethodologyModel = {
    ...EMPTY_MODEL,
    constructs: [
      {
        id: "k1", project_id: "p1", name: "Teacher Motivation", role: "independent",
        conceptual_definition: null, operational_definition: null, notes: null,
        provenance: "user", confirmed: true,
      } as never,
    ],
  };

  it("flags a near-duplicate phrasing that never uses the construct's own name", () => {
    const claims = [claim({ claim_text: "Motivation of teachers predicted classroom outcomes." })];
    const findings = buildManuscriptConsistencyFindings(claims as never, model, []);
    expect(findings.some((f) => f.id.startsWith("methodology:construct-terminology:"))).toBe(true);
  });

  it("does not flag a claim that uses the construct's exact name", () => {
    const claims = [claim({ claim_text: "Teacher Motivation predicted classroom outcomes." })];
    const findings = buildManuscriptConsistencyFindings(claims as never, model, []);
    expect(findings.some((f) => f.id.startsWith("methodology:construct-terminology:"))).toBe(false);
  });
});

describe("buildManuscriptConsistencyFindings — hypothesis traceability", () => {
  const model: MethodologyModel = {
    ...EMPTY_MODEL,
    hypotheses: [
      {
        id: "h1", project_id: "p1", objective_id: null, question_id: null, label: "H1",
        statement: "Motivation predicts performance.", hypothesis_form: "association",
        direction: "unspecified", analysis_method: null, provenance: "user", confirmed: true, order_index: 0,
      } as never,
    ],
  };

  it("flags a hypothesis with no linked manuscript claim", () => {
    const findings = buildManuscriptConsistencyFindings([], model, []);
    expect(findings.some((f) => f.id === "methodology:hypothesis-no-manuscript-claim:h1")).toBe(true);
  });

  it("does not flag a hypothesis once a claim is linked to it", () => {
    const findings = buildManuscriptConsistencyFindings([], model, [{ hypothesis_id: "h1" }]);
    expect(findings.some((f) => f.id === "methodology:hypothesis-no-manuscript-claim:h1")).toBe(false);
  });
});

describe("buildManuscriptConsistencyFindings — Phase 18 relay", () => {
  it("relays runConsistencyChecks findings unchanged, namespaced and recategorized", () => {
    const model: MethodologyModel = {
      ...EMPTY_MODEL,
      questions: [
        {
          id: "q1", project_id: "p1", question_text: "What predicts performance?",
          question_kind: "unclassified", provenance: "user", confirmed: true, order_index: 0,
        } as never,
      ],
    };
    const findings = buildManuscriptConsistencyFindings([], model, []);
    const relayed = findings.find((f) => f.id === "methodology:question-no-objective-q1");
    expect(relayed).toBeTruthy();
    expect(relayed?.category).toBe("methodology");
    expect(relayed?.provenance).toBe("deterministic");
  });
});
