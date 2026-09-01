import { beforeEach, describe, expect, it } from "vitest";
import { createInMemorySupabase } from "../testing/in-memory-supabase";
import { createMockProvider, withMockProvider, type MockProvider } from "../testing/mock-provider";
import { runSectionAction, SectionActionError } from "../sections/run-action";
import { generateConclusion } from "../conclusion-generator";
import { generateDiscussion } from "../discussion-generator";
import { generateResultsAnalysis } from "../results-generator";
import { AIOrchestrator } from "../orchestrator";
import { compileDocumentModel } from "../../export/document-model";
import { renderMarkdown } from "../../export/to-markdown";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 16 §22: the whole researcher workflow, end to end, with no API
 * credits and no network.
 *
 * Every AI step goes through the real orchestrator, router, guards, context
 * policy and citation verification — only the network call is replaced. That
 * is the point: mocking `AIOrchestrator` (as older tests do) would exercise
 * none of the wiring this phase added.
 *
 * Fixture Scenario A from §23. Nothing here is a real research finding.
 */
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const DATASET_ID = "33333333-3333-3333-3333-333333333333";

function seedProject() {
  return createInMemorySupabase({
    research_projects: [
      {
        id: PROJECT_ID,
        user_id: USER_ID,
        title: "សុខភាពផ្លូវចិត្តអំឡុងពេលមុន និងក្រោយសម្រាល និងតួនាទីរបស់ឆ្មប",
        language: "km",
        discipline: "midwifery",
        study_design: "cross_sectional",
        target_population: ["midwives", "pregnant women", "postpartum women"],
        location: "Phnom Penh",
        sample_size: 200,
        sampling_method: "convenience",
        status: "active",
      },
    ],
    research_citations: [
      {
        id: "44444444-4444-4444-4444-444444444444",
        project_id: PROJECT_ID,
        citation_key: "sok2024antenatal",
        title: "Antenatal depressive symptoms among women attending urban health centres",
        authors: ["Sok, D."],
        year: 2024,
        status: "user_provided",
      },
    ],
    research_sections: [],
  });
}

async function saveSection(db: ReturnType<typeof seedProject>, sectionType: string, content: string) {
  const { upsertSection } = await import("../../db/sections");
  return upsertSection(db.client as SupabaseClient, {
    project_id: PROJECT_ID,
    section_type: sectionType as never,
    content,
    status: "in_progress",
  });
}

let db: ReturnType<typeof seedProject>;
let mock: MockProvider;

beforeEach(() => {
  db = seedProject();
  mock = createMockProvider();
});

