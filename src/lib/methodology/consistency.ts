import { contentWords } from "../evidence/ranking";
import { HYPOTHESIS_POSITION_LABELS } from "../db/types";
import { buildCoverageMatrix, type CoverageMatrix } from "./coverage";
import { classifyQuestion, expectsHypothesis } from "./question-classification";
import { byId, type MethodologyModel } from "./model";
import { reviewQuestionnaire } from "./questionnaire-quality";
import type { MethodologyFinding, MethodologyMetric } from "./types";

/**
 * The consistency engine (§13).
 *
 * Every finding below is a statement about *stored rows*: an edge that is
 * absent, a definition column that is null, two names that differ. None of them
 * is a judgement about whether the research is any good, and the wording is
 * chosen so none of them can be read that way — §21 is explicit that ordinary
 * methodological incompleteness must not be described in alarming language.
 *
 * `error` is reserved for a state that is structurally impossible to act on
 * (a hypothesis naming no outcome, a construct measured by nothing).
 * `warning` is a real gap in a chain the researcher has started.
 * `info` is a prompt to look, not a defect.
 */
function det(f: Omit<MethodologyFinding, "provenance">): MethodologyFinding {
  return { ...f, provenance: "deterministic" };
}

/**
 * Near-identical names, the way a researcher actually creates them: same words,
 * different order, and one of them plural. "Teacher motivation" and "motivation
 * of teachers" are one concept typed twice.
 *
 * The plural rule is crude — a trailing "s" off words longer than three letters
 * — and it is meant to be. It exists to catch that one pattern, and the finding
 * it produces asks the researcher whether the two are the same rather than
 * merging anything.
 */
/**
 * Exported for Phase 19's manuscript-consistency checks, which reuse this
 * exact heuristic for claim-text-vs-construct-name drift rather than
 * inventing a second one.
 */
