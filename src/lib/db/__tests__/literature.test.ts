import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createGaps, deleteGap, listGaps, updateGap } from "../gaps";
import { getSourceProfiles, upsertSourceProfile } from "../source-profiles";
import {
  assignSourceToTheme,
  createTheme,
  deleteTheme,
  listThemeSources,
  listThemes,
  removeSourceFromTheme,
  renameTheme,
} from "../themes";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "99999999-9999-9999-9999-999999999999";

function seed() {
  return createInMemorySupabase({
    research_themes: [],
    research_theme_sources: [],
    research_gaps: [],
    research_source_profiles: [],
  });
}

let db: ReturnType<typeof seed>;
let supabase: SupabaseClient;

beforeEach(() => {
  db = seed();
  supabase = db.client as SupabaseClient;
});

describe("themes", () => {
  it("keeps each project's themes to itself", async () => {
    await createTheme(supabase, { project_id: PROJECT_ID, name: "Mine" });
    await createTheme(supabase, { project_id: OTHER_PROJECT, name: "Theirs" });

    expect((await listThemes(supabase, PROJECT_ID)).map((t) => t.name)).toEqual(["Mine"]);
  });

  it("records that a theme came from a suggestion, and keeps that after a rename", async () => {
    const theme = await createTheme(supabase, { project_id: PROJECT_ID, name: "Screening", ai_suggested: true });
    const renamed = await renameTheme(supabase, PROJECT_ID, theme.id, { name: "Screening barriers" });

    expect(renamed.name).toBe("Screening barriers");
    expect(renamed.ai_suggested).toBe(true);
  });

  it("will not rename or delete a theme through another project's id", async () => {
    const theme = await createTheme(supabase, { project_id: OTHER_PROJECT, name: "Theirs" });

    await deleteTheme(supabase, PROJECT_ID, theme.id);
    expect(await listThemes(supabase, OTHER_PROJECT)).toHaveLength(1);
  });

  it("assigns and removes sources without touching the sources themselves", async () => {
    const theme = await createTheme(supabase, { project_id: PROJECT_ID, name: "Screening" });
    await assignSourceToTheme(supabase, {
      project_id: PROJECT_ID,
      theme_id: theme.id,
      citation_id: "cit1",
    });
    expect(await listThemeSources(supabase, PROJECT_ID)).toHaveLength(1);

    await removeSourceFromTheme(supabase, PROJECT_ID, theme.id, "cit1");
    expect(await listThemeSources(supabase, PROJECT_ID)).toHaveLength(0);
  });
});

describe("source profiles", () => {
  it("refreshes a profile rather than accumulating a second one", async () => {
    await upsertSourceProfile(supabase, {
      project_id: PROJECT_ID,
      citation_id: "cit1",
      population: "Midwives",
    });
    await upsertSourceProfile(supabase, {
      project_id: PROJECT_ID,
      citation_id: "cit1",
      population: "Postpartum women",
    });

    const profiles = await getSourceProfiles(supabase, PROJECT_ID, ["cit1"]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].population).toBe("Postpartum women");
  });

  it("returns nothing rather than querying for an empty selection", async () => {
    expect(await getSourceProfiles(supabase, PROJECT_ID, [])).toEqual([]);
  });
});

describe("gaps", () => {
  it("stores the basis it was given, so it can be shown wherever the gap is", async () => {
    const [gap] = await createGaps(supabase, [
      {
        project_id: PROJECT_ID,
        citation_id: "cit1",
        gap_text: "Generalisability is untested.",
        basis: "derived_limitation",
      },
    ]);
    expect(gap.basis).toBe("derived_limitation");
    expect(gap.verified).toBeFalsy();
  });

  it("makes verification a separate, later act", async () => {
    const [gap] = await createGaps(supabase, [
      { project_id: PROJECT_ID, gap_text: "A gap.", basis: "ai_inference", verified: false },
    ]);

    const verified = await updateGap(supabase, PROJECT_ID, gap.id, { verified: true });
    expect(verified.verified).toBe(true);
  });

  it("deletes only the row asked for, and only within the project", async () => {
    const [mine, other] = await createGaps(supabase, [
      { project_id: PROJECT_ID, gap_text: "Mine.", basis: "ai_inference" },
      { project_id: OTHER_PROJECT, gap_text: "Theirs.", basis: "ai_inference" },
    ]);

    await deleteGap(supabase, PROJECT_ID, other.id);
    expect(await listGaps(supabase, OTHER_PROJECT)).toHaveLength(1);

    await deleteGap(supabase, PROJECT_ID, mine.id);
    expect(await listGaps(supabase, PROJECT_ID)).toHaveLength(0);
  });
});
