// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectWorkspace from "../ProjectWorkspace";

/**
 * §37: the pre-export integrity gate. Warns, never blocks by default — the
 * export route itself is untouched (no mock of it is even needed here,
 * since a warning-free gate check falls straight through to the real
 * export URL); only the gate's own check and the confirm dialog are new.
 *
 * Every other pane is a heavy, independently-tested component — stubbed
 * here so this file stays focused on the one behavior it exists to cover.
 */
vi.mock("@/components/AICopilot", () => ({ default: () => null }));
vi.mock("@/components/DataAnalysisPanel", () => ({ default: () => null }));
vi.mock("@/components/DocumentsPanel", () => ({ default: () => null }));
vi.mock("@/components/EvidencePanel", () => ({ default: () => null }));
vi.mock("@/components/LiteratureWorkspace", () => ({ default: () => null }));
vi.mock("@/components/MethodologyWorkspace", () => ({ default: () => null }));
vi.mock("@/components/QualityCheckPanel", () => ({ default: () => null }));
vi.mock("@/components/QuestionnaireBuilder", () => ({ default: () => null }));
vi.mock("@/components/ResearchIntegrityWorkspace", () => ({ default: () => null }));
vi.mock("@/components/ResearchNavigator", () => ({ default: () => null }));
vi.mock("@/components/SectionHistoryPane", () => ({ default: () => null }));
vi.mock("@/components/SectionReviewPane", () => ({ default: () => null }));
vi.mock("@/components/SectionEditor", () => ({ default: () => null }));

const PROJECT = { id: "p1", user_id: "u1", title: "My Thesis", language: "en" as const, status: "active" as const };

function stub(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/integrity/gate")) {
      if (overrides.gateFails) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ blocking: false, warnings: overrides.warnings ?? [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let originalLocation: Location;
beforeEach(() => {
  stub();
  originalLocation = window.location;
  // jsdom's window.location.href setter navigates for real and errors —
  // replace it with a writable stand-in so triggerExport's fallback path is observable.
  Object.defineProperty(window, "location", { value: { ...originalLocation, href: "" }, writable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
});

describe("pre-export integrity gate", () => {
  it("exports directly when the gate reports no warnings", async () => {
    render(<ProjectWorkspace project={PROJECT as never} initialSections={[]} initialDocuments={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("button", { name: "Word (.docx)" }));

    expect(window.location.href).toContain("/export?format=docx");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a confirm dialog with the warning titles when the gate reports warnings, rather than exporting immediately", async () => {
    stub({ warnings: [{ id: "citation:missing:c1", title: "No citation present" }] });
    render(<ProjectWorkspace project={PROJECT as never} initialSections={[]} initialDocuments={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Research integrity warnings" });
    expect(dialog).toHaveTextContent("No citation present");
    expect(window.location.href).toBe("");
  });

  it("dismisses the dialog on Cancel without exporting", async () => {
    stub({ warnings: [{ id: "citation:missing:c1", title: "No citation present" }] });
    render(<ProjectWorkspace project={PROJECT as never} initialSections={[]} initialDocuments={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("button", { name: "Markdown (.md)" }));
    await screen.findByRole("alertdialog");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(window.location.href).toBe("");
  });

  it("proceeds to the real export URL from Export anyway", async () => {
    stub({ warnings: [{ id: "citation:missing:c1", title: "No citation present" }] });
    render(<ProjectWorkspace project={PROJECT as never} initialSections={[]} initialDocuments={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("button", { name: "Word (.docx)" }));
    const dialog = await screen.findByRole("alertdialog");

    const exportAnyway = within(dialog).getByRole("link", { name: "Export anyway" });
    expect(exportAnyway).toHaveAttribute("href", "/api/research/projects/p1/export?format=docx");
  });

  it("falls through to exporting directly when the gate check itself fails, rather than blocking the researcher", async () => {
    stub({ gateFails: true });
    render(<ProjectWorkspace project={PROJECT as never} initialSections={[]} initialDocuments={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));

    expect(window.location.href).toContain("/export?format=pdf");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
