import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSection {
  section_type: string;
  content: string;
}
interface FakeCitation {
  citation_key: string;
  title: string | null;
  year: number | null;
  status: string;
}
interface FakeMessage {
  role: string;
  content: string;
}
interface FakeChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page: number | null;
  section: string | null;
  similarity: number;
}

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("../../db/projects", () => dbProjects);

const dbSections = vi.hoisted(() => ({
  getSection: vi.fn(async (): Promise<FakeSection | null> => null),
}));
vi.mock("../../db/sections", () => dbSections);

const dbCitations = vi.hoisted(() => ({
  getCitationsByIds: vi.fn(async (): Promise<FakeCitation[]> => []),
}));
vi.mock("../../db/citations", () => dbCitations);

const dbMessages = vi.hoisted(() => ({
  getRecentMessages: vi.fn(async (): Promise<FakeMessage[]> => []),
}));
vi.mock("../../db/messages", () => dbMessages);

const dbChunks = vi.hoisted(() => ({
  searchChunks: vi.fn(async (): Promise<FakeChunk[]> => []),
}));
vi.mock("../../db/chunks", () => dbChunks);

const embeddingsMock = vi.hoisted(() => ({ embedQuery: vi.fn(async () => [0.1, 0.2]) }));
vi.mock("../embeddings", () => embeddingsMock);

const { buildContext } = await import("../context-manager");

const baseProject = {
  id: "proj-1",
  title: "Maternal Nutrition Study",
  language: "en" as const,
  discipline: "midwifery",
  study_design: "cross_sectional",
  target_population: ["pregnant women"],
  location: "Phnom Penh",
  sample_size: 200,
  sampling_method: "convenience",
  status: "active" as const,
  user_id: "u1",
  created_at: "",
  updated_at: "",
};

const supabase = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbProjects.getProject.mockResolvedValue(baseProject);
  dbSections.getSection.mockResolvedValue(null);
  dbCitations.getCitationsByIds.mockResolvedValue([]);
  dbMessages.getRecentMessages.mockResolvedValue([]);
  dbChunks.searchChunks.mockResolvedValue([]);
});

describe("buildContext", () => {
  it("always includes the project profile when the project exists", async () => {
    const context = await buildContext(supabase, { projectId: "proj-1" });
    expect(context).toContain("## Project Profile");
    expect(context).toContain("Maternal Nutrition Study");
    expect(context).toContain("pregnant women");
  });

  it("returns an empty string when the project cannot be found (RLS denies or doesn't exist)", async () => {
    dbProjects.getProject.mockResolvedValueOnce(null);
    const context = await buildContext(supabase, { projectId: "missing" });
    expect(context).toBe("");
  });

  it("includes the current section when sectionType is given and the section exists", async () => {
    dbSections.getSection.mockResolvedValueOnce({
      section_type: "methodology",
      content: "This study uses a cross-sectional design.",
    });
    const context = await buildContext(supabase, { projectId: "proj-1", sectionType: "methodology" });
    expect(context).toContain("## Current Section: methodology");
    expect(context).toContain("cross-sectional design");
  });

  it("does not query for a section when sectionType is omitted", async () => {
    await buildContext(supabase, { projectId: "proj-1" });
    expect(dbSections.getSection).not.toHaveBeenCalled();
  });

  it("does not run retrieval when no query is given", async () => {
    await buildContext(supabase, { projectId: "proj-1" });
    expect(embeddingsMock.embedQuery).not.toHaveBeenCalled();
    expect(dbChunks.searchChunks).not.toHaveBeenCalled();
  });

  it("embeds the query and includes retrieved excerpts when a query is given", async () => {
    dbChunks.searchChunks.mockResolvedValueOnce([
      { id: "c1", document_id: "d1", chunk_index: 0, content: "Adherence to iron supplements was low.", page: 4, section: null, similarity: 0.9 },
    ]);
    const context = await buildContext(supabase, { projectId: "proj-1", query: "supplement adherence" });
    expect(embeddingsMock.embedQuery).toHaveBeenCalledWith("supplement adherence");
    expect(context).toContain("## Relevant Document Excerpts");
    expect(context).toContain("Adherence to iron supplements was low.");
  });

  it("post-filters retrieved chunks to the given documentIds", async () => {
    dbChunks.searchChunks.mockResolvedValueOnce([
      { id: "c1", document_id: "keep-me", chunk_index: 0, content: "kept chunk", page: null, section: null, similarity: 0.9 },
      { id: "c2", document_id: "drop-me", chunk_index: 0, content: "dropped chunk", page: null, section: null, similarity: 0.8 },
    ]);
    const context = await buildContext(supabase, {
      projectId: "proj-1",
      query: "x",
      documentIds: ["keep-me"],
    });
    expect(context).toContain("kept chunk");
    expect(context).not.toContain("dropped chunk");
  });

  it("includes requested sources by id", async () => {
    dbCitations.getCitationsByIds.mockResolvedValueOnce([
      { citation_key: "who2024", title: "WHO ANC Guidelines", year: 2024, status: "verified" },
    ]);
    const context = await buildContext(supabase, { projectId: "proj-1", sourceIds: ["cite-1"] });
    expect(dbCitations.getCitationsByIds).toHaveBeenCalledWith(supabase, ["cite-1"]);
    expect(context).toContain("## Relevant Sources");
    expect(context).toContain("who2024");
  });

  it("includes recent conversation turns when a conversationId is given", async () => {
    dbMessages.getRecentMessages.mockResolvedValueOnce([
      { role: "user", content: "What objectives fit this topic?" },
      { role: "assistant", content: "Here are three candidate objectives." },
    ]);
    const context = await buildContext(supabase, { projectId: "proj-1", conversationId: "conv-1" });
    expect(context).toContain("## Recent Conversation");
    expect(context).toContain("What objectives fit this topic?");
  });

  it("prunes recent messages, then chunks, before dropping the project profile", async () => {
    const spy = vi.spyOn(await import("../model-config"), "getMaxContextTokens");
    spy.mockReturnValue(40); // tiny budget — forces pruning

    dbChunks.searchChunks.mockResolvedValueOnce([
      { id: "c1", document_id: "d1", chunk_index: 0, content: "x".repeat(300), page: null, section: null, similarity: 0.9 },
    ]);
    dbMessages.getRecentMessages.mockResolvedValueOnce([{ role: "user", content: "y".repeat(300) }]);

    const context = await buildContext(supabase, {
      projectId: "proj-1",
      query: "x",
      conversationId: "conv-1",
    });

    expect(context).toContain("## Project Profile"); // never dropped
    expect(context).not.toContain("## Recent Conversation"); // dropped first
    expect(context).not.toContain("## Relevant Document Excerpts"); // dropped next

    spy.mockRestore();
  });
});
