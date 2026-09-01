// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeManager from "../ThemeManager";
import type { ResearchCitationRow } from "@/lib/db/types";

const CITATIONS: ResearchCitationRow[] = [
  {
    id: "cit1", project_id: "p1", citation_key: "sok2024", title: "Prevalence", authors: [], year: 2024,
    journal: null, doi: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "",
  },
  {
    id: "cit2", project_id: "p1", citation_key: "chan2023", title: "Screening", authors: [], year: 2023,
    journal: null, doi: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "",
  },
];

/** A tiny scripted server, so the component's contract with the API is what is asserted. */
function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const body = routes[key];
    if (body === undefined) return { ok: false, json: async () => ({ error: `no route for ${key}` }) };
    return { ok: true, json: async () => body };
  });
}

let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(() => {
  fetchMock = mockFetch({
    "GET /api/research/projects/p1/themes": { themes: [], assignments: [] },
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("themes", () => {
  it("says there are none yet and explains what they are for", async () => {
    render(<ThemeManager projectId="p1" citations={CITATIONS} />);
    expect(await screen.findByText("No themes yet.")).toBeInTheDocument();
  });

  it("creates a theme the researcher named", async () => {
    render(<ThemeManager projectId="p1" citations={CITATIONS} />);
    await screen.findByText("No themes yet.");

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ theme: { id: "t1" }, assigned: [] }) };
      return {
        ok: true,
        json: async () => ({
          themes: [{ id: "t1", project_id: "p1", name: "Screening barriers", description: null, ai_suggested: false, confirmed: true, created_at: "", updated_at: "" }],
          assignments: [],
        }),
      };
    });

    await userEvent.type(screen.getByLabelText("New theme"), "Screening barriers");
    await userEvent.click(screen.getByRole("button", { name: "Create theme" }));

    expect(await screen.findByText("Screening barriers")).toBeInTheDocument();
  });

  it("marks an AI suggestion as a suggestion and requires confirmation before it becomes a theme", async () => {
    render(<ThemeManager projectId="p1" citations={CITATIONS} />);
    await screen.findByText("No themes yet.");

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/themes/suggest")) {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              { name: "Screening", description: "Tools and practice", citationIds: ["cit2"], aiSuggested: true },
            ],
          }),
        };
      }
      if (init?.method === "POST") return { ok: true, json: async () => ({ theme: { id: "t1" }, assigned: ["cit2"] }) };
      return { ok: true, json: async () => ({ themes: [], assignments: [] }) };
    });

    await userEvent.click(screen.getByRole("button", { name: "Suggest themes" }));

    expect(await screen.findByText("AI SUGGESTED")).toBeInTheDocument();
    // Still a proposal: nothing was created by asking for suggestions.
    expect(screen.getByText("No themes yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/research/projects/p1/themes",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("discards a suggestion without creating anything", async () => {
    render(<ThemeManager projectId="p1" citations={CITATIONS} />);
    await screen.findByText("No themes yet.");

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/themes/suggest")) {
        return { ok: true, json: async () => ({ suggestions: [{ name: "Screening", description: "", citationIds: [], aiSuggested: true }] }) };
      }
      return { ok: true, json: async () => ({ themes: [], assignments: [] }) };
    });

    await userEvent.click(screen.getByRole("button", { name: "Suggest themes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(screen.queryByText("AI SUGGESTED")).not.toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/research/projects/p1/themes" && (init as RequestInit)?.method === "POST",
    );
    expect(posts).toHaveLength(0);
  });

  it("assigns and removes a source through the theme's own checkboxes", async () => {
    fetchMock = mockFetch({
      "GET /api/research/projects/p1/themes": {
        themes: [{ id: "t1", project_id: "p1", name: "Screening", description: null, ai_suggested: false, confirmed: true, created_at: "", updated_at: "" }],
        assignments: [],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ThemeManager projectId="p1" citations={CITATIONS} />);
    await screen.findByText("Screening");

    await userEvent.click(screen.getByRole("checkbox", { name: "chan2023" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/research/projects/p1/themes/t1/sources",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
