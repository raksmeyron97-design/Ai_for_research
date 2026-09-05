import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import {
  createConstruct,
  createHypothesis,
  createIndicator,
  createObjective,
  createResearchQuestion,
  createScale,
  linkHypothesisVariable,
} from "../../db/methodology";
import {
  createFrameworkNode,
  createFrameworkRelationship,
  deleteFrameworkRelationship,
  updateFrameworkNode,
} from "../../db/framework";
import { insertQuestions, updateQuestion } from "../../db/questions";
import { createClaims, createEvidence, linkClaimEvidence } from "../../db/evidence";
import { upsertCitation } from "../../db/citations";
import { linkClaimToMethodology } from "../../db/integrity";
import { upsertSection } from "../../db/sections";
import { buildResearchSystemReview } from "../review-service";
import type { ReviewFinding } from "../types";

/**
 * §43: the whole research graph, built, deliberately broken, and repaired.
 *
 * The assertion that matters throughout is that every finding comes and goes
 * *because rows changed*. The review is derived on every call (§21), so a
 * finding that appears after a link is removed and disappears after it is
 * restored is evidence the review is reading the database rather than caching
 * a verdict. A cached review would pass the "break" half of every case below
 * and fail the repair.
 */
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const CLAIM_TEXT = "Teacher motivation was positively associated with student performance.";

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

function has(findings: ReviewFinding[], prefix: string): boolean {
  return findings.some((f) => f.id.startsWith(prefix));
}

/**
 * Builds the full chain from §43:
 *
 *   Question -> Objective -> Construct -> Indicator -> Hypothesis
 *            -> Framework node -> link to construct -> relationship
 *            -> Questionnaire item -> mapped to indicator
 *            -> Claim -> Citation -> Evidence -> Source
 *            -> Claim linked to methodology
 */