describe("offline end-to-end research workflow", () => {
  it("walks the full chain from title to export using only mock AI", async () => {
    const supabase = db.client as SupabaseClient;

    await withMockProvider(mock, async () => {
      // --- 1. Problem statement -------------------------------------------
      const problem = await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "research_problem",
        actionId: "generate",
        userId: USER_ID,
      });
      expect(problem.content.length).toBeGreaterThan(0);
      await saveSection(db, "research_problem", "Screening competency among midwives is undocumented locally.");

      // --- 2. Rationale ----------------------------------------------------
      await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "rationale",
        actionId: "generate",
        userId: USER_ID,
      });
      await saveSection(db, "rationale", "No local study has measured screening competency.");

      // --- 3. Objectives, as validated structured output -------------------
      mock.reset();
      const objectivesMock = createMockProvider({
        fallback: {
          kind: "valid",
          json: {
            generalObjective: "Assess depression screening competency among midwives.",
            specificObjectives: [
              {
                text: "Determine the proportion of midwives who correctly apply the screening cut-off.",
                measurable: true,
                measurabilityNote: "",
                linkedQuestion: "",
              },
            ],
            alignmentNotes: [],
          },
        },
      });

      await withMockProvider(objectivesMock, async () => {
        const objectives = await runSectionAction(supabase, {
          projectId: PROJECT_ID,
          section: "objectives",
          actionId: "generate",
          userId: USER_ID,
        });
        expect(objectives.structured).toMatchObject({
          specificObjectives: [{ measurable: true }],
        });
      });
      await saveSection(db, "objectives", "General: assess screening competency. Specific: 1) proportion applying cut-off.");

      // --- 4. Research questions -------------------------------------------
      const questionsMock = createMockProvider({
        fallback: {
          kind: "valid",
          json: {
            questions: [
              { question: "What proportion of midwives apply the cut-off correctly?", objective: "1", variable: "competency" },
            ],
            issues: [],
          },
        },
      });
      await withMockProvider(questionsMock, async () => {
        const questions = await runSectionAction(supabase, {
          projectId: PROJECT_ID,
          section: "research_questions",
          actionId: "generate",
          userId: USER_ID,
        });
        expect(questions.structured).toMatchObject({ questions: [{ variable: "competency" }] });
      });
      await saveSection(db, "research_questions", "What proportion of midwives apply the cut-off correctly?");

      // --- 5. Variables, always AI-suggested -------------------------------
      const variablesMock = createMockProvider({
        fallback: {
          kind: "valid",
          json: {
            variables: [
              {
                name: "screening competency",
                role: "dependent",
                dataType: "binary",
                operationalDefinition: "Correct application of the 13-point cut-off on a vignette.",
                measurement: "vignette score",
                linkedObjective: "1",
              },
            ],
            notes: [],
          },
        },
      });
      await withMockProvider(variablesMock, async () => {
        const variables = await runSectionAction(supabase, {
          projectId: PROJECT_ID,
          section: "variables",
          actionId: "generate",
          userId: USER_ID,
        });
        // §10: the schema has no field the model could use to claim a
        // variable is confirmed.
        expect(JSON.stringify(variables.structured)).not.toContain("confirmed");
      });
      await saveSection(db, "variables", "Dependent: screening competency (binary).");

      // --- 6. Methodology review -------------------------------------------
      await saveSection(db, "methodology", "Cross-sectional survey of 200 midwives, convenience sample.");
      const methodologyMock = createMockProvider({
        fallback: {
          kind: "valid",
          json: {
            findings: [
              {
                aspect: "sampling",
                verdict: "WARN",
                issue: "Convenience sampling limits generalisability.",
                reason: "Selection bias is not addressed.",
                affectedSection: "methodology",
                recommendation: "State the limitation explicitly.",
              },
            ],
          },
        },
      });
      await withMockProvider(methodologyMock, async () => {
        const review = await runSectionAction(supabase, {
          projectId: PROJECT_ID,
          section: "methodology",
          actionId: "review",
          userId: USER_ID,
        });
        expect(review.structured).toMatchObject({ findings: [{ verdict: "WARN" }] });
      });

      // --- 7. Dataset and computed results ---------------------------------
      db.seed("research_datasets", [
        {
          id: DATASET_ID,
          project_id: PROJECT_ID,
          name: "competency survey",
          row_count: 3,
          column_schema: [
            { name: "age", type: "number" },
            { name: "correct", type: "number" },
          ],
          data: [
            { age: 24, correct: 1 },
            { age: 31, correct: 0 },
            { age: 28, correct: 1 },
          ],
        },
      ]);

      const results = await generateResultsAnalysis(supabase, PROJECT_ID, DATASET_ID, { userId: USER_ID });
      // The numbers come from summarizeDataset, never from the model.
      expect(results.rowCount).toBe(3);
      expect(results.summary.age).toBeDefined();
      await saveSection(db, "results", "Mean age 27.7; 2 of 3 applied the cut-off correctly.");

      // --- 8. Discussion, which requires real results ----------------------
      const discussion = await generateDiscussion(supabase, PROJECT_ID, { userId: USER_ID });
      expect(discussion.content.length).toBeGreaterThan(0);
      await saveSection(db, "discussion", "Findings are consistent with the single available local source.");

      // --- 9. Conclusion, which requires objectives and findings -----------
      const conclusion = await generateConclusion(supabase, PROJECT_ID, { userId: USER_ID });
      expect(conclusion.content.length).toBeGreaterThan(0);
      await saveSection(db, "conclusion", "Screening competency was incomplete in this sample.");
    });

    // --- 10. Export -------------------------------------------------------
    const model = await compileDocumentModel(db.client as SupabaseClient, PROJECT_ID);
    const markdown = renderMarkdown(model);

    expect(markdown).toContain("Research Problem");
    expect(markdown).toContain("Screening competency was incomplete in this sample.");
  });

  it("records a version row for every content change, with AI provenance", async () => {
    const supabase = db.client as SupabaseClient;
    const { recordSectionVersion, listSectionVersions } = await import("../../db/section-versions");

    const section = await saveSection(db, "objectives", "First draft.");
    await recordSectionVersion(supabase, {
      project_id: PROJECT_ID,
      section_id: section.id,
      section_type: "objectives",
      previous_content: "",
      new_content: "First draft.",
      action: "ai_generate",
      provider: "gemini",
      model: "gemini-3.6-flash",
      section_action: "generate",
    });

    const versions = await listSectionVersions(supabase, section.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      previous_content: "",
      new_content: "First draft.",
      action: "ai_generate",
      provider: "gemini",
    });
  });
});

