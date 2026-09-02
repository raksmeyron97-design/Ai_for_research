import { describe, expect, it } from "vitest";
import { chunkFixture } from "../../ai/testing/evidence-fixtures";
import { contentWords, lexicalOverlap, rankAll, rankEvidence, sourceQuality } from "../ranking";
import type { ResearchCitationRow } from "../../db/types";

function citation(over: Partial<ResearchCitationRow> = {}): ResearchCitationRow {
  return {
    id: "c1",
    project_id: "p1",
    citation_key: "sok2024",
    title: "A study",
    authors: ["Sok, D."],
    year: new Date().getFullYear(),
    journal: null,
    doi: null,
    pmid: null,
    isbn: null,
    url: null,
    source_type: "article",
    tier: 2,
    status: "user_provided",
    created_at: "",
    ...over,
  };
}

const CLAIM = "Postpartum depression affects maternal wellbeing in the first year.";

describe("lexical overlap", () => {
  it("measures how much of the claim's vocabulary the excerpt covers", () => {
    const full = lexicalOverlap(CLAIM, "Postpartum depression affects maternal wellbeing during the first year.");
    const none = lexicalOverlap(CLAIM, "Soil salinity in coastal rice paddies.");
    expect(full).toBeGreaterThan(0.8);
    expect(none).toBe(0);
  });

  it("does not punish a long excerpt for being long", () => {
    const padding = " ".concat("Additional unrelated sentences. ".repeat(40));
    const short = lexicalOverlap(CLAIM, "Postpartum depression affects maternal wellbeing.");
    const long = lexicalOverlap(CLAIM, `Postpartum depression affects maternal wellbeing.${padding}`);
    expect(long).toBe(short);
  });

  it("finds overlap in Khmer, which has no word spaces", () => {
    const overlap = lexicalOverlap("ជំងឺធ្លាក់ទឹកចិត្តក្រោយសម្រាល", "ការសិក្សាអំពីជំងឺធ្លាក់ទឹកចិត្តក្រោយសម្រាល");
    expect(overlap).toBeGreaterThan(0.5);
  });

  it("keeps domain words rather than stripping them as noise", () => {
    expect(contentWords("maternal health care")).toContain("health");
    expect(contentWords("the and of")).toHaveLength(0);
  });
});

describe("source quality", () => {
  it("ranks a verified tier-1 source above an unverified tier-4 one", () => {
    expect(sourceQuality(citation({ tier: 1, status: "verified" }))).toBeGreaterThan(
      sourceQuality(citation({ tier: 4, status: "unverified" })),
    );
  });

  it("is zero when there is no source at all", () => {
    expect(sourceQuality(undefined)).toBe(0);
  });
});

describe("relevance ranking", () => {
  it("cannot let source quality rescue an irrelevant excerpt", () => {
    const irrelevantButExcellent = rankEvidence({
      claimText: CLAIM,
      section: "research_problem",
      chunk: chunkFixture({ id: "a", content: "Soil salinity in coastal rice paddies.", similarity: 0.02 }),
      citation: citation({ tier: 1, status: "verified" }),
    });
    const relevantButWeak = rankEvidence({
      claimText: CLAIM,
      section: "research_problem",
      chunk: chunkFixture({
        id: "b",
        content: "Postpartum depression affects maternal wellbeing in the first year after birth.",
        similarity: 0.82,
      }),
      citation: citation({ tier: 4, status: "unverified" }),
    });

    expect(relevantButWeak.score).toBeGreaterThan(irrelevantButExcellent.score);
    expect(irrelevantButExcellent.belowRelevanceFloor).toBe(true);
  });

  it("says plainly why an off-topic excerpt is off-topic, rather than showing a score alone", () => {
    const ranked = rankEvidence({
      claimText: CLAIM,
      section: "research_problem",
      chunk: chunkFixture({ id: "a", content: "Soil salinity in rice paddies.", similarity: 0 }),
      citation: citation({ tier: 1, status: "verified" }),
    });
    expect(ranked.explanation).toMatch(/Low topical match/);
    expect(ranked.explanation).toMatch(/quality does not change that/i);
  });

  it("sorts every off-topic candidate after every on-topic one", () => {
    const ranked = rankAll([
      {
        claimText: CLAIM,
        section: "research_problem",
        chunk: chunkFixture({ id: "off", content: "Soil salinity.", similarity: 0.01 }),
        citation: citation({ tier: 1, status: "verified" }),
      },
      {
        claimText: CLAIM,
        section: "research_problem",
        chunk: chunkFixture({
          id: "on",
          content: "Depression after birth affects maternal wellbeing.",
          similarity: 0.6,
        }),
        citation: citation({ tier: 4, status: "unverified" }),
      },
    ]);
    expect(ranked.map((r) => r.chunk.id)).toEqual(["on", "off"]);
  });

  it("prefers a source already cited in the section, all else being equal", () => {
    const shared = {
      claimText: CLAIM,
      section: "research_problem" as const,
      content: "Postpartum depression affects maternal wellbeing in the first year.",
    };
    const cited = rankEvidence({
      claimText: shared.claimText,
      section: shared.section,
      chunk: chunkFixture({ id: "a", content: shared.content, similarity: 0.7, citation_key: "sok2024" }),
      citation: citation(),
      keysAlreadyInSection: ["sok2024"],
    });
    const uncited = rankEvidence({
      claimText: shared.claimText,
      section: shared.section,
      chunk: chunkFixture({ id: "b", content: shared.content, similarity: 0.7, citation_key: "other2024" }),
      citation: citation({ citation_key: "other2024" }),
      keysAlreadyInSection: ["sok2024"],
    });
    expect(cited.score).toBeGreaterThan(uncited.score);
  });

  it("clamps a negative cosine similarity to unrelated rather than rescaling it", () => {
    const ranked = rankEvidence({
      claimText: CLAIM,
      section: "research_problem",
      chunk: chunkFixture({ id: "a", content: "Unrelated.", similarity: -0.4 }),
      citation: citation(),
    });
    expect(ranked.semantic).toBe(0);
  });
});