export function normalisedName(name: string): string {
  return contentWords(name)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .sort()
    .join(" ");
}

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 3)}…` : text;
}

// ---------------------------------------------------------------------
// §6 — questions and objectives
// ---------------------------------------------------------------------
function reviewQuestionsAndObjectives(model: MethodologyModel): MethodologyFinding[] {
  const findings: MethodologyFinding[] = [];
  const objectivesByQuestion = new Map<string, number>();
  for (const objective of model.objectives) {
    if (!objective.question_id) continue;
    objectivesByQuestion.set(objective.question_id, (objectivesByQuestion.get(objective.question_id) ?? 0) + 1);
  }

  const hypothesesByQuestion = new Set(
    model.hypotheses.flatMap((h) => (h.question_id ? [h.question_id] : [])),
  );
  const objectiveIdsWithHypothesis = new Set(
    model.hypotheses.flatMap((h) => (h.objective_id ? [h.objective_id] : [])),
  );

  for (const question of model.questions) {
    if (!objectivesByQuestion.has(question.id)) {
      findings.push(
        det({
          id: `question-no-objective-${question.id}`,
          category: "question_objective_alignment",
          severity: "warning",
          title: "Research question has no objective",
          explanation:
            "No objective is linked to this question, so nothing in the study states what will be done to answer it.",
          evidence: truncate(question.question_text),
          targetType: "research_question",
          targetId: question.id,
          remediation: "Write an objective for this question, or link an existing one.",
        }),
      );
    }

    // The shape of the question decides whether a missing hypothesis is worth
    // mentioning at all. A descriptive question needs no hypothesis, and
    // saying otherwise would be the check inventing a requirement.
    const kind = question.question_kind === "unclassified"
      ? classifyQuestion(question.question_text).kind
      : question.question_kind;

    const reachable =
      hypothesesByQuestion.has(question.id) ||
      model.objectives.some((o) => o.question_id === question.id && objectiveIdsWithHypothesis.has(o.id));

    if (expectsHypothesis(kind) && model.hypotheses.length > 0 && !reachable) {
      findings.push(
        det({
          id: `question-no-hypothesis-${question.id}`,
          category: "hypothesis_traceability",
          severity: "info",
          title: "No hypothesis traces back to this question",
          explanation: `This question is phrased as ${kind === "causal" ? "an effect" : kind === "comparative" ? "a comparison" : "a relationship"}, and the project states hypotheses elsewhere, but none of them is linked to this one.`,
          evidence: truncate(question.question_text),
          targetType: "research_question",
          targetId: question.id,
          remediation: "Link the hypothesis that addresses this question, if there is one.",
        }),
      );
    }
  }

  for (const objective of model.objectives) {
    if (objective.question_id) continue;
    findings.push(
      det({
        id: `objective-no-question-${objective.id}`,
        category: "question_objective_alignment",
        severity: model.questions.length === 0 ? "info" : "warning",
        title: "Objective is not linked to a research question",
        explanation:
          model.questions.length === 0
            ? "No research questions have been added yet, so there is nothing to link this objective to."
            : "This objective does not say which research question it serves.",
        evidence: truncate(objective.objective_text),
        targetType: "objective",
        targetId: objective.id,
        remediation:
          model.questions.length === 0 ? "Add the research questions first." : "Link the question this objective answers.",
      }),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------
// §7 / §9 — constructs, definitions, indicators
// ---------------------------------------------------------------------
function reviewConstructs(model: MethodologyModel, coverage: CoverageMatrix): MethodologyFinding[] {
  const findings: MethodologyFinding[] = [];
  const indicatorsByConstruct = new Map<string, number>();
  for (const indicator of model.indicators) {
    indicatorsByConstruct.set(
      indicator.construct_id,
      (indicatorsByConstruct.get(indicator.construct_id) ?? 0) + 1,
    );
  }
  const coverageByConstruct = new Map(coverage.constructs.map((c) => [c.constructId, c]));

  // Near-duplicate names. Same content words in any order is how the same
  // construct gets entered twice: "teacher motivation" and "motivation of
  // teachers" are one concept and two rows, and every traceability check
  // downstream then splits between them.
  const byNormalised = new Map<string, string[]>();
  for (const construct of model.constructs) {
    const key = normalisedName(construct.name);
    if (!key) continue;
    byNormalised.set(key, [...(byNormalised.get(key) ?? []), construct.id]);
  }
  for (const [, ids] of byNormalised) {
    if (ids.length < 2) continue;
    const names = ids.map((id) => model.constructs.find((c) => c.id === id)?.name).filter(Boolean);
    findings.push(
      det({
        id: `construct-near-duplicate-${ids[0]}`,
        category: "construct_naming",
        severity: "warning",
        title: "Two constructs may be the same concept",
        explanation: `${names.map((n) => `“${n}”`).join(" and ")} use the same words. If they are one concept, the items and hypotheses pointing at each are being counted separately.`,
        targetType: "construct",
        targetId: ids[0],
        remediation: "Merge them if they are the same, or rename so the difference is visible.",
      }),
    );
  }

  for (const construct of model.constructs) {
    const label = `“${construct.name}”`;

    if (!construct.conceptual_definition?.trim()) {
      findings.push(
        det({
          id: `construct-no-conceptual-${construct.id}`,
          category: "definition",
          severity: "info",
          title: "Construct has no conceptual definition",
          explanation: `${label} has no stated meaning, so a reader cannot tell what it covers and what it excludes.`,
          targetType: "construct",
          targetId: construct.id,
          remediation: "Write what the concept means, ideally citing where the definition comes from.",
        }),
      );
    }

    if (!construct.operational_definition?.trim()) {
      findings.push(
        det({
          id: `construct-no-operational-${construct.id}`,
          category: "definition",
          severity: construct.conceptual_definition?.trim() ? "warning" : "info",
          title: "Construct has no operational definition",
          explanation: construct.conceptual_definition?.trim()
            ? `${label} says what the concept means but not how it will be observed. That gap is what makes a construct unmeasurable in practice.`
            : `${label} has neither definition yet.`,
          targetType: "construct",
          targetId: construct.id,
          remediation: "State how this construct will be observed or measured.",
        }),
      );
    }

    if ((indicatorsByConstruct.get(construct.id) ?? 0) === 0) {
      const directItems = coverageByConstruct.get(construct.id)?.unassignedItems.length ?? 0;
      findings.push(
        det({
          id: `construct-no-indicator-${construct.id}`,
          category: "measurement_chain",
          severity: directItems > 0 ? "info" : "warning",
          title: "Construct has no indicators",
          explanation:
            directItems > 0
              ? `${label} is measured by ${directItems} item${directItems === 1 ? "" : "s"} directly, without indicators in between. That is workable; indicators only become necessary when the construct has distinguishable parts.`
              : `${label} has nothing observable under it, so there is nothing for a questionnaire item to measure.`,
          targetType: "construct",
          targetId: construct.id,
          remediation: "Add the indicators that make this construct observable.",
        }),
      );
    }

    const constructCoverage = coverageByConstruct.get(construct.id);
    const itemCount =
      (constructCoverage?.unassignedItems.length ?? 0) +
      (constructCoverage?.indicators.reduce((n, i) => n + i.items.length, 0) ?? 0);

    if (itemCount === 0) {
      findings.push(
        det({
          id: `construct-unmeasured-${construct.id}`,
          category: "measurement_coverage",
          severity: "error",
          title: "Construct is not measured by anything",
          explanation: `No questionnaire item measures ${label} or any of its indicators, so the study collects no data about it.`,
          targetType: "construct",
          targetId: construct.id,
          remediation: "Add items for this construct, or remove it if it is no longer part of the design.",
        }),
      );
    }

    if (construct.provenance === "ai_suggested" && !construct.confirmed) {
      findings.push(
        det({
          id: `construct-unconfirmed-${construct.id}`,
          category: "provenance",
          severity: "info",
          title: "AI-suggested construct not yet confirmed",
          explanation: `${label} was proposed by the assistant and is still marked as a suggestion.`,
          targetType: "construct",
          targetId: construct.id,
          remediation: "Confirm it to make it part of the model, or remove it.",
        }),
      );
    }
  }

  for (const indicator of model.indicators) {
    if (coverage.uncoveredIndicatorIds.includes(indicator.id)) {
      const construct = model.constructs.find((c) => c.id === indicator.construct_id);
      findings.push(
        det({
          id: `indicator-uncovered-${indicator.id}`,
          category: "measurement_coverage",
          severity: "warning",
          title: "Indicator has no questionnaire item",
          explanation: `“${indicator.name}”${construct ? ` under “${construct.name}”` : ""} has no item measuring it, so this part of the construct is not covered by the instrument.`,
          targetType: "indicator",
          targetId: indicator.id,
          remediation: "Write an item for this indicator, or map an existing one.",
        }),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------
// §8 — hypotheses
// ---------------------------------------------------------------------
function reviewHypotheses(model: MethodologyModel): MethodologyFinding[] {
  const findings: MethodologyFinding[] = [];
  const constructsById = byId(model.constructs);
  const linksByHypothesis = new Map<string, typeof model.hypothesisVariables>();
  for (const link of model.hypothesisVariables) {
    linksByHypothesis.set(link.hypothesis_id, [...(linksByHypothesis.get(link.hypothesis_id) ?? []), link]);
  }

  // Direction conflicts, per unordered construct pair. Two hypotheses stating
  // opposite directions for the same pair is a contradiction inside the study,
  // and it is invisible when the hypotheses are read one at a time.
  const directionByPair = new Map<string, { direction: string; hypothesisId: string; label: string }[]>();

  for (const hypothesis of model.hypotheses) {
    const links = linksByHypothesis.get(hypothesis.id) ?? [];
    const name = hypothesis.label ? `${hypothesis.label}` : truncate(hypothesis.statement, 60);

    if (links.length === 0) {
      findings.push(
        det({
          id: `hypothesis-no-variables-${hypothesis.id}`,
          category: "hypothesis_traceability",
          severity: "error",
          title: "Hypothesis names no variables",
          explanation: `${name} is not linked to any construct, so there is no way to tell what it predicts about or how it would be tested.`,
          evidence: truncate(hypothesis.statement),
          targetType: "hypothesis",
          targetId: hypothesis.id,
          remediation: "Link the constructs this hypothesis relates, and say which is the predictor and which the outcome.",
        }),
      );
    } else {
      const positions = new Set(links.map((l) => l.position));
      if (!positions.has("outcome")) {
        findings.push(
          det({
            id: `hypothesis-no-outcome-${hypothesis.id}`,
            category: "hypothesis_traceability",
            severity: "error",
            title: "Hypothesis has no outcome",
            explanation: `${name} links ${links.length} construct${links.length === 1 ? "" : "s"} but none of them is marked as the outcome, so the hypothesis states no result to observe.`,
            evidence: truncate(hypothesis.statement),
            targetType: "hypothesis",
            targetId: hypothesis.id,
            remediation: "Mark which construct is the outcome.",
          }),
        );
      }

      // The form and the links must agree. A mediation hypothesis with no
      // mediator linked is not a mediation hypothesis yet, whichever the form
      // column says.
      if (hypothesis.hypothesis_form === "mediation" && !positions.has("mediator")) {
        findings.push(
          det({
            id: `hypothesis-mediation-no-mediator-${hypothesis.id}`,
            category: "hypothesis_structure",
            severity: "error",
            title: "Mediation hypothesis has no mediator",
            explanation: `${name} is recorded as a mediation hypothesis, but no construct is linked in the mediator position.`,
            evidence: truncate(hypothesis.statement),
            targetType: "hypothesis",
            targetId: hypothesis.id,
            remediation: "Link the mediating construct, or change the hypothesis form.",
          }),
        );
      }
      if (hypothesis.hypothesis_form === "moderation" && !positions.has("moderator")) {
        findings.push(
          det({
            id: `hypothesis-moderation-no-moderator-${hypothesis.id}`,
            category: "hypothesis_structure",
            severity: "error",
            title: "Moderation hypothesis has no moderator",
            explanation: `${name} is recorded as a moderation hypothesis, but no construct is linked in the moderator position.`,
            evidence: truncate(hypothesis.statement),
            targetType: "hypothesis",
            targetId: hypothesis.id,
            remediation: "Link the moderating construct, or change the hypothesis form.",
          }),
        );
      }

      // A construct in a hypothesis that nothing measures makes the hypothesis
      // untestable with the current instrument — worth saying at the
      // hypothesis, not only at the construct.
      for (const link of links) {
        const construct = constructsById.get(link.construct_id);
        if (!construct) continue;
        const measured = model.items.some(
          (item) =>
            item.construct_id === construct.id ||
            model.indicators.some((i) => i.construct_id === construct.id && i.id === item.indicator_id),
        );
        if (!measured) {
          findings.push(
            det({
              id: `hypothesis-unmeasured-variable-${hypothesis.id}-${construct.id}`,
              category: "hypothesis_traceability",
              severity: "warning",
              title: "Hypothesis uses a construct nothing measures",
              explanation: `${name} uses “${construct.name}” as the ${HYPOTHESIS_POSITION_LABELS[link.position].toLowerCase()}, but no questionnaire item measures it. As it stands the hypothesis cannot be tested with this instrument.`,
              evidence: truncate(hypothesis.statement),
              targetType: "hypothesis",
              targetId: hypothesis.id,
              remediation: `Add items measuring “${construct.name}”.`,
            }),
          );
        }
      }

      const predictors = links.filter((l) => l.position === "predictor").map((l) => l.construct_id).sort();
      const outcomes = links.filter((l) => l.position === "outcome").map((l) => l.construct_id).sort();
      if (hypothesis.direction !== "unspecified" && predictors.length > 0 && outcomes.length > 0) {
        const key = `${predictors.join(",")}->${outcomes.join(",")}`;
        directionByPair.set(key, [
          ...(directionByPair.get(key) ?? []),
          { direction: hypothesis.direction, hypothesisId: hypothesis.id, label: name },
        ]);
      }
    }

    if (!hypothesis.objective_id && !hypothesis.question_id) {
      findings.push(
        det({
          id: `hypothesis-untraceable-${hypothesis.id}`,
          category: "hypothesis_traceability",
          severity: "warning",
          title: "Hypothesis is not linked to an objective or question",
          explanation: `${name} does not say which part of the study it belongs to, so it cannot be traced back to what the research set out to answer.`,
          evidence: truncate(hypothesis.statement),
          targetType: "hypothesis",
          targetId: hypothesis.id,
          remediation: "Link it to the objective or research question it addresses.",
        }),
      );
    }
  }

  for (const [, entries] of directionByPair) {
    const directions = new Set(entries.map((e) => e.direction));
    if (directions.size > 1) {
      findings.push(
        det({
          id: `hypothesis-direction-conflict-${entries[0].hypothesisId}`,
          category: "hypothesis_structure",
          severity: "warning",
          title: "Hypotheses state opposite directions for the same relationship",
          explanation: `${entries.map((e) => e.label).join(" and ")} predict different directions between the same constructs. One of them will be disconfirmed whatever the data show.`,
          targetType: "hypothesis",
          targetId: entries[0].hypothesisId,
          remediation: "Check whether these are genuinely competing predictions or a data-entry slip.",
        }),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------
// §33 — analysis plan. Advisory only.
// ---------------------------------------------------------------------

/**
 * Methods that cannot address a relationship between two variables, whatever
 * else they are good for. The list is short on purpose: §33 says build
 * compatibility *warnings*, not automatic judgements, so this only fires where
 * the incompatibility is definitional rather than a matter of preference.
 */
const RELATIONSHIP_INCAPABLE = [
  { pattern: /\b(?:descriptive|frequenc(?:y|ies)|percentages?|means? and standard deviations?)\b/i, name: "descriptive statistics" },
];

function reviewAnalysisPlan(model: MethodologyModel): MethodologyFinding[] {
  const findings: MethodologyFinding[] = [];

  for (const hypothesis of model.hypotheses) {
    const name = hypothesis.label ?? truncate(hypothesis.statement, 60);
    const method = hypothesis.analysis_method?.trim();

    if (!method) {
      if (model.hypotheses.length > 0) {
        findings.push(
          det({
            id: `hypothesis-no-analysis-${hypothesis.id}`,
            category: "analysis_plan",
            severity: "info",
            title: "Hypothesis has no analysis method",
            explanation: `${name} does not say how it will be tested.`,
            targetType: "hypothesis",
            targetId: hypothesis.id,
            remediation: "Record the analysis method you intend to use.",
          }),
        );
      }
      continue;
    }

    const relational = hypothesis.hypothesis_form !== "descriptive" && hypothesis.hypothesis_form !== "unclassified";
    const incapable = RELATIONSHIP_INCAPABLE.find((m) => m.pattern.test(method));
    if (relational && incapable) {
      findings.push(
        det({
          id: `hypothesis-analysis-mismatch-${hypothesis.id}`,
          category: "analysis_plan",
          severity: "warning",
          title: "Analysis method may not test this hypothesis",
          explanation: `${name} states a relationship, and the recorded method is ${incapable.name}, which describes variables rather than testing a relationship between them. Whether the plan is adequate is a methodological judgement — this check only notes the mismatch.`,
          evidence: method,
          targetType: "hypothesis",
          targetId: hypothesis.id,
          remediation: "Confirm the analysis with your supervisor, or record the inferential test you will use.",
        }),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------
// Metrics (§14)
// ---------------------------------------------------------------------
function ratio(covered: number, total: number, label: string, id: string, reasons: { ok: string; empty: string }): MethodologyMetric {
  if (total === 0) {
    // §14: null means "not computable", never zero. An empty model has no
    // coverage to report, and 0% would read as a failing study.
    return { id, label, value: null, status: "not_computable", reason: reasons.empty };
  }
  const value = covered / total;
  return {
    id,
    label,
    value,
    status: value === 1 ? "ok" : value >= 0.5 ? "attention" : "incomplete",
    reason: reasons.ok,
    evidence: { covered, total },
  };
}

export function buildMetrics(model: MethodologyModel, coverage: CoverageMatrix): MethodologyMetric[] {
  const linkedObjectives = model.objectives.filter((o) => o.question_id).length;
  const questionsWithObjective = new Set(
    model.objectives.flatMap((o) => (o.question_id ? [o.question_id] : [])),
  ).size;

  const constructsDefined = model.constructs.filter(
    (c) => c.conceptual_definition?.trim() && c.operational_definition?.trim(),
  ).length;

  const tracedHypotheses = model.hypotheses.filter((h) => {
    const links = model.hypothesisVariables.filter((l) => l.hypothesis_id === h.id);
    return links.some((l) => l.position === "outcome") && (h.objective_id || h.question_id);
  }).length;

  const measuredConstructs = coverage.constructs.filter(
    (c) => c.unassignedItems.length > 0 || c.indicators.some((i) => i.items.length > 0),
  ).length;

  const hypothesesWithAnalysis = model.hypotheses.filter((h) => h.analysis_method?.trim()).length;

  const itemsWithProvenanceIntegrity = model.items.filter(
    (i) => i.adaptation_type === null || i.source_citation_id !== null,
  ).length;

  return [
    ratio(questionsWithObjective, model.questions.length, "Research-question alignment", "question_alignment", {
      ok: "Research questions that have at least one objective linked to them.",
      empty: "No research questions have been added yet.",
    }),
    ratio(linkedObjectives, model.objectives.length, "Objective coverage", "objective_coverage", {
      ok: "Objectives that state which research question they serve.",
      empty: "No objectives have been added yet.",
    }),
    ratio(constructsDefined, model.constructs.length, "Construct completeness", "construct_completeness", {
      ok: "Constructs with both a conceptual and an operational definition.",
      empty: "No constructs have been added yet.",
    }),
    ratio(measuredConstructs, model.constructs.length, "Variable traceability", "variable_traceability", {
      ok: "Constructs measured by at least one questionnaire item.",
      empty: "No constructs have been added yet.",
    }),
    ratio(tracedHypotheses, model.hypotheses.length, "Hypothesis traceability", "hypothesis_traceability", {
      ok: "Hypotheses with a named outcome and a link to an objective or question.",
      empty: "No hypotheses have been added yet.",
    }),
    ratio(
      coverage.counts.coveredIndicators,
      coverage.counts.indicators,
      "Measurement coverage",
      "measurement_coverage",
      {
        ok: "Indicators with at least one questionnaire item measuring them.",
        empty: "No indicators have been added yet.",
      },
    ),
    ratio(coverage.counts.mappedItems, coverage.counts.items, "Questionnaire coverage", "questionnaire_coverage", {
      ok: "Questionnaire items linked to a construct or an indicator.",
      empty: "No questionnaire items have been written yet.",
    }),
    ratio(hypothesesWithAnalysis, model.hypotheses.length, "Analysis-plan coverage", "analysis_coverage", {
      ok: "Hypotheses with a recorded analysis method.",
      empty: "No hypotheses have been added yet.",
    }),
    ratio(itemsWithProvenanceIntegrity, model.items.length, "Source provenance integrity", "provenance_integrity", {
      ok: "Items that either claim no source or name the source they claim.",
      empty: "No questionnaire items have been written yet.",
    }),
  ];
}

// ---------------------------------------------------------------------
export interface ConsistencyResult {
  findings: MethodologyFinding[];
  metrics: MethodologyMetric[];
  coverage: CoverageMatrix;
}

/**
 * The whole deterministic pass. Pure — it reads the gathered model and returns
 * findings, so every rule is testable without a database and the result cannot
 * depend on anything a model said.
 */
export function runConsistencyChecks(model: MethodologyModel): ConsistencyResult {
  const coverage = buildCoverageMatrix(model);

  const scalesById = new Map(model.scales.map((s) => [s.id, s]));
  const constructNamesById = new Map(model.constructs.map((c) => [c.id, c.name]));
  const indicatorNamesById = new Map(model.indicators.map((i) => [i.id, i.name]));

  const findings = [
    ...reviewQuestionsAndObjectives(model),
    ...reviewConstructs(model, coverage),
    ...reviewHypotheses(model),
    ...reviewAnalysisPlan(model),
    ...reviewQuestionnaire(model.items, { scalesById, constructNamesById, indicatorNamesById }),
  ];

  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { findings, metrics: buildMetrics(model, coverage), coverage };
}
