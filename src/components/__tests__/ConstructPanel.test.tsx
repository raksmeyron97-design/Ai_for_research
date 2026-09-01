// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConstructPanel from "../ConstructPanel";
import { construct, indicator } from "@/lib/methodology/__tests__/fixtures";

function setup(props: Partial<Parameters<typeof ConstructPanel>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onAddIndicator: vi.fn(),
  };
  render(<ConstructPanel constructs={[]} indicators={[]} {...handlers} {...props} />);
  return handlers;
}

describe("ConstructPanel", () => {
  it("explains what constructs are for when there are none", () => {
    setup();
    expect(screen.getByText(/concepts your questions are about/i)).toBeInTheDocument();
  });

  it("adds a construct with its role", async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText("New construct name"), "Teacher motivation");
    await userEvent.selectOptions(screen.getByLabelText("Role in the study"), "independent");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("Teacher motivation", "independent");
  });

  // §9: the gap between the two definitions is the thing worth seeing.
  it("names the missing operational definition in the summary line", () => {
    setup({ constructs: [construct({ id: "con-a", operational_definition: null })] });
    expect(screen.getByText(/no operational definition/)).toBeInTheDocument();
  });

  it("keeps the two definitions as separate labelled fields", async () => {
    setup({ constructs: [construct({ id: "con-a" })] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText(/Conceptual definition — what the concept means/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Operational definition — how it will be observed/)).toBeInTheDocument();
  });

  it("saves a definition when the field loses focus", async () => {
    const { onUpdate } = setup({ constructs: [construct({ id: "con-a", operational_definition: null })] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText(/Operational definition/);
    await userEvent.type(field, "Mean of four items.");
    await userEvent.tab();
    expect(onUpdate).toHaveBeenCalledWith("con-a", { operationalDefinition: "Mean of four items." });
  });

  it("adds an indicator with an optional dimension", async () => {
    const { onAddIndicator } = setup({ constructs: [construct({ id: "con-a" })] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("New indicator name"), "Job satisfaction");
    await userEvent.type(screen.getByLabelText("Dimension (optional)"), "Intrinsic");
    await userEvent.click(screen.getByRole("button", { name: "Add indicator" }));
    expect(onAddIndicator).toHaveBeenCalledWith("con-a", "Job satisfaction", "Intrinsic");
  });

  it("lists the indicators under a construct", async () => {
    setup({
      constructs: [construct({ id: "con-a" })],
      indicators: [indicator({ id: "ind-a", construct_id: "con-a", name: "Job satisfaction", dimension: "Intrinsic" })],
    });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Job satisfaction · Intrinsic")).toBeInTheDocument();
  });

  // §22 / §1.3: an unconfirmed suggestion is not the researcher's own work yet.
  it("marks an unconfirmed AI construct and offers to confirm it", async () => {
    const { onUpdate } = setup({
      constructs: [construct({ id: "con-a", provenance: "ai_suggested", confirmed: false })],
    });
    expect(screen.getByText("AI SUGGESTED")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onUpdate).toHaveBeenCalledWith("con-a", { confirmed: true });
  });

  it("does not mark a confirmed construct as a suggestion", () => {
    setup({ constructs: [construct({ id: "con-a", provenance: "ai_suggested", confirmed: true })] });
    expect(screen.queryByText("AI SUGGESTED")).not.toBeInTheDocument();
  });
});
