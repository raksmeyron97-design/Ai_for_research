// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourceComparison from "../SourceComparison";
import type { ResearchCitationRow } from "@/lib/db/types";

const CITATIONS: ResearchCitationRow[] = [
  { id: "cit1", project_id: "p1", citation_key: "sok2024", title: "Study A", authors: [], year: 2024, journal: null, doi: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "" },
  { id: "cit2", project_id: "p1", citation_key: "chan2023", title: "Study B", authors: [], year: 2023, journal: null, doi: null, url: null, source_type: null, tier: 2, status: "user_provided", created_at: "" },
];

const FIELDS = [
  { field: "population", label: "Population" },
  { field: "study_design", label: "Study design" },
  { field: "sample", label: "Sample" },
  { field: "variables", label: "Variables" },
  { field: "main_finding", label: "Main finding" },
  { field: "limitations", label: "Limitations" },
  { field: "relevance", label: "Research relevance" },
];

function cells(values: Record<string, [string | null, string | null]>) {
  return FIELDS.map((f) => ({
    field: f.field,
    label: f.label,
    value: values[f.field]?.[0] ?? null,
    provenance: values[f.field]?.[1] ?? null,
  }));
}

const COMPARISON = {
  fields: FIELDS,
  columns: [
    {
      citationId: "cit1", citationKey: "sok2024", title: "Study A", authors: [], year: 2024, profiled: true,
      cells: cells({
        population: ["Postpartum women in urban health centres", "source_stated"],
        limitations: ["Single-site sample", "ai_inference"],
      }),
    },
    {
      citationId: "cit2", citationKey: "chan2023", title: "Study B", authors: [], year: 2023, profiled: true,
      cells: cells({ population: ["Midwives", "source_stated"] }),
    },
  ],
  agreements: [{ text: "Both study maternal mental health.", citationIds: ["cit1", "cit2"], kind: "agreement" }],
  disagreements: [{ text: "They report different prevalence.", citationIds: ["cit1", "cit2"], kind: "disagreement" }],
  unprofiledCitationIds: [],
};

function Harness() {
  const [ids, setIds] = useState<string[]>([]);
  return <SourceComparison projectId="p1" citations={CITATIONS} selectedIds={ids} onSelectionChange={setIds} />;
}

afterEach(() => vi.unstubAllGlobals());

async function compare() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ comparison: COMPARISON }) })),
  );
  render(<Harness />);
  await userEvent.click(screen.getByRole("checkbox", { name: "sok2024" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "chan2023" }));
  await userEvent.click(screen.getByRole("button", { name: "Compare" }));
}

describe("source comparison", () => {
  it("will not compare fewer than two sources", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "sok2024" }));
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "chan2023" }));
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();
  });

  it("says a missing field is missing rather than filling it in", async () => {
    await compare();
    expect(await screen.findByText("Postpartum women in urban health centres")).toBeInTheDocument();
    // Every unfilled cell reads the same way, so a reader can tell a gap from
    // an extracted fact.
    expect(screen.getAllByText("Not available in source").length).toBeGreaterThan(5);
  });

  it("labels an inferred cell as an inference", async () => {
    await compare();
    expect(await screen.findByText("Single-site sample")).toBeInTheDocument();
    expect(screen.getByText("AI INFERENCE")).toBeInTheDocument();
  });

  it("keeps every agreement and disagreement attached to its sources", async () => {
    await compare();
    expect(await screen.findByText("Both study maternal mental health.")).toBeInTheDocument();
    expect(screen.getAllByText("[sok2024] [chan2023]")).toHaveLength(2);
    expect(screen.getByText("They report different prevalence.")).toBeInTheDocument();
  });

  it("invites a selection before anything has been compared", () => {
    render(<Harness />);
    expect(screen.getByText(/Select sources above to compare them field by field/)).toBeInTheDocument();
  });

  it("warns when a selected source has not been read yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ comparison: { ...COMPARISON, unprofiledCitationIds: ["cit2"] } }),
      })),
    );
    render(<Harness />);
    await userEvent.click(screen.getByRole("checkbox", { name: "sok2024" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "chan2023" }));
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByText(/have not been read yet/)).toBeInTheDocument();
  });

  it("shows a failure as an alert instead of an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "The comparison could not be built." }) })),
    );
    render(<Harness />);
    await userEvent.click(screen.getByRole("checkbox", { name: "sok2024" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "chan2023" }));
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The comparison could not be built.");
  });
});
