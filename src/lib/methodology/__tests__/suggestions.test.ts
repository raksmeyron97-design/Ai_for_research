import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import {
  constructSuggestionFixture,
  definitionFixture,
  HALLUCINATED_CONSTRUCT_ID,
  hypothesisSuggestionFixture,
  INJECTION_TEXT,
  itemGenerationFixture,
  itemMappingFixture,
  OTHER_PROJECT_CONSTRUCT_ID,
  rewriteFixture,
  unsupportedSourceClaimFixture,
} from "../../ai/testing/methodology-fixtures";
import {
  MethodologySuggestionError,
  suggestConstructs,
  suggestHypotheses,
  suggestItemMapping,
  suggestItemRewrite,
  suggestItems,
  suggestOperationalDefinition,
} from "../suggestions";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const CONSTRUCTS = [
  { id: "con-a", label: "Teacher motivation", detail: "independent" },
  { id: "con-b", label: "Student performance", detail: "dependent" },
];
const INDICATORS = [{ id: "ind-a", label: "Job satisfaction", detail: "Teacher motivation" }];

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
  });
}

let supabase: SupabaseClient;

beforeEach(() => {
  supabase = seed().client as SupabaseClient;
});

describe("item mapping", () => {
  it("returns a proposal and persists nothing", async () => {
    const mock = createMockProvider({
      fallback: itemMappingFixture([{ constructId: "con-a", indicatorId: "ind-a", confidence: "high" }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "I feel motivated to prepare my lessons.",
        constructs: CONSTRUCTS,
        indicators: INDICATORS,
      }),
    );

    expect(result.provenance).toBe("ai_suggested");
    expect(result.proposals).toEqual([
      { constructId: "con-a", indicatorId: "ind-a", confidence: "high", rationale: expect.any(String) },
    ]);
  });

  // §40: an id that was never offered is discarded, not stored.
  it("discards a hallucinated construct id", async () => {
    const mock = createMockProvider({
      fallback: itemMappingFixture([{ constructId: HALLUCINATED_CONSTRUCT_ID }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "Item",
        constructs: CONSTRUCTS,
        indicators: INDICATORS,
      }),
    );

    expect(result.proposals).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/not in this project/i);
  });

  // A cross-project id is well-formed and indistinguishable by inspection.
  // Only membership of the offered list rules it out — which is why the check
  // is "was this offered", not "does this look like a uuid".
  it("discards a well-formed id from another project", async () => {
    const mock = createMockProvider({
      fallback: itemMappingFixture([{ constructId: OTHER_PROJECT_CONSTRUCT_ID }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "Item",
        constructs: CONSTRUCTS,
        indicators: INDICATORS,
      }),
    );

    expect(result.proposals).toEqual([]);
  });

  it("does not call a provider when there is nothing to map to", async () => {
    const mock = createMockProvider({ fallback: itemMappingFixture([]) });

    const result = await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "Item",
        constructs: [],
        indicators: [],
      }),
    );

    expect(mock.calls).toHaveLength(0);
    expect(result.notes[0]).toMatch(/no constructs/i);
  });

  it("sends the item and the candidates, not the project", async () => {
    const mock = createMockProvider({ fallback: itemMappingFixture([{ constructId: "con-a" }]) });

    await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "I feel motivated to prepare my lessons.",
        constructs: CONSTRUCTS,
        indicators: INDICATORS,
      }),
    );

    const prompt = mock.calls[0].prompt;
    expect(prompt).toContain("I feel motivated to prepare my lessons.");
    expect(prompt).toContain("id=con-a");
    // §17: no thesis text, no source library, no other items.
    expect(prompt.length).toBeLessThan(2000);
  });

  it("reports truncation instead of hiding it", async () => {
    const mock = createMockProvider({ fallback: itemMappingFixture([{ constructId: "con-a" }]) });

    const result = await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "word ".repeat(400),
        constructs: CONSTRUCTS,
        indicators: INDICATORS,
      }),
    );

    expect(result.contextTruncated).toBe(true);
    expect(mock.calls[0].prompt).toContain("[truncated]");
  });

  it("rejects malformed JSON without persisting anything", async () => {
    const mock = createMockProvider({ fallback: { kind: "invalid_json" } });

    await expect(
      withMockProvider(mock, () =>
        suggestItemMapping(supabase, {
          projectId: PROJECT_ID,
          itemText: "Item",
          constructs: CONSTRUCTS,
          indicators: INDICATORS,
        }),
      ),
    ).rejects.toThrow(MethodologySuggestionError);
  });

  // A mapping missing its confidence and rationale is not a partially usable
  // mapping — accepting the construct id from it would be accepting an
  // unvalidated response for the one field that has consequences.
  it("rejects a response missing required fields", async () => {
    const mock = createMockProvider({
      fallback: { kind: "valid", json: { mappings: [{ constructId: "con-a" }] } },
    });

    await expect(
      withMockProvider(mock, () =>
        suggestItemMapping(supabase, {
          projectId: PROJECT_ID,
          itemText: "Item",
          constructs: CONSTRUCTS,
          indicators: INDICATORS,
        }),
      ),
    ).rejects.toThrow(MethodologySuggestionError);
  });
});

