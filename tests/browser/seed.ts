import { createClient } from "@supabase/supabase-js";

/**
 * The fixture project the browser suite drives.
 *
 * Seeded through the service-role client and raw SQL rather than through the
 * app's own routes: the point of these tests is the rendered interface, and
 * building the fixture through the UI would mean a layout failure and a
 * seeding failure look identical.
 *
 * The project is deliberately *not* clean. It carries a construct the
 * framework does not show, an unmapped node, a relationship pointing the
 * opposite way to its hypothesis and an unsupported claim — so every
 * workspace has real findings to render, and a panel that silently shows
 * nothing cannot pass by looking tidy.
 */
export const FIXTURE = {
  email: "browser-fixture@test.local",
  password: "browser-fixture-password-1",
  projectTitle: "Browser fixture project",
} as const;

const IDS = {
  project: "eeeeeeee-1111-1111-1111-111111111111",
  question: "eeeeeeee-2222-1111-1111-111111111111",
  objective: "eeeeeeee-2222-2222-2222-222222222222",
  constructA: "eeeeeeee-3333-1111-1111-111111111111",
  constructB: "eeeeeeee-3333-2222-2222-222222222222",
  constructC: "eeeeeeee-3333-3333-3333-333333333333",
  indicatorA: "eeeeeeee-4444-1111-1111-111111111111",
  indicatorB: "eeeeeeee-4444-2222-2222-222222222222",
  hypothesis: "eeeeeeee-5555-1111-1111-111111111111",
  nodeA: "eeeeeeee-6666-1111-1111-111111111111",
  nodeB: "eeeeeeee-6666-2222-2222-222222222222",
  nodeLegacy: "eeeeeeee-6666-3333-3333-333333333333",
  relationship: "eeeeeeee-7777-1111-1111-111111111111",
  instrument: "eeeeeeee-8888-1111-1111-111111111111",
  scale: "eeeeeeee-8888-2222-2222-222222222222",
  itemA: "eeeeeeee-8888-3333-3333-333333333333",
  citationA: "eeeeeeee-9999-1111-1111-111111111111",
  citationB: "eeeeeeee-9999-2222-2222-222222222222",
  evidenceA: "eeeeeeee-aaaa-1111-1111-111111111111",
  claimSupported: "eeeeeeee-bbbb-1111-1111-111111111111",
  claimUnsupported: "eeeeeeee-bbbb-2222-2222-222222222222",
} as const;

/** The sentence a traceability test navigates to and expects selected. */
export const TRACED_CLAIM_TEXT =
  "Teacher motivation was positively associated with student performance.";
export const UNSUPPORTED_CLAIM_TEXT =
  "Motivation is the single most important factor in education.";

export const RESULTS_SECTION_CONTENT = [
  "The analysis proceeded in two stages.",
  TRACED_CLAIM_TEXT,
  UNSUPPORTED_CLAIM_TEXT,
  "Further work is needed to establish causal direction.",
].join(" ");

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Browser tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).",
    );
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * Creates the fixture user, or reuses it. `createUser` with
 * `email_confirm: true` skips the mail round-trip local GoTrue would
 * otherwise require, so the suite does not depend on Inbucket being up.
 */
async function ensureUser(): Promise<string> {
  const admin = adminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email: FIXTURE.email,
    password: FIXTURE.password,
    email_confirm: true,
  });

  if (created?.user) return created.user.id;

  // Already there from a previous run. Reset the password so a fixture whose
  // credentials drifted cannot fail the whole suite at the login step.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email === FIXTURE.email);
  if (!existing) throw new Error(`Could not create or find the fixture user: ${error?.message}`);

  await admin.auth.admin.updateUserById(existing.id, {
    password: FIXTURE.password,
    email_confirm: true,
  });
  return existing.id;
}

/**
 * Rebuilds the fixture project from scratch on every run.
 *
 * Deleting the project first is what makes the suite repeatable: cascades
 * remove every child row, so a test that edits the framework does not leave
 * the next run looking at its edits. Only this one project is touched —
 * nothing else in the local database is cleared.
 */
