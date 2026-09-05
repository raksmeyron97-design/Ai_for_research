// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourceSearchPanel from "../SourceSearchPanel";

/**
 * Phase 21 §17-§20 and §51.
 *
 * The properties worth asserting here are the ones a screenshot cannot show:
 * that the filters become database predicates rather than array scans, that
 * paging is bounded, and that a slow response cannot overwrite a newer one.
 */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "cit1",
    citation_key: "sok2024",
    title: "Prevalence study",
    authors: ["Sok, D."],
    year: 2024,
    journal: null,
    doi: null,
    source_type: null,
    status: "user_provided",
    evidence_count: 0,
    claim_count: 0,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stub(handler: (url: string) => unknown) {
  const mock = vi.fn(async (input: unknown) => ({
    ok: true,
    json: async () => handler(String(input)),
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("source search", () => {
  it("asks for one bounded page, not the whole library", async () => {
    const mock = stub(() => ({ sources: [row()], total: 1, limit: 25, offset: 0, filtered: false }));

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);
    await screen.findByText("Prevalence study");

    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("/api/research/projects/p1/sources/search");
    expect(url).toContain("limit=25");
    expect(url).toContain("offset=0");
  });

  it("pages forward through a large library without re-fetching everything", async () => {
    const mock = stub((url) => {
      const offset = Number(new URL(url, "http://t.local").searchParams.get("offset"));
      return {
        sources: [row({ id: `cit${offset}`, title: `Source at ${offset}` })],
        total: 120,
        limit: 25,
        offset,
        filtered: false,
      };
    });

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);
    await screen.findByText("Source at 0");
    expect(screen.getByText(/120 sources in this library/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Source at 25");

    expect(String(mock.mock.calls[mock.mock.calls.length - 1][0])).toContain("offset=25");
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("returns to the first page when a filter changes", async () => {
    // Staying on page 4 of a result set that now has one page shows an empty
    // list over a search that matched things.
    const mock = stub((url) => {
      const offset = Number(new URL(url, "http://t.local").searchParams.get("offset"));
      return { sources: [row({ title: `At ${offset}` })], total: 120, limit: 25, offset, filtered: false };
    });

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);
    await screen.findByText("At 0");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("At 25");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "DOI" }), "false");

    await waitFor(() =>
      expect(String(mock.mock.calls[mock.mock.calls.length - 1][0])).toContain("offset=0"),
    );
  });

  it("sends only the filters the researcher actually chose", async () => {
    // An omitted parameter means "no opinion" server-side. Sending
    // `hasDoi=` for an untouched control would be a different query.
    const mock = stub(() => ({ sources: [], total: 0, limit: 25, offset: 0, filtered: false }));

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);
    await waitFor(() => expect(mock).toHaveBeenCalled());

    const first = String(mock.mock.calls[0][0]);
    expect(first).not.toContain("hasDoi");
    expect(first).not.toContain("statuses");
    expect(first).not.toContain("q=");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Evidence" }), "false");
    await waitFor(() =>
      expect(String(mock.mock.calls[mock.mock.calls.length - 1][0])).toContain("hasEvidence=false"),
    );
    // ...and still nothing for the controls left alone.
    expect(String(mock.mock.calls[mock.mock.calls.length - 1][0])).not.toContain("hasDoi");
  });

  it("a slow earlier response cannot overwrite a newer one (§51)", async () => {
    // The failure this prevents: type "sc", then "screening"; the first query
    // is slower and lands last, and the list settles on results for a prefix
    // of what the box contains.
    const resolvers: ((value: unknown) => void)[] = [];
    const mock = vi.fn(
      (input: unknown) =>
        new Promise((resolve) => {
          const url = String(input);
          resolvers.push(() =>
            resolve({
              ok: true,
              json: async () =>
                url.includes("q=screening")
                  ? { sources: [row({ id: "new", title: "NEWER RESULT" })], total: 1, limit: 25, offset: 0, filtered: true }
                  : { sources: [row({ id: "old", title: "STALE RESULT" })], total: 1, limit: 25, offset: 0, filtered: false },
            }),
          );
        }),
    );
    vi.stubGlobal("fetch", mock);

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);
    await waitFor(() => expect(resolvers.length).toBe(1));

    await userEvent.type(screen.getByLabelText(/search your sources/i), "screening");
    await waitFor(() => expect(resolvers.length).toBeGreaterThan(1));

    // Newest first, oldest last — the out-of-order arrival.
    const [stale, ...rest] = resolvers;
    rest.reverse().forEach((r) => r(null));
    await screen.findByText("NEWER RESULT");

    stale(null);

    // Give the stale response every chance to land before asserting it did not.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("STALE RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("NEWER RESULT")).toBeInTheDocument();
  });

  it("explains a failed search without exposing the database", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be searched/i);
    expect(alert.textContent).not.toMatch(/postgres|relation|column|constraint/i);
  });

  it("filters by theme on the server and can clear it", async () => {
    const mock = stub(() => ({ sources: [], total: 0, limit: 25, offset: 0, filtered: true }));
    const onClear = vi.fn();

    render(
      <SourceSearchPanel
        projectId="p1"
        themeFilter={{ id: "theme-1", name: "Screening" }}
        onClearThemeFilter={onClear}
        onOpenSource={vi.fn()}
      />,
    );

    await waitFor(() => expect(String(mock.mock.calls[0][0])).toContain("themeId=theme-1"));
    await userEvent.click(screen.getByRole("button", { name: /clear theme: screening/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("distinguishes an empty library from a search that matched nothing", async () => {
    stub(() => ({ sources: [], total: 0, limit: 25, offset: 0, filtered: false }));

    render(<SourceSearchPanel projectId="p1" onOpenSource={vi.fn()} />);

    expect(await screen.findByText(/No sources yet/)).toBeInTheDocument();
    expect(screen.queryByText(/match the current search/i)).toBeNull();
  });
});
