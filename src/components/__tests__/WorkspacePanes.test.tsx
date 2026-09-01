// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspacePanes from "../WorkspacePanes";

/** Phase 17 §24/§25/§36 — mobile navigation, accessible tabs, no state loss. */
function setup() {
  return render(
    <WorkspacePanes
      navigator={<div>Navigator content</div>}
      editor={<textarea aria-label="Section editor" defaultValue="" />}
      assistant={<div>Assistant content</div>}
    />,
  );
}

describe("responsive workspace panes", () => {
  it("opens on the editor, which is what a researcher came to do", () => {
    setup();
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches panes on click", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: "AI Assist" }));

    expect(screen.getByRole("tab", { name: "AI Assist" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "AI Assist" })).toBeVisible();
  });

  it("renders each pane exactly once, so no control is duplicated", () => {
    setup();
    // Rendering a separate mobile and desktop layout would duplicate every
    // interactive control and every id inside the panes.
    expect(screen.getAllByLabelText("Section editor")).toHaveLength(1);
    expect(screen.getAllByText("Navigator content")).toHaveLength(1);
  });

  it("keeps every pane mounted, so switching tabs does not discard work", async () => {
    setup();
    const editor = screen.getByLabelText("Section editor");
    await userEvent.type(editor, "draft in progress");

    await userEvent.click(screen.getByRole("tab", { name: "Sections" }));
    await userEvent.click(screen.getByRole("tab", { name: "Editor" }));

    // Unmounting inactive panes would have thrown this away, along with any
    // AI suggestion waiting for review.
    expect(screen.getByLabelText("Section editor")).toHaveValue("draft in progress");
  });

  it("moves between tabs with arrow keys", async () => {
    setup();
    const editorTab = screen.getByRole("tab", { name: "Editor" });
    editorTab.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "AI Assist" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around at the ends rather than dead-ending", async () => {
    setup();
    screen.getByRole("tab", { name: "Editor" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Sections" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "AI Assist" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps only the active tab in the tab order", async () => {
    setup();
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Sections" })).toHaveAttribute("tabindex", "-1");
  });

  it("labels the tablist", () => {
    setup();
    expect(screen.getByRole("tablist", { name: "Workspace panes" })).toBeInTheDocument();
  });

  it("keeps all three panes mounted for the desktop grid", () => {
    setup();
    // All three exist in the DOM at all times; CSS decides visibility, so the
    // desktop three-column workflow is untouched.
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);
  });
});
