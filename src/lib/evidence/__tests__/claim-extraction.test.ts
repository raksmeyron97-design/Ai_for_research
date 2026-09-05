import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { claimExtractionFixture } from "../../ai/testing/evidence-fixtures";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import { ClaimExtractionError, extractClaims } from "../claim-extraction";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PASSAGE =
  "Postpartum depression can affect maternal wellbeing. In our sample, 21% screened positive. This suggests screening should start earlier.";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
  });
}

let db: ReturnType<typeof seed>;
let supabase: SupabaseClient;

beforeEach(() => {
  db = seed();
  supabase = db.client as SupabaseClient;
});

describe("claim extraction", () => {
  it("derives whether a claim needs evidence from its type rather than trusting the model", async () => {
    const mock = createMockProvider({
      fallback: claimExtractionFixture([
        { text: "Postpartum depression can affect maternal wellbeing.", type: "factual" },
        { text: "21% of the sample screened positive.", type: "user_provided" },
        { text: "Screening should start earlier.", type: "interpretive" },
      ]),
    });

    const claims = await withMockProvider(mock, () =>
      extractClaims(supabase, { projectId: PROJECT_ID, section: "research_problem", passage: PASSAGE }),
    );

    expect(claims.map((c) => c.needsEvidence)).toEqual([true, false, false]);
  });

  it("locates a claim in the passage when the sentence came back verbatim", async () => {
    const mock = createMockProvider({
      fallback: claimExtractionFixture([
        {
          text: "Postpartum depression can affect maternal wellbeing.",
          sourceSentence: "Postpartum depression can affect maternal wellbeing.",
        },
      ]),
    });

    const [claim] = await withMockProvider(mock, () =>
      extractClaims(supabase, {
        projectId: PROJECT_ID,
        section: "research_problem",
        passage: PASSAGE,
        passageOffset: 100,
      }),
    );

    expect(claim.offsetStart).toBe(100);
    expect(claim.offsetEnd).toBe(100 + "Postpartum depression can affect maternal wellbeing.".length);
  });

  it("leaves offsets null when the sentence was paraphrased, rather than guessing", async () => {
    const mock = createMockProvider({
      fallback: claimExtractionFixture([{ text: "A paraphrase.", sourceSentence: "" }]),
    });

    const [claim] = await withMockProvider(mock, () =>
      extractClaims(supabase, { projectId: PROJECT_ID, section: "research_problem", passage: PASSAGE }),
    );
    expect(claim.offsetStart).toBeNull();
  });

  it("sends the passage and nothing else, so extraction cannot drift onto other text", async () => {
    const mock = createMockProvider({ fallback: claimExtractionFixture([{ text: "A claim." }]) });

    await withMockProvider(mock, () =>
      extractClaims(supabase, { projectId: PROJECT_ID, section: "research_problem", passage: PASSAGE }),
    );

    const prompt = mock.calls[0].prompt;
    expect(prompt).toContain(PASSAGE);
    expect(prompt).not.toContain("Saved Sources");
    expect(prompt).not.toContain("Earlier Sections");
  });

  it("fails cleanly on a malformed response rather than persisting a repaired one", async () => {
    const mock = createMockProvider({ fallback: { kind: "invalid_json" } });

    await expect(
      withMockProvider(mock, () =>
        extractClaims(supabase, { projectId: PROJECT_ID, section: "research_problem", passage: PASSAGE }),
      ),
    ).rejects.toBeInstanceOf(ClaimExtractionError);
  });

  it("returns nothing for an empty selection without calling a provider", async () => {
    const mock = createMockProvider();
    const claims = await withMockProvider(mock, () =>
      extractClaims(supabase, { projectId: PROJECT_ID, section: "research_problem", passage: "   " }),
    );
    expect(claims).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });
});
