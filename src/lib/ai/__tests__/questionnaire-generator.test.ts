import { beforeEach, describe, expect, it, vi } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbSections = vi.hoisted(() => ({
  getSection: vi.fn(async (_s: unknown, _p: string, _sectionType: string): Promise<{ content: string } | null> => null),
}));
vi.mock("../../db/sections", () => dbSections);

const dbInstruments = vi.hoisted(() => ({ createInstrument: vi.fn() }));
vi.mock("../../db/instruments", () => dbInstruments);

const dbQuestions = vi.hoisted(() => ({
  insertQuestions: vi.fn(async (_s: unknown, _rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> => []),
}));
vi.mock("../../db/questions", () => dbQuestions);

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../orchestrator", () => ({
  AIOrchestrator: vi.fn(function AIOrchestrator() {
    return { generate: generateMock };
  }),
}));

const { generateQuestionnaire, QuestionnaireGenerationError } = await import("../questionnaire-generator");

const supabase = {} as never;

const validInstrumentResponse = {
  instrument: {
    name: "Maternal Health Survey",
    validation_status: "researcher_developed",
    source_reference: "",
    adaptation_notes: "",
  },
  sections: [
    {
      section_label: "Demographics",
      questions: [
        {
          objective_label: "Assess age",
          variable_label: "age",
          construct: "demographics",
          question_text: "What is your age?",
          response_type: "numeric",
          options: [],
          required: true,
        },
      ],
    },
    {
      section_label: "Knowledge",
      questions: [
        {
          objective_label: "Assess screening knowledge",
          variable_label: "knowledge_score",
          construct: "screening_knowledge",
          question_text: "Do you know the signs of postpartum depression?",
          response_type: "yes_no",
          options: [],
          required: true,
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue({
    id: "proj-1",
    title: "Maternal Mental Health Study",
    discipline: "midwifery",
    study_design: "cross_sectional",
    target_population: ["pregnant women"],
  });
  dbInstruments.createInstrument.mockImplementation(async (_s: unknown, input: Record<string, unknown>) => ({
    id: "instrument-1",
    project_id: "proj-1",
    created_at: "",
    updated_at: "",
    ...input,
  }));
  dbQuestions.insertQuestions.mockImplementation(async (_s: unknown, rows: unknown[]) =>
    rows.map((r, i) => ({ id: `q-${i}`, created_at: "", ...(r as object) })),
  );
});

describe("generateQuestionnaire", () => {
  it("throws when the project is not found", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    await expect(generateQuestionnaire(supabase, "missing")).rejects.toThrow(
      QuestionnaireGenerationError,
    );
  });

  it("requests structured output with the questionnaire task type", async () => {
    generateMock.mockResolvedValueOnce({ content: JSON.stringify(validInstrumentResponse) });
    await generateQuestionnaire(supabase, "proj-1");

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "questionnaire", responseSchema: expect.any(Object) }),
    );
  });

  it("persists the instrument and flattens all sections' questions with sequential order_index", async () => {
    generateMock.mockResolvedValueOnce({ content: JSON.stringify(validInstrumentResponse) });

    const result = await generateQuestionnaire(supabase, "proj-1");

    expect(dbInstruments.createInstrument).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ project_id: "proj-1", name: "Maternal Health Survey" }),
    );

    const inserted = dbQuestions.insertQuestions.mock.calls[0][1];
    expect(inserted).toHaveLength(2);
    expect(inserted[0].order_index).toBe(0);
    expect(inserted[1].order_index).toBe(1);
    expect(inserted[0].section_label).toBe("Demographics");
    expect(inserted[1].section_label).toBe("Knowledge");
    expect(result.instrument.id).toBe("instrument-1");
  });

  it("converts empty label strings to null before persisting", async () => {
    generateMock.mockResolvedValueOnce({ content: JSON.stringify(validInstrumentResponse) });
    await generateQuestionnaire(supabase, "proj-1");

    const insertCall = dbInstruments.createInstrument.mock.calls[0][1];
    expect(insertCall.source_reference).toBeNull();
    expect(insertCall.adaptation_notes).toBeNull();
  });

  it("throws QuestionnaireGenerationError and persists nothing when the model returns invalid JSON", async () => {
    generateMock.mockResolvedValueOnce({ content: "not json" });

    await expect(generateQuestionnaire(supabase, "proj-1")).rejects.toThrow(QuestionnaireGenerationError);
    expect(dbInstruments.createInstrument).not.toHaveBeenCalled();
    expect(dbQuestions.insertQuestions).not.toHaveBeenCalled();
  });

  it("throws and persists nothing when validation_status=validated has no source_reference (Section 26)", async () => {
    generateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        instrument: { name: "X", validation_status: "validated", source_reference: "", adaptation_notes: "" },
        sections: [],
      }),
    });

    await expect(generateQuestionnaire(supabase, "proj-1")).rejects.toThrow(QuestionnaireGenerationError);
    expect(dbInstruments.createInstrument).not.toHaveBeenCalled();
  });

  it("includes objectives/variables/rationale section content in the context when present", async () => {
    dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, sectionType: string) => {
      if (sectionType === "objectives") return { content: "Assess knowledge gaps." };
      if (sectionType === "variables") return { content: "Age, parity, education." };
      return null;
    });
    generateMock.mockResolvedValueOnce({ content: JSON.stringify(validInstrumentResponse) });

    await generateQuestionnaire(supabase, "proj-1");

    const call = generateMock.mock.calls[0][0];
    expect(call.context).toContain("Assess knowledge gaps.");
    expect(call.context).toContain("Age, parity, education.");
  });
});
