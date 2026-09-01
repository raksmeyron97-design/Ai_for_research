import { beforeEach, describe, expect, it, vi } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbSections = vi.hoisted(() => ({ getSection: vi.fn() }));
vi.mock("../../db/sections", () => dbSections);

const generateMock = vi.hoisted(() => vi.fn());
vi.mock("../orchestrator", () => ({
  AIOrchestrator: vi.fn(function AIOrchestrator() {
    return { generate: generateMock };
  }),
}));

const { generateConclusion, ConclusionGenerationError, detectUnsourcedNumbers } = await import(
  "../conclusion-generator"
);

describe("detectUnsourcedNumbers (heuristic, not proof — see the module doc comment)", () => {
  it("flags a number in the conclusion that doesn't appear in the source", () => {
    const warnings = detectUnsourcedNumbers(
      "The conclusion shows 87% improvement.",
      "Results found that 62% of participants reported the barrier.",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("87%");
  });

  it("does not flag a number that legitimately appears in the source", () => {
    const warnings = detectUnsourcedNumbers(
      "62% of participants reported the barrier, which is concerning.",
      "Results found that 62% of participants reported the barrier.",
    );
    expect(warnings).toHaveLength(0);
  });

  it("excludes plausible research-paper years from the check", () => {
    const warnings = detectUnsourcedNumbers(
      "This aligns with trends observed since 2020.",
      "No mention of any year here.",
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not exclude a percentage that happens to look like a year", () => {
    const warnings = detectUnsourcedNumbers("2020% is not a plausible percentage but should still be checked.", "");
    expect(warnings).toHaveLength(1);
  });

  it("de-duplicates repeated unsourced numbers into one warning", () => {
    const warnings = detectUnsourcedNumbers("87% here and 87% again.", "nothing matches");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("a number");
  });

  it("reports multiple distinct unsourced numbers together", () => {
    const warnings = detectUnsourcedNumbers("87% and 42 participants were unexpected.", "no matching numbers");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("numbers");
  });

  it("returns no warnings when the conclusion contains no numbers at all", () => {
    const warnings = detectUnsourcedNumbers("A purely qualitative conclusion.", "some source text");
    expect(warnings).toHaveLength(0);
  });

  it("always includes a recommendation to verify, not a hard rejection", () => {
    const warnings = detectUnsourcedNumbers("87% found here.", "nothing");
    expect(warnings[0].recommendation).toBeTruthy();
    expect(warnings[0].severity).toBe("high");
  });
});

describe("generateConclusion", () => {
  const supabase = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    dbProjects.getProject.mockResolvedValue({ id: "proj-1", title: "Maternal Health Study" });
    dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, type: string) => {
      if (type === "objectives") return { content: "Assess barriers to care." };
      if (type === "results") return { content: "62% reported a barrier." };
      return null;
    });
    generateMock.mockResolvedValue({ content: "Conclusion text at 62%." });
  });

  it("throws when objectives are empty — nothing to conclude against", async () => {
    dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, type: string) =>
      type === "objectives" ? { content: "" } : null,
    );
    await expect(generateConclusion(supabase, "proj-1")).rejects.toThrow(ConclusionGenerationError);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("throws when neither Results nor Discussion has content", async () => {
    dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, type: string) =>
      type === "objectives" ? { content: "Assess barriers." } : null,
    );
    await expect(generateConclusion(supabase, "proj-1")).rejects.toThrow(ConclusionGenerationError);
  });

  it("succeeds when Discussion has content even if Results doesn't", async () => {
    dbSections.getSection.mockImplementation(async (_s: unknown, _p: string, type: string) => {
      if (type === "objectives") return { content: "Assess barriers." };
      if (type === "discussion") return { content: "62% reported a barrier, discussed at length." };
      return null;
    });
    const result = await generateConclusion(supabase, "proj-1");
    expect(result.content).toBeTruthy();
  });

  it("flags a genuinely new number the model introduced", async () => {
    generateMock.mockResolvedValueOnce({ content: "We conclude 99% of the problem is solved." });
    const result = await generateConclusion(supabase, "proj-1");
    expect(result.warnings.some((w) => w.category === "data_integrity")).toBe(true);
  });

  it("does not flag numbers that trace back to the real objectives/results content", async () => {
    generateMock.mockResolvedValueOnce({ content: "62% reported a barrier, as found." });
    const result = await generateConclusion(supabase, "proj-1");
    expect(result.warnings).toHaveLength(0);
  });

  it("requests the conclusion task type", async () => {
    await generateConclusion(supabase, "proj-1");
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ taskType: "conclusion" }));
  });
});
