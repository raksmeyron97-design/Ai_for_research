import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { gapSuggestionFixture } from "../../ai/testing/evidence-fixtures";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import { suggestGaps } from "../gap-analysis";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const LIMITATION = "The sample was drawn from a single urban health centre, so findings may not generalise.";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
    research_citations: [
      { id: "cit1", project_id: PROJECT_ID, citation_key: "sok2024", title: "Study A", authors: [], year: 2024, status: "user_provided", tier: 2 },
    ],
    research_source_profiles: [
      {
        id: "p1",
        project_id: PROJECT_ID,
        citation_id: "cit1",
        main_finding: "21% screened positive",
        limitations: LIMITATION,
        field_provenance: {},
      },
    ],
  });
}

let db: ReturnType<typeof seed>;
let supabase: SupabaseClient;

beforeEach(() => {
  db = seed();
  supabase = db.client as SupabaseClient;
});

describe("gap basis is checked, not accepted", () => {
  it("keeps source_stated when the quoted sentence really is in the source's facts", async () => {
    const mock = createMockProvider({
      fallback: gapSuggestionFixture([
        {
          text: "Whether findings hold outside urban centres is unknown.",
          citationKey: "sok2024",
          basis: "source_stated",
          supportingText: LIMITATION,
        },
      ]),
    });

    const [gap] = await withMockProvider(mock, () =>
      suggestGaps(supabase, { projectId: PROJECT_ID, citationIds: ["cit1"] }),
    );

    expect(gap.basis).toBe("source_stated");
    expect(gap.downgradedFrom).toBeUndefined();
  });

  it("downgrades a source_stated claim whose quote is not in the source, and says it did", async () => {
    const mock = createMockProvider({
      fallback: gapSuggestionFixture([
        {
          text: "The authors call for longitudinal work.",
          citationKey: "sok2024",
          basis: "source_stated",
          supportingText: "Future longitudinal studies are urgently required across every province.",
        },
      ]),
    });

    const [gap] = await withMockProvider(mock, () =>
      suggestGaps(supabase, { projectId: PROJECT_ID, citationIds: ["cit1"] }),
    );

    expect(gap.basis).toBe("ai_inference");
    expect(gap.downgradedFrom).toBe("source_stated");
  });

  it("downgrades derived_limitation when the source records no limitation", async () => {
    db.tables.research_source_profiles[0].limitations = null;

    const mock = createMockProvider({
      fallback: gapSuggestionFixture([
        { text: "Generalisability is untested.", citationKey: "sok2024", basis: "derived_limitation" },
      ]),
    });

    const [gap] = await withMockProvider(mock, () =>
      suggestGaps(supabase, { projectId: PROJECT_ID, citationIds: ["cit1"] }),
    );

    expect(gap.basis).toBe("ai_inference");
    expect(gap.downgradedFrom).toBe("derived_limitation");
  });

  it("never returns a verified gap — verification is the researcher's act", async () => {
    const mock = createMockProvider({
      fallback: gapSuggestionFixture([
        { text: "A gap.", citationKey: "sok2024", basis: "source_stated", supportingText: LIMITATION },
      ]),
    });

    const gaps = await withMockProvider(mock, () =>
      suggestGaps(supabase, { projectId: PROJECT_ID, citationIds: ["cit1"] }),
    );
    expect(gaps.every((g) => g.verified === false)).toBe(true);
  });

  it("keeps an observation whose citation key was invented, but drops the attribution", async () => {
    const mock = createMockProvider({
      fallback: gapSuggestionFixture([
        { text: "Nothing covers rural provinces.", citationKey: "notasource", basis: "source_stated" },
      ]),
    });

    const [gap] = await withMockProvider(mock, () =>
      suggestGaps(supabase, { projectId: PROJECT_ID, citationIds: ["cit1"] }),
    );

    expect(gap.citation_id).toBeNull();
    expect(gap.basis).toBe("ai_inference");
  });
});
