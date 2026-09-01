import { describe, expect, it, vi, beforeEach } from "vitest";

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbSections = vi.hoisted(() => ({ listSections: vi.fn() }));
vi.mock("../../db/sections", () => dbSections);

const dbCitations = vi.hoisted(() => ({ listCitations: vi.fn() }));
vi.mock("../../db/citations", () => dbCitations);

const dbInstruments = vi.hoisted(() => ({ listInstruments: vi.fn() }));
vi.mock("../../db/instruments", () => dbInstruments);

const dbQuestions = vi.hoisted(() => ({ listQuestions: vi.fn() }));
vi.mock("../../db/questions", () => dbQuestions);

const { compileDocumentModel } = await import("../document-model");

const supabase = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue({
    id: "proj-1",
    title: "Maternal Health Study",
    discipline: "Public Health",
    study_design: "Cross-sectional",
    location: "Phnom Penh",
  });
  dbSections.listSections.mockResolvedValue([]);
  dbCitations.listCitations.mockResolvedValue([]);
  dbInstruments.listInstruments.mockResolvedValue([]);
  dbQuestions.listQuestions.mockResolvedValue([]);
});

describe("compileDocumentModel", () => {
  it("throws when the project doesn't exist (or isn't visible under RLS)", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    await expect(compileDocumentModel(supabase, "missing")).rejects.toThrow("Project not found");
  });

  it("opens with the project title as an H1 followed by a page break, when no Title section has been drafted yet", async () => {
    const model = await compileDocumentModel(supabase, "proj-1");
    expect(model.blocks[0]).toEqual({ type: "heading", level: 1, text: "Maternal Health Study" });
    expect(model.blocks.some((b) => b.type === "pagebreak")).toBe(true);
  });

  it("prefers the drafted Title section content over project.title once it exists — the section is the authoritative, alignment-checked title", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: "title", content: "Barriers to Maternal Healthcare Access in Phnom Penh" },
    ]);
    const model = await compileDocumentModel(supabase, "proj-1");
    expect(model.title).toBe("Barriers to Maternal Healthcare Access in Phnom Penh");
    expect(model.blocks[0]).toEqual({
      type: "heading",
      level: 1,
      text: "Barriers to Maternal Healthcare Access in Phnom Penh",
    });
  });

  it("emits every chapter heading in research-chain order", async () => {
    const model = await compileDocumentModel(supabase, "proj-1");
    const chapterHeadings = model.blocks
      .filter((b) => b.type === "heading" && b.level === 1)
      .map((b) => (b as { text: string }).text);
    expect(chapterHeadings).toEqual([
      "Maternal Health Study",
      "Chapter 1: Introduction",
      "Chapter 2: Objectives and Conceptual Framework",
      "Chapter 3: Methodology",
      "Chapter 4: Results",
      "Chapter 5: Discussion",
      "Chapter 6: Conclusion and Recommendations",
      "References",
      "Appendices",
    ]);
  });

  it("shows an honest placeholder for a section that has no content yet, rather than fabricating or omitting it", async () => {
    const model = await compileDocumentModel(supabase, "proj-1");
    const resultsHeadingIdx = model.blocks.findIndex(
      (b) => b.type === "heading" && b.text === "Results",
    );
    expect(model.blocks[resultsHeadingIdx + 1]).toEqual({ type: "paragraph", text: "[Not yet completed]" });
  });

  it("splits real section content into one paragraph block per blank-line-separated paragraph", async () => {
    dbSections.listSections.mockResolvedValueOnce([
      { section_type: "research_problem", content: "First paragraph.\n\nSecond paragraph." },
    ]);
    const model = await compileDocumentModel(supabase, "proj-1");
    const idx = model.blocks.findIndex((b) => b.type === "heading" && b.text === "Research Problem");
    expect(model.blocks[idx + 1]).toEqual({ type: "paragraph", text: "First paragraph." });
    expect(model.blocks[idx + 2]).toEqual({ type: "paragraph", text: "Second paragraph." });
  });

  it("builds the reference list from real research_citations rows, sorted by citation key, never from prose", async () => {
    dbCitations.listCitations.mockResolvedValueOnce([
      { citation_key: "who2024", title: "WHO ANC Guideline", authors: ["WHO"], year: 2024, journal: null, doi: null, url: "https://who.int" },
      { citation_key: "adams2019", title: "Barriers to Care", authors: ["Adams, J.", "Lee, K."], year: 2019, journal: "J Public Health", doi: "10.1/xyz", url: null },
    ]);
    const model = await compileDocumentModel(supabase, "proj-1");
    const refHeadingIdx = model.blocks.findIndex((b) => b.type === "heading" && b.text === "References");
    const refBlocks = model.blocks
      .slice(refHeadingIdx + 1)
      .filter((b) => b.type === "paragraph") as { type: "paragraph"; text: string }[];
    expect(refBlocks[0].text).toContain("[adams2019]");
    expect(refBlocks[0].text).toContain("Adams, J. & Lee, K.");
    expect(refBlocks[0].text).toContain("https://doi.org/10.1/xyz");
    expect(refBlocks[1].text).toContain("[who2024]");
    expect(refBlocks[1].text).toContain("https://who.int");
  });

  it("shows a placeholder in the reference list when the project has no saved citations", async () => {
    const model = await compileDocumentModel(supabase, "proj-1");
    const refHeadingIdx = model.blocks.findIndex((b) => b.type === "heading" && b.text === "References");
    expect(model.blocks[refHeadingIdx + 1]).toEqual({ type: "paragraph", text: "[Not yet completed]" });
  });

  it("appends the full questionnaire instrument as a table under Appendices", async () => {
    dbInstruments.listInstruments.mockResolvedValueOnce([
      { id: "instr-1", name: "Barrier Survey", validation_status: "adapted", source_reference: "WHO 2020" },
    ]);
    dbQuestions.listQuestions.mockResolvedValueOnce([
      { order_index: 0, section_label: "Demographics", question_text: "Age?", response_type: "numeric", options: null, required: true },
      { order_index: 1, section_label: "Barriers", question_text: "Distance?", response_type: "likert", options: ["1", "2", "3"], required: false },
    ]);
    const model = await compileDocumentModel(supabase, "proj-1");
    const table = model.blocks.find((b) => b.type === "table");
    expect(table).toBeDefined();
    if (table?.type === "table") {
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]).toEqual(["1", "Demographics", "Age?", "numeric", "", "Yes"]);
      expect(table.rows[1]).toEqual(["2", "Barriers", "Distance?", "likert", "1; 2; 3", "No"]);
    }
  });
});