describe("construct suggestions", () => {
  it("marks a name the project already has rather than dropping it", async () => {
    const mock = createMockProvider({
      fallback: constructSuggestionFixture([
        { name: "Teacher motivation", role: "independent" },
        { name: "Class size", role: "control" },
      ]),
    });

    const result = await withMockProvider(mock, () =>
      suggestConstructs(supabase, {
        projectId: PROJECT_ID,
        questionText: "What is the relationship between teacher motivation and student performance?",
        existingNames: ["Teacher motivation"],
      }),
    );

    expect(result.proposals.map((p) => p.alreadyExists)).toEqual([true, false]);
  });
});

describe("hypothesis suggestions", () => {
  it("does not call a provider with fewer than two constructs", async () => {
    const mock = createMockProvider({ fallback: hypothesisSuggestionFixture([]) });

    const result = await withMockProvider(mock, () =>
      suggestHypotheses(supabase, {
        projectId: PROJECT_ID,
        questionText: "What is the relationship between X and Y?",
        constructs: [CONSTRUCTS[0]],
      }),
    );

    expect(mock.calls).toHaveLength(0);
    expect(result.notes[0]).toMatch(/at least two constructs/i);
  });

  // The question's shape is computed and told to the model, not asked of it —
  // letting the model both pick the shape and write to it removes the check.
  it("computes the question shape itself and sends it", async () => {
    const mock = createMockProvider({
      fallback: hypothesisSuggestionFixture([
        {
          statement: "Teacher motivation predicts student performance.",
          variables: [
            { constructId: "con-a", position: "predictor" },
            { constructId: "con-b", position: "outcome" },
          ],
        },
      ]),
    });

    const result = await withMockProvider(mock, () =>
      suggestHypotheses(supabase, {
        projectId: PROJECT_ID,
        questionText: "What is the effect of teacher motivation on student performance?",
        constructs: CONSTRUCTS,
      }),
    );

    expect(mock.calls[0].prompt).toContain("QUESTION SHAPE (computed, not your judgement): causal");
    expect(result.proposals[0].hasOutcome).toBe(true);
  });

  it("derives hasOutcome rather than trusting the form the model chose", async () => {
    const mock = createMockProvider({
      fallback: hypothesisSuggestionFixture([
        {
          statement: "Teacher motivation matters.",
          form: "prediction",
          variables: [{ constructId: "con-a", position: "predictor" }],
        },
      ]),
    });

    const result = await withMockProvider(mock, () =>
      suggestHypotheses(supabase, {
        projectId: PROJECT_ID,
        questionText: "What is the effect of X on Y?",
        constructs: CONSTRUCTS,
      }),
    );

    expect(result.proposals[0].hasOutcome).toBe(false);
  });

  it("drops a hypothesis referencing a construct that was not offered", async () => {
    const mock = createMockProvider({
      fallback: hypothesisSuggestionFixture([
        {
          statement: "X relates to Z.",
          variables: [
            { constructId: "con-a", position: "predictor" },
            { constructId: HALLUCINATED_CONSTRUCT_ID, position: "outcome" },
          ],
        },
      ]),
    });

    const result = await withMockProvider(mock, () =>
      suggestHypotheses(supabase, {
        projectId: PROJECT_ID,
        questionText: "What is the effect of X on Y?",
        constructs: CONSTRUCTS,
      }),
    );

    expect(result.proposals).toEqual([]);
  });
});

