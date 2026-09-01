// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionReviewPane from "../SectionReviewPane";
import type { SectionReview } from "@/lib/evidence/section-review-service";

/**
 * The mounted review (§3): one fetch of one normalized response, and a
 * recheck when the workspace says something changed.
 */
function review(coverage: number | null): SectionReview {
  return {
    sectionId: "s1",
    sectionType: "research_problem",
    // Distinct values throughout, so a percentage assertion can only match the
    // metric it names.
    completeness: { value: 0.42, label: "Completeness", explanation: "126 words against 300." },
    evidenceCoverage: { value: coverage, label: "Evidence coverage", explanation: "2 claims require evidence." },
    alignment: { value: 0.9, label: "Research alignment", explanation: "9 of 10." },
    citationIntegrity: { value: 0.8, label: "Citation integrity", explanation: "4 of 5 resolve." },
    issues: [],
    coverage: {
      requiring: 2,
      supported: coverage === null ? 0 : coverage * 2,
      partiallySupported: 0,
      unsupported: 0,
      needsVerification: 0,
      coverage,
      explanation: "2 claims require evidence.",
    },
    checkedAt: "2026-09-01T00:00:00.000Z",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("mounted section review", () => {
  it("makes one request for the whole review, not one per metric", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ review: review(0.5) }) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SectionReviewPane projectId="p1" sectionType="research_problem" refreshToken={0} />);

    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Evidence coverage" })).toHaveAttribute("aria-valuenow", "50");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/research/projects/p1/sections/research_problem/review");
  });

  it("rechecks when the workspace says the rows changed, and the number moves", async () => {
    let coverage = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ review: review(coverage) }) })),
    );

    const { rerender } = render(
      <SectionReviewPane projectId="p1" sectionType="research_problem" refreshToken={0} />,
    );
    expect(await screen.findByText("0%")).toBeInTheDocument();

    coverage = 1;
    rerender(<SectionReviewPane projectId="p1" sectionType="research_problem" refreshToken={1} />);

    await waitFor(() => expect(screen.getByText("100%")).toBeInTheDocument());
  });

  it("passes an issue's action up rather than acting on it itself", async () => {
    const withIssue = {
      ...review(0),
      issues: [
        {
          severity: "HIGH" as const,
          claim: "A claim.",
          claimId: "claim-1",
          reason: "No linked evidence.",
          recommendation: "Find a source.",
          action: "find_evidence" as const,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ review: withIssue }) })),
    );

    const onIssueAction = vi.fn();
    render(
      <SectionReviewPane
        projectId="p1"
        sectionType="research_problem"
        refreshToken={0}
        onIssueAction={onIssueAction}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));
    expect(onIssueAction).toHaveBeenCalledWith(expect.objectContaining({ claimId: "claim-1" }));
  });

  it("shows a failure rather than an empty set of bars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "The section check could not run." }) })),
    );

    render(<SectionReviewPane projectId="p1" sectionType="research_problem" refreshToken={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The section check could not run.");
  });
});
