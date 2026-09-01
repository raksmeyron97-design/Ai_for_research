import { beforeEach, describe, expect, it, vi } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbSections = vi.hoisted(() => ({ listSections: vi.fn(async () => [] as unknown[]) }));
vi.mock("../../db/sections", () => dbSections);

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../orchestrator", () => ({
  AIOrchestrator: vi.fn(function AIOrchestrator() {
    return { generate: generateMock };
  }),
}));

const { checkAlignment } = await import("../alignment-engine");

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue({ id: "proj-1", title: "A Study" });
});

const supabase = {} as never;

describe("checkAlignment", () => {
  it("throws when the project is not found", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    await expect(checkAlignment(supabase, "missing")).rejects.toThrow(/not found/);
  });

  it("returns an informational issue instead of calling the model when no sections have content", async () => {
    dbSections.listSections.mockResolvedValueOnce([{ section_type: "title", content: "" }]);
    const issues = await checkAlignment(supabase, "proj-1");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("informational");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("requests structured output with the quality_check task type", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: "title", content: "Maternal health study" },
    ]);
    generateMock.mockResolvedValueOnce({ content: JSON.stringify({ issues: [] }) });

    await checkAlignment(supabase, "proj-1");

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        taskType: "quality_check",
        responseSchema: expect.any(Object),
      }),
    );
  });

  it("parses valid structured issues from the model response", async () => {
    dbSections.listSections.mockResolvedValueOnce([{ section_type: "title", content: "x" }]);
    generateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        issues: [
          {
            severity: "high",
            category: "alignment",
            section: "methodology",
            message: "Objective not covered by methodology.",
            recommendation: "Add a matching methodology item.",
          },
        ],
      }),
    });

    const issues = await checkAlignment(supabase, "proj-1");
    expect(issues).toEqual([
      {
        severity: "high",
        category: "alignment",
        section: "methodology",
        message: "Objective not covered by methodology.",
        recommendation: "Add a matching methodology item.",
      },
    ]);
  });

  it("converts empty section/recommendation strings to undefined", async () => {
    dbSections.listSections.mockResolvedValueOnce([{ section_type: "title", content: "x" }]);
    generateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        issues: [{ severity: "low", category: "writing", section: "", message: "minor", recommendation: "" }],
      }),
    });

    const issues = await checkAlignment(supabase, "proj-1");
    expect(issues[0].section).toBeUndefined();
    expect(issues[0].recommendation).toBeUndefined();
  });

  it("returns a fallback issue instead of throwing when the model response is malformed", async () => {
    dbSections.listSections.mockResolvedValueOnce([{ section_type: "title", content: "x" }]);
    generateMock.mockResolvedValueOnce({ content: "not valid json" });

    const issues = await checkAlignment(supabase, "proj-1");
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("system");
  });
});
