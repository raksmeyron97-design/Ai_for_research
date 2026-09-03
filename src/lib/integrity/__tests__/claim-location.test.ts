import { describe, expect, it } from "vitest";
import { locateClaimInSection } from "../claim-location";

const CLAIM = "Teacher motivation was positively associated with student performance.";

function claim(over: Partial<Parameters<typeof locateClaimInSection>[1]> = {}) {
  return {
    claim_text: CLAIM,
    source_offset_start: null,
    source_offset_end: null,
    ...over,
  };
}

describe("finding a claim in its section", () => {
  it("locates a sentence that is still there", () => {
    const content = `Intro. ${CLAIM} Outro.`;
    const result = locateClaimInSection(content, claim());
    expect(result.outcome).toBe("located");
    expect(result.matchedBy).toBe("text");
    expect(content.slice(result.start!, result.end!)).toBe(CLAIM);
  });

  it("tolerates the whitespace a textarea introduces", () => {
    // An extracted sentence and the sentence on screen routinely differ by a
    // line break where the editor wrapped it.
    const content = `Intro.\n\nTeacher motivation was positively\nassociated with student performance.\n\nOutro.`;
    const result = locateClaimInSection(content, claim());
    expect(result.outcome).toBe("located");
    expect(content.slice(result.start!, result.end!)).toContain("Teacher motivation");
  });

  it("reports claim_not_located when the sentence was rewritten", () => {
    const content = "Intro. Teacher motivation showed no association with performance. Outro.";
    const result = locateClaimInSection(content, claim());
    expect(result.outcome).toBe("claim_not_located");
    expect(result.start).toBeNull();
    expect(result.explanation).toContain("no longer in the section");
  });

  it("reports an empty section as its own state", () => {
    // "Nothing written yet" and "you edited this sentence away" are different
    // things to tell a researcher.
    expect(locateClaimInSection("   ", claim()).outcome).toBe("section_empty");
  });
});

describe("stored offsets disambiguate, but never override the text (§13)", () => {
  it("uses offsets to pick the right one of two identical sentences", () => {
    // This is the only case where offsets add anything: text search returns
    // the first occurrence, and the claim may have come from the second.
    // Highlighting the wrong identical sentence quietly puts the researcher
    // in the wrong paragraph.
    const content = `First paragraph. ${CLAIM} Second paragraph. ${CLAIM} End.`;
    const second = content.lastIndexOf(CLAIM);
    const result = locateClaimInSection(content, {
      claim_text: CLAIM,
      source_offset_start: second,
      source_offset_end: second + CLAIM.length,
    });
    expect(result.outcome).toBe("located");
    expect(result.matchedBy).toBe("offset");
    expect(result.start).toBe(second);
  });

  it("falls back to the first occurrence when there are no offsets", () => {
    const content = `First paragraph. ${CLAIM} Second paragraph. ${CLAIM} End.`;
    const result = locateClaimInSection(content, claim());
    expect(result.matchedBy).toBe("text");
    expect(result.start).toBe(content.indexOf(CLAIM));
  });

  it("refuses offsets that now point at different text", () => {
    // This is the brittleness the phase brief warns about: a drifted offset
    // points at the wrong sentence with total confidence.
    const content = "A completely different opening sentence sits here now. Outro.";
    const result = locateClaimInSection(content, {
      claim_text: CLAIM,
      source_offset_start: 0,
      source_offset_end: 20,
    });
    expect(result.outcome).toBe("claim_not_located");
  });

  it("ignores offsets that run past the end of the text", () => {
    const result = locateClaimInSection("Short.", {
      claim_text: CLAIM,
      source_offset_start: 100,
      source_offset_end: 200,
    });
    expect(result.outcome).toBe("claim_not_located");
  });

  it("ignores a reversed or empty offset span", () => {
    const content = `Intro. ${CLAIM} Outro.`;
    const reversed = locateClaimInSection(content, {
      claim_text: "not present anywhere",
      source_offset_start: 30,
      source_offset_end: 10,
    });
    expect(reversed.outcome).toBe("claim_not_located");
  });

  it("never returns a span it did not verify against the claim text", () => {
    // The invariant behind every case above: if something is returned, the
    // text at that span is the claim.
    const contents = [
      `Intro. ${CLAIM} Outro.`,
      `${CLAIM}`,
      `Intro.\n${CLAIM}\nOutro.`,
      "Nothing like it here.",
    ];
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const content of contents) {
      const result = locateClaimInSection(content, claim());
      if (result.outcome === "located") {
        expect(normalise(content.slice(result.start!, result.end!))).toBe(normalise(CLAIM));
      }
    }
  });
});
