// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MethodologyFindings from "../MethodologyFindings";
import type { MethodologyFinding } from "@/lib/methodology/types";

function finding(over: Partial<MethodologyFinding> = {}): MethodologyFinding {
  return {
    id: "construct-unmeasured-con-a",
    category: "measurement_coverage",
    severity: "error",
    title: "Construct is not measured by anything",
    explanation: "No questionnaire item measures “Teacher motivation”.",
    provenance: "deterministic",
    targetType: "construct",
    targetId: "con-a",
    remediation: "Add items for this construct.",
    ...over,
  };
}

describe("MethodologyFindings", () => {
  it("says the checks passed rather than that the work is finished", () => {
    render(<MethodologyFindings findings={[]} />);
    expect(screen.getByText(/not that the methodology is finished/i)).toBeInTheDocument();
  });

  it("groups by severity with a count", () => {
    render(
      <MethodologyFindings
        findings={[finding(), finding({ id: "b", severity: "warning" }), finding({ id: "c", severity: "info" })]}
      />,
    );
    expect(screen.getByText("Needs attention (1)")).toBeInTheDocument();
    expect(screen.getByText("Gaps (1)")).toBeInTheDocument();
    expect(screen.getByText("Worth a look (1)")).toBeInTheDocument();
  });

  // §1.3 / §21: a fact about stored rows and a model's reading must not look
  // the same. The badge is the difference.
  it("distinguishes a deterministic finding from an AI-suggested one", () => {
    render(
      <MethodologyFindings
        findings={[finding(), finding({ id: "b", provenance: "ai_suggested", severity: "info" })]}
      />,
    );
    expect(screen.getByText("CHECKED")).toBeInTheDocument();
    expect(screen.getByText("AI SUGGESTED")).toBeInTheDocument();
  });

  it("shows the remediation as a next step", () => {
    render(<MethodologyFindings findings={[finding()]} />);
    expect(screen.getByText("Add items for this construct.")).toBeInTheDocument();
  });

  it("shows the evidence the finding rests on", () => {
    render(<MethodologyFindings findings={[finding({ evidence: "I feel motivated." })]} />);
    expect(screen.getByText("I feel motivated.")).toBeInTheDocument();
  });

  it("navigates to the object the finding is about", async () => {
    const onNavigate = vi.fn();
    render(<MethodologyFindings findings={[finding()]} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: /Go to construct/ }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ targetId: "con-a" }));
  });

  // §21: normal incompleteness must not be dressed as an emergency.
  it("describes the low-severity group as prompts rather than defects", () => {
    render(<MethodologyFindings findings={[finding({ severity: "info" })]} />);
    expect(screen.getByText(/Prompts to check something, not defects/i)).toBeInTheDocument();
  });
});
