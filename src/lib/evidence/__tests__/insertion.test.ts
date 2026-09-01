import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createClaims } from "../../db/evidence";
import { listSectionVersions } from "../../db/section-versions";
import { explainSectionCitations, EvidenceInsertionError, insertEvidence } from "../insertion";
import { buildSectionReview } from "../section-review-service";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "99999999-9999-9999-9999-999999999999";
const SECTION_TEXT = "Postpartum depression can affect maternal wellbeing. Screening is inconsistent.";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
      { id: OTHER_PROJECT, user_id: "u2", title: "Other", language: "en", target_population: [], status: "active" },
    ],
    research_sections: [
      {
        id: "s-problem",
        project_id: PROJECT_ID,
        section_type: "research_problem",
        content: SECTION_TEXT,
        status: "in_progress",
        metadata: {},
      },
    ],
    research_citations: [
      {
        id: "cit1",
        project_id: PROJECT_ID,
        citation_key: "sok2024",
        title: "Antenatal depressive symptoms",
        authors: ["Sok, D."],
        year: 2024,
        status: "user_provided",
        tier: 2,
      },
      {
        id: "cit-other",
        project_id: OTHER_PROJECT,
        citation_key: "other2024",
        title: "Someone else's source",
        authors: [],
        year: 2024,
        status: "user_provided",
        tier: 1,
      },
    ],
  });
}

let db: ReturnType<typeof seed>;
let supabase: SupabaseClient;

async function seedClaim(text = "Postpartum depression can affect maternal wellbeing.") {
  const [claim] = await createClaims(supabase, [
    { project_id: PROJECT_ID, section_type: "research_problem", claim_text: text, claim_type: "factual" },
  ]);
  return claim;
}

beforeEach(() => {
  db = seed();
  supabase = db.client as SupabaseClient;
});

const base = {
  projectId: PROJECT_ID,
  section: "research_problem" as const,
  citationId: "cit1",
  excerpt: "Depressive symptoms were reported by 21% of postpartum women.",
  page: 14,
  chunkId: null,
};

describe("evidence insertion", () => {
  it("persists the whole chain, not just a bracket in the text", async () => {
    const claim = await seedClaim();
    const result = await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "evidence_citation",
      support: "SUPPORTED",
    });

    expect(result.evidence.excerpt).toContain("21%");
    expect(result.relation.claim_id).toBe(claim.id);
    expect(result.relation.evidence_id).toBe(result.evidence.id);
    expect(result.relation.inserted_into_section).toBe("research_problem");
    expect(result.sectionContent).toContain("maternal wellbeing [sok2024].");
  });

  it("derives the claim status from the support judgement, never from the link existing", async () => {
    const claim = await seedClaim();

    const attached = await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "evidence_citation",
      support: "NEEDS_REVIEW",
    });
    expect(attached.claim.evidence_status).toBe("NEEDS_VERIFICATION");

    const second = await seedClaim("Screening is inconsistent.");
    const checked = await insertEvidence(supabase, {
      ...base,
      claimId: second.id,
      mode: "evidence_citation",
      support: "SUPPORTED",
    });
    expect(checked.claim.evidence_status).toBe("SUPPORTED");
  });

  it("records the version as an evidence insert, not as an AI change", async () => {
    const claim = await seedClaim();
    await insertEvidence(supabase, { ...base, claimId: claim.id, mode: "citation_only", support: "SUPPORTED" });

    const versions = await listSectionVersions(supabase, "s-problem");
    expect(versions).toHaveLength(1);
    expect(versions[0].action).toBe("evidence_insert");
    expect(versions[0].model).toBeFalsy();
  });

  it("links the evidence but leaves the text alone when the claim's wording has changed", async () => {
    const claim = await seedClaim("A sentence the researcher has since rewritten.");
    const result = await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "citation_only",
      support: "SUPPORTED",
    });

    expect(result.placement).toBe("claim_not_located");
    expect(result.sectionContent).toBe(SECTION_TEXT);
    expect(result.relation.id).toBeTruthy();
    expect(result.validation.notes.join(" ")).toMatch(/linked but not written into the text/);
  });

  it("never rewrites the paragraph without wording the researcher supplied", async () => {
    const claim = await seedClaim();
    await expect(
      insertEvidence(supabase, { ...base, claimId: claim.id, mode: "replace_claim", support: "SUPPORTED" }),
    ).rejects.toBeInstanceOf(EvidenceInsertionError);

    const replaced = await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "replace_claim",
      support: "SUPPORTED",
      replacementText: "Postpartum depression is associated with reduced maternal wellbeing.",
    });
    expect(replaced.sectionContent).toContain("associated with reduced maternal wellbeing [sok2024].");
    expect(replaced.sectionContent).toContain("Screening is inconsistent.");
  });

  it("refuses a source belonging to another project", async () => {
    const claim = await seedClaim();
    await expect(
      insertEvidence(supabase, {
        ...base,
        claimId: claim.id,
        citationId: "cit-other",
        mode: "citation_only",
        support: "SUPPORTED",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a claim that belongs to a different section", async () => {
    const [claim] = await createClaims(supabase, [
      { project_id: PROJECT_ID, section_type: "methodology", claim_text: "Elsewhere.", claim_type: "factual" },
    ]);
    await expect(
      insertEvidence(supabase, { ...base, claimId: claim.id, mode: "citation_only", support: "SUPPORTED" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("reports what it checked after inserting, rather than only that it succeeded", async () => {
    const claim = await seedClaim();
    const result = await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "evidence_citation",
      support: "SUPPORTED",
    });

    expect(result.validation).toMatchObject({
      sourceExists: true,
      evidenceExists: true,
      relationExists: true,
      projectMatches: true,
      citationExists: true,
      citationMetadataValid: true,
      ok: true,
    });
  });

  it("moves evidence coverage because the rows changed, not because it was told to", async () => {
    const claim = await seedClaim();

    const before = await buildSectionReview(supabase, PROJECT_ID, "research_problem");
    expect(before.evidenceCoverage.value).toBe(0);

    await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "evidence_citation",
      support: "SUPPORTED",
    });

    const after = await buildSectionReview(supabase, PROJECT_ID, "research_problem");
    expect(after.evidenceCoverage.value).toBe(1);
  });
});

describe("why a citation is where it is", () => {
  it("resolves section -> claim -> evidence -> source -> citation", async () => {
    const claim = await seedClaim();
    await insertEvidence(supabase, {
      ...base,
      claimId: claim.id,
      mode: "evidence_citation",
      support: "PARTIAL",
    });

    const [provenance] = await explainSectionCitations(supabase, PROJECT_ID, "research_problem");
    expect(provenance).toMatchObject({
      citationKey: "sok2024",
      claimText: "Postpartum depression can affect maternal wellbeing.",
      support: "PARTIAL",
      page: 14,
    });
    expect(provenance.excerpt).toContain("21%");
  });

  it("returns nothing for a section with no claims", async () => {
    expect(await explainSectionCitations(supabase, PROJECT_ID, "methodology")).toEqual([]);
  });
});
