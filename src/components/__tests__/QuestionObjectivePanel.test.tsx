// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionObjectivePanel from "../QuestionObjectivePanel";
import { objective, researchQuestion } from "@/lib/methodology/__tests__/fixtures";

function setup(props: Partial<Parameters<typeof QuestionObjectivePanel>[0]> = {}) {
  const handlers = {
    onAddQuestion: vi.fn(),
    onAddObjective: vi.fn(),
    onDeleteQuestion: vi.fn(),
  };
  render(<QuestionObjectivePanel questions={[]} objectives={[]} {...handlers} {...props} />);
  return handlers;
}

describe("QuestionObjectivePanel", () => {
  it("explains why research questions come first when there are none", () => {
    setup();
    expect(screen.getByText(/everything else in the methodology traces back/i)).toBeInTheDocument();
  });

  it("adds a question and clears the field", async () => {
    const { onAddQuestion } = setup();
    const input = screen.getByLabelText("New research question");
    await userEvent.type(input, "What is the effect of X on Y?");
    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(onAddQuestion).toHaveBeenCalledWith("What is the effect of X on Y?");
    expect(input).toHaveValue("");
  });

  it("cannot submit an empty question", () => {
    setup();
    expect(screen.getByRole("button", { name: "Add question" })).toBeDisabled();
  });

  // The point of showing them together: the gap is visible without holding the
  // other list in your head.
  it("names a question that has no objective under it", () => {
    setup({ questions: [researchQuestion({ id: "rq-a" })] });
    expect(screen.getByText("No objective yet for this question.")).toBeInTheDocument();
  });

  it("lists the objectives under their question", () => {
    setup({
      questions: [researchQuestion({ id: "rq-a" })],
      objectives: [objective({ id: "obj-a", question_id: "rq-a", objective_text: "To measure the association." })],
    });
    expect(screen.getByText("To measure the association.")).toBeInTheDocument();
    expect(screen.queryByText("No objective yet for this question.")).not.toBeInTheDocument();
  });

  it("lets an objective be added with no question yet", async () => {
    const { onAddObjective } = setup({ questions: [researchQuestion({ id: "rq-a" })] });
    await userEvent.type(screen.getByLabelText("New objective"), "To describe the sample.");
    await userEvent.click(screen.getByRole("button", { name: "Add objective" }));
    expect(onAddObjective).toHaveBeenCalledWith("To describe the sample.", null);
  });

  it("attaches a new objective to the chosen question", async () => {
    const { onAddObjective } = setup({ questions: [researchQuestion({ id: "rq-a" })] });
    await userEvent.type(screen.getByLabelText("New objective"), "To measure it.");
    await userEvent.selectOptions(screen.getByLabelText(/Research question this objective serves/), "rq-a");
    await userEvent.click(screen.getByRole("button", { name: "Add objective" }));
    expect(onAddObjective).toHaveBeenCalledWith("To measure it.", "rq-a");
  });

  it("blocks accepting a suggested construct the project already has", () => {
    setup({
      questions: [researchQuestion({ id: "rq-a" })],
      suggestionsFor: "rq-a",
      suggestions: [
        {
          name: "Teacher motivation",
          role: "independent",
          conceptualDefinition: "Willingness.",
          rationale: "In the question.",
          alreadyExists: true,
        },
      ],
      onAcceptConstruct: vi.fn(),
      onRejectConstruct: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Add construct" })).toBeDisabled();
    expect(screen.getByText(/already exists in the project/i)).toBeInTheDocument();
  });

  it("passes the edited name, not the proposed one, when accepting", async () => {
    const onAcceptConstruct = vi.fn();
    setup({
      questions: [researchQuestion({ id: "rq-a" })],
      suggestionsFor: "rq-a",
      suggestions: [
        {
          name: "Motivation",
          role: "independent",
          conceptualDefinition: "Willingness.",
          rationale: "In the question.",
          alreadyExists: false,
        },
      ],
      onAcceptConstruct,
      onRejectConstruct: vi.fn(),
    });

    await userEvent.type(screen.getByLabelText(/Edit this suggestion/i), " of teachers");
    await userEvent.click(screen.getByRole("button", { name: "Add construct" }));
    expect(onAcceptConstruct).toHaveBeenCalledWith(expect.anything(), "Motivation of teachers");
  });
});
