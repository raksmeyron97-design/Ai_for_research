import { beforeEach, describe, expect, it, vi } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbDatasets = vi.hoisted(() => ({ getDataset: vi.fn() }));
vi.mock("../../db/datasets", () => dbDatasets);

const dbSections = vi.hoisted(() => ({ getSection: vi.fn(async () => null) }));
vi.mock("../../db/sections", () => dbSections);

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../orchestrator", () => ({
  AIOrchestrator: vi.fn(function AIOrchestrator() {
    return { generate: generateMock };
  }),
}));

const { generateResultsAnalysis, ResultsGenerationError } = await import("../results-generator");

const supabase = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue({ id: "proj-1", title: "Maternal Health Study" });
  dbDatasets.getDataset.mockResolvedValue({
    id: "ds-1",
    project_id: "proj-1",
    row_count: 3,
    column_schema: [{ name: "age", type: "numeric", missingCount: 0 }],
    data: [{ age: 20 }, { age: 30 }, { age: 40 }],
  });
  generateMock.mockResolvedValue({ content: "The mean age was 30." });
});

describe("generateResultsAnalysis", () => {
  it("throws when the project is not found", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    await expect(generateResultsAnalysis(supabase, "missing", "ds-1")).rejects.toThrow(
      ResultsGenerationError,
    );
  });

  it("throws when the dataset is not found", async () => {
    dbDatasets.getDataset.mockResolvedValueOnce(null);
    await expect(generateResultsAnalysis(supabase, "proj-1", "missing")).rejects.toThrow(
      ResultsGenerationError,
    );
  });

  it("throws when the dataset belongs to a different project", async () => {
    dbDatasets.getDataset.mockResolvedValueOnce({
      id: "ds-1",
      project_id: "other-project",
      row_count: 1,
      column_schema: [],
      data: [],
    });
    await expect(generateResultsAnalysis(supabase, "proj-1", "ds-1")).rejects.toThrow(
      ResultsGenerationError,
    );
  });

  it("passes dataSetId through to the orchestrator, satisfying the Phase 5 dataset guard", async () => {
    await generateResultsAnalysis(supabase, "proj-1", "ds-1");
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "results_generation", dataSetId: "ds-1" }),
    );
  });

  it("includes the real computed mean in the context sent to the model", async () => {
    await generateResultsAnalysis(supabase, "proj-1", "ds-1");
    const call = generateMock.mock.calls[0][0];
    expect(call.context).toContain("mean=30");
  });

  it("never lets the model's response override the computed summary numbers", async () => {
    generateMock.mockResolvedValueOnce({ content: "The mean age was actually 9999 (fabricated)." });
    const result = await generateResultsAnalysis(supabase, "proj-1", "ds-1");
    // The summary is computed independently and returned alongside the
    // model's prose — a hallucinated number in the prose can't corrupt it.
    const ageSummary = result.summary.age;
    if (ageSummary.type !== "numeric") throw new Error("expected numeric");
    expect(ageSummary.mean).toBe(30);
  });

  it("returns the model's interpretation text alongside the real summary", async () => {
    const result = await generateResultsAnalysis(supabase, "proj-1", "ds-1");
    expect(result.interpretation).toBe("The mean age was 30.");
    expect(result.datasetId).toBe("ds-1");
    expect(result.rowCount).toBe(3);
  });
});
