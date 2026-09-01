import { beforeEach, describe, expect, it, vi } from "vitest";

const contextManagerMock = vi.hoisted(() => ({
  buildContext: vi.fn(async () => "assembled context"),
}));
vi.mock("../context-manager", () => contextManagerMock);

const { resolveRequestContext } = await import("../prepare-request");

const baseRequest = {
  projectId: "11111111-1111-1111-1111-111111111111",
  taskType: "chat" as const,
};

const supabase = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveRequestContext", () => {
  it("uses the caller-provided context as-is, without calling buildContext", async () => {
    const result = await resolveRequestContext(supabase, { ...baseRequest, context: "already assembled" });
    expect(result.context).toBe("already assembled");
    expect(contextManagerMock.buildContext).not.toHaveBeenCalled();
  });

  it("builds context from the request fields when none is provided", async () => {
    const result = await resolveRequestContext(supabase, {
      ...baseRequest,
      message: "draft my objectives",
      sectionId: "objectives",
    });

    expect(contextManagerMock.buildContext).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        projectId: baseRequest.projectId,
        sectionType: "objectives",
        query: "draft my objectives",
      }),
    );
    expect(result.context).toBe("assembled context");
  });

  it("passes sectionType as undefined for a sectionId that isn't a real SectionType", async () => {
    await resolveRequestContext(supabase, { ...baseRequest, sectionId: "not-a-real-section" });
    expect(contextManagerMock.buildContext).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ sectionType: undefined }),
    );
  });

  it("passes documentIds, sourceIds, and conversationId through to buildContext", async () => {
    await resolveRequestContext(supabase, {
      ...baseRequest,
      documentIds: ["doc-1"],
      sourceIds: ["cite-1"],
      conversationId: "22222222-2222-2222-2222-222222222222",
    });
    expect(contextManagerMock.buildContext).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        documentIds: ["doc-1"],
        sourceIds: ["cite-1"],
        conversationId: "22222222-2222-2222-2222-222222222222",
      }),
    );
  });

  it("leaves context undefined (not an empty string) when buildContext returns nothing usable", async () => {
    contextManagerMock.buildContext.mockResolvedValueOnce("");
    const result = await resolveRequestContext(supabase, baseRequest);
    expect(result.context).toBeUndefined();
  });
});