describe("item generation", () => {
  it("takes the mapping from the request, never from the model", async () => {
    const mock = createMockProvider({
      fallback: itemGenerationFixture([{ text: "I enjoy preparing lessons." }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItems(supabase, {
        projectId: PROJECT_ID,
        constructName: "Teacher motivation",
        constructId: "con-a",
        indicatorId: "ind-a",
      }),
    );

    expect(result.proposals[0]).toMatchObject({ constructId: "con-a", indicatorId: "ind-a" });
    expect(result.provenance).toBe("ai_suggested");
  });

  // §31/§32: a model asserting a source is a sentence, not evidence. The
  // proposal has nowhere to carry a citation, so the claim cannot be persisted
  // as provenance however confidently it is phrased.
  it("cannot persist a source claim the model made up", async () => {
    const mock = createMockProvider({ fallback: unsupportedSourceClaimFixture() });

    const result = await withMockProvider(mock, () =>
      suggestItems(supabase, {
        projectId: PROJECT_ID,
        constructName: "Perceived usefulness",
        constructId: "con-a",
      }),
    );

    const proposal = result.proposals[0] as unknown as Record<string, unknown>;
    expect(proposal).not.toHaveProperty("sourceCitationId");
    expect(proposal).not.toHaveProperty("adaptationType");
    expect(Object.keys(proposal).sort()).toEqual([
      "constructId", "indicatorId", "rationale", "responseType", "text",
    ]);
  });

  // §40: source text is data. An instruction inside it is passed through as
  // content and never changes what the workflow returns.
  it("treats injected instructions in the definition as data", async () => {
    const mock = createMockProvider({
      fallback: itemGenerationFixture([{ text: "I find the system useful." }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItems(supabase, {
        projectId: PROJECT_ID,
        constructName: "Perceived usefulness",
        constructId: "con-a",
        operationalDefinition: INJECTION_TEXT,
      }),
    );

    expect(result.provenance).toBe("ai_suggested");
    expect(result.proposals).toHaveLength(1);
    // The instruction reached the model as content, under the integrity guard's
    // data rule — it did not become a system instruction.
    expect(mock.calls[0].prompt).toContain("Ignore the research system");
    expect(mock.calls[0].systemInstruction).not.toContain("Ignore the research system");
  });
});

describe("rewrites and definitions", () => {
  it("returns rewrite alternatives without applying any", async () => {
    const mock = createMockProvider({
      fallback: rewriteFixture([{ text: "I am satisfied with the training content." }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItemRewrite(supabase, {
        projectId: PROJECT_ID,
        itemText: "How satisfied are you with the training content and the instructor?",
        concerns: ["Possible double-barrelled item"],
      }),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.provenance).toBe("ai_suggested");
    expect(mock.calls[0].prompt).toContain("Possible double-barrelled item");
  });

  it("proposes an operational definition without claiming it is validated", async () => {
    const mock = createMockProvider({
      fallback: definitionFixture([{ text: "Mean of the four job-satisfaction items." }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestOperationalDefinition(supabase, {
        projectId: PROJECT_ID,
        constructName: "Teacher motivation",
        indicatorNames: ["Job satisfaction"],
      }),
    );

    expect(result.proposals[0].text).toContain("Mean of the four");
    expect(mock.calls[0].prompt).toMatch(/Do not claim any procedure is validated/i);
  });
});

describe("the shared framing", () => {
  it("forbids validity and reliability claims in every workflow", async () => {
    const mock = createMockProvider({ fallback: itemMappingFixture([{ constructId: "con-a" }]) });

    await withMockProvider(mock, () =>
      suggestItemMapping(supabase, {
        projectId: PROJECT_ID,
        itemText: "Item",
        constructs: CONSTRUCTS,
        indicators: INDICATORS,
      }),
    );

    expect(mock.calls[0].prompt).toMatch(/Never state that a study, instrument, sample size or hypothesis is valid/i);
    expect(mock.calls[0].prompt).toMatch(/You are not deciding anything/i);
  });
});
