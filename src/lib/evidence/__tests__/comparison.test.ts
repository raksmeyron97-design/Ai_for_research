import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { comparisonNotesFixture, sourceProfileFixture } from "../../ai/testing/evidence-fixtures";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import { compareSources, extractSourceProfile } from "../comparison";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "99999999-9999-9999-9999-999999999999";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
    research_citations: [
      { id: "cit1", project_id: PROJECT_ID, citation_key: "sok2024", title: "Study A", authors: [], year: 2024, status: "user_provided", tier: 2 },
      { id: "cit2", project_id: PROJECT_ID, citation_key: "chan2023", title: "Study B", authors: [], year: 2023, status: "user_provided", tier: 2 },
      { id: "cit-other", project_id: OTHER_PROJECT, citation_key: "x2020", title: "Elsewhere", authors: [], year: 2020, status: "user_provided", tier: 1 },
    ],
    research_source_profiles: [],
  });
}

let db: ReturnType<typeof seed>;
let supabase: SupabaseClient;

beforeEach(() => {
  db = seed();
  supabase = db.client as SupabaseClient;
});

describe("source profile extraction", () => {
  it("stores an absent field as absent rather than filling it in", async () => {
    const mock = createMockProvider({
      fallback: sourceProfileFixture(
        { population: "Postpartum women attending urban health centres", main_finding: "21% screened positive" },
        ["population", "main_finding"],
      ),
    });

    const profile = await withMockProvider(mock, () =>
      extractSourceProfile(supabase, { projectId: PROJECT_ID, citationId: "cit1", excerpts: ["Some text."] }),
    );

    expect(profile?.population).toContain("Postpartum women");
    expect(profile?.limitations).toBeNull();
    expect(profile?.sample).toBeNull();
  });

  it("records which fields the source stated and which were inferred", async () => {
    const mock = createMockProvider({
      fallback: sourceProfileFixture({ population: "Midwives", limitations: "Small sample" }, ["population"]),
    });

    const profile = await withMockProvider(mock, () =>
      extractSourceProfile(supabase, { projectId: PROJECT_ID, citationId: "cit1", excerpts: ["Some text."] }),
    );

    expect(profile?.field_provenance.population).toBe("source_stated");
    expect(profile?.field_provenance.limitations).toBe("ai_inference");
  });

  it("does not call a provider when there is no source text to read", async () => {
    const mock = createMockProvider();
    const profile = await withMockProvider(mock, () =>
      extractSourceProfile(supabase, { projectId: PROJECT_ID, citationId: "cit1", excerpts: ["", "  "] }),
    );
    expect(profile).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });
});

describe("the comparison matrix", () => {
  it("marks unprofiled sources rather than inventing columns for them", async () => {
    const comparison = await compareSources(supabase, {
      projectId: PROJECT_ID,
      citationIds: ["cit1", "cit2"],
      withNotes: false,
    });

    expect(comparison.columns).toHaveLength(2);
    expect(comparison.unprofiledCitationIds).toEqual(["cit1", "cit2"]);
    expect(comparison.columns[0].cells.every((c) => c.value === null)).toBe(true);
  });

  it("drops a statement whose sources cannot be resolved, rather than showing it unattributed", async () => {
    db.seed("research_source_profiles", [
      { id: "p1", project_id: PROJECT_ID, citation_id: "cit1", population: "Postpartum women", field_provenance: {} },
      { id: "p2", project_id: PROJECT_ID, citation_id: "cit2", population: "Midwives", field_provenance: {} },
    ]);

    const mock = createMockProvider({
      fallback: comparisonNotesFixture(
        [
          { text: "Both study maternal mental health.", citationKeys: ["sok2024", "chan2023"] },
          { text: "Studies generally agree.", citationKeys: ["invented1", "invented2"] },
        ],
        [{ text: "They disagree on prevalence.", citationKeys: ["sok2024", "chan2023"] }],
      ),
    });

    const comparison = await withMockProvider(mock, () =>
      compareSources(supabase, { projectId: PROJECT_ID, citationIds: ["cit1", "cit2"] }),
    );

    expect(comparison.agreements).toHaveLength(1);
    expect(comparison.agreements[0].citationIds).toEqual(["cit1", "cit2"]);
    expect(comparison.disagreements[0].citationIds).toHaveLength(2);
  });

  it("excludes a source from another project without saying which id was rejected", async () => {
    const comparison = await compareSources(supabase, {
      projectId: PROJECT_ID,
      citationIds: ["cit1", "cit-other"],
      withNotes: false,
    });
    expect(comparison.columns.map((c) => c.citationId)).toEqual(["cit1"]);
  });

  it("refuses a selection outside 2-5 sources", async () => {
    await expect(
      compareSources(supabase, { projectId: PROJECT_ID, citationIds: ["cit1"], withNotes: false }),
    ).rejects.toThrow(/between 2 and 5/);
  });

  it("keeps the matrix when the commentary call fails", async () => {
    db.seed("research_source_profiles", [
      { id: "p1", project_id: PROJECT_ID, citation_id: "cit1", population: "Postpartum women", field_provenance: {} },
      { id: "p2", project_id: PROJECT_ID, citation_id: "cit2", population: "Midwives", field_provenance: {} },
    ]);

    const mock = createMockProvider({ fallback: { kind: "provider_failure", retryable: false } });
    const comparison = await withMockProvider(mock, () =>
      compareSources(supabase, { projectId: PROJECT_ID, citationIds: ["cit1", "cit2"] }),
    );

    expect(comparison.columns).toHaveLength(2);
    expect(comparison.agreements).toEqual([]);
  });
});
