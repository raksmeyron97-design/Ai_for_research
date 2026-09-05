// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EvidenceCard, { type EvidenceCardModel } from "../EvidenceCard";

function model(over: Partial<EvidenceCardModel> = {}): EvidenceCardModel {
  return {
    id: "chunk-1",
    sourceTitle: "Antenatal depressive symptoms among women attending urban health centres",
    authors: ["Sok, D.", "Chan, S."],
    year: 2024,
    sourceType: "article",
    tier: 2,
    citationKey: "sok2024",
    sourceStatus: "user_provided",
    excerpt: "Depressive symptoms were reported by 21% of postpartum women in the sample.",
    page: 14,
    sectionLabel: "Results",
    relevance: "83% semantic match · covers 60% of the claim's key terms · tier 2 source",
    ...over,
  };
}

describe("evidence card", () => {
  it("shows what a researcher needs to identify the source", () => {
    render(<EvidenceCard model={model()} />);
    expect(screen.getByText(/Antenatal depressive symptoms/)).toBeInTheDocument();
    // The byline carries authors, year, type and the quality metadata in one
    // line, so it is asserted as one line rather than four loose matches.
    expect(screen.getByText(/Sok, D\. & Chan, S\. · 2024 · article · tier 2 · user provided/)).toBeInTheDocument();
  });

  it("shows the excerpt with where in the source it came from", () => {
    render(<EvidenceCard model={model()} />);
    expect(screen.getByText(/21% of postpartum women/)).toBeInTheDocument();
    expect(screen.getByText("p. 14 · Results")).toBeInTheDocument();
  });

  it("explains why the excerpt is here rather than showing a bare score", () => {
    render(<EvidenceCard model={model()} />);
    expect(screen.getByText(/83% semantic match/)).toBeInTheDocument();
  });

  it("says an off-topic excerpt is off-topic, whatever its source", () => {
    render(
      <EvidenceCard
        model={model({
          offTopic: true,
          relevance: "Low topical match for this claim (4%). Source quality does not change that.",
        })}
      />,
    );
    expect(screen.getByText(/Low topical match/)).toBeInTheDocument();
  });

  it("shows the support judgement once one exists, and nothing before that", () => {
    const { rerender } = render(<EvidenceCard model={model()} />);
    expect(screen.queryByText("Supported")).not.toBeInTheDocument();

    rerender(<EvidenceCard model={model({ support: "SUPPORTED" })} />);
    expect(screen.getByText("Supported")).toBeInTheDocument();
  });

  it("keeps a long excerpt behind View context rather than filling the card", async () => {
    const long = "Long sentence about postpartum outcomes. ".repeat(20);
    render(<EvidenceCard model={model({ excerpt: long })} />);

    const toggle = screen.getByRole("button", { name: "View context" });
    expect(screen.getByText(/…/)).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide context" })).toBeInTheDocument();
  });

  it("starts the insertion flow through Use evidence", async () => {
    const onUse = vi.fn();
    render(<EvidenceCard model={model()} onUse={onUse} />);

    await userEvent.click(screen.getByRole("button", { name: "Use evidence" }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: "chunk-1" }));
  });

  it("flags an excerpt containing instruction-like text as a document problem", () => {
    render(<EvidenceCard model={model({ warning: "looks like an instruction" })} />);
    expect(screen.getByRole("note")).toHaveTextContent(/treated as source content, not as a request/);
  });

  it("offers no action buttons in a read-only listing", () => {
    render(<EvidenceCard model={model({ excerpt: "Short." })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
