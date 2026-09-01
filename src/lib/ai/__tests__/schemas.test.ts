import { describe, expect, it } from "vitest";
import { questionnaireResponseSchema } from "../schemas";

function baseInstrument(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "ANC Knowledge Survey",
    validation_status: "researcher_developed",
    source_reference: "",
    adaptation_notes: "",
    ...overrides,
  };
}

function withSections(instrument: unknown, sections: unknown[] = []) {
  return { instrument, sections };
}

describe("questionnaireResponseSchema — validated instrument safety", () => {
  it("accepts researcher_developed with an empty source_reference", () => {
    const result = questionnaireResponseSchema.safeParse(withSections(baseInstrument()));
    expect(result.success).toBe(true);
  });

  it("rejects validated with an empty source_reference", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(baseInstrument({ validation_status: "validated", source_reference: "" })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects adapted with a whitespace-only source_reference", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(baseInstrument({ validation_status: "adapted", source_reference: "   " })),
    );
    expect(result.success).toBe(false);
  });

  it("accepts validated when a real source_reference is given", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(
        baseInstrument({ validation_status: "validated", source_reference: "EPDS (Cox et al., 1987)" }),
      ),
    );
    expect(result.success).toBe(true);
  });

  it("accepts adapted when a real source_reference is given", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(
        baseInstrument({ validation_status: "adapted", source_reference: "WHO ANC guideline checklist" }),
      ),
    );
    expect(result.success).toBe(true);
  });
});

describe("questionnaireResponseSchema — questions", () => {
  it("accepts a fully-formed section with questions", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(baseInstrument(), [
        {
          section_label: "Demographics",
          questions: [
            {
              objective_label: "Assess age distribution",
              variable_label: "age",
              construct: "demographics",
              question_text: "What is your age?",
              response_type: "numeric",
              options: [],
              required: true,
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an unknown response_type", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(baseInstrument(), [
        {
          section_label: "Demographics",
          questions: [
            {
              objective_label: "",
              variable_label: "",
              construct: "",
              question_text: "What is your age?",
              response_type: "essay",
              options: [],
              required: true,
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an empty question_text", () => {
    const result = questionnaireResponseSchema.safeParse(
      withSections(baseInstrument(), [
        {
          section_label: "Demographics",
          questions: [
            {
              objective_label: "",
              variable_label: "",
              construct: "",
              question_text: "",
              response_type: "open_text",
              options: [],
              required: false,
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(false);
  });
});
