import { describe, expect, it } from "vitest";
import { classifyQuestion, expectsHypothesis } from "../question-classification";

describe("classifyQuestion", () => {
  it("reads an effect question as causal", () => {
    const result = classifyQuestion("What is the effect of peer tutoring on exam performance?");
    expect(result.kind).toBe("causal");
    expect(result.matched[0]).toMatch(/effect of/i);
  });

  it("reads a between-groups question as comparative", () => {
    expect(classifyQuestion("Is there a difference in motivation between urban and rural teachers?").kind)
      .toBe("comparative");
  });

  it("reads a relationship question as correlational", () => {
    expect(classifyQuestion("What is the relationship between workload and burnout?").kind)
      .toBe("correlational");
  });

  it("reads a level question as descriptive", () => {
    expect(classifyQuestion("What is the level of digital literacy among first-year students?").kind)
      .toBe("descriptive");
  });

  it("reads an open question as exploratory", () => {
    expect(classifyQuestion("How do nurses describe their experience of night shifts?").kind)
      .toBe("exploratory");
  });

  // The stronger claim has to win: classifying this as merely correlational
  // would suppress the checks a causal claim needs.
  it("prefers causal when a question is phrased both ways", () => {
    expect(classifyQuestion("What is the effect of the relationship between X and Y on Z?").kind)
      .toBe("causal");
  });

  it("returns unclassified rather than guessing", () => {
    const result = classifyQuestion("Teacher motivation in Cambodian secondary schools.");
    expect(result.kind).toBe("unclassified");
    expect(result.matched).toEqual([]);
  });

  // §6: the classifier must never imply the question is defective.
  it("frames an unclassified result as a limit of the check, not a criticism", () => {
    const result = classifyQuestion("Something entirely unpatterned.");
    expect(result.reason).toMatch(/limit of this check/i);
    expect(result.reason).not.toMatch(/invalid|poor|bad/i);
  });

  it("treats an empty question as unclassified", () => {
    expect(classifyQuestion("   ").kind).toBe("unclassified");
  });
});

describe("expectsHypothesis", () => {
  it("expects one for causal, comparative and correlational shapes", () => {
    expect(expectsHypothesis("causal")).toBe(true);
    expect(expectsHypothesis("comparative")).toBe(true);
    expect(expectsHypothesis("correlational")).toBe(true);
  });

  // A descriptive study with no hypothesis is complete, not incomplete.
  it("does not expect one for descriptive or exploratory shapes", () => {
    expect(expectsHypothesis("descriptive")).toBe(false);
    expect(expectsHypothesis("exploratory")).toBe(false);
    expect(expectsHypothesis("unclassified")).toBe(false);
  });
});
