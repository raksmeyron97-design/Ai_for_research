import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { themeSuggestionFixture } from "../../ai/testing/evidence-fixtures";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import { suggestThemes } from "../theme-suggestions";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
    research_citations: [
      { id: "cit1", project_id: PROJECT_ID, citation_key: "sok2024", title: "Prevalence study", authors: [], year: 2024, status: "user_provided", tier: 2 },
      { id: "cit2", project_id: PROJECT_ID, citation_key: "chan2023", title: "Screening tools", authors: [], year: 2023, status: "user_provided", tier: 2 },
    ],
  });
}

let db: ReturnType<typeof seed>;
let supabase: SupabaseClient;

beforeEach(() => {
  db = seed();
  supabase = db.client as SupabaseClient;
});

describe("theme suggestions", () => {
  it("writes nothing — a suggestion is a proposal", async () => {
    const mock = createMockProvider({
      fallback: themeSuggestionFixture([{ name: "Prevalence", citationKeys: ["sok2024"] }]),
    });

    const suggestions = await withMockProvider(mock, () =>
      suggestThemes(supabase, { projectId: PROJECT_ID }),
    );

    expect(suggestions[0]).toMatchObject({ name: "Prevalence", aiSuggested: true });
    expect(db.rows("research_themes")).toEqual([]);
  });

  it("drops a citation key the model invented", async () => {
    const mock = createMockProvider({
      fallback: themeSuggestionFixture([{ name: "Screening", citationKeys: ["chan2023", "notreal2020"] }]),
    });

    const [theme] = await withMockProvider(mock, () => suggestThemes(supabase, { projectId: PROJECT_ID }));
    expect(theme.citationIds).toEqual(["cit2"]);
  });

  it("sends bibliographic lines only, never the documents", async () => {
    const mock = createMockProvider({ fallback: themeSuggestionFixture([{ name: "A", citationKeys: [] }]) });
    await withMockProvider(mock, () => suggestThemes(supabase, { projectId: PROJECT_ID }));

    const prompt = mock.calls[0].prompt;
    expect(prompt).toContain("[sok2024] Prevalence study (2024)");
    expect(prompt).not.toContain("Relevant Document Excerpts");
  });

  it("does not ask for a grouping of fewer than two sources", async () => {
    const single = createInMemorySupabase({
      research_projects: [
        { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
      ],
      research_citations: [
        { id: "cit1", project_id: PROJECT_ID, citation_key: "sok2024", title: "Only one", authors: [], year: 2024, status: "user_provided", tier: 2 },
      ],
    });

    const mock = createMockProvider();
    const suggestions = await withMockProvider(mock, () =>
      suggestThemes(single.client as SupabaseClient, { projectId: PROJECT_ID }),
    );
    expect(suggestions).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });
});
