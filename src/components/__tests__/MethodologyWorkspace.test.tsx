// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MethodologyWorkspace from "../MethodologyWorkspace";

const EMPTY_MODEL = {
  questions: [],
  objectives: [],
  constructs: [],
  indicators: [],
  hypotheses: [],
  hypothesisVariables: [],
  scales: [],
  items: [],
  analysisPlan: null,
};

const REVIEW = {
  projectId: "p1",
  metrics: [
    {
      id: "measurement_coverage",
      label: "Measurement coverage",
      value: null,
      status: "not_computable",
      reason: "No indicators have been added yet.",
    },
  ],
  findings: [
    {
      id: "construct-unmeasured-con-a",
      category: "measurement_coverage",
      severity: "error",
      title: "Construct is not measured by anything",
      explanation: "No item measures it.",
      provenance: "deterministic",
      targetType: "construct",
      targetId: "con-a",
    },
  ],
  graph: { nodes: [], edges: [] },
  totals: { questions: 0, objectives: 0, constructs: 0, indicators: 0, hypotheses: 0, items: 0 },
  generatedAt: "2026-09-02T00:00:00Z",
};

/** A tiny scripted server, so the component's contract with the API is asserted. */
function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0];
    const key = `${init?.method ?? "GET"} ${path}`;
    if (key in overrides) {
      const value = overrides[key];
      if (value === "fail") return { ok: false, json: async () => ({ error: "Nope." }) };
      return { ok: true, json: async () => value };
    }
    if (path.endsWith("/methodology")) return { ok: true, json: async () => ({ model: EMPTY_MODEL }) };
    if (path.endsWith("/review")) return { ok: true, json: async () => ({ review: REVIEW }) };
    return { ok: true, json: async () => ({}) };
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  render(<MethodologyWorkspace projectId="p1" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument());
}

describe("MethodologyWorkspace", () => {
  it("announces loading before the model arrives", () => {
    render(<MethodologyWorkspace projectId="p1" onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading your methodology/i);
  });

  it("shows the metrics and the findings on the overview", async () => {
    await open();
    expect(screen.getByRole("meter", { name: "Measurement coverage" })).toBeInTheDocument();
    expect(screen.getByText("Construct is not measured by anything")).toBeInTheDocument();
  });

  it("reports a failed load as a readable error", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /api/research/projects/p1/methodology": "fail" }));
    render(<MethodologyWorkspace projectId="p1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i));
  });

  it("moves between tabs with the arrow keys", async () => {
    await open();
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Questions" })).toHaveAttribute("aria-selected", "true");
    expect(overview).toHaveAttribute("tabindex", "-1");
  });

  // §20: a metric tile is a way in to the thing it counts.
  it("takes a metric tile to the tab that holds what it counts", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Measurement coverage/ }));
    expect(screen.getByRole("tab", { name: "Coverage" })).toHaveAttribute("aria-selected", "true");
  });

  // §21: a finding leads to the object it is about.
  it("takes a finding to the tab that holds its target", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Go to construct/ }));
    expect(screen.getByRole("tab", { name: "Constructs" })).toHaveAttribute("aria-selected", "true");
  });

  it("adds a research question through the API and reloads", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    await open();

    await userEvent.click(screen.getByRole("tab", { name: "Questions" }));
    await userEvent.type(screen.getByLabelText("New research question"), "What is the effect of X on Y?");
    await userEvent.click(screen.getByRole("button", { name: "Add question" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/research/projects/p1/methodology/questions",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  // §18: a proposal made from a shortened text says so.
  it("surfaces a truncated context rather than swallowing it", async () => {
    const fetchMock = mockFetch({
      "GET /api/research/projects/p1/methodology": {
        model: { ...EMPTY_MODEL, questions: [{ id: "rq-a", project_id: "p1", question_text: "What is X?", question_kind: "descriptive", provenance: "user", confirmed: true, order_index: 0, created_at: "", updated_at: "" }] },
      },
      "POST /api/research/projects/p1/methodology/suggest": {
        proposals: [],
        provenance: "ai_suggested",
        contextTruncated: true,
        notes: [],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    await open();

    await userEvent.click(screen.getByRole("tab", { name: "Questions" }));
    await userEvent.click(screen.getByRole("button", { name: "Suggest constructs" }));

    await waitFor(() => expect(screen.getByText(/shortened version of your text/i)).toBeInTheDocument());
  });

  // §23: a rejection creates no row, so without recording it the history would
  // only ever show accepted suggestions.
  it("records a rejected suggestion", async () => {
    const fetchMock = mockFetch({
      "GET /api/research/projects/p1/methodology": {
        model: { ...EMPTY_MODEL, questions: [{ id: "rq-a", project_id: "p1", question_text: "What is X?", question_kind: "descriptive", provenance: "user", confirmed: true, order_index: 0, created_at: "", updated_at: "" }] },
      },
      "POST /api/research/projects/p1/methodology/suggest": {
        proposals: [
          { name: "Teacher motivation", role: "independent", conceptualDefinition: "Willingness.", rationale: "In the question.", alreadyExists: false },
        ],
        provenance: "ai_suggested",
        contextTruncated: false,
        notes: [],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    await open();

    await userEvent.click(screen.getByRole("tab", { name: "Questions" }));
    await userEvent.click(screen.getByRole("button", { name: "Suggest constructs" }));
    await waitFor(() => expect(screen.getByText("AI SUGGESTED")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/research/projects/p1/methodology/decisions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"accepted":false'),
        }),
      ),
    );
  });

  // §36: one DOM tree. Every panel is rendered once and hidden, so no control
  // and no id appears twice.
  it("renders each tab panel exactly once", async () => {
    await open();
    for (const id of ["overview", "questions", "constructs", "hypotheses", "coverage"]) {
      expect(document.querySelectorAll(`#meth-panel-${id}`)).toHaveLength(1);
    }
  });

  it("keeps the tablist reachable at a narrow width", async () => {
    await open();
    const tablist = screen.getByRole("tablist", { name: "Methodology workspace" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(5);
    // Horizontal scrolling rather than wrapping, so the row survives 320px.
    expect(tablist.className).toContain("overflow-x-auto");
  });
});
