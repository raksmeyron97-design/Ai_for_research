import type { QuestionnaireQuestionRow } from "../db/types";
import type { MethodologyModel } from "./model";

/**
 * The coverage matrix (§12).
 *
 * Construct → dimension → indicator → item, counted from stored links only.
 * The one number this refuses to produce is an "optimal item count": §12 says
 * not to invent one, and it is right to — three items per indicator is a rule
 * of thumb from one measurement tradition, not a fact, and printing it as a
 * target would turn a convention into a requirement the researcher never chose.
 * So the matrix reports what covers what, and leaves "enough" to the researcher.
 */
export interface IndicatorCoverage {
  indicatorId: string;
  name: string;
  dimension: string | null;
  items: QuestionnaireQuestionRow[];
}

export interface ConstructCoverage {
  constructId: string;
  name: string;
  role: string;
  indicators: IndicatorCoverage[];
  /** Items attached to the construct without naming an indicator. */
  unassignedItems: QuestionnaireQuestionRow[];
  /** True when the construct has at least one indicator and every one is covered. */
  fullyCovered: boolean;
}

export interface CoverageMatrix {
  constructs: ConstructCoverage[];
  /** Items linked to neither a construct nor an indicator. */
  orphanItems: QuestionnaireQuestionRow[];
  /** Indicators with no item at all — the gap the matrix exists to show. */
  uncoveredIndicatorIds: string[];
  counts: { indicators: number; coveredIndicators: number; items: number; mappedItems: number };
}

export function buildCoverageMatrix(model: MethodologyModel): CoverageMatrix {
  const itemsByIndicator = new Map<string, QuestionnaireQuestionRow[]>();
  const itemsByConstructOnly = new Map<string, QuestionnaireQuestionRow[]>();
  const orphanItems: QuestionnaireQuestionRow[] = [];

  for (const item of model.items) {
    if (item.indicator_id) {
      const list = itemsByIndicator.get(item.indicator_id) ?? [];
      list.push(item);
      itemsByIndicator.set(item.indicator_id, list);
    } else if (item.construct_id) {
      const list = itemsByConstructOnly.get(item.construct_id) ?? [];
      list.push(item);
      itemsByConstructOnly.set(item.construct_id, list);
    } else {
      orphanItems.push(item);
    }
  }

  const uncoveredIndicatorIds: string[] = [];
  const constructs: ConstructCoverage[] = model.constructs.map((construct) => {
    const indicators = model.indicators
      .filter((indicator) => indicator.construct_id === construct.id)
      .map<IndicatorCoverage>((indicator) => {
        const items = itemsByIndicator.get(indicator.id) ?? [];
        if (items.length === 0) uncoveredIndicatorIds.push(indicator.id);
        return {
          indicatorId: indicator.id,
          name: indicator.name,
          dimension: indicator.dimension,
          items,
        };
      });

    return {
      constructId: construct.id,
      name: construct.name,
      role: construct.role,
      indicators,
      unassignedItems: itemsByConstructOnly.get(construct.id) ?? [],
      // A construct with no indicators is not "fully covered" — there is
      // nothing to cover yet, and calling that complete would hide the gap.
      fullyCovered: indicators.length > 0 && indicators.every((i) => i.items.length > 0),
    };
  });

  const totalIndicators = model.indicators.length;
  const covered = totalIndicators - uncoveredIndicatorIds.length;

  return {
    constructs,
    orphanItems,
    uncoveredIndicatorIds,
    counts: {
      indicators: totalIndicators,
      coveredIndicators: covered,
      items: model.items.length,
      mappedItems: model.items.length - orphanItems.length,
    },
  };
}
