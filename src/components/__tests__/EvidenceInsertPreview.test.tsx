// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EvidenceInsertPreview from "../EvidenceInsertPreview";
import type { EvidenceCardModel } from "../EvidenceCard";

const EVIDENCE: EvidenceCardModel = {
  id: "chunk-1",
  sourceTitle: "Antenatal depressive symptoms",
  authors: ["Sok, D."],
  year: 2024,
  sourceType: "article",
  tier: 2,
  citationKey: "sok2024",
  sourceStatus: "user_provided",
  excerpt: "Depressive symptoms were reported by 21% of postpartum women.",
  page: 14,
  sectionLabel: "Results",
  relevance: "83% semantic match",
};

const CLAIM = "Postpartum depression can affect maternal wellbeing.";

function setup(onInsert = vi.fn()) {
  render(
    <EvidenceInsertPreview
      claimText={CLAIM}
      evidence={EVIDENCE}
      onInsert={onInsert}
      onCancel={vi.fn()}
      error={null}
    />,
  );
  return onInsert;
}

describe("the preview before insertion", () => {
  it("shows the claim, the excerpt, the source, the page and the citation", () => {
    setup();
    expect(screen.getByText(CLAIM)).toBeInTheDocument();
    expect(screen.getByText(/21% of postpartum women/)).toBeInTheDocument();
    expect(screen.getByText("Antenatal depressive symptoms")).toBeInTheDocument();
    expect(screen.getByText("p. 14")).toBeInTheDocument();
    expect(screen.getByText("[sok2024]")).toBeInTheDocument();
  });

  it("does not preselect Supported — attaching a source is not the same as checking it", () => {
    setup();
    expect(screen.getByRole("radio", { name: /Needs review/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Supported/ })).not.toBeChecked();
  });

  it("requires an explicit choice before inserting, and passes it on", async () => {
    const onInsert = setup();
    await userEvent.click(screen.getByRole("radio", { name: /^Supported/ }));
    await userEvent.click(screen.getByRole("button", { name: "Insert evidence" }));

    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ support: "SUPPORTED", mode: "evidence_citation" }),
    );
  });

  it("will not replace the researcher's sentence without wording they typed", async () => {
    const onInsert = setup();
    await userEvent.click(screen.getByRole("radio", { name: /Replace claim/ }));

    const insert = screen.getByRole("button", { name: "Insert evidence" });
    expect(insert).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText("Replacement wording"),
      "Postpartum depression is associated with reduced maternal wellbeing.",
    );
    expect(insert).toBeEnabled();

    await userEvent.click(insert);
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "replace_claim",
        replacementText: "Postpartum depression is associated with reduced maternal wellbeing.",
      }),
    );
  });

  it("offers all three insertion modes, with evidence + citation as the default", () => {
    setup();
    expect(screen.getByRole("radio", { name: /Citation only/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Evidence \+ citation/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Replace claim/ })).toBeInTheDocument();
  });

  it("says the page is not recorded rather than leaving it blank", () => {
    render(
      <EvidenceInsertPreview
        claimText={CLAIM}
        evidence={{ ...EVIDENCE, page: null }}
        onInsert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
  });
});
