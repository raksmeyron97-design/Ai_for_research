import { describe, expect, it } from "vitest";
import { SECTION_CHAIN } from "@/lib/db/types";
import { SECTION_CONTEXT_POLICY, allowsLayer, getContextPolicy } from "../context-policy";

/**
 * Phase 16 §5/§20. The policy is the thing that stops a `title` request and a
 * `discussion` request receiving identical context, so its invariants are
 * worth asserting rather than trusting.
 */
describe("section context policy", () => {
  it("covers every section in the authoritative chain, and nothing else", () => {
    expect(Object.keys(SECTION_CONTEXT_POLICY).sort()).toEqual([...SECTION_CHAIN].sort());
  });

  it("never lists a layer as both allowed and excluded", () => {
    for (const section of SECTION_CHAIN) {
      const p = getContextPolicy(section);
      const allowed = new Set([...p.required, ...p.optional]);
      for (const excluded of p.excluded) {
        expect(allowed.has(excluded), `${section} both allows and excludes ${excluded}`).toBe(false);
      }
    }
  });

  it("never lists the same layer as both required and optional", () => {
    for (const section of SECTION_CHAIN) {
      const p = getContextPolicy(section);
      for (const layer of p.required) {
        expect(p.optional).not.toContain(layer);
      }
    }
  });

  it("only enables retrieval where retrieved sources are actually allowed", () => {
    // Retrieval costs an embedding call before it costs context tokens, so
    // running it for a section that would then discard the result is pure waste.
    for (const section of SECTION_CHAIN) {
      const p = getContextPolicy(section);
      if (p.retrieval) {
        expect(allowsLayer(section, "retrievedSources"), `${section} retrieves but excludes the result`).toBe(true);
      }
    }
  });

  it("never lets a section list itself as a prior section", () => {
    for (const section of SECTION_CHAIN) {
      expect(getContextPolicy(section).priorSections).not.toContain(section);
    }
  });

  it("only names real sections as prior sections", () => {
    for (const section of SECTION_CHAIN) {
      for (const prior of getContextPolicy(section).priorSections) {
        expect(SECTION_CHAIN).toContain(prior);
      }
    }
  });
});

describe("the specific exclusions the phase brief calls for", () => {
  it("objectives do not receive literature or the dataset", () => {
    // §5: objectives follow from the problem and rationale. Literature does
    // not make an objective measurable.
    expect(allowsLayer("objectives", "retrievedSources")).toBe(false);
    expect(allowsLayer("objectives", "datasetSummary")).toBe(false);
    expect(getContextPolicy("objectives").priorSections).toContain("research_problem");
    expect(getContextPolicy("objectives").priorSections).toContain("rationale");
  });

  it("methodology sees objectives, questions and variables — not literature", () => {
    const p = getContextPolicy("methodology");
    expect(p.priorSections).toEqual(expect.arrayContaining(["objectives", "research_questions", "variables"]));
    expect(allowsLayer("methodology", "retrievedSources")).toBe(false);
  });

  it("results require computed statistics and refuse literature", () => {
    const p = getContextPolicy("results");
    expect(p.required).toContain("datasetSummary");
    expect(allowsLayer("results", "retrievedSources")).toBe(false);
  });

  it("discussion is the one section needing both findings and sources", () => {
    const p = getContextPolicy("discussion");
    expect(p.priorSections).toContain("results");
    expect(allowsLayer("discussion", "citations")).toBe(true);
    expect(p.retrieval).toBe(true);
  });

  it("conclusion sees no literature and no dataset — anything new there is unsupported", () => {
    expect(allowsLayer("conclusion", "retrievedSources")).toBe(false);
    expect(allowsLayer("conclusion", "citations")).toBe(false);
    expect(allowsLayer("conclusion", "datasetSummary")).toBe(false);
    expect(getContextPolicy("conclusion").priorSections).toEqual(
      expect.arrayContaining(["objectives", "results", "discussion"]),
    );
  });

  it("no section receives conversation history — section actions are not chat", () => {
    for (const section of SECTION_CHAIN) {
      expect(allowsLayer(section, "conversation"), `${section} admits conversation`).toBe(false);
    }
  });
});
