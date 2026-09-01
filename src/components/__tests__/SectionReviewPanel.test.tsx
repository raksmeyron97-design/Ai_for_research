// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionReviewPanel from "../SectionReviewPanel";
import type { SectionReview } from "@/lib/evidence/section-review-service";

/**
 * Phase 17 §26 / Phase 17B §31. These assert researcher-visible behaviour —
 * what a score says, whether an issue is actionable — not markup.
 */
function review(over: Partial<SectionReview> = {}): SectionReview {
  return {
    sectionId: "s1",
    sectionType: "research_problem",
    completeness: { value: 0.8, label: "Completeness", explanation: "240 words against a rough target of 300." },
    evidenceCoverage: {
      value: 0.7,
      label: "Evidence coverage",
      explanation: "10 claim(s) require evidence: 7 supported.",
    },
    alignment: { value: 0.9, label: "Research alignment", explanation: "1 of 1 prior sections has content." },
    citationIntegrity: {
      value: null,
      label: "Citation integrity",
      explanation: "No citations in this section yet.",
    },
    issues: [],
    coverage: {
      requiring: 10,
      supported: 7,
      partiallySupported: 0,
      unsupported: 3,
      needsVerification: 0,
      coverage: 0.7,
      explanation: "10 claim(s) require evidence: 7 supported.",
    },
    checkedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("section health display", () => {
  it("shows each computed score as a percentage", () => {
    render(<SectionReviewPanel review={review()} onRefresh={vi.fn()} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("shows the explanation beside every score, so no number is unexplained", () => {
    render(<SectionReviewPanel review={review()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/10 claim\(s\) require evidence/)).toBeInTheDocument();
  });

  it("renders a non-computable dimension as n/a rather than inventing a number", () => {
    render(<SectionReviewPanel review={review()} onRefresh={vi.fn()} />);
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText("No citations in this section yet.")).toBeInTheDocument();
  });

  it("exposes each score as an accessible meter", () => {
    render(<SectionReviewPanel review={review()} onRefresh={vi.fn()} />);
    expect(screen.getByRole("meter", { name: "Completeness" })).toHaveAttribute("aria-valuenow", "80");
  });

  it("marks a non-applicable meter with no value rather than zero", () => {
    render(<SectionReviewPanel review={review()} onRefresh={vi.fn()} />);
    const meter = screen.getByRole("meter", { name: "Citation integrity" });
    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(meter).toHaveAttribute("aria-valuetext", "not applicable");
  });
});

describe("issues", () => {
  const withIssue = review({
    issues: [
      {
        severity: "HIGH",
        claim: "Postpartum depression affects maternal wellbeing.",
        claimId: "claim-1",
        reason: "This factual claim has no linked evidence.",
        recommendation: "Use Find Evidence to attach a source.",
        action: "find_evidence",
      },
    ],
  });

  it("shows the claim, reason and recommendation together", () => {
    render(<SectionReviewPanel review={withIssue} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Postpartum depression affects maternal wellbeing/)).toBeInTheDocument();
    expect(screen.getByText("This factual claim has no linked evidence.")).toBeInTheDocument();
    expect(screen.getByText("Use Find Evidence to attach a source.")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("offers the issue's next step as an action carrying the claim it concerns", async () => {
    const onAction = vi.fn();
    render(<SectionReviewPanel review={withIssue} onRefresh={vi.fn()} onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Find evidence" }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ claimId: "claim-1", action: "find_evidence" }));
  });

  it("says a clean result means the checks passed, not that the section is finished", () => {
    render(<SectionReviewPanel review={review()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/not that the section is finished/)).toBeInTheDocument();
  });

  it("counts the issues in the heading", () => {
    render(<SectionReviewPanel review={withIssue} onRefresh={vi.fn()} />);
    expect(screen.getByText("Potential issues (1)")).toBeInTheDocument();
  });
});

describe("states before a result exists", () => {
  it("invites a first check rather than showing empty bars", async () => {
    const onRefresh = vi.fn();
    render(<SectionReviewPanel review={null} onRefresh={onRefresh} />);

    await userEvent.click(screen.getByRole("button", { name: "Check this section" }));
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("announces that the checks are running", () => {
    render(<SectionReviewPanel review={null} loading onRefresh={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Running the section checks…");
  });

  it("shows a failure as an alert instead of a plausible score", () => {
    render(<SectionReviewPanel review={null} error="The section check could not run." onRefresh={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The section check could not run.");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});
