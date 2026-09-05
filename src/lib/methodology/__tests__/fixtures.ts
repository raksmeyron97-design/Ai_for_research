import type {
  QuestionnaireQuestionRow,
  ResearchConstructRow,
  ResearchHypothesisRow,
  ResearchHypothesisVariableRow,
  ResearchIndicatorRow,
  ResearchObjectiveRow,
  ResearchQuestionRow,
  ResearchScaleRow,
} from "../../db/types";
import { EMPTY_MODEL, type MethodologyModel } from "../model";

/**
 * Row builders for the methodology engine's tests.
 *
 * Everything defaults to the *complete* state — definitions filled, links
 * present — so a test that wants a gap removes one field and the test reads as
 * "this one thing is missing" rather than as a wall of setup.
 */
let counter = 0;
const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

export function researchQuestion(over: Partial<ResearchQuestionRow> = {}): ResearchQuestionRow {
  return {
    id: id("rq"),
    project_id: "p1",
    question_text: "What is the relationship between teacher motivation and student performance?",
    question_kind: "correlational",
    provenance: "user",
    confirmed: true,
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function objective(over: Partial<ResearchObjectiveRow> = {}): ResearchObjectiveRow {
  return {
    id: id("obj"),
    project_id: "p1",
    question_id: null,
    objective_text: "To measure the association between teacher motivation and student performance.",
    provenance: "user",
    confirmed: true,
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function construct(over: Partial<ResearchConstructRow> = {}): ResearchConstructRow {
  return {
    id: id("con"),
    project_id: "p1",
    name: "Teacher motivation",
    role: "independent",
    conceptual_definition: "A teacher's willingness to invest effort in their work.",
    operational_definition: "Mean score across the intrinsic and extrinsic motivation items.",
    notes: null,
    provenance: "user",
    confirmed: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function indicator(over: Partial<ResearchIndicatorRow> = {}): ResearchIndicatorRow {
  return {
    id: id("ind"),
    project_id: "p1",
    construct_id: "con-1",
    name: "Job satisfaction",
    dimension: "Intrinsic motivation",
    description: null,
    provenance: "user",
    confirmed: true,
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function hypothesis(over: Partial<ResearchHypothesisRow> = {}): ResearchHypothesisRow {
  return {
    id: id("hyp"),
    project_id: "p1",
    objective_id: "obj-1",
    question_id: null,
    label: "H1",
    statement: "Teacher motivation is positively associated with student performance.",
    hypothesis_form: "association",
    direction: "positive",
    analysis_method: "Pearson correlation",
    provenance: "user",
    confirmed: true,
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function hypothesisVariable(
  over: Partial<ResearchHypothesisVariableRow> = {},
): ResearchHypothesisVariableRow {
  return {
    id: id("hv"),
    project_id: "p1",
    hypothesis_id: "hyp-1",
    construct_id: "con-1",
    position: "predictor",
    provenance: "user",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function scale(over: Partial<ResearchScaleRow> = {}): ResearchScaleRow {
  return {
    id: id("sc"),
    project_id: "p1",
    name: "Agreement 1-5",
    points: [
      { value: 1, label: "Strongly disagree" },
      { value: 2, label: "Disagree" },
      { value: 3, label: "Neutral" },
      { value: 4, label: "Agree" },
      { value: 5, label: "Strongly agree" },
    ],
    polarity: "ascending",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function item(over: Partial<QuestionnaireQuestionRow> = {}): QuestionnaireQuestionRow {
  return {
    id: id("q"),
    instrument_id: "inst-1",
    project_id: "p1",
    section_label: "Motivation",
    objective_label: null,
    variable_label: null,
    construct: null,
    question_text: "I feel motivated to prepare my lessons carefully.",
    response_type: "likert",
    options: null,
    required: true,
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    construct_id: "con-1",
    indicator_id: "ind-1",
    scale_id: "sc-1",
    reverse_coded: false,
    item_provenance: "user",
    source_citation_id: null,
    source_location: null,
    adaptation_type: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function model(over: Partial<MethodologyModel> = {}): MethodologyModel {
  return { ...EMPTY_MODEL, ...over };
}

/** A small project where every link in the chain is present. */
export function completeModel(): MethodologyModel {
  const q = researchQuestion({ id: "rq-a" });
  const o = objective({ id: "obj-a", question_id: q.id });
  const c = construct({ id: "con-a" });
  const i = indicator({ id: "ind-a", construct_id: c.id });
  const outcome = construct({ id: "con-b", name: "Student performance", role: "dependent" });
  const outcomeIndicator = indicator({ id: "ind-b", construct_id: outcome.id, name: "Exam score" });
  const h = hypothesis({ id: "hyp-a", objective_id: o.id });
  const s = scale({ id: "sc-a" });

  return {
    ...EMPTY_MODEL,
    questions: [q],
    objectives: [o],
    constructs: [c, outcome],
    indicators: [i, outcomeIndicator],
    hypotheses: [h],
    hypothesisVariables: [
      hypothesisVariable({ hypothesis_id: h.id, construct_id: c.id, position: "predictor" }),
      hypothesisVariable({ hypothesis_id: h.id, construct_id: outcome.id, position: "outcome" }),
    ],
    scales: [s],
    items: [
      item({ id: "q-a", construct_id: c.id, indicator_id: i.id, scale_id: s.id }),
      item({
        id: "q-b",
        construct_id: outcome.id,
        indicator_id: outcomeIndicator.id,
        scale_id: s.id,
        question_text: "My most recent exam score reflected my preparation.",
      }),
    ],
  };
}
