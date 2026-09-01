// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VersionHistory from "../VersionHistory";
import type { SectionVersionRow } from "@/lib/db/section-versions";

function version(over: Partial<SectionVersionRow> = {}): SectionVersionRow {
  return {
    id: "v1",
    project_id: "p1",
    section_id: "s1",
    section_type: "research_problem",
    previous_content: "The original sentence.",
    new_content: "The revised sentence with more detail.",
    action: "ai_generate",
    provider: "gemini",
    model: "gemini-3.6-flash",
    section_action: "generate",
    restored_from_version_id: null,
    created_by: "u1",
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe("version history", () => {
  it("shows what kind of change each version was, and by which model", () => {
    render(<VersionHistory versions={[version()]} onRestore={vi.fn()} />);
    expect(screen.getByText(/AI generate/)).toBeInTheDocument();
    expect(screen.getByText(/gemini-3\.6-flash/)).toBeInTheDocument();
  });

  it("shows no model for a manual edit rather than attributing it to one", () => {
    render(
      <VersionHistory
        versions={[version({ action: "manual", provider: null, model: null })]}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByText(/Manual edit/)).toBeInTheDocument();
    expect(screen.queryByText(/gemini/)).not.toBeInTheDocument();
  });

  it("summarises the size of the change", () => {
    render(<VersionHistory versions={[version()]} onRestore={vi.fn()} />);
    expect(screen.getByText(/\+3 words/)).toBeInTheDocument();
  });

  it("shows a diff on demand, marking what was removed and added", async () => {
    render(<VersionHistory versions={[version()]} onRestore={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));

    expect(screen.getByText("original")).toBeInTheDocument();
    expect(screen.getByText("revised")).toBeInTheDocument();
  });

  it("states that restoring keeps later versions — the §22 guarantee", async () => {
    render(<VersionHistory versions={[version()]} onRestore={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));

    // Wording this as a revert would imply the drafts in between are lost.
    expect(screen.getByText(/creates a new version from it. Nothing after it is deleted/)).toBeInTheDocument();
  });

  it("hands the chosen version back on restore", async () => {
    const onRestore = vi.fn();
    render(<VersionHistory versions={[version({ id: "v7" })]} onRestore={onRestore} />);

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "v7" }));
  });

  it("collapses the diff again", async () => {
    render(<VersionHistory versions={[version()]} onRestore={vi.fn()} />);
    const compare = screen.getByRole("button", { name: "Compare" });

    await userEvent.click(compare);
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByRole("button", { name: "Compare" })).toHaveAttribute("aria-expanded", "false");
  });

  it("explains an empty history instead of showing nothing", () => {
    render(<VersionHistory versions={[]} onRestore={vi.fn()} />);
    expect(screen.getByText(/Every edit and accepted AI change will appear here/)).toBeInTheDocument();
  });

  it("announces loading to assistive technology", () => {
    render(<VersionHistory versions={[]} loading onRestore={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading history/);
  });

  it("lists several versions independently", async () => {
    render(
      <VersionHistory
        versions={[version({ id: "v2" }), version({ id: "v1", action: "manual", provider: null, model: null })]}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);

    await userEvent.click(screen.getAllByRole("button", { name: "Compare" })[0]);
    // Opening one diff must not open the other.
    expect(screen.getAllByRole("button", { name: "Compare" })).toHaveLength(1);
  });
});

/**
 * Phase 17B §29: the label has to be the action that happened. Reusing "AI
 * insert" for an evidence insertion would make the history misreport the one
 * distinction it exists to keep.
 */
describe("action labels", () => {
  it("calls an evidence insertion an evidence insertion, not an AI change", () => {
    render(
      <VersionHistory
        versions={[version({ action: "evidence_insert", provider: null, model: null, section_action: "citation_only" })]}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByText(/Evidence insert/)).toBeInTheDocument();
    expect(screen.queryByText(/AI insert/)).not.toBeInTheDocument();
  });

  it("marks a restore as a restore", () => {
    render(
      <VersionHistory
        versions={[version({ action: "restore", provider: null, model: null, restored_from_version_id: "v0" })]}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByText(/Restored/)).toBeInTheDocument();
  });
});
