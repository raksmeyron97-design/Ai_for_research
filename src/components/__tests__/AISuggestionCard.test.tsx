// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AISuggestionCard from "../AISuggestionCard";

function setup(props: Partial<Parameters<typeof AISuggestionCard>[0]> = {}) {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  render(
    <ul>
      <AISuggestionCard
        title="Teacher motivation"
        rationale="Named in the question."
        onAccept={onAccept}
        onReject={onReject}
        {...props}
      />
    </ul>,
  );
  return { onAccept, onReject };
}

describe("AISuggestionCard", () => {
  // §1.3: a proposal must never be presentable as a decision.
  it("always labels itself as a suggestion", () => {
    setup();
    expect(screen.getByText("AI SUGGESTED")).toBeInTheDocument();
  });

  it("keeps the reasoning behind a disclosure rather than in the way", async () => {
    setup();
    expect(screen.queryByText("Named in the question.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Why this?" }));
    expect(screen.getByText("Named in the question.")).toBeInTheDocument();
  });

  it("accepts and rejects", async () => {
    const { onAccept, onReject } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalled();
  });

  // Editing is not a separate mode: the editable text *is* the proposal.
  it("lets the researcher edit the proposal before accepting it", async () => {
    const onEditableTextChange = vi.fn();
    setup({ editableText: "Teacher motivation", onEditableTextChange });
    const box = screen.getByLabelText(/Edit this suggestion/i);
    await userEvent.type(box, "!");
    expect(onEditableTextChange).toHaveBeenCalled();
  });

  it("blocks accepting when the proposal cannot be used as it stands, and says why", () => {
    setup({ disabledReason: "This suggestion names no outcome." });
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByText("This suggestion names no outcome.")).toBeInTheDocument();
  });

  // Rejecting must still be possible while a save is in flight — otherwise a
  // stuck request traps the proposal on screen.
  it("shows a saving state without disabling reject", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
