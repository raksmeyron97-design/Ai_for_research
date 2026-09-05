import { contentWords } from "../evidence/ranking";
import type { QuestionnaireQuestionRow, ResearchScaleRow } from "../db/types";
import type { MethodologyFinding } from "./types";

/**
 * Deterministic questionnaire item checks (§11).
 *
 * Every rule here is a *linguistic heuristic*, and the wording of every finding
 * says so. §11 is explicit: the system may flag "possible double-barrelled
 * item"; it may not claim the item is proven defective. A questionnaire item is
 * a piece of natural language, and no pattern match settles whether a
 * respondent will misread it — only a pilot does.
 *
 * So these findings are `warning` and `info`, never `error`, with one
 * exception: a structural fact about the stored model (an item mapped to
 * nothing, a Likert item with no scale) is an `error` because it is a fact, not
 * a reading.
 */

/** Words that join two distinct things a respondent would rate separately. */
const CONJUNCTIONS = /\b(?:and|or|as well as|along with|together with)\b/gi;

/**
 * Nouns/adjectives that carry their own evaluative content. "Satisfied with X
 * and Y" is double-barrelled; "bread and butter" inside one noun phrase is not,
 * so the rule needs both sides of the conjunction to look like separate objects.
 */
const EVALUATIVE_STEMS = [
  "satisf", "agree", "useful", "helpful", "clear", "relevant", "important",
  "effective", "quality", "difficult", "easy", "confident", "willing", "likely",
];

const LEADING_PHRASES = [
  /\bdon'?t you (?:agree|think)\b/i,
  /\bwouldn'?t you (?:agree|say)\b/i,
  /\bhow much do you agree that\b/i,
  /\bobviously\b/i,
  /\bclearly\b/i,
  /\bof course\b/i,
  /\bas everyone knows\b/i,
  /\bisn'?t it true that\b/i,
  /\bshouldn'?t\b/i,
  /\bthe (?:excellent|poor|outstanding|terrible)\b/i,
];

const NEGATIONS = /\b(?:not|never|no|none|cannot|can't|won'?t|doesn'?t|didn'?t|isn'?t|aren'?t|shouldn'?t|wouldn'?t|unable|lack(?:ing)?|without)\b/gi;

/** Pronouns and bare definite phrases with no antecedent inside the item. */
const AMBIGUOUS_REFS = [
  /\bthey\b/i, /\bthem\b/i, /\btheir\b/i, /\bit\b/i, /\bits\b/i,
  /\bthis\b/i, /\bthat\b/i, /\bthese\b/i, /\bthose\b/i,
  /\bthe programme?\b/i, /\bthe service\b/i, /\bthe system\b/i, /\bthe organi[sz]ation\b/i,
];

/** Response types where a shared, ordered scale is what makes the item scoreable. */
const SCALED_TYPES = new Set(["likert"]);

function finding(f: Omit<MethodologyFinding, "provenance">): MethodologyFinding {
  return { ...f, provenance: "deterministic" };
}

function itemLabel(item: QuestionnaireQuestionRow): string {
  return item.question_text.length > 90
    ? `${item.question_text.slice(0, 87)}…`
    : item.question_text;
}

/**
 * Jaccard over content words. `lexicalOverlap` in the ranking module is
 * deliberately asymmetric — it asks how much of a claim an excerpt covers —
 * which is the wrong question here: two items are redundant only when they
 * cover each other, so this is symmetric on purpose rather than a duplicate of
 * that function.
 */
