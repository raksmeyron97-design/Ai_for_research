// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HypothesisPanel from "../HypothesisPanel";
import { construct, hypothesis, hypothesisVariable, objective } from "@/lib/methodology/__tests__/fixtures";

const CONSTRUCTS = [
  construct({ id: "con-a", name: "Teacher motivation" }),
  construct({ id: "con-b", name: "Student performance" }),
];

function setup(props: Partial<Parameters<typeof HypothesisPanel>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onDelete: vi.fn(),
    onLink: vi.fn(),
    onUnlink: vi.fn(),
  };
  render(
    <HypothesisPanel
      hypotheses={[]}
      links={[]}
      constructs={CONSTRUCTS}
      objectives={[]}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("HypothesisPanel", () => {
  // §8: a descriptive study with no hypotheses is complete, not empty.
  it("says having no hypotheses can be correct", () => {
    setup();
    expect(screen.getByText(/Descriptive and exploratory studies often have none/i)).toBeInTheDocument();
  });

  it("adds a hypothesis with its label, form and objective", async () => {
    const { onAdd } = setup({ objectives: [objective({ id: "obj-a" })] });
    await userEvent.type(screen.getByLabelText("Hypothesis label"), "H1");
    await userEvent.type(screen.getByLabelText("Hypothesis statement"), "X predicts Y.");
    await userEvent.selectOptions(screen.getByLabelText("Hypothesis form"), "prediction");
    await userEvent.selectOptions(screen.getByLabelText(/Objective this hypothesis serves/), "obj-a");
    await userEvent.click(screen.getByRole("button", { name: "Add hypothesis" }));

    expect(onAdd).toHaveBeenCalledWith({
      statement: "X predicts Y.",
      label: "H1",
      form: "prediction",
      objectiveId: "obj-a",
    });
  });

  it("names a hypothesis with no constructs linked", () => {
    setup({ hypotheses: [hypothesis({ id: "hyp-a" })] });
    expect(screen.getByText(/nothing about this hypothesis can be checked/i)).toBeInTheDocument();
  });

  it("shows each construct with the position it occupies", () => {
    setup({
      hypotheses: [hypothesis({ id: "hyp-a" })],
      links: [
        hypothesisVariable({ id: "hv-1", hypothesis_id: "hyp-a", construct_id: "con-a", position: "predictor" }),
        hypothesisVariable({ id: "hv-2", hypothesis_id: "hyp-a", construct_id: "con-b", position: "outcome" }),
      ],
    });
    expect(screen.getByText("Teacher motivation · Predictor")).toBeInTheDocument();
    expect(screen.getByText("Student performance · Outcome")).toBeInTheDocument();
  });

  it("says when a hypothesis has no analysis method", () => {
    setup({ hypotheses: [hypothesis({ id: "hyp-a", analysis_method: null })] });
    expect(screen.getByText(/no analysis method/)).toBeInTheDocument();
  });

  it("links a construct in the chosen position", async () => {
    const { onLink } = setup({ hypotheses: [hypothesis({ id: "hyp-a" })] });
    await userEvent.selectOptions(screen.getByLabelText("Construct to link"), "con-b");
    await userEvent.selectOptions(screen.getByLabelText("Position in the hypothesis"), "outcome");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onLink).toHaveBeenCalledWith("hyp-a", "con-b", "outcome");
  });

  // hasOutcome is recomputed from the links, not read off the form the model
  // chose — a suggestion that names no outcome cannot be accepted.
  it("refuses to accept a suggested hypothesis with no outcome", () => {
    setup({
      suggestions: [
        {
          statement: "Motivation matters.",
          form: "association",
          variables: [{ constructId: "con-a", position: "predictor" }],
          rationale: "From the question.",
          hasOutcome: false,
        },
      ],
      onAcceptSuggestion: vi.fn(),
      onRejectSuggestion: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Add this hypothesis" })).toBeDisabled();
    expect(screen.getByText(/names no outcome/i)).toBeInTheDocument();
  });
});
