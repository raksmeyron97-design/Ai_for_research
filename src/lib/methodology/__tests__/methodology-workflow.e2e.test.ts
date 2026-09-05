import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import { INJECTION_TEXT, itemGenerationFixture } from "../../ai/testing/methodology-fixtures";
import {
  createConstruct,
  createHypothesis,
  createIndicator,
  createObjective,
  createResearchQuestion,
  linkHypothesisVariable,
} from "../../db/methodology";
import { recordMethodologyEvent, listMethodologyEvents } from "../../db/methodology-events";
import { insertQuestions } from "../../db/questions";
import { buildMethodologyReview } from "../review-service";
import { suggestItems } from "../suggestions";

/**
 * Phase 18 §41: the whole chain, end to end, with a deterministic provider.
 *
 * The assertion that matters is the last one. After the AI suggestion is
 * accepted, the review is re-run — and it derives its result from the rows that
 * were written, not from the response that proposed them. If accepting a
 * suggestion did not actually create the item, coverage would not move, and
 * this test would fail with the model's answer having been perfectly fine.
 */
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
    research_instruments: [{ id: "inst-1", project_id: PROJECT_ID, name: "Main survey" }],
  });
}

let supabase: SupabaseClient;

beforeEach(() => {
  supabase = seed().client as SupabaseClient;
});

