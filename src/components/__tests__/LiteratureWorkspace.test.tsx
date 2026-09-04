// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiteratureWorkspace from "../LiteratureWorkspace";

/**
 * §25: one workspace with one selection, not five pages.
 *
 * The behaviour that matters is continuity — ticking studies under Compare and
 * finding them still ticked under Research gaps — and that closing it returns
 * the researcher to their writing rather than navigating away from it.
 */
const CITATIONS = [
  { id: "cit1", project_id: "p1", citation_key: "sok2024", title: "Prevalence study", authors: ["Sok, D."], year: 2024, journal: null, doi: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "" },
  { id: "cit2", project_id: "p1", citation_key: "chan2023", title: "Screening tools", authors: [], year: 2023, journal: null, doi: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "" },
];

/** What `search_project_sources` returns, filtered the way the database would.
 *  Kept honest deliberately: a stub that ignores `q` would let a component
 *  that never sends it pass. */
function searchResponse(url: string) {
  const params = new URL(url, "http://test.local").searchParams;
  const q = (params.get("q") ?? "").toLowerCase();
  const matched = CITATIONS.filter(
    (c) => !q || `${c.citation_key} ${c.title} ${c.authors.join(" ")}`.toLowerCase().includes(q),
  );
  return {
    sources: matched.map((c) => ({ ...c, evidence_count: 0, claim_count: 0 })),
    total: matched.length,
    limit: 25,
    offset: 0,
    filtered: [...params.keys()].some((k) => k !== "limit" && k !== "offset"),
  };
}

function stub(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/sources/search")) return { ok: true, json: async () => searchResponse(url) };
    if (url.includes("/citations")) return { ok: true, json: async () => ({ citations: CITATIONS }) };
    if (url.includes("/evidence")) return { ok: true, json: async () => ({ evidence: overrides.evidence ?? [] }) };
    if (url.includes("/themes")) return { ok: true, json: async () => ({ themes: [], assignments: [] }) };
    if (url.includes("/gaps")) return { ok: true, json: async () => ({ gaps: [] }) };
    if (url.includes("/sources/")) return { ok: true, json: async () => overrides.source ?? {} };
    if (url.includes("/literature/compare")) {
      return { ok: true, json: async () => ({ comparison: { columns: [], fields: [], agreements: [], disagreements: [], unprofiledCitationIds: [] } }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Braced deliberately: a hook that *returns* a value is treated by Vitest as
// a cleanup callback, so `() => stub()` would hand the runner the mock to call
// with no arguments at teardown.
beforeEach(() => {
  stub();
});
afterEach(() => vi.unstubAllGlobals());

const tab = (name: string) =>
  within(screen.getByRole("tablist", { name: "Literature workspace" })).getByRole("tab", { name });

describe("literature workspace", () => {
  it("presents the five surfaces as one navigation", async () => {
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    const tabs = screen.getByRole("tablist", { name: "Literature workspace" });
    expect(Array.from(tabs.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual([
      "Sources",
      "Evidence",
      "Themes",
      "Compare",
      "Research gaps",
    ]);
  });

  it("searches on the server rather than filtering a fully loaded library", async () => {
    // Phase 21 §17-§20. This used to assert the opposite — that typing caused
    // no request — which was only achievable by having fetched every source
    // in the project up front. That is fine at twelve sources and wrong at
    // two hundred and fifty, and it left the search function built in Phase
    // 20 with no caller.
    const fetchMock = stub();
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText("Prevalence study")).toBeInTheDocument();

    // The default tab must not pull the whole library across the wire.
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/citations"))).toBe(false);

    await userEvent.type(screen.getByLabelText(/search your sources/i), "screening");

    // Wait for the narrowed result rather than for "Screening tools", which
    // is on screen from the start — the assertion has to be about what the
    // search removed.
    await waitFor(() => expect(screen.queryByText("Prevalence study")).not.toBeInTheDocument());
    expect(screen.getByText("Screening tools")).toBeInTheDocument();

    const searches = fetchMock.mock.calls.filter(([url]) => String(url).includes("/sources/search"));
    expect(searches.length).toBeGreaterThan(0);
    // Debounced: nine keystrokes must not be nine queries.
    expect(searches.length).toBeLessThan(9);
    expect(String(searches[searches.length - 1][0])).toContain("q=screening");
  });

  it("says the search covers this library, not the published literature", async () => {
    // §18: "no results" from a search box is otherwise read as "no such
    // research exists".
    stub();
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText("Prevalence study");

    await userEvent.type(screen.getByLabelText(/search your sources/i), "nothing matches this");

    expect(
      await screen.findByText(/No sources in this library match the current search/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not the published literature/i)).toBeInTheDocument();
  });

  it("asks the server for a filter instead of intersecting arrays in the browser", async () => {
    const fetchMock = stub();
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText("Prevalence study");

    await userEvent.click(screen.getByRole("combobox", { name: "Cited" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Cited" }), "false");

    const searches = fetchMock.mock.calls.filter(([url]) => String(url).includes("/sources/search"));
    expect(String(searches[searches.length - 1][0])).toContain("isCited=false");
  });

  it("carries the selection from Compare through to Research gaps", async () => {
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText("Prevalence study");

    await userEvent.click(tab("Compare"));
    const compare = screen.getByRole("tabpanel", { name: "Compare" });
    await userEvent.click(within(compare).getByRole("checkbox", { name: "sok2024" }));

    await userEvent.click(tab("Research gaps"));
    const gaps = screen.getByRole("tabpanel", { name: "Research gaps" });
    expect(within(gaps).getByRole("checkbox", { name: "sok2024" })).toBeChecked();
  });

  it("loads saved evidence only when its tab is opened", async () => {
    const fetchMock = stub();
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText("Prevalence study");

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evidence"))).toBe(false);

    await userEvent.click(tab("Evidence"));
    expect(await screen.findByText(/No evidence saved in this project yet/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evidence"))).toBe(true);
  });

  it("opens a source's detail and offers a way back to the section that cites it", async () => {
    stub({
      source: {
        citation: CITATIONS[0],
        profile: null,
        documents: [],
        evidence: [],
        claims: [],
        links: [],
        sections: ["research_problem"],
        themes: [],
      },
    });
    const onGoToSection = vi.fn();
    const onClose = vi.fn();

    render(<LiteratureWorkspace projectId="p1" onClose={onClose} onGoToSection={onGoToSection} />);
    await userEvent.click(await screen.findByRole("button", { name: /Prevalence study/ }));

    await userEvent.click(await screen.findByRole("button", { name: "Research Problem" }));
    expect(onGoToSection).toHaveBeenCalledWith("research_problem");
    // Going to a section closes the workspace, putting the researcher back on
    // the editor they left (§27).
    expect(onClose).toHaveBeenCalled();
  });

  it("closes back to writing rather than navigating away", async () => {
    const onClose = vi.fn();
    render(<LiteratureWorkspace projectId="p1" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to writing" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says the library is empty rather than showing a blank list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ citations: [] }) })),
    );
    render(<LiteratureWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText(/No sources yet/)).toBeInTheDocument();
  });
});
