import { describe, expect, it } from "vitest";
import { locateClaim, placeCitation, replaceClaimText } from "../citation-insertion";

const SECTION = `Maternal mental health is under-researched locally.

Postpartum depression can affect maternal wellbeing. Screening is inconsistent.`;

describe("locating a claim in the section", () => {
  it("finds it verbatim", () => {
    expect(locateClaim(SECTION, "Screening is inconsistent.")).not.toBeNull();
  });

  it("tolerates the whitespace differences a textarea introduces", () => {
    const wrapped = "Postpartum depression can\n   affect maternal wellbeing.";
    const content = `Intro.\n\n${wrapped} More text.`;
    expect(locateClaim(content, "Postpartum depression can affect maternal wellbeing.")).not.toBeNull();
  });

  it("returns null when the sentence is no longer there", () => {
    expect(locateClaim(SECTION, "A sentence that was deleted.")).toBeNull();
  });
});

describe("placing a citation", () => {
  it("writes the key before the sentence's closing punctuation", () => {
    const result = placeCitation(SECTION, "Postpartum depression can affect maternal wellbeing.", "sok2024");
    expect(result.outcome).toBe("placed");
    expect(result.content).toContain("maternal wellbeing [sok2024].");
  });

  it("leaves the text alone when the claim cannot be found", () => {
    const result = placeCitation(SECTION, "A claim that was edited away.", "sok2024");
    expect(result.outcome).toBe("claim_not_located");
    expect(result.content).toBe(SECTION);
  });

  it("does not add the same citation twice", () => {
    const once = placeCitation(SECTION, "Screening is inconsistent.", "sok2024");
    const twice = placeCitation(once.content, "Screening is inconsistent [sok2024].", "sok2024");
    expect(twice.outcome).toBe("already_present");
    expect(twice.content).toBe(once.content);
  });

  it("only trusts stored offsets when the text they point at still matches", () => {
    const stale = placeCitation(SECTION, "A claim that moved.", "sok2024", { start: 0, end: 10 });
    expect(stale.outcome).toBe("claim_not_located");

    const start = SECTION.indexOf("Screening is inconsistent.");
    const fresh = placeCitation(SECTION, "Screening is inconsistent.", "sok2024", {
      start,
      end: start + "Screening is inconsistent.".length,
    });
    expect(fresh.outcome).toBe("placed");
  });
});

describe("replacing a claim", () => {
  it("swaps only the claim's own sentence", () => {
    const result = replaceClaimText(
      SECTION,
      "Postpartum depression can affect maternal wellbeing.",
      "Postpartum depression is associated with reduced maternal wellbeing.",
    );
    expect(result.outcome).toBe("placed");
    expect(result.content).toContain("is associated with reduced maternal wellbeing.");
    expect(result.content).toContain("Screening is inconsistent.");
    expect(result.content).not.toContain("can affect maternal wellbeing");
  });

  it("changes nothing when the claim is gone, rather than guessing where it was", () => {
    const result = replaceClaimText(SECTION, "Not in the text.", "Replacement.");
    expect(result.content).toBe(SECTION);
    expect(result.outcome).toBe("claim_not_located");
  });
});