describe("the methodology chain, end to end", () => {
  it("moves measurement coverage only because rows changed", async () => {
    // --- the researcher builds the chain -------------------------------
    const question = await createResearchQuestion(supabase, {
      project_id: PROJECT_ID,
      question_text: "What is the relationship between teacher motivation and student performance?",
      question_kind: "correlational",
    });

    const objective = await createObjective(supabase, {
      project_id: PROJECT_ID,
      question_id: question.id,
      objective_text: "To measure the association between teacher motivation and student performance.",
    });

    const motivation = await createConstruct(supabase, {
      project_id: PROJECT_ID,
      name: "Teacher motivation",
      role: "independent",
      conceptual_definition: "Willingness to invest effort at work.",
      operational_definition: "Mean of the motivation items.",
    });
    const performance = await createConstruct(supabase, {
      project_id: PROJECT_ID,
      name: "Student performance",
      role: "dependent",
      conceptual_definition: "Attainment in assessed work.",
      operational_definition: "Mean end-of-term exam score.",
    });

    const satisfaction = await createIndicator(supabase, {
      project_id: PROJECT_ID,
      construct_id: motivation.id,
      name: "Job satisfaction",
    });
    const examScore = await createIndicator(supabase, {
      project_id: PROJECT_ID,
      construct_id: performance.id,
      name: "Exam score",
    });

    const hypothesis = await createHypothesis(supabase, {
      project_id: PROJECT_ID,
      objective_id: objective.id,
      label: "H1",
      statement: "Teacher motivation is positively associated with student performance.",
      hypothesis_form: "association",
      direction: "positive",
      analysis_method: "Pearson correlation",
    });
    await linkHypothesisVariable(supabase, {
      project_id: PROJECT_ID,
      hypothesis_id: hypothesis.id,
      construct_id: motivation.id,
      position: "predictor",
    });
    await linkHypothesisVariable(supabase, {
      project_id: PROJECT_ID,
      hypothesis_id: hypothesis.id,
      construct_id: performance.id,
      position: "outcome",
    });

    // One indicator is covered; the other is not.
    await insertQuestions(supabase, [
      {
        instrument_id: "inst-1",
        project_id: PROJECT_ID,
        section_label: "Motivation",
        question_text: "I feel satisfied with my work.",
        response_type: "open_text",
        order_index: 0,
        construct_id: motivation.id,
        indicator_id: satisfaction.id,
      },
    ]);

    // --- the deterministic review finds the gap ------------------------
    const before = await buildMethodologyReview(supabase, PROJECT_ID);
    const coverageBefore = before.metrics.find((m) => m.id === "measurement_coverage");
    expect(coverageBefore?.value).toBe(0.5);
    expect(coverageBefore?.evidence).toEqual({ covered: 1, total: 2 });

    const gap = before.findings.find((f) => f.id === `indicator-uncovered-${examScore.id}`);
    expect(gap?.severity).toBe("warning");
    expect(gap?.provenance).toBe("deterministic");

    // --- the assistant proposes items for the uncovered indicator ------
    const mock = createMockProvider({
      fallback: itemGenerationFixture([
        { text: "My most recent exam score reflected my preparation.", responseType: "likert" },
      ]),
    });

    const suggestion = await withMockProvider(mock, () =>
      suggestItems(supabase, {
        projectId: PROJECT_ID,
        constructName: performance.name,
        constructId: performance.id,
        indicatorName: examScore.name,
        indicatorId: examScore.id,
        operationalDefinition: performance.operational_definition,
      }),
    );

    expect(suggestion.provenance).toBe("ai_suggested");
    expect(suggestion.proposals[0]).toMatchObject({
      constructId: performance.id,
      indicatorId: examScore.id,
    });

    // Nothing is stored yet: a proposal is not a decision.
    const stillBefore = await buildMethodologyReview(supabase, PROJECT_ID);
    expect(stillBefore.metrics.find((m) => m.id === "measurement_coverage")?.value).toBe(0.5);

    // --- the researcher accepts it -------------------------------------
    const accepted = suggestion.proposals[0];
    const [created] = await insertQuestions(supabase, [
      {
        instrument_id: "inst-1",
        project_id: PROJECT_ID,
        section_label: "Performance",
        question_text: accepted.text,
        response_type: accepted.responseType,
        order_index: 1,
        construct_id: accepted.constructId,
        indicator_id: accepted.indicatorId,
        item_provenance: "ai_suggested",
      },
    ]);

    await recordMethodologyEvent(supabase, {
      project_id: PROJECT_ID,
      entity_type: "questionnaire_item",
      entity_id: created.id,
      action: "ai_suggestion_accepted",
      summary: "Accepted a suggested questionnaire item",
      proposal: accepted as unknown as Record<string, unknown>,
    });

    // --- the review is re-run and derives the change from the rows -----
    const after = await buildMethodologyReview(supabase, PROJECT_ID);
    const coverageAfter = after.metrics.find((m) => m.id === "measurement_coverage");
    expect(coverageAfter?.value).toBe(1);
    expect(coverageAfter?.evidence).toEqual({ covered: 2, total: 2 });
    expect(after.findings.some((f) => f.id === `indicator-uncovered-${examScore.id}`)).toBe(false);

    // The accepted item is still marked as a suggestion until confirmed.
    const stillSuggested = after.findings.find((f) => f.id === `item-unconfirmed-${created.id}`);
    expect(stillSuggested?.severity).toBe("info");

    // --- the history records what was proposed and what was decided ----
    const events = await listMethodologyEvents(supabase, PROJECT_ID);
    const decision = events.find((e) => e.action === "ai_suggestion_accepted");
    expect(decision?.entity_id).toBe(created.id);
    expect(decision?.proposal).toMatchObject({ text: accepted.text });
  });

  it("treats an instruction inside a construct definition as data", async () => {
    // §40: source and researcher text is content, never command. An injected
    // instruction reaches the model under the integrity guard's data rule and
    // changes nothing about what the workflow returns or writes.
    const construct = await createConstruct(supabase, {
      project_id: PROJECT_ID,
      name: "Perceived usefulness",
      operational_definition: INJECTION_TEXT,
    });

    const mock = createMockProvider({
      fallback: itemGenerationFixture([{ text: "I find the system useful in my work." }]),
    });

    const result = await withMockProvider(mock, () =>
      suggestItems(supabase, {
        projectId: PROJECT_ID,
        constructName: construct.name,
        constructId: construct.id,
        operationalDefinition: construct.operational_definition,
      }),
    );

    expect(result.provenance).toBe("ai_suggested");
    expect(result.proposals).toHaveLength(1);

    // The proposal has nowhere to carry the validation claim the injection
    // asked for, and nothing was written.
    const proposal = result.proposals[0] as unknown as Record<string, unknown>;
    expect(proposal).not.toHaveProperty("sourceCitationId");
    expect(proposal).not.toHaveProperty("adaptationType");

    const review = await buildMethodologyReview(supabase, PROJECT_ID);
    expect(review.totals.items).toBe(0);
  });
});