export function itemSimilarity(a: string, b: string): number {
  const left = new Set(contentWords(a));
  const right = new Set(contentWords(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Above this, two items in the same construct are worth a second look.
 *
 * 0.6 rather than something stricter because of how redundant items actually
 * look: "I feel motivated to prepare my lessons carefully" and "...to prepare
 * my lessons well" share four content words out of six, which is 0.67. A
 * threshold above that would miss the exact case the rule exists for.
 */
export const REDUNDANCY_THRESHOLD = 0.6;

export function detectDoubleBarrelled(text: string): string[] {
  const matches = [...text.matchAll(CONJUNCTIONS)];
  if (matches.length === 0) return [];

  const hits: string[] = [];
  for (const match of matches) {
    const index = match.index ?? 0;
    const before = text.slice(0, index).toLowerCase();
    const after = text.slice(index + match[0].length).toLowerCase();

    // Both sides must name something ratable. "Training content and
    // instructor" is two objects; "terms and conditions" reads as one, and
    // this rule leaves it alone rather than flagging every conjunction in the
    // questionnaire and training the researcher to ignore the warning.
    const beforeEvaluative = EVALUATIVE_STEMS.some((stem) => before.includes(stem));
    const afterHasNoun = /\b[a-z]{4,}\b/.test(after);
    if (beforeEvaluative && afterHasNoun) hits.push(match[0]);
  }
  return hits;
}

export function detectLeadingLanguage(text: string): string[] {
  return LEADING_PHRASES.map((p) => text.match(p)?.[0]).filter((m): m is string => Boolean(m));
}

export function countNegations(text: string): number {
  return [...text.matchAll(NEGATIONS)].length;
}

export function detectAmbiguousReferences(text: string): string[] {
  // A pronoun with a plausible antecedent in the same item is fine. The cheap
  // structural proxy: an item that names at least two concrete nouns before the
  // pronoun probably has one.
  return AMBIGUOUS_REFS.map((p) => text.match(p)?.[0]).filter((m): m is string => Boolean(m));
}

export interface ItemQualityContext {
  scalesById: Map<string, ResearchScaleRow>;
  constructNamesById: Map<string, string>;
  indicatorNamesById: Map<string, string>;
}

/**
 * Checks one item in isolation. Cross-item checks (redundancy, scale
 * consistency within a construct) need the set and live in `reviewQuestionnaire`.
 */
export function reviewItem(
  item: QuestionnaireQuestionRow,
  context: ItemQualityContext,
): MethodologyFinding[] {
  const findings: MethodologyFinding[] = [];
  const text = item.question_text;

  // --- structural facts about the stored model -------------------------
  if (!item.construct_id && !item.indicator_id) {
    const namedInText = Boolean(item.construct?.trim() || item.variable_label?.trim());
    findings.push(
      finding({
        id: `item-unmapped-${item.id}`,
        category: "measurement_mapping",
        severity: namedInText ? "warning" : "error",
        title: namedInText ? "Item names a construct but is not linked to one" : "Item measures nothing yet",
        explanation: namedInText
          ? `This item records “${item.construct ?? item.variable_label}” as text, from before constructs were modelled. Linking it makes it count towards that construct's coverage.`
          : "This item is not linked to a construct or an indicator, so it does not contribute to any measurement coverage.",
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Link the item to the construct or indicator it measures.",
      }),
    );
  }

  if (SCALED_TYPES.has(item.response_type) && !item.scale_id) {
    findings.push(
      finding({
        id: `item-no-scale-${item.id}`,
        category: "response_scale",
        severity: "error",
        title: "Likert item has no response scale",
        explanation:
          "A Likert item without a defined scale has no ordered response set, so its answers cannot be scored or compared with the other items measuring the same construct.",
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Attach a response scale, or change the response type.",
      }),
    );
  }

  if (item.reverse_coded && item.scale_id && context.scalesById.get(item.scale_id)?.polarity === "unordered") {
    findings.push(
      finding({
        id: `item-reverse-unordered-${item.id}`,
        category: "response_scale",
        severity: "warning",
        title: "Reverse-coded item on an unordered scale",
        explanation:
          "Reverse coding flips a score along an order. This item's scale has no direction, so there is nothing to flip.",
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Give the scale a direction, or clear the reverse-coded flag.",
      }),
    );
  }

  // --- linguistic heuristics -------------------------------------------
  const barrels = detectDoubleBarrelled(text);
  if (barrels.length > 0) {
    findings.push(
      finding({
        id: `item-double-barrelled-${item.id}`,
        category: "item_wording",
        severity: "warning",
        title: "Possible double-barrelled item",
        explanation: `This item may ask about two things at once (joined by “${barrels[0]}”). A respondent who feels differently about each has no honest answer. This is a wording heuristic, not a proven defect.`,
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "If the two parts can be rated separately, split them into two items.",
      }),
    );
  }

  const leading = detectLeadingLanguage(text);
  if (leading.length > 0) {
    findings.push(
      finding({
        id: `item-leading-${item.id}`,
        category: "item_wording",
        severity: "warning",
        title: "Possible leading wording",
        explanation: `“${leading[0]}” signals an expected answer. Whether it actually shifts responses is a question for a pilot, not for this check.`,
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Rephrase neutrally so the item does not indicate a preferred answer.",
      }),
    );
  }

  if (countNegations(text) >= 2) {
    findings.push(
      finding({
        id: `item-negation-${item.id}`,
        category: "item_wording",
        severity: "warning",
        title: "Multiple negations in one item",
        explanation:
          "Two or more negatives make an item hard to read, and disagreement with a negative statement is ambiguous. This counts negation words; it does not measure comprehension.",
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Rewrite positively and use the reverse-coded flag if the reversal is intentional.",
      }),
    );
  }

  const refs = detectAmbiguousReferences(text);
  // Short items carry no antecedent, so a pronoun in one is far more likely to
  // be genuinely unclear than the same pronoun in a long, self-contained item.
  if (refs.length > 0 && contentWords(text).length <= 12) {
    findings.push(
      finding({
        id: `item-ambiguous-ref-${item.id}`,
        category: "item_wording",
        severity: "info",
        title: "Possibly unclear reference",
        explanation: `“${refs[0]}” may not have a clear referent inside this item. Respondents read items one at a time, so a reference that depends on the previous item can be read differently by different people.`,
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Name the thing the item refers to explicitly.",
      }),
    );
  }

  // --- provenance ------------------------------------------------------
  if (item.item_provenance === "ai_suggested") {
    findings.push(
      finding({
        id: `item-unconfirmed-${item.id}`,
        category: "provenance",
        severity: "info",
        title: "AI-suggested item not yet confirmed",
        explanation:
          "This item was proposed by the assistant and has not been marked as the researcher's own. It stays labelled as a suggestion until it is.",
        evidence: itemLabel(item),
        targetType: "questionnaire_item",
        targetId: item.id,
        remediation: "Review the wording and confirm it, or edit it first.",
      }),
    );
  }

  return findings;
}

/**
 * Cross-item checks. These are the ones that cannot be done item by item:
 * redundancy is a property of a pair, and scale consistency is a property of a
 * construct's whole item set.
 */
export function reviewQuestionnaire(
  items: QuestionnaireQuestionRow[],
  context: ItemQualityContext,
): MethodologyFinding[] {
  const findings: MethodologyFinding[] = items.flatMap((item) => reviewItem(item, context));

  // --- redundancy, within a construct ----------------------------------
  // Only within a construct: two similarly worded items measuring different
  // constructs are usually parallel wording on purpose ("I am satisfied with
  // my supervisor" / "...with my workload"), and flagging those would be noise.
  const byConstruct = new Map<string, QuestionnaireQuestionRow[]>();
  for (const item of items) {
    if (!item.construct_id) continue;
    const list = byConstruct.get(item.construct_id) ?? [];
    list.push(item);
    byConstruct.set(item.construct_id, list);
  }

  for (const [constructId, group] of byConstruct) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const similarity = itemSimilarity(group[i].question_text, group[j].question_text);
        if (similarity < REDUNDANCY_THRESHOLD) continue;

        findings.push(
          finding({
            id: `item-redundant-${group[i].id}-${group[j].id}`,
            category: "redundancy",
            severity: "info",
            title: "Two items may be asking the same thing",
            explanation: `These two items measuring “${context.constructNamesById.get(constructId) ?? "this construct"}” share ${Math.round(similarity * 100)}% of their content words. Overlapping wording is sometimes deliberate — parallel items are how internal consistency is estimated — so this is a prompt to check, not a defect.`,
            evidence: `“${itemLabel(group[i])}” / “${itemLabel(group[j])}”`,
            targetType: "questionnaire_item",
            targetId: group[i].id,
            remediation: "Keep both if the repetition is intentional; otherwise merge or reword one.",
          }),
        );
      }
    }

    // --- scale consistency within a construct --------------------------
    const scaleIds = new Set(group.map((item) => item.scale_id).filter((id): id is string => Boolean(id)));
    if (scaleIds.size > 1) {
      const names = [...scaleIds].map((id) => context.scalesById.get(id)?.name ?? "unnamed scale");
      findings.push(
        finding({
          id: `construct-mixed-scales-${constructId}`,
          category: "response_scale",
          severity: "warning",
          title: "One construct measured on more than one scale",
          explanation: `Items for “${context.constructNamesById.get(constructId) ?? "this construct"}” use ${scaleIds.size} different scales (${names.join(", ")}). Scores from different response sets are not directly comparable, so a construct mean across them is not meaningful.`,
          targetType: "construct",
          targetId: constructId,
          remediation: "Use one scale across the construct, or score its sub-sets separately.",
        }),
      );
    }

    // Opposed polarities are worse than merely different scales: the numbers
    // combine silently and the mean comes out wrong rather than unavailable.
    const polarities = new Set(
      [...scaleIds].map((id) => context.scalesById.get(id)?.polarity).filter(Boolean),
    );
    if (polarities.has("ascending") && polarities.has("descending")) {
      findings.push(
        finding({
          id: `construct-opposed-scales-${constructId}`,
          category: "response_scale",
          severity: "error",
          title: "Scales for one construct run in opposite directions",
          explanation: `Items for “${context.constructNamesById.get(constructId) ?? "this construct"}” sit on both an ascending and a descending scale. Combining them without recoding produces a score in which agreement and disagreement cancel each other out.`,
          targetType: "construct",
          targetId: constructId,
          remediation: "Align the scales, or mark the reversed items as reverse-coded and recode before scoring.",
        }),
      );
    }
  }

  return findings;
}