describe("research integrity guards, offline (§24)", () => {
  it("blocks results generation when no dataset is attached", async () => {
    const supabase = db.client as SupabaseClient;
    await withMockProvider(mock, async () => {
      const response = await new AIOrchestrator({ supabase }).generate({
        projectId: PROJECT_ID,
        taskType: "results_generation",
        message: "Generate Chapter 5 results.",
      });

      expect(response.content).toContain("Real research data is required");
      // The guard answers before any provider call — nothing to hallucinate around.
      expect(mock.calls).toHaveLength(0);
    });
  });

  it("blocks a conclusion when there are no results to conclude from", async () => {
    const supabase = db.client as SupabaseClient;
    await saveSection(db, "objectives", "Assess screening competency.");

    await withMockProvider(mock, async () => {
      await expect(generateConclusion(supabase, PROJECT_ID)).rejects.toThrow(/results|discussion/i);
    });
  });

  it("blocks a discussion when there are no results", async () => {
    const supabase = db.client as SupabaseClient;
    await withMockProvider(mock, async () => {
      await expect(generateDiscussion(supabase, PROJECT_ID)).rejects.toThrow();
    });
  });

  it("flags a citation key that matches no saved source", async () => {
    const supabase = db.client as SupabaseClient;
    await saveSection(db, "research_problem", "Existing content to improve.");

    const citing = createMockProvider({
      fallback: { kind: "citation", keys: ["invented2020key"] },
    });

    await withMockProvider(citing, async () => {
      const result = await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "research_problem",
        actionId: "improve",
        userId: USER_ID,
      });
      expect(result.warnings.some((w) => w.category === "citation")).toBe(true);
    });
  });

  it("does not flag a citation key that does resolve", async () => {
    const supabase = db.client as SupabaseClient;
    await saveSection(db, "research_problem", "Existing content to improve.");

    const citing = createMockProvider({ fallback: { kind: "citation", keys: ["sok2024antenatal"] } });
    await withMockProvider(citing, async () => {
      const result = await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "research_problem",
        actionId: "improve",
        userId: USER_ID,
      });
      expect(result.warnings.some((w) => w.category === "citation")).toBe(false);
    });
  });

  it("fails safely on invalid AI JSON, persisting nothing", async () => {
    const supabase = db.client as SupabaseClient;
    const broken = createMockProvider({ fallback: { kind: "invalid_json" } });

    await withMockProvider(broken, async () => {
      await expect(
        runSectionAction(supabase, {
          projectId: PROJECT_ID,
          section: "objectives",
          actionId: "generate",
          userId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(SectionActionError);
    });

    expect(db.rows("research_sections")).toHaveLength(0);
  });

  it("fails safely when structured output has the wrong shape", async () => {
    const supabase = db.client as SupabaseClient;
    const wrongShape = createMockProvider({
      fallback: { kind: "schema_mismatch", json: { generalObjective: 42 } },
    });

    await withMockProvider(wrongShape, async () => {
      const error = await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "objectives",
        actionId: "generate",
        userId: USER_ID,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(SectionActionError);
      // §28: a researcher sees something actionable, not a Zod dump.
      expect((error as SectionActionError).userMessage).toContain("Nothing was saved");
    });
  });

  it("translates a provider failure into a safe message that says nothing was saved", async () => {
    const supabase = db.client as SupabaseClient;
    await saveSection(db, "research_problem", "Content.");
    const failing = createMockProvider({ fallback: { kind: "provider_failure", message: "429 key=SECRET" } });

    await withMockProvider(failing, async () => {
      const error = await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "research_problem",
        actionId: "improve",
        userId: USER_ID,
      }).catch((e) => e);

      expect((error as SectionActionError).userMessage).not.toContain("SECRET");
      expect((error as SectionActionError).userMessage).toContain("Nothing was saved");
    });
  });

  it("refuses an action that needs content when the section is empty", async () => {
    const supabase = db.client as SupabaseClient;
    await withMockProvider(mock, async () => {
      await expect(
        runSectionAction(supabase, {
          projectId: PROJECT_ID,
          section: "research_problem",
          actionId: "improve",
          userId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(SectionActionError);
      // No provider call for a request that could not have worked.
      expect(mock.calls).toHaveLength(0);
    });
  });

  it("directs generation of guarded sections to their dedicated generator", async () => {
    const supabase = db.client as SupabaseClient;
    await withMockProvider(mock, async () => {
      const error = await runSectionAction(supabase, {
        projectId: PROJECT_ID,
        section: "results",
        actionId: "generate",
        userId: USER_ID,
      }).catch((e) => e);

      expect((error as SectionActionError).userMessage).toContain("dataset");
      expect(mock.calls).toHaveLength(0);
    });
  });
});
