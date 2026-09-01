// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspacePanes, { type WorkspacePane } from "../WorkspacePanes";

/**
 * Phase 17 §26 / Phase 17B §30-§31.
 *
 * The behaviour worth protecting is not the layout — it is that the panes are
 * rendered once and stay mounted, because that is what stops a mobile layout
 * from becoming a second copy of every control and a second copy of the logic
 * behind it.
 */
function panes(): WorkspacePane[] {
  return [
    { id: "navigator", label: "Sections", region: "navigator", node: <p>navigator content</p> },
    {
      id: "editor",
      label: "Editor",
      region: "editor",
      node: <textarea aria-label="Section text" defaultValue="" />,
    },
    // §30's order: Section -> Editor -> Review -> Evidence -> AI.
    { id: "review", label: "Review", region: "aside", node: <p>review content</p> },
    { id: "evidence", label: "Evidence", region: "aside", node: <p>evidence content</p> },
    { id: "assistant", label: "AI Assist", region: "aside", node: <p>assistant content</p> },
    { id: "history", label: "History", region: "aside", node: <p>history content</p> },
  ];
}

/**
 * Aside panes appear in both tab rows — the mobile row and the desktop aside
 * row — so every query has to say which row it means. That duplication is in
 * the *tabs*, not the panes: the pane content is still rendered once, which is
 * what the "no duplicated control" test checks.
 */
function mobileTab(name: string) {
  return within(screen.getByRole("tablist", { name: "Workspace panes" })).getByRole("tab", { name });
}

function asideTab(name: string) {
  return within(screen.getByRole("tablist", { name: "Assistant panes" })).getByRole("tab", { name });
}

/** Mirrors how ProjectWorkspace owns the aside selection. */
function Harness({ initialAside = "assistant" }: { initialAside?: string }) {
  const [aside, setAside] = useState(initialAside);
  return <WorkspacePanes panes={panes()} activeAside={aside} onAsideChange={setAside} />;
}

describe("workspace panes", () => {
  it("opens on the editor, which is what a researcher came to do", () => {
    render(<Harness />);
    expect(mobileTab("Editor")).toHaveAttribute("aria-selected", "true");
  });

  it("offers every pane in the mobile tab row, including the Phase 17B ones", () => {
    render(<Harness />);
    const tabs = screen.getByRole("tablist", { name: "Workspace panes" });
    const labels = Array.from(tabs.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(labels).toEqual(["Sections", "Editor", "Review", "Evidence", "AI Assist", "History"]);
  });

  it("switches panes on click", async () => {
    render(<Harness />);
    await userEvent.click(mobileTab("Evidence"));
    expect(mobileTab("Evidence")).toHaveAttribute("aria-selected", "true");
    expect(mobileTab("Editor")).toHaveAttribute("aria-selected", "false");
  });

  it("renders each pane exactly once, so no control is duplicated for mobile", () => {
    render(<Harness />);
    expect(screen.getAllByText("navigator content")).toHaveLength(1);
    expect(screen.getAllByLabelText("Section text")).toHaveLength(1);
    expect(screen.getAllByText("evidence content")).toHaveLength(1);
  });

  it("keeps every pane mounted, so switching tabs does not discard work", async () => {
    render(<Harness />);
    const editor = screen.getByLabelText("Section text");
    await userEvent.type(editor, "a half-written paragraph");

    await userEvent.click(mobileTab("Review"));
    await userEvent.click(mobileTab("Editor"));

    expect(screen.getByLabelText("Section text")).toHaveValue("a half-written paragraph");
  });

  it("moves between tabs with arrow keys and wraps at the ends", async () => {
    render(<Harness />);
    mobileTab("Editor").focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(mobileTab("Review")).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(mobileTab("Sections")).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowLeft}");
    expect(mobileTab("History")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps only the active tab in the tab order", () => {
    render(<Harness />);
    expect(mobileTab("Editor")).toHaveAttribute("tabindex", "0");
    expect(mobileTab("Sections")).toHaveAttribute("tabindex", "-1");
  });

  it("labels both tablists, so a screen reader can tell them apart", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Workspace panes" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Assistant panes" })).toBeInTheDocument();
  });

  it("switches the desktop aside column independently of the mobile row", async () => {
    render(<Harness />);
    await userEvent.click(asideTab("Review"));
    expect(asideTab("Review")).toHaveAttribute("aria-selected", "true");
    // The mobile row is unchanged: a researcher on a phone did not just get
    // moved off the editor by a desktop-only control.
    expect(mobileTab("Editor")).toHaveAttribute("aria-selected", "true");
  });
});
