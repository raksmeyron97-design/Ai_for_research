import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { mergeCitations, ReferenceMergeError } from "../reference-merge";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function citationRow(over: Record<string, unknown>) {
  return {
    project_id: PROJECT_ID, title: "T", authors: [], year: 2024, journal: null,
    doi: null, pmid: null, isbn: null, url: null, source_type: "article", tier: 2, status: "user_provided",
    ...over,
  };
}

describe("mergeCitations", () => {
  it("repoints evidence, questionnaire items and gaps, then removes the duplicate", async () => {
    const db = createInMemorySupabase({
      research_citations: [
        citationRow({ id: "primary", citation_key: "smith2024a" }),
        citationRow({ id: "duplicate", citation_key: "smith2024b" }),
      ],
      research_evidence: [
        { id: "ev1", project_id: PROJECT_ID, citation_id: "duplicate", excerpt: "..." },
      ],
      questionnaire_questions: [
        { id: "q1", project_id: PROJECT_ID, source_citation_id: "duplicate", text: "Item" },
      ],
      research_gaps: [
        { id: "g1", project_id: PROJECT_ID, citation_id: "duplicate", gap_text: "...", basis: "source_stated" },
      ],
    });
    const client = db.client as SupabaseClient;

    const result = await mergeCitations(client, PROJECT_ID, "primary", "duplicate");
    expect(result.id).toBe("primary");

    expect(db.rows("research_evidence")[0].citation_id).toBe("primary");
    expect(db.rows("questionnaire_questions")[0].source_citation_id).toBe("primary");
    expect(db.rows("research_gaps")[0].citation_id).toBe("primary");
    expect(db.rows("research_citations").map((c) => c.id)).toEqual(["primary"]);

    const events = db.rows("research_integrity_events");
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("reference_merged");
  });

  it("refuses to merge into itself", async () => {
    const db = createInMemorySupabase({
      research_citations: [citationRow({ id: "a", citation_key: "a" })],
    });
    await expect(mergeCitations(db.client as SupabaseClient, PROJECT_ID, "a", "a")).rejects.toThrow(ReferenceMergeError);
  });

  it("refuses when either citation is not in this project", async () => {
    const db = createInMemorySupabase({
      research_citations: [
        citationRow({ id: "a", citation_key: "a" }),
        citationRow({ id: "b", citation_key: "b", project_id: "other-project" }),
      ],
    });
    await expect(mergeCitations(db.client as SupabaseClient, PROJECT_ID, "a", "b")).rejects.toThrow(ReferenceMergeError);
  });

  it("refuses when the duplicate has a Literature-workspace theme link, without dropping it", async () => {
    const db = createInMemorySupabase({
      research_citations: [
        citationRow({ id: "primary", citation_key: "a" }),
        citationRow({ id: "duplicate", citation_key: "b" }),
      ],
      research_theme_sources: [
        { id: "ts1", project_id: PROJECT_ID, theme_id: "theme1", citation_id: "duplicate" },
      ],
    });
    const client = db.client as SupabaseClient;
    await expect(mergeCitations(client, PROJECT_ID, "primary", "duplicate")).rejects.toThrow(ReferenceMergeError);
    // Nothing was touched.
    expect(db.rows("research_citations")).toHaveLength(2);
    expect(db.rows("research_theme_sources")).toHaveLength(1);
  });
});
