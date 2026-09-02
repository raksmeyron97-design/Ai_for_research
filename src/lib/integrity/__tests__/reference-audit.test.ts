import { describe, expect, it } from "vitest";
import {
  findDuplicateReferences,
  findMalformedIdentifiers,
  findMissingBibliographyEntries,
  findMissingMetadata,
  findUnusedReferences,
} from "../reference-audit";

function citation(over: Record<string, unknown> = {}) {
  return {
    id: "cit-1",
    citation_key: "smith2024",
    title: "A study of things",
    authors: ["Smith, J."],
    year: 2024,
    source_type: "article",
    doi: null,
    pmid: null,
    isbn: null,
    ...over,
  };
}

describe("findMissingBibliographyEntries", () => {
  it("flags a citation key used in prose with no matching source", () => {
    const sections = [{ content: "Prior work supports this [ghost2099]." }];
    const findings = findMissingBibliographyEntries(sections, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].targetId).toBe("ghost2099");
  });

  it("does not flag a key that resolves", () => {
    const sections = [{ content: "Prior work supports this [smith2024]." }];
    const findings = findMissingBibliographyEntries(sections, [{ citation_key: "smith2024" }]);
    expect(findings).toHaveLength(0);
  });
});

describe("findUnusedReferences", () => {
  it("flags a citation neither mentioned in prose nor linked to evidence", () => {
    const findings = findUnusedReferences([{ content: "No citations here." }], [citation() as never], []);
    expect(findings).toHaveLength(1);
    expect(findings[0].targetId).toBe("cit-1");
  });

  it("does not flag a citation mentioned in prose", () => {
    const findings = findUnusedReferences(
      [{ content: "As shown in [smith2024]." }],
      [citation() as never],
      [],
    );
    expect(findings).toHaveLength(0);
  });

  it("does not flag a citation linked to evidence even if never mentioned in prose", () => {
    const findings = findUnusedReferences([{ content: "" }], [citation() as never], [{ citation_id: "cit-1" }]);
    expect(findings).toHaveLength(0);
  });
});

describe("findDuplicateReferences", () => {
  it("flags two citations with the same normalized DOI", () => {
    const citations = [
      citation({ id: "cit-1", citation_key: "smith2024a", doi: "10.1234/abcd" }),
      citation({ id: "cit-2", citation_key: "smith2024b", doi: "https://doi.org/10.1234/abcd" }),
    ];
    const findings = findDuplicateReferences(citations as never);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("flags two citations with the same normalized title+year+first-author, never by fuzzy text similarity", () => {
    const citations = [
      citation({ id: "cit-1", citation_key: "a", title: "Motivation and Performance", year: 2024, authors: ["Smith, J."] }),
      citation({ id: "cit-2", citation_key: "b", title: "motivation and performance", year: 2024, authors: ["Smith, J."] }),
    ];
    const findings = findDuplicateReferences(citations as never);
    expect(findings).toHaveLength(1);
  });

  it("does not flag two unrelated citations with no shared identifier", () => {
    const citations = [
      citation({ id: "cit-1", citation_key: "a" }),
      citation({ id: "cit-2", citation_key: "b", title: "Something entirely different", year: 2020, authors: ["Lee, K."] }),
    ];
    const findings = findDuplicateReferences(citations as never);
    expect(findings).toHaveLength(0);
  });

  it("never fires on incomplete title/year/author fields alone", () => {
    const citations = [
      citation({ id: "cit-1", citation_key: "a", title: null, doi: null }),
      citation({ id: "cit-2", citation_key: "b", title: null, doi: null }),
    ];
    const findings = findDuplicateReferences(citations as never);
    expect(findings).toHaveLength(0);
  });
});

describe("findMalformedIdentifiers", () => {
  it("flags a malformed DOI as an error", () => {
    const findings = findMalformedIdentifiers([citation({ doi: "not-a-doi" }) as never]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("does not flag an absent identifier as malformed", () => {
    const findings = findMalformedIdentifiers([citation({ doi: null, pmid: null, isbn: null }) as never]);
    expect(findings).toHaveLength(0);
  });

  it("does not flag a valid identifier", () => {
    const findings = findMalformedIdentifiers([citation({ doi: "10.1234/abcd" }) as never]);
    expect(findings).toHaveLength(0);
  });
});

describe("findMissingMetadata", () => {
  it("flags a citation with no title as warning", () => {
    const findings = findMissingMetadata([citation({ title: null }) as never]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("flags a citation missing only source_type as info", () => {
    const findings = findMissingMetadata([citation({ source_type: null }) as never]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("does not flag a fully populated citation", () => {
    const findings = findMissingMetadata([citation() as never]);
    expect(findings).toHaveLength(0);
  });
});