export async function seedBrowserFixture(): Promise<{ userId: string; projectId: string }> {
  const admin = adminClient();
  const userId = await ensureUser();

  await admin.from("research_projects").delete().eq("id", IDS.project);

  const insert = async (table: string, rows: Record<string, unknown>[]) => {
    const { error } = await admin.from(table).insert(rows);
    if (error) throw new Error(`Seeding ${table} failed: ${error.message}`);
  };

  await insert("research_projects", [
    {
      id: IDS.project,
      user_id: userId,
      title: FIXTURE.projectTitle,
      language: "en",
    },
  ]);

  await insert("research_sections", [
    {
      project_id: IDS.project,
      section_type: "results",
      content: RESULTS_SECTION_CONTENT,
      status: "in_progress",
    },
    {
      project_id: IDS.project,
      section_type: "conceptual_framework",
      content: "The framework relates teacher motivation to student performance.",
      status: "in_progress",
    },
  ]);

  await insert("research_questions", [
    {
      id: IDS.question,
      project_id: IDS.project,
      question_text: "How does teacher motivation relate to student performance?",
      question_kind: "correlational",
    },
  ]);

  await insert("research_objectives", [
    {
      id: IDS.objective,
      project_id: IDS.project,
      question_id: IDS.question,
      objective_text: "To measure the association between teacher motivation and performance.",
    },
  ]);

  await insert("research_constructs", [
    {
      id: IDS.constructA,
      project_id: IDS.project,
      name: "Teacher motivation",
      role: "independent",
      conceptual_definition: "A teacher's willingness to invest effort.",
      operational_definition: "Mean of the motivation items.",
    },
    {
      id: IDS.constructB,
      project_id: IDS.project,
      name: "Student performance",
      role: "dependent",
      conceptual_definition: "Attainment against the curriculum.",
      operational_definition: "End-of-term examination score.",
    },
    // Deliberately absent from the framework, so the framework-coverage
    // finding has something real to report.
    {
      id: IDS.constructC,
      project_id: IDS.project,
      name: "Class size",
      role: "control",
      conceptual_definition: "Number of enrolled students.",
      operational_definition: null,
    },
  ]);

  await insert("research_indicators", [
    { id: IDS.indicatorA, project_id: IDS.project, construct_id: IDS.constructA, name: "Lesson preparation effort" },
    { id: IDS.indicatorB, project_id: IDS.project, construct_id: IDS.constructB, name: "Examination score" },
  ]);

  await insert("research_hypotheses", [
    {
      id: IDS.hypothesis,
      project_id: IDS.project,
      objective_id: IDS.objective,
      label: "H1",
      statement: "Teacher motivation is positively associated with student performance.",
      hypothesis_form: "association",
      direction: "positive",
      analysis_method: "Pearson correlation",
    },
  ]);

  await insert("research_hypothesis_variables", [
    { project_id: IDS.project, hypothesis_id: IDS.hypothesis, construct_id: IDS.constructA, position: "predictor" },
    { project_id: IDS.project, hypothesis_id: IDS.hypothesis, construct_id: IDS.constructB, position: "outcome" },
  ]);

  await insert("research_framework_nodes", [
    { id: IDS.nodeA, project_id: IDS.project, construct_id: IDS.constructA, position_x: 40, position_y: 60 },
    { id: IDS.nodeB, project_id: IDS.project, construct_id: IDS.constructB, position_x: 320, position_y: 60 },
    // A legacy free-text node, so the unmapped state is on screen (§40).
    { id: IDS.nodeLegacy, project_id: IDS.project, construct_id: null, label: "School climate", position_x: 180, position_y: 220 },
  ]);

  await insert("research_framework_relationships", [
    {
      id: IDS.relationship,
      project_id: IDS.project,
      from_node_id: IDS.nodeA,
      to_node_id: IDS.nodeB,
      relation_type: "predicts",
      hypothesis_id: IDS.hypothesis,
    },
  ]);

  await insert("research_scales", [
    {
      id: IDS.scale,
      project_id: IDS.project,
      name: "Agreement 1-5",
      points: [
        { value: 1, label: "Strongly disagree" },
        { value: 2, label: "Disagree" },
        { value: 3, label: "Neutral" },
        { value: 4, label: "Agree" },
        { value: 5, label: "Strongly agree" },
      ],
      polarity: "ascending",
    },
  ]);

  await insert("research_instruments", [
    { id: IDS.instrument, project_id: IDS.project, name: "Teacher survey" },
  ]);

  await insert("questionnaire_questions", [
    {
      id: IDS.itemA,
      project_id: IDS.project,
      instrument_id: IDS.instrument,
      section_label: "Motivation",
      order_index: 0,
      question_text: "I feel motivated to prepare my lessons carefully.",
      response_type: "likert",
      construct_id: IDS.constructA,
      indicator_id: IDS.indicatorA,
      scale_id: IDS.scale,
    },
  ]);

  await insert("research_citations", [
    {
      id: IDS.citationA,
      project_id: IDS.project,
      citation_key: "smith2024",
      title: "Teacher motivation and student outcomes",
      authors: ["Smith, J", "Lee, K"],
      year: 2024,
      journal: "Journal of Education",
      doi: "10.1234/fixture",
      source_type: "article",
      status: "verified",
    },
    // No DOI and nothing cites it: gives the literature filters a row that
    // actually differs from the first one.
    {
      id: IDS.citationB,
      project_id: IDS.project,
      citation_key: "jones2019",
      title: "Classroom climate and attainment",
      authors: ["Jones, A"],
      year: 2019,
      journal: "Teaching Review",
      source_type: "article",
      status: "unverified",
    },
  ]);

  await insert("research_evidence", [
    {
      id: IDS.evidenceA,
      project_id: IDS.project,
      citation_id: IDS.citationA,
      excerpt: "Motivation correlated with attainment across the sample (r = .42, p < .01).",
    },
  ]);

  await insert("research_claims", [
    {
      id: IDS.claimSupported,
      project_id: IDS.project,
      section_type: "results",
      claim_text: TRACED_CLAIM_TEXT,
      claim_type: "factual",
      needs_evidence: true,
      evidence_status: "SUPPORTED",
      source_offset_start: RESULTS_SECTION_CONTENT.indexOf(TRACED_CLAIM_TEXT),
      source_offset_end:
        RESULTS_SECTION_CONTENT.indexOf(TRACED_CLAIM_TEXT) + TRACED_CLAIM_TEXT.length,
    },
    {
      id: IDS.claimUnsupported,
      project_id: IDS.project,
      section_type: "results",
      claim_text: UNSUPPORTED_CLAIM_TEXT,
      claim_type: "interpretive",
      needs_evidence: true,
      evidence_status: "NEEDS_VERIFICATION",
      source_offset_start: null,
      source_offset_end: null,
    },
  ]);

  await insert("research_claim_evidence", [
    {
      project_id: IDS.project,
      claim_id: IDS.claimSupported,
      evidence_id: IDS.evidenceA,
      support: "SUPPORTED",
    },
  ]);

  return { userId, projectId: IDS.project };
}

export const FIXTURE_IDS = IDS;
