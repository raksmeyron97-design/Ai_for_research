import { beforeEach, describe, expect, it, vi } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbSections = vi.hoisted(() => ({ getSection: vi.fn() }));
vi.mock("../../db/sections", () => dbSections);

const dbCitations = vi.hoisted(() => ({ listCitations: vi.fn(async () => [] as unknown[]) }));
vi.mock("../../db/citations", () => dbCitations);

const integrityGuard = vi.hoisted(() => ({ verifyCitationsInText: vi.fn(async () => [] as unknown[]) }));
vi.mock("../integrity-guard", () => integrityGuard);

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../orchestrator", () => ({
  AIOrchestrator: vi.fn(function AIOrchestrator() {
    return { generate: generateMock };
  }),
}));

const { generateDiscussion, DiscussionGenerationError } = await import("../discussion-generator");

const supabase = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue({ id: "proj-1", title: "Maternal Health Study" });
  dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, type: string) => {
    if (type === "results") return { content: "62% of participants reported barrier X." };
    if (type === "objectives") return { content: "Assess barriers to care." };
    return null;
  });
  generateMock.mockResolvedValue({ content: "Discussion text." });
});

describe("generateDiscussion", () => {
  it("throws when the project is not found", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    await expect(generateDiscussion(supabase, "missing")).rejects.toThrow(DiscussionGenerationError);
  });

  it("throws when the Results section is empty — a hard guard against discussing nonexistent findings", async () => {
    dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, type: string) =>
      type === "results" ? { content: "" } : null,
    );
    await expect(generateDiscussion(supabase, "proj-1")).rejects.toThrow(DiscussionGenerationError);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("throws when the Results section has never been created", async () => {
    dbSections.getSection.mockResolvedValue(null);
    await expect(generateDiscussion(supabase, "proj-1")).rejects.toThrow(DiscussionGenerationError);
  });

  it("requests the discussion task type and includes real results content", async () => {
    await generateDiscussion(supabase, "proj-1");
    const call = generateMock.mock.calls[0][0];
    expect(call.taskType).toBe("discussion");
    expect(call.context).toContain("62% of participants reported barrier X.");
  });

  it("tells the model to mark literature comparisons as needing evidence when no sources exist", async () => {
    await generateDiscussion(supabase, "proj-1");
    const call = generateMock.mock.calls[0][0];
    expect(call.context).toContain("Additional evidence required");
  });

  it("includes real saved citations in context, using their exact citation_key", async () => {
    dbCitations.listCitations.mockResolvedValueOnce([
      { id: "c1", citation_key: "who2024", title: "WHO ANC Guideline", year: 2024, authors: ["WHO"] },
    ]);
    await generateDiscussion(supabase, "proj-1");
    const call = generateMock.mock.calls[0][0];
    expect(call.context).toContain("[who2024]");
  });

  it("surfaces citation-verification warnings from the integrity guard", async () => {
    // Give it a real citation so the separate "no sources at all" warning
    // doesn't also fire — isolating just the integrity-guard's check.
    dbCitations.listCitations.mockResolvedValueOnce([
      { id: "c1", citation_key: "who2024", title: "WHO", year: 2024, authors: ["WHO"] },
    ]);
    integrityGuard.verifyCitationsInText.mockResolvedValueOnce([
      { severity: "high", category: "citation", message: "fake_cite not found" },
    ]);
    const result = await generateDiscussion(supabase, "proj-1");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("fake_cite");
  });

  it("warns when no sources exist and the model didn't mark evidence as required anyway", async () => {
    generateMock.mockResolvedValueOnce({ content: "This agrees with prior research on the topic." });
    const result = await generateDiscussion(supabase, "proj-1");
    expect(result.warnings.some((w) => w.category === "citation")).toBe(true);
  });

  it("does not add the no-sources warning when the model correctly flagged evidence as required", async () => {
    generateMock.mockResolvedValueOnce({ content: "Additional evidence required for this comparison." });
    const result = await generateDiscussion(supabase, "proj-1");
    expect(result.warnings).toHaveLength(0);
  });
});
