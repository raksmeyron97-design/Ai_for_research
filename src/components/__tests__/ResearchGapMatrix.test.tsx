// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResearchGapMatrix from "../ResearchGapMatrix";
import type { ResearchCitationRow, ResearchSourceProfileRow } from "@/lib/db/types";

const CITATIONS: ResearchCitationRow[] = [
  { id: "cit1", project_id: "p1", citation_key: "sok2024", title: "Study A", authors: [], year: 2024, journal: null, doi: null, pmid: null, isbn: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "" },
];

const PROFILES: ResearchSourceProfileRow[] = [
  {
    id: "pr1", project_id: "p1", citation_id: "cit1",
    population: "Postpartum women", study_design: "Cross-sectional", sample: null, variables: null,
    main_finding: "21% screened positive", limitations: "Single urban site", relevance: null,
    field_provenance: {}, created_at: "", updated_at: "",
  },
];

function Harness({ initial = ["cit1"] }: { initial?: string[] }) {
  const [ids, setIds] = useState<string[]>(initial);
  return (
    <ResearchGapMatrix
      projectId="p1"
      citations={CITATIONS}
      profiles={PROFILES}
      selectedIds={ids}
      onSelectionChange={setIds}
    />
  );
}

function stubFetch(gaps: unknown[] = [], suggestions: unknown[] = []) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/gaps/suggest")) return { ok: true, json: async () => ({ suggestions }) };
    if (init?.method === "POST") return { ok: true, json: async () => ({ gaps: [] }) };
    if (init?.method === "PATCH") return { ok: true, json: async () => ({ gap: {} }) };
    return { ok: true, json: async () => ({ gaps }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("research gap matrix", () => {
  it("asks for studies before it can show anything", async () => {
    stubFetch();
    render(<Harness initial={[]} />);
    expect(await screen.findByText("Add studies to compare research gaps.")).toBeInTheDocument();
  });

  it("shows each selected study's known facts and marks the unknown ones", async () => {
    stubFetch();
    render(<Harness />);

    expect(await screen.findByText("[sok2024]")).toBeInTheDocument();
    expect(screen.getByText("Postpartum women")).toBeInTheDocument();
    expect(screen.getByText("21% screened positive")).toBeInTheDocument();
    expect(screen.getAllByText("Not available in source").length).toBeGreaterThan(0);
  });

  it("shows the basis of every saved gap beside it", async () => {
    stubFetch([
      {
        id: "g1", project_id: "p1", citation_id: "cit1",
        gap_text: "Generalisability beyond urban sites is untested.",
        basis: "derived_limitation", supporting_text: null, verified: false, created_at: "", updated_at: "",
      },
    ]);
    render(<Harness />);

    expect(await screen.findByText("Generalisability beyond urban sites is untested.")).toBeInTheDocument();
    expect(screen.getByText("Derived from a stated limitation")).toBeInTheDocument();
  });

  it("says when a suggestion's claimed basis did not survive checking", async () => {
    stubFetch([], [
      {
        project_id: "p1", citation_id: "cit1", gap_text: "The authors call for longitudinal work.",
        basis: "ai_inference", supporting_text: "Future studies are needed.", verified: false,
        downgradedFrom: "source_stated",
      },
    ]);
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Suggest gaps" }));

    expect(await screen.findByText("The authors call for longitudinal work.")).toBeInTheDocument();
    expect(screen.getByText("AI inference")).toBeInTheDocument();
    expect(screen.getByText(/proposed as “Stated by source”/)).toBeInTheDocument();
  });

  it("writes nothing until the researcher adds a suggestion to the matrix", async () => {
    const fetchMock = stubFetch([], [
      { project_id: "p1", citation_id: "cit1", gap_text: "A gap.", basis: "ai_inference", supporting_text: null, verified: false },
    ]);
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Suggest gaps" }));
    await screen.findByText("A gap.");

    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/research/projects/p1/gaps" && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Add to matrix" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/research/projects/p1/gaps",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("makes verification an explicit act by the researcher", async () => {
    const fetchMock = stubFetch([
      {
        id: "g1", project_id: "p1", citation_id: "cit1", gap_text: "A gap.",
        basis: "ai_inference", supporting_text: null, verified: false, created_at: "", updated_at: "",
      },
    ]);
    render(<Harness />);

    await userEvent.click(await screen.findByRole("button", { name: "Mark verified" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/research/projects/p1/gaps/g1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ verified: true }) }),
      ),
    );
  });
});