async function buildEverything() {
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
    conceptual_definition: "A teacher's willingness to invest effort.",
    operational_definition: "Mean of the motivation items.",
  });

  const performance = await createConstruct(supabase, {
    project_id: PROJECT_ID,
    name: "Student performance",
    role: "dependent",
    conceptual_definition: "Attainment against the curriculum.",
    operational_definition: "End-of-term examination score.",
  });

  const motivationIndicator = await createIndicator(supabase, {
    project_id: PROJECT_ID,
    construct_id: motivation.id,
    name: "Lesson preparation effort",
  });

  const performanceIndicator = await createIndicator(supabase, {
    project_id: PROJECT_ID,
    construct_id: performance.id,
    name: "Examination score",
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

  // --- the framework, bound to the canonical constructs ------------------
  const motivationNode = await createFrameworkNode(supabase, {
    project_id: PROJECT_ID,
    construct_id: motivation.id,
  });
  const performanceNode = await createFrameworkNode(supabase, {
    project_id: PROJECT_ID,
    construct_id: performance.id,
  });
  const relationship = await createFrameworkRelationship(supabase, {
    project_id: PROJECT_ID,
    from_node_id: motivationNode.id,
    to_node_id: performanceNode.id,
    relation_type: "predicts",
    hypothesis_id: hypothesis.id,
  });

  // --- measurement -------------------------------------------------------
  // A Likert item with no scale is a Phase 18 error in its own right, so the
  // fixture attaches one: this test is about the Phase 20 edges, and leaving a
  // known unrelated error in the baseline would mask them.
  const scale = await createScale(supabase, {
    project_id: PROJECT_ID,
    name: "Agreement 1-5",
    points: [
      { value: 1, label: "Strongly disagree" },
      { value: 2, label: "Disagree" },
      { value: 3, label: "Neutral" },
      { value: 4, label: "Agree" },
      { value: 5, label: "Strongly agree" },
    ],
    polarity: "ascending",
  });

  const [motivationItem, performanceItem] = await insertQuestions(supabase, [
    {
      project_id: PROJECT_ID,
      instrument_id: "inst-1",
      section_label: "Motivation",
      order_index: 0,
      question_text: "I feel motivated to prepare my lessons carefully.",
      response_type: "likert",
      construct_id: motivation.id,
      indicator_id: motivationIndicator.id,
      scale_id: scale.id,
    },
    {
      project_id: PROJECT_ID,
      instrument_id: "inst-1",
      section_label: "Performance",
      order_index: 1,
      question_text: "My most recent exam score reflected my preparation.",
      response_type: "likert",
      construct_id: performance.id,
      indicator_id: performanceIndicator.id,
      scale_id: scale.id,
    },
  ]);

  // --- the manuscript, with its evidence chain ---------------------------
  await upsertSection(supabase, {
    project_id: PROJECT_ID,
    section_type: "results",
    content: `The analysis proceeded in two stages. ${CLAIM_TEXT} [smith2024]`,
    status: "in_progress",
  });

  const citation = await upsertCitation(supabase, {
    project_id: PROJECT_ID,
    citation_key: "smith2024",
    title: "Teacher motivation and student outcomes",
    authors: ["Smith, J"],
    year: 2024,
    journal: "Journal of Education",
    doi: "10.1234/example",
    status: "verified",
  });

  const evidence = await createEvidence(supabase, {
    project_id: PROJECT_ID,
    citation_id: citation.id,
    excerpt: "Motivation correlated with attainment across the sample.",
  });

  // `createClaims` derives needs_evidence and the initial status from
  // claim_type on purpose, so neither is passed here.
  const [claim] = await createClaims(supabase, [
    {
      project_id: PROJECT_ID,
      section_type: "results",
      claim_text: CLAIM_TEXT,
      claim_type: "factual",
    },
  ]);

  await linkClaimEvidence(supabase, {
    project_id: PROJECT_ID,
    claim_id: claim.id,
    evidence_id: evidence.id,
    support: "SUPPORTED",
  });

  await linkClaimToMethodology(supabase, {
    project_id: PROJECT_ID,
    claim_id: claim.id,
    hypothesis_id: hypothesis.id,
    construct_id: motivation.id,
  });

  return {
    question,
    objective,
    motivation,
    performance,
    motivationIndicator,
    performanceIndicator,
    hypothesis,
    motivationNode,
    performanceNode,
    relationship,
    motivationItem,
    performanceItem,
    citation,
    evidence,
    claim,
  };
}

describe("the whole research graph, end to end (§43)", () => {
  it("traces everything once the chain is complete", async () => {
    await buildEverything();
    const review = await buildResearchSystemReview(supabase, PROJECT_ID);

    // No structural failure anywhere.
    expect(review.findings.filter((f) => f.severity === "error")).toEqual([]);

    // And the things that would each be a broken edge are absent.
    expect(has(review.findings, "framework:construct-not-in-framework:")).toBe(false);
    expect(has(review.findings, "framework:node-unmapped:")).toBe(false);
    expect(has(review.findings, "framework:hypothesis-not-drawn:")).toBe(false);
    expect(has(review.findings, "framework:construct-not-measured:")).toBe(false);
    expect(has(review.findings, "analysis:hypothesis-not-reported:")).toBe(false);
    expect(has(review.findings, "traceability:claim-no-methodology-link:")).toBe(false);

    // Framework coverage is computed, not assumed.
    const coverage = review.metrics.find((m) => m.id === "framework_coverage");
    expect(coverage?.value).toBe(1);
    expect(coverage?.evidence).toEqual({ covered: 2, total: 2 });
  });

  it("reports an unsupported claim when the evidence relation is removed, and stops when it is restored", async () => {
    const built = await buildEverything();

    const before = await buildResearchSystemReview(supabase, PROJECT_ID);
    const supportedBefore = before.metrics.find((m) => m.id === "integrity_evidence_coverage")?.value;

    // There is no db helper for removing a claim-evidence row (nothing in the
    // app unlinks one yet), so the break goes through the client directly.
    await supabase
      .from("research_claim_evidence")
      .delete()
      .eq("project_id", PROJECT_ID)
      .eq("claim_id", built.claim.id)
      .eq("evidence_id", built.evidence.id);

    const broken = await buildResearchSystemReview(supabase, PROJECT_ID);
    // The excerpt now supports nothing — a real edge, invisible from either end.
    expect(has(broken.findings, "traceability:evidence-supports-nothing:")).toBe(true);

    // Repair, and it goes away because the row came back.
    await linkClaimEvidence(supabase, {
      project_id: PROJECT_ID,
      claim_id: built.claim.id,
      evidence_id: built.evidence.id,
      support: "SUPPORTED",
    });

    const repaired = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(has(repaired.findings, "traceability:evidence-supports-nothing:")).toBe(false);
    expect(repaired.metrics.find((m) => m.id === "integrity_evidence_coverage")?.value).toBe(
      supportedBefore,
    );
  });

  it("reports a measurement gap when the item mapping is removed, and stops when it is restored", async () => {
    const built = await buildEverything();

    await updateQuestion(supabase, PROJECT_ID, built.motivationItem.id, {
      construct_id: null,
      indicator_id: null,
    });

    const broken = await buildResearchSystemReview(supabase, PROJECT_ID);
    const finding = broken.findings.find((f) =>
      f.id === `framework:construct-not-measured:${built.motivation.id}`,
    );
    expect(finding?.category).toBe("questionnaire");
    expect(finding?.severity).toBe("warning");

    await updateQuestion(supabase, PROJECT_ID, built.motivationItem.id, {
      construct_id: built.motivation.id,
      indicator_id: built.motivationIndicator.id,
    });

    const repaired = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(
      has(repaired.findings, `framework:construct-not-measured:${built.motivation.id}`),
    ).toBe(false);
  });

  it("reports a framework gap when the relationship is removed, and stops when it is redrawn", async () => {
    const built = await buildEverything();

    await deleteFrameworkRelationship(supabase, PROJECT_ID, built.relationship.id);

    const broken = await buildResearchSystemReview(supabase, PROJECT_ID);
    // Both constructs are still drawn, so this is specifically "the
    // hypothesis relates two things the framework does not connect".
    expect(has(broken.findings, "framework:hypothesis-not-drawn:")).toBe(true);
    expect(has(broken.findings, "framework:node-isolated:")).toBe(true);

    await createFrameworkRelationship(supabase, {
      project_id: PROJECT_ID,
      from_node_id: built.motivationNode.id,
      to_node_id: built.performanceNode.id,
      relation_type: "predicts",
      hypothesis_id: built.hypothesis.id,
    });

    const repaired = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(has(repaired.findings, "framework:hypothesis-not-drawn:")).toBe(false);
    expect(has(repaired.findings, "framework:node-isolated:")).toBe(false);
  });

  it("reports an unmapped node when the construct link is cleared, and stops when it is relinked", async () => {
    const built = await buildEverything();

    await updateFrameworkNode(supabase, PROJECT_ID, built.motivationNode.id, {
      construct_id: null,
      label: "Teacher motivation",
    });

    const broken = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(has(broken.findings, `framework:node-unmapped:${built.motivationNode.id}`)).toBe(true);
    // And the construct is now absent from the framework, which is the other
    // half of the same break — §40: an identical label does not count as a
    // mapping.
    expect(
      has(broken.findings, `framework:construct-not-in-framework:${built.motivation.id}`),
    ).toBe(true);

    await updateFrameworkNode(supabase, PROJECT_ID, built.motivationNode.id, {
      construct_id: built.motivation.id,
    });

    const repaired = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(has(repaired.findings, `framework:node-unmapped:${built.motivationNode.id}`)).toBe(false);
    expect(
      has(repaired.findings, `framework:construct-not-in-framework:${built.motivation.id}`),
    ).toBe(false);
  });

  it("reports a direction disagreement when the relationship is reversed", async () => {
    const built = await buildEverything();

    await deleteFrameworkRelationship(supabase, PROJECT_ID, built.relationship.id);
    await createFrameworkRelationship(supabase, {
      project_id: PROJECT_ID,
      from_node_id: built.performanceNode.id,
      to_node_id: built.motivationNode.id,
      relation_type: "predicts",
      hypothesis_id: built.hypothesis.id,
    });

    const broken = await buildResearchSystemReview(supabase, PROJECT_ID);
    const finding = broken.findings.find((f) => f.id.startsWith("framework:direction-mismatch:"));
    expect(finding?.severity).toBe("warning");
    // Never rewritten: the framework and the hypothesis are both the
    // researcher's, and nothing here decides which is the mistake.
    expect(finding?.remediation).toMatch(/decide which direction/i);
  });

  it("reports an unreported hypothesis when the claim's methodology link is the only one", async () => {
    // Build everything except the claim -> hypothesis link.
    const built = await buildEverything();

    // A second hypothesis nothing reports on.
    const second = await createHypothesis(supabase, {
      project_id: PROJECT_ID,
      objective_id: built.objective.id,
      label: "H2",
      statement: "Class size moderates the association.",
      hypothesis_form: "association",
      direction: "none",
      analysis_method: "Moderated regression",
    });

    const review = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(has(review.findings, `analysis:hypothesis-not-reported:${second.id}`)).toBe(true);
    // The first one is reported on, so it must not be flagged.
    expect(has(review.findings, `analysis:hypothesis-not-reported:${built.hypothesis.id}`)).toBe(
      false,
    );
  });

  it("never reports one finding twice under two names", async () => {
    // Phase 19 relays Phase 18's consistency findings, and Phase 20 calls
    // Phase 18 directly — so before de-duplication every methodology finding
    // arrived twice, as `methodology:<id>` and `integrity:methodology:<id>`,
    // under two categories and two target types. A researcher would have seen
    // each one in two places and had no way to tell they were the same thing.
    const built = await buildEverything();

    // Break something Phase 18 reports on, so there is a methodology finding
    // to duplicate in the first place.
    await updateQuestion(supabase, PROJECT_ID, built.motivationItem.id, { scale_id: null });

    const review = await buildResearchSystemReview(supabase, PROJECT_ID);

    const ids = review.findings.map((f) => f.id);
    expect(ids.length).toBe(new Set(ids).size);

    // And specifically: no finding survives with the double prefix.
    expect(ids.filter((id) => id.startsWith("integrity:methodology:"))).toEqual([]);

    // The one that is kept carries the real target, not a flattened project id.
    const itemFinding = review.findings.find((f) => f.id.startsWith("methodology:item-no-scale"));
    expect(itemFinding?.targetType).toBe("questionnaire_item");
    expect(itemFinding?.category).toBe("questionnaire");
  });

  it("computes the final state from stored rows, not from anything cached", async () => {
    const built = await buildEverything();

    const first = await buildResearchSystemReview(supabase, PROJECT_ID);
    const second = await buildResearchSystemReview(supabase, PROJECT_ID);
    // Two runs over unchanged rows agree exactly — findings are sorted
    // stably so this is a real equality, not a set comparison.
    expect(second.findings.map((f) => f.id)).toEqual(first.findings.map((f) => f.id));

    // And one row changes the answer.
    await deleteFrameworkRelationship(supabase, PROJECT_ID, built.relationship.id);
    const third = await buildResearchSystemReview(supabase, PROJECT_ID);
    expect(third.findings.map((f) => f.id)).not.toEqual(first.findings.map((f) => f.id));
  });
});
