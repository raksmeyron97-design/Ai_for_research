import { describe, expect, it } from "vitest";
import { ALL_SCENARIOS, AB_SCENARIO_IDS, SMOKE_SCENARIO_IDS, selectScenarios } from "../scenarios";
import { CORPORA, allKnownCitationKeys, getCorpus } from "../fixtures/corpus";
import { buildScenarioContext } from "../fixtures/context";

/**
 * The suite's integrity, checked as code. A scenario whose expected
 * citation does not exist in its corpus, or whose retrieved keys are
 * unresolvable, would silently score every model as wrong — a broken
 * benchmark is worse than none, so these are hard assertions.
 */
describe("benchmark scenario suite", () => {
  it("meets the Phase 16 coverage floor of 30 scenarios", () => {
    expect(ALL_SCENARIOS.length).toBeGreaterThanOrEqual(30);
  });

  it("has unique scenario ids", () => {
    const ids = ALL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every required benchmark category", () => {
    const categories = new Set(ALL_SCENARIOS.map((s) => s.category));
    for (const required of [
      "rag_grounding",
      "hallucination",
      "methodology_reasoning",
      "questionnaire",
      "khmer_writing",
      "english_writing",
      "citation",
      "structured_output",
    ]) {
      expect(categories.has(required as never), `missing category ${required}`).toBe(true);
    }
  });

  it("covers all four RAG answerability classes", () => {
    const classes = new Set(ALL_SCENARIOS.map((s) => s.ragClass).filter(Boolean));
    expect([...classes].sort()).toEqual([1, 2, 3, 4]);
  });

  it("includes Khmer-language scenarios", () => {
    expect(ALL_SCENARIOS.filter((s) => s.language === "km").length).toBeGreaterThanOrEqual(5);
  });

  it("resolves every retrieved key against its corpus", () => {
    for (const scenario of ALL_SCENARIOS) {
      if (!scenario.retrievedKeys?.length) continue;
      expect(scenario.corpus, `${scenario.id} retrieves keys without naming a corpus`).toBeTruthy();
      const corpus = getCorpus(scenario.corpus as string);
      for (const key of scenario.retrievedKeys) {
        expect(
          corpus.sources.some((s) => s.citationKey === key),
          `${scenario.id} retrieves unknown key ${key}`,
        ).toBe(true);
      }
    }
  });

  it("only requires citations that were actually retrieved", () => {
    for (const scenario of ALL_SCENARIOS) {
      for (const key of scenario.expect.mustCite ?? []) {
        expect(
          scenario.retrievedKeys?.includes(key),
          `${scenario.id} requires citing ${key} which it never retrieves`,
        ).toBe(true);
      }
    }
  });

  it("never expects a citation of a key that exists nowhere", () => {
    const known = allKnownCitationKeys();
    for (const scenario of ALL_SCENARIOS) {
      for (const key of scenario.expect.mustCite ?? []) {
        expect(known.has(key), `${scenario.id} expects unknown key ${key}`).toBe(true);
      }
    }
  });

  it("gives every scenario a deterministic expectation, so nothing plausible can pass by default", () => {
    for (const scenario of ALL_SCENARIOS) {
      const e = scenario.expect;
      const hasExpectation =
        Boolean(e.mustCite?.length) ||
        Boolean(e.mustNotCite?.length) ||
        e.mustAbstain === true ||
        Boolean(e.mustMention?.length) ||
        Boolean(e.mustNotContain?.length) ||
        e.mustAcknowledgeConflict === true ||
        e.mustCorrectPremise === true ||
        Boolean(e.schema) ||
        Boolean(e.allowedNumbers) ||
        Boolean(e.consistentTerms?.length) ||
        e.maxWords !== undefined;
      expect(hasExpectation, `${scenario.id} has no checkable expectation`).toBe(true);
    }
  });

  it("keeps every fixture DOI on the reserved non-registrant prefix", () => {
    for (const corpus of Object.values(CORPORA)) {
      for (const source of corpus.sources) {
        expect(source.doi.startsWith("10.0000/"), `${source.citationKey} uses a resolvable-looking DOI`).toBe(true);
      }
    }
  });

  it("resolves the smoke and A/B scenario ids", () => {
    for (const id of [...SMOKE_SCENARIO_IDS, ...AB_SCENARIO_IDS]) {
      expect(ALL_SCENARIOS.some((s) => s.id === id), `unknown scenario id ${id}`).toBe(true);
    }
  });

  it("limits the smoke suite to a cheap subset", () => {
    const smoke = selectScenarios({ suite: "smoke", scenarioFilter: null, categoryFilter: null, maxScenarios: 3 });
    expect(smoke.length).toBeLessThanOrEqual(3);
  });
});

describe("scenario context rendering", () => {
  const scenario = ALL_SCENARIOS.find((s) => s.id === "rag-c1-prevalence-single")!;

  it("renders production format without citation keys on excerpts", () => {
    const { text } = buildScenarioContext(scenario, "production");
    expect(text).toContain("## Relevant Document Excerpts");
    expect(text).toContain("[1]:");
    // Production's formatChunks has no key to print — this is the finding the A/B measures.
    expect(text).not.toContain("[sok2024antenatal]:");
  });

  it("renders keyed format with citation keys on excerpts", () => {
    const { text } = buildScenarioContext(scenario, "keyed");
    expect(text).toContain("[sok2024antenatal]:");
  });

  it("returns empty context for scenarios with no retrieval", () => {
    const noRetrieval = ALL_SCENARIOS.find((s) => !s.retrievedKeys?.length)!;
    expect(buildScenarioContext(noRetrieval).text).toBe("");
  });
});
