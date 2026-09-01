import { beforeEach, describe, expect, it, vi } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn(), SECTION_CHAIN: [] as string[] }));
vi.mock("../../db/projects", async () => {
  const actual = await vi.importActual<typeof import("../../db/projects")>("../../db/projects");
  return { ...actual, getProject: dbProjects.getProject };
});

const dbSections = vi.hoisted(() => ({ listSections: vi.fn(async () => [] as unknown[]) }));
vi.mock("../../db/sections", () => dbSections);

const integrityGuard = vi.hoisted(() => ({
  verifyCitationsInText: vi.fn(async () => [] as unknown[]),
}));
vi.mock("../integrity-guard", () => integrityGuard);

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../orchestrator", () => ({
  AIOrchestrator: vi.fn(function AIOrchestrator() {
    return { generate: generateMock };
  }),
}));

const { runQualityCheck } = await import("../quality-check");
const { SECTION_CHAIN } = await import("../../db/projects");

const supabase = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue({ id: "proj-1", title: "A Study" });
  integrityGuard.verifyCitationsInText.mockResolvedValue([]);
});

describe("runQualityCheck", () => {
  it("throws when the project is not found", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    await expect(runQualityCheck(supabase, "missing")).rejects.toThrow(/not found/);
  });

  it("returns zero scores and an informational issue when no sections have content, without calling the model", async () => {
    dbSections.listSections.mockResolvedValueOnce(
      SECTION_CHAIN.map((s) => ({ section_type: s, content: "", status: "not_started" })),
    );

    const result = await runQualityCheck(supabase, "proj-1");

    expect(result.scores.overall).toBe(0);
    expect(result.issues.some((i) => i.category === "structure")).toBe(true);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("always includes the AI Quality Estimate disclaimer", async () => {
    dbSections.listSections.mockResolvedValueOnce([]);
    const result = await runQualityCheck(supabase, "proj-1");
    expect(result.disclaimer).toMatch(/AI Quality Estimate/);
  });

  it("flags partially-completed projects structurally without calling that a hard error", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: SECTION_CHAIN[0], content: "some title text", status: "completed" },
      ...SECTION_CHAIN.slice(1).map((s) => ({ section_type: s, content: "", status: "not_started" })),
    ]);
    generateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        scores: { methodology: 10, evidence: 10, alignment: 10, writing: 10, references: 10, dataIntegrity: 10, overall: 10 },
        issues: [],
      }),
    });

    const result = await runQualityCheck(supabase, "proj-1");
    const structural = result.issues.find((i) => i.category === "structure");
    expect(structural?.message).toContain("haven't been started yet");
  });

  it("combines structural, citation, and AI-reported issues", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: SECTION_CHAIN[0], content: "text with a [fake_cite]", status: "completed" },
    ]);
    integrityGuard.verifyCitationsInText.mockResolvedValueOnce([
      { severity: "high", category: "citation", message: "fake_cite not found" },
    ]);
    generateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        scores: { methodology: 50, evidence: 50, alignment: 50, writing: 50, references: 50, dataIntegrity: 50, overall: 50 },
        issues: [{ severity: "medium", category: "writing", section: "", message: "verbose", recommendation: "" }],
      }),
    });

    const result = await runQualityCheck(supabase, "proj-1");
    const categories = result.issues.map((i) => i.category);
    expect(categories).toContain("citation");
    expect(categories).toContain("writing");
  });

  it("returns placeholder scores and a system issue instead of throwing on a malformed AI response", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: SECTION_CHAIN[0], content: "text", status: "completed" },
    ]);
    generateMock.mockResolvedValueOnce({ content: "not valid json" });

    const result = await runQualityCheck(supabase, "proj-1");
    expect(result.scores.overall).toBe(0);
    expect(result.issues.some((i) => i.category === "system")).toBe(true);
  });

  it("requests structured output with the quality_check task type", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: SECTION_CHAIN[0], content: "text", status: "completed" },
    ]);
    generateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        scores: { methodology: 1, evidence: 1, alignment: 1, writing: 1, references: 1, dataIntegrity: 1, overall: 1 },
        issues: [],
      }),
    });

    await runQualityCheck(supabase, "proj-1");

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "quality_check", responseSchema: expect.any(Object) }),
    );
  });
});
