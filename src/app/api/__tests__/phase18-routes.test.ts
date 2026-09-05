import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 18 §27: every methodology route establishes who is asking and which
 * project they own before it touches anything, and no id in a body or a path is
 * authorisation on its own.
 *
 * These assert the preamble and the boundaries, not the features — a route that
 * skipped the project check would pass its own feature tests perfectly while
 * being the hole.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

// Partially mocked: project-schema.ts reads SECTION_CHAIN from this module at
// import time, so replacing it wholesale breaks validation before a test runs.
const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/projects")>()),
  ...dbProjects,
}));

const rateLimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { aiRequest: { bucket: "ai_request", maxEvents: 60, windowSeconds: 600 } },
  rateLimitResponseBody: () => ({ error: "rate limited" }),
}));
vi.mock("@/lib/security/rate-limit", () => rateLimit);

const methodologyDb = vi.hoisted(() => ({
  listResearchQuestions: vi.fn(),
  createResearchQuestion: vi.fn(),
  updateResearchQuestion: vi.fn(),
  deleteResearchQuestion: vi.fn(),
  listObjectives: vi.fn(),
  createObjective: vi.fn(),
  updateObjective: vi.fn(),
  deleteObjective: vi.fn(),
  listConstructs: vi.fn(),
  getConstruct: vi.fn(),
  createConstruct: vi.fn(),
  updateConstruct: vi.fn(),
  deleteConstruct: vi.fn(),
  listIndicators: vi.fn(),
  createIndicator: vi.fn(),
  updateIndicator: vi.fn(),
  deleteIndicator: vi.fn(),
  listHypotheses: vi.fn(),
  createHypothesis: vi.fn(),
  updateHypothesis: vi.fn(),
  deleteHypothesis: vi.fn(),
  listHypothesisVariables: vi.fn(),
  linkHypothesisVariable: vi.fn(),
  unlinkHypothesisVariable: vi.fn(),
  listScales: vi.fn(),
  createScale: vi.fn(),
  updateScale: vi.fn(),
  deleteScale: vi.fn(),
}));
vi.mock("@/lib/db/methodology", () => methodologyDb);

const eventsDb = vi.hoisted(() => ({ recordMethodologyEvent: vi.fn(), listMethodologyEvents: vi.fn() }));
vi.mock("@/lib/db/methodology-events", () => eventsDb);

const questionsDb = vi.hoisted(() => ({
  getQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  listQuestionsForProject: vi.fn(),
  listQuestions: vi.fn(),
  insertQuestions: vi.fn(),
}));
vi.mock("@/lib/db/questions", () => questionsDb);

const instrumentsDb = vi.hoisted(() => ({ getInstrument: vi.fn() }));
vi.mock("@/lib/db/instruments", () => instrumentsDb);

const reviewService = vi.hoisted(() => ({ buildMethodologyReview: vi.fn(), loadMethodologyModel: vi.fn() }));
vi.mock("@/lib/methodology/review-service", () => reviewService);

