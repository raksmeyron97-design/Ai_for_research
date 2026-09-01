import { describe, expect, it } from "vitest";
import {
  countNegations,
  detectAmbiguousReferences,
  detectDoubleBarrelled,
  detectLeadingLanguage,
  itemSimilarity,
  reviewItem,
  reviewQuestionnaire,
  type ItemQualityContext,
} from "../questionnaire-quality";
import { item, scale } from "./fixtures";

const context: ItemQualityContext = {
  scalesById: new Map([["sc-1", scale({ id: "sc-1" })]]),
  constructNamesById: new Map([["con-1", "Teacher motivation"]]),
  indicatorNamesById: new Map([["ind-1", "Job satisfaction"]]),
};

/** Finding ids carry the target id as a suffix; tests care about the rule. */
function hasRule(findings: { id: string }[], rule: string): boolean {
  return findings.some((f) => f.id.startsWith(`${rule}-`));
}

describe("double-barrelled detection", () => {
  it("flags an item rating two different things at once", () => {
    expect(detectDoubleBarrelled("How satisfied are you with the training content and the instructor?"))
      .not.toHaveLength(0);
  });

  // A rule that fired on every "and" would train the researcher to ignore it.
  it("leaves a conjunction inside one idea alone", () => {
    expect(detectDoubleBarrelled("I read the terms and conditions before enrolling.")).toEqual([]);
  });
});

describe("leading language", () => {
  it("flags wording that signals an expected answer", () => {
    expect(detectLeadingLanguage("Don't you agree that the new system is better?")).not.toHaveLength(0);
  });

  it("leaves a neutral item alone", () => {
    expect(detectLeadingLanguage("The new system is easy to use.")).toEqual([]);
  });
});

describe("negation and ambiguity", () => {
  it("counts stacked negations", () => {
    expect(countNegations("I do not feel that I cannot complete my work.")).toBeGreaterThanOrEqual(2);
  });

  it("finds pronouns with no antecedent in the item", () => {
    expect(detectAmbiguousReferences("They explained it clearly.")).not.toHaveLength(0);
  });
});

describe("itemSimilarity", () => {
  it("is symmetric", () => {
    const a = "I feel motivated to prepare my lessons.";
    const b = "I feel motivated when preparing lessons.";
    expect(itemSimilarity(a, b)).toBeCloseTo(itemSimilarity(b, a), 10);
  });

  it("is near zero for unrelated items", () => {
    expect(itemSimilarity("I enjoy teaching mathematics.", "The canteen food is affordable."))
      .toBeLessThan(0.2);
  });
});

describe("reviewItem", () => {
  it("reports an unmapped item as an error", () => {
    const findings = reviewItem(item({ construct_id: null, indicator_id: null }), context);
    const unmapped = findings.find((f) => f.id.startsWith("item-unmapped"));
    expect(unmapped?.severity).toBe("error");
  });

  // An item carrying the Phase 6 free-text mapping has a mapping — it just
  // isn't linked. Calling that an error would tell a researcher their existing
  // work is broken.
  it("softens to a warning when the item names a construct in text", () => {
    const findings = reviewItem(
      item({ construct_id: null, indicator_id: null, construct: "Teacher motivation" }),
      context,
    );
    const unmapped = findings.find((f) => f.id.startsWith("item-unmapped"));
    expect(unmapped?.severity).toBe("warning");
    expect(unmapped?.explanation).toMatch(/before constructs were modelled/i);
  });

  it("reports a Likert item with no scale", () => {
    const findings = reviewItem(item({ scale_id: null }), context);
    expect(hasRule(findings, "item-no-scale")).toBe(true);
  });

  it("does not require a scale for an open-text item", () => {
    const findings = reviewItem(item({ scale_id: null, response_type: "open_text" }), context);
    expect(hasRule(findings, "item-no-scale")).toBe(false);
  });

  // §11: wording heuristics may flag, never conclude.
  it("words a wording heuristic as a possibility, not a defect", () => {
    const findings = reviewItem(
      item({ question_text: "How satisfied are you with the training content and the instructor?" }),
      context,
    );
    const barrel = findings.find((f) => f.id.startsWith("item-double-barrelled"));
    expect(barrel?.severity).toBe("warning");
    expect(barrel?.explanation).toMatch(/heuristic, not a proven defect/i);
  });

  it("marks an unconfirmed AI item as a suggestion", () => {
    const findings = reviewItem(item({ item_provenance: "ai_suggested" }), context);
    expect(hasRule(findings, "item-unconfirmed")).toBe(true);
  });

  it("returns nothing for a complete, plainly worded item", () => {
    expect(reviewItem(item(), context)).toEqual([]);
  });
});

describe("reviewQuestionnaire", () => {
  it("flags two near-identical items in the same construct", () => {
    const findings = reviewQuestionnaire(
      [
        item({ id: "q1", question_text: "I feel motivated to prepare my lessons carefully." }),
        item({ id: "q2", question_text: "I feel motivated to prepare my lessons well." }),
      ],
      context,
    );
    const redundant = findings.find((f) => f.id.startsWith("item-redundant"));
    expect(redundant).toBeDefined();
    // Parallel wording is how internal consistency is estimated, so this is a
    // prompt to look rather than a defect.
    expect(redundant?.severity).toBe("info");
  });

  it("does not compare items across different constructs", () => {
    const findings = reviewQuestionnaire(
      [
        item({ id: "q1", construct_id: "con-1", question_text: "I am satisfied with my supervisor." }),
        item({ id: "q2", construct_id: "con-2", question_text: "I am satisfied with my workload." }),
      ],
      context,
    );
    expect(findings.some((f) => f.id.startsWith("item-redundant"))).toBe(false);
  });

  it("flags one construct measured on two different scales", () => {
    const scales = new Map([
      ["sc-1", scale({ id: "sc-1", name: "Agreement 1-5" })],
      ["sc-2", scale({ id: "sc-2", name: "Frequency 1-4" })],
    ]);
    const findings = reviewQuestionnaire(
      [item({ id: "q1", scale_id: "sc-1" }), item({ id: "q2", scale_id: "sc-2" })],
      { ...context, scalesById: scales },
    );
    expect(hasRule(findings, "construct-mixed-scales")).toBe(true);
  });

  // Opposed polarities are worse than merely different: the numbers combine
  // silently and the mean comes out wrong rather than unavailable.
  it("escalates to an error when the scales run in opposite directions", () => {
    const scales = new Map([
      ["sc-1", scale({ id: "sc-1", polarity: "ascending" })],
      ["sc-2", scale({ id: "sc-2", name: "Reversed", polarity: "descending" })],
    ]);
    const findings = reviewQuestionnaire(
      [item({ id: "q1", scale_id: "sc-1" }), item({ id: "q2", scale_id: "sc-2" })],
      { ...context, scalesById: scales },
    );
    const opposed = findings.find((f) => f.id.startsWith("construct-opposed-scales"));
    expect(opposed?.severity).toBe("error");
  });
});
