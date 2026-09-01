// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionReviewPanel from "../SectionReviewPanel";
import type { SectionHealth } from "@/lib/evidence/section-review";

/**
 * Phase 17 §26, closing Phase 16 gap #6. These assert researcher-visible
 * behaviour — what a score says, whether an issue is actionable — not markup.
 */
function health(over: Partial<SectionHealth> = {}): SectionHealth {
  return {
    section: "research_problem",
    completeness: 0.8,
    evidenceCoverage: 0.7,
    researchAlignment: 0.9,
    citationIntegrity: null,
    coverage: {
      requiring: 10,
      supported: 7,
      partiallySupported: 0,
      unsupported: 3,
      needsVerification: 0,
      coverage: 0.7,
      explanation: "10 claim(s) require evidence: 7 supported.",
    },
    findings: [],
    explanations: {
      completeness: "240 words against a rough target of 300.",
      evidenceCoverage: "10 claim(s) require evidence: 7 supported.",
      researchAlignment: "1 of 1 prior sections has content.",
      citationIntegrity: "No citations in this section yet.",
    },
    ...over,
  };
}

describe("section health display", () => {
  it("shows each computed score as a percentage", () => {
    render(<SectionReviewPanel health={health()} onRefresh={vi.fn()} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("shows the explanation beside every score, so no number is unexplained", () => {
    render(<SectionReviewPanel health={health()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/10 claim\(s\) require evidence/)).toBeInTheDocument();
  });

  it("renders a non-computable dimension as n/a rather than inventing a number", () => {
    render(<SectionReviewPanel health={health()} onRefresh={vi.fn()} />);
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText(/No citations in this section yet/)).toBeInTheDocument();
  });

  it("exposes each score as an accessible meter", () => {
    render(<SectionReviewPanel health={health()} onRefresh={vi.fn()} />);
    const meter = screen.getByRole("meter", { name: "Evidence coverage" });
    expect(meter).toHaveAttribute("aria-valuenow", "70");
  });

  it("marks a non-applicable meter with no value rather than zero", () => {
    render(<SectionReviewPanel health={health()} onRefresh={vi.fn()} />);
    const meter = screen.getByRole("meter", { name: "Citation integrity" });
    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(meter).toHaveAttribute("aria-valuetext", "not applicable");
  });
});

describe("findings", () => {
  const withFinding = health({
    findings: [
      {
        severity: "HIGH",
        section: "research_problem",
        claim: "Postpartum depression affects maternal wellbeing.",
        reason: "This claim needs evidence and none has been verified yet.",
        recommendation: "Use Find Evidence to attach a source.",
        action: "find_evidence",
      },
    ],
  });

  it("shows the claim, reason and recommendation together", () => {
    render(<SectionReviewPanel health={withFinding} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Postpartum depression affects maternal wellbeing/)).toBeInTheDocument();
    expect(screen.getByText(/none has been verified yet/)).toBeInTheDocument();
    expect(screen.getByText(/Use Find Evidence/)).toBeInTheDocument();
  });

  it("offers the finding's next step as an action", async () => {
    const onAction = vi.fn();
    render(<SectionReviewPanel health={withFinding} onRefresh={vi.fn()} onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Find evidence" }));
    expect(onAction).toHaveBeenCalledWith("find_evidence", "Postpartum depression affects maternal wellbeing.");
  });

  it("says a clean result means the checks passed, not that the section is finished", () => {
    render(<SectionReviewPanel health={health()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/not that the section is finished/)).toBeInTheDocument();
  });

  it("counts the findings in the heading", () => {
    render(<SectionReviewPanel health={withFinding} onRefresh={vi.fn()} />);
    expect(screen.getByText("Potential issues (1)")).toBeInTheDocument();
  });
});

describe("empty and loading states", () => {
  it("offers a useful empty state rather than 'nothing here'", async () => {
    const onRefresh = vi.fn();
    render(<SectionReviewPanel health={null} onRefresh={onRefresh} />);

    expect(screen.getByText(/hasn’t been checked yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check this section" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("announces the loading state to assistive technology", () => {
    render(<SectionReviewPanel health={null} loading onRefresh={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Running the section checks/);
  });

  it("disables refresh while a check is running", () => {
    render(<SectionReviewPanel health={null} loading onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  });
});