const suggestions = vi.hoisted(() => ({
  suggestItemMapping: vi.fn(),
  suggestConstructs: vi.fn(),
  suggestHypotheses: vi.fn(),
  suggestItems: vi.fn(),
  suggestItemRewrite: vi.fn(),
  suggestOperationalDefinition: vi.fn(),
  MethodologySuggestionError: class extends Error {
    constructor(message: string, public readonly userMessage: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/methodology/suggestions", () => suggestions);

const B = "../research/projects/[projectId]/methodology";
const modelRoute = await import(`${B}/route`);
const reviewRoute = await import(`${B}/review/route`);
const questionsRoute = await import(`${B}/questions/route`);
const questionRoute = await import(`${B}/questions/[questionId]/route`);
const constructsRoute = await import(`${B}/constructs/route`);
const constructRoute = await import(`${B}/constructs/[constructId]/route`);
const indicatorsRoute = await import(`${B}/indicators/route`);
const hypothesesRoute = await import(`${B}/hypotheses/route`);
const variablesRoute = await import(`${B}/hypotheses/[hypothesisId]/variables/route`);
const scalesRoute = await import(`${B}/scales/route`);
const itemsRoute = await import(`${B}/items/route`);
const itemRoute = await import(`${B}/items/[itemId]/route`);
const eventsRoute = await import(`${B}/events/route`);
const suggestRoute = await import(`${B}/suggest/route`);
const decisionsRoute = await import(`${B}/decisions/route`);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const QUESTION_ID = "22222222-2222-2222-2222-222222222222";
const CONSTRUCT_ID = "33333333-3333-3333-3333-333333333333";
const HYPOTHESIS_ID = "44444444-4444-4444-4444-444444444444";
const ITEM_ID = "55555555-5555-5555-5555-555555555555";
const INSTRUMENT_ID = "66666666-6666-6666-6666-666666666666";
const CITATION_ID = "77777777-7777-7777-7777-777777777777";

const projectParams = Promise.resolve({ projectId: PROJECT_ID });

function req(method: string, body?: unknown, url = "http://localhost/x") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1", title: "T", language: "en" });
  rateLimit.checkRateLimit.mockResolvedValue({ allowed: true });

  for (const fn of Object.values(methodologyDb)) fn.mockResolvedValue([]);
  methodologyDb.createResearchQuestion.mockResolvedValue({ id: QUESTION_ID, question_text: "Q?" });
  methodologyDb.updateResearchQuestion.mockResolvedValue({ id: QUESTION_ID, question_text: "Q?" });
  methodologyDb.createConstruct.mockResolvedValue({ id: CONSTRUCT_ID, name: "C" });
  methodologyDb.updateConstruct.mockResolvedValue({ id: CONSTRUCT_ID, name: "C" });
  methodologyDb.getConstruct.mockResolvedValue({ id: CONSTRUCT_ID, name: "C", role: "latent" });
  methodologyDb.createIndicator.mockResolvedValue({ id: "ind-1", name: "I" });
  methodologyDb.createHypothesis.mockResolvedValue({ id: HYPOTHESIS_ID, statement: "H", label: "H1" });
  methodologyDb.createScale.mockResolvedValue({ id: "sc-1", name: "S" });
  methodologyDb.linkHypothesisVariable.mockResolvedValue({ id: "hv-1" });

  eventsDb.recordMethodologyEvent.mockResolvedValue({ id: "ev-1" });
  eventsDb.listMethodologyEvents.mockResolvedValue([]);

  questionsDb.getQuestion.mockResolvedValue({ id: ITEM_ID, question_text: "Item", project_id: PROJECT_ID });
  questionsDb.updateQuestion.mockResolvedValue({ id: ITEM_ID, question_text: "Item" });
  questionsDb.listQuestionsForProject.mockResolvedValue([]);
  questionsDb.listQuestions.mockResolvedValue([]);
  questionsDb.insertQuestions.mockResolvedValue([{ id: ITEM_ID, question_text: "Item" }]);

  instrumentsDb.getInstrument.mockResolvedValue({ id: INSTRUMENT_ID, project_id: PROJECT_ID });
  reviewService.buildMethodologyReview.mockResolvedValue({ projectId: PROJECT_ID, findings: [] });
  reviewService.loadMethodologyModel.mockResolvedValue({ constructs: [] });

  for (const [key, fn] of Object.entries(suggestions)) {
    if (typeof fn === "function" && key.startsWith("suggest")) {
      (fn as ReturnType<typeof vi.fn>).mockResolvedValue({
        proposals: [],
        provenance: "ai_suggested",
        contextTruncated: false,
        notes: [],
      });
    }
  }
});

describe("every methodology route refuses an unauthenticated or foreign caller", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["GET model", () => modelRoute.GET(req("GET"), { params: projectParams })],
    ["GET review", () => reviewRoute.GET(req("GET"), { params: projectParams })],
    ["GET events", () => eventsRoute.GET(req("GET"), { params: projectParams })],
    ["GET questions", () => questionsRoute.GET(req("GET"), { params: projectParams })],
    [
      "POST question",
      () => questionsRoute.POST(req("POST", { questionText: "What is X?" }), { params: projectParams }),
    ],
    [
      "PATCH question",
      () =>
        questionRoute.PATCH(req("PATCH", { questionText: "New?" }), {
          params: Promise.resolve({ projectId: PROJECT_ID, questionId: QUESTION_ID }),
        }),
    ],
    [
      "DELETE question",
      () =>
        questionRoute.DELETE(req("DELETE"), {
          params: Promise.resolve({ projectId: PROJECT_ID, questionId: QUESTION_ID }),
        }),
    ],
    ["GET constructs", () => constructsRoute.GET(req("GET"), { params: projectParams })],
    ["POST construct", () => constructsRoute.POST(req("POST", { name: "C" }), { params: projectParams })],
    [
      "PATCH construct",
      () =>
        constructRoute.PATCH(req("PATCH", { name: "C2" }), {
          params: Promise.resolve({ projectId: PROJECT_ID, constructId: CONSTRUCT_ID }),
        }),
    ],
    [
      "POST indicator",
      () =>
        indicatorsRoute.POST(req("POST", { constructId: CONSTRUCT_ID, name: "I" }), {
          params: projectParams,
        }),
    ],
    ["POST hypothesis", () => hypothesesRoute.POST(req("POST", { statement: "H" }), { params: projectParams })],
    [
      "POST hypothesis variable",
      () =>
        variablesRoute.POST(req("POST", { constructId: CONSTRUCT_ID, position: "outcome" }), {
          params: Promise.resolve({ projectId: PROJECT_ID, hypothesisId: HYPOTHESIS_ID }),
        }),
    ],
    [
      "POST scale",
      () =>
        scalesRoute.POST(
          req("POST", { name: "S", points: [{ value: 1, label: "Low" }, { value: 2, label: "High" }] }),
          { params: projectParams },
        ),
    ],
    [
      "POST items",
      () =>
        itemsRoute.POST(
          req("POST", {
            instrumentId: INSTRUMENT_ID,
            items: [{ questionText: "Q", sectionLabel: "S", responseType: "likert" }],
          }),
          { params: projectParams },
        ),
    ],
    [
      "PATCH item",
      () =>
        itemRoute.PATCH(req("PATCH", { constructId: CONSTRUCT_ID }), {
          params: Promise.resolve({ projectId: PROJECT_ID, itemId: ITEM_ID }),
        }),
    ],
    [
      "POST suggest",
      () =>
        suggestRoute.POST(req("POST", { kind: "item_mapping", itemId: ITEM_ID }), { params: projectParams }),
    ],
    [
      "POST decision",
      () =>
        decisionsRoute.POST(req("POST", { entityType: "construct", accepted: false, summary: "Rejected" }), {
          params: projectParams,
        }),
    ],
  ];

  it.each(cases)("%s answers 401 with no session", async (_name, call) => {
    authMock.requireUserId.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it.each(cases)("%s answers 404 for someone else's project", async (_name, call) => {
    dbProjects.getProject.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it.each(cases)("%s does no database work before authorising", async (_name, call) => {
    authMock.requireUserId.mockResolvedValue(null);
    await call();
    for (const fn of Object.values(methodologyDb)) expect(fn).not.toHaveBeenCalled();
    expect(eventsDb.recordMethodologyEvent).not.toHaveBeenCalled();
  });
});

describe("input validation (§28)", () => {
  it("rejects a malformed body before authorising", async () => {
    const res = await questionsRoute.POST(req("POST", { questionText: "" }), { params: projectParams });
    expect(res.status).toBe(400);
    expect(dbProjects.getProject).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid construct id on an indicator", async () => {
    const res = await indicatorsRoute.POST(req("POST", { constructId: "not-a-uuid", name: "I" }), {
      params: projectParams,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch rather than writing an empty update", async () => {
    const res = await questionRoute.PATCH(req("PATCH", {}), {
      params: Promise.resolve({ projectId: PROJECT_ID, questionId: QUESTION_ID }),
    });
    expect(res.status).toBe(400);
    expect(methodologyDb.updateResearchQuestion).not.toHaveBeenCalled();
  });

  it("rejects a scale with fewer than two points", async () => {
    const res = await scalesRoute.POST(req("POST", { name: "S", points: [{ value: 1, label: "Only" }] }), {
      params: projectParams,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown suggestion kind", async () => {
    const res = await suggestRoute.POST(req("POST", { kind: "write_my_thesis" }), { params: projectParams });
    expect(res.status).toBe(400);
  });
});

describe("§31 — an item may not claim a source without naming one", () => {
  it("rejects an adaptation type with a null citation", async () => {
    const res = await itemRoute.PATCH(req("PATCH", { adaptationType: "verbatim", sourceCitationId: null }), {
      params: Promise.resolve({ projectId: PROJECT_ID, itemId: ITEM_ID }),
    });
    expect(res.status).toBe(400);
    expect(questionsDb.updateQuestion).not.toHaveBeenCalled();
  });

  it("accepts an adaptation type when the source is named", async () => {
    const res = await itemRoute.PATCH(
      req("PATCH", { adaptationType: "adapted", sourceCitationId: CITATION_ID }),
      { params: Promise.resolve({ projectId: PROJECT_ID, itemId: ITEM_ID }) },
    );
    expect(res.status).toBe(200);
  });

  // The generated-item route has no source field at all, so an AI-suggested
  // item cannot arrive already attributed to a published instrument.
  it("offers no way to attribute a source when creating items", async () => {
    await itemsRoute.POST(
      req("POST", {
        instrumentId: INSTRUMENT_ID,
        items: [
          {
            questionText: "Q",
            sectionLabel: "S",
            responseType: "likert",
            itemProvenance: "ai_suggested",
            sourceCitationId: CITATION_ID,
            adaptationType: "verbatim",
          },
        ],
      }),
      { params: projectParams },
    );

    const inserted = questionsDb.insertQuestions.mock.calls[0][1][0];
    expect(inserted).not.toHaveProperty("source_citation_id");
    expect(inserted).not.toHaveProperty("adaptation_type");
    expect(inserted.item_provenance).toBe("ai_suggested");
  });
});

describe("ids in a path are re-resolved inside the project (§27)", () => {
  it("refuses to link a variable to a hypothesis this project does not have", async () => {
    methodologyDb.listHypotheses.mockResolvedValue([]);
    const res = await variablesRoute.POST(req("POST", { constructId: CONSTRUCT_ID, position: "outcome" }), {
      params: Promise.resolve({ projectId: PROJECT_ID, hypothesisId: HYPOTHESIS_ID }),
    });
    expect(res.status).toBe(404);
    expect(methodologyDb.linkHypothesisVariable).not.toHaveBeenCalled();
  });

  it("refuses to append items to an instrument belonging to another project", async () => {
    instrumentsDb.getInstrument.mockResolvedValue({ id: INSTRUMENT_ID, project_id: "other-project" });
    const res = await itemsRoute.POST(
      req("POST", {
        instrumentId: INSTRUMENT_ID,
        items: [{ questionText: "Q", sectionLabel: "S", responseType: "likert" }],
      }),
      { params: projectParams },
    );
    expect(res.status).toBe(404);
    expect(questionsDb.insertQuestions).not.toHaveBeenCalled();
  });

  it("refuses a suggestion for an item this project does not have", async () => {
    questionsDb.getQuestion.mockResolvedValue(null);
    const res = await suggestRoute.POST(req("POST", { kind: "item_mapping", itemId: ITEM_ID }), {
      params: projectParams,
    });
    expect(res.status).toBe(404);
    expect(suggestions.suggestItemMapping).not.toHaveBeenCalled();
  });
});

describe("the suggest route", () => {
  it("applies the AI rate limit", async () => {
    rateLimit.checkRateLimit.mockResolvedValue({ allowed: false });
    const res = await suggestRoute.POST(req("POST", { kind: "item_mapping", itemId: ITEM_ID }), {
      params: projectParams,
    });
    expect(res.status).toBe(429);
  });

  // The candidate lists come from project-scoped queries, never from the body.
  // A caller cannot offer the model an id from another project because a caller
  // cannot offer the model anything.
  it("builds the candidate list from the database, not the request", async () => {
    methodologyDb.listConstructs.mockResolvedValue([
      { id: CONSTRUCT_ID, name: "Teacher motivation", role: "independent" },
    ]);
    methodologyDb.listIndicators.mockResolvedValue([]);

    await suggestRoute.POST(
      req("POST", {
        kind: "item_mapping",
        itemId: ITEM_ID,
        constructs: [{ id: "00000000-0000-4000-8000-00000000beef", label: "Injected" }],
      }),
      { params: projectParams },
    );

    const passed = suggestions.suggestItemMapping.mock.calls[0][1];
    expect(passed.constructs).toEqual([
      { id: CONSTRUCT_ID, label: "Teacher motivation", detail: "Independent variable" },
    ]);
  });

  it("reports a provider failure as a readable error, not a stack", async () => {
    suggestions.suggestItemMapping.mockRejectedValue(
      new suggestions.MethodologySuggestionError("boom", "That suggestion could not run. Nothing was saved."),
    );
    const res = await suggestRoute.POST(req("POST", { kind: "item_mapping", itemId: ITEM_ID }), {
      params: projectParams,
    });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Nothing was saved/);
  });

  it("writes nothing when a suggestion succeeds", async () => {
    await suggestRoute.POST(req("POST", { kind: "constructs", questionId: QUESTION_ID }), {
      params: projectParams,
    });
    expect(methodologyDb.createConstruct).not.toHaveBeenCalled();
    expect(eventsDb.recordMethodologyEvent).not.toHaveBeenCalled();
  });
});

describe("the audit log (§23)", () => {
  it("records a creation with the row that was written", async () => {
    await questionsRoute.POST(req("POST", { questionText: "What is X?" }), { params: projectParams });
    expect(eventsDb.recordMethodologyEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity_type: "research_question", action: "created", entity_id: QUESTION_ID }),
    );
  });

  it("records a mapping change as a mapping, not an edit", async () => {
    await itemRoute.PATCH(req("PATCH", { constructId: CONSTRUCT_ID }), {
      params: Promise.resolve({ projectId: PROJECT_ID, itemId: ITEM_ID }),
    });
    expect(eventsDb.recordMethodologyEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "mapped" }),
    );
  });

  it("records a rejected suggestion, which creates no row of its own", async () => {
    const res = await decisionsRoute.POST(
      req("POST", { entityType: "construct", accepted: false, summary: "Not this one" }),
      { params: projectParams },
    );
    expect(res.status).toBe(201);
    expect(eventsDb.recordMethodologyEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "ai_suggestion_rejected", entity_id: null }),
    );
  });

  // The change already happened. Rolling a researcher's edit back because the
  // log was unavailable would be worse than saying the log is unavailable.
  it("still saves the change when the audit write fails, and says so", async () => {
    eventsDb.recordMethodologyEvent.mockRejectedValue(new Error("log unavailable"));
    const res = await questionsRoute.POST(req("POST", { questionText: "What is X?" }), {
      params: projectParams,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).audited).toBe(false);
  });

  it("caps the size of a recorded proposal", async () => {
    const res = await decisionsRoute.POST(
      req("POST", {
        entityType: "construct",
        accepted: true,
        summary: "Accepted",
        proposal: { blob: "x".repeat(9000) },
      }),
      { params: projectParams },
    );
    expect(res.status).toBe(400);
  });
});

describe("events listing", () => {
  it("caps the page size a caller can ask for", async () => {
    await eventsRoute.GET(req("GET", undefined, "http://localhost/x?limit=100000"), {
      params: projectParams,
    });
    expect(eventsDb.listMethodologyEvents).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({ limit: 200 }),
    );
  });
});
