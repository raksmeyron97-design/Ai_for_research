import { describe, expect, it } from "vitest";
import { diffWords } from "@/lib/text/diff-words";

/**
 * Phase 16 §17. The diff is what a researcher looks at before accepting a
 * replacement, so it has to be right about what would be lost — that is the
 * whole reason Replace is allowed to exist.
 */
describe("word diff", () => {
  it("marks unchanged text as unchanged", () => {
    const parts = diffWords("the same text", "the same text");
    expect(parts.every((p) => p.type === "same")).toBe(true);
  });

  it("shows an added word as added and nothing as removed", () => {
    const parts = diffWords("a study", "a cross-sectional study");
    expect(parts.filter((p) => p.type === "added").map((p) => p.text.trim())).toContain("cross-sectional");
    expect(parts.filter((p) => p.type === "removed")).toHaveLength(0);
  });

  it("shows a removed word as removed", () => {
    const parts = diffWords("a cross-sectional study", "a study");
    expect(parts.filter((p) => p.type === "removed").map((p) => p.text.trim())).toContain("cross-sectional");
  });

  it("shows a replacement as a removal plus an addition", () => {
    const parts = diffWords("prevalence was 21.4%", "prevalence was 63.4%");
    const removed = parts.filter((p) => p.type === "removed").map((p) => p.text.trim());
    const added = parts.filter((p) => p.type === "added").map((p) => p.text.trim());
    // The exact case a researcher must be able to see before accepting.
    expect(removed).toContain("21.4%");
    expect(added).toContain("63.4%");
  });

  it("reconstructs the original from same + removed", () => {
    const before = "The cross-sectional design cannot establish causation.";
    const after = "This descriptive design does not establish causation.";
    const rebuilt = diffWords(before, after)
      .filter((p) => p.type !== "added")
      .map((p) => p.text)
      .join("");
    expect(rebuilt).toBe(before);
  });

  it("reconstructs the replacement from same + added", () => {
    const before = "The cross-sectional design cannot establish causation.";
    const after = "This descriptive design does not establish causation.";
    const rebuilt = diffWords(before, after)
      .filter((p) => p.type !== "removed")
      .map((p) => p.text)
      .join("");
    expect(rebuilt).toBe(after);
  });

  it("treats an empty original as pure addition", () => {
    const parts = diffWords("", "brand new content");
    expect(parts.every((p) => p.type === "added")).toBe(true);
  });

  it("treats emptying a section as pure removal — the most destructive case", () => {
    const parts = diffWords("existing work", "");
    expect(parts.every((p) => p.type === "removed")).toBe(true);
  });

  it("falls back to a whole-block diff on very large inputs instead of hanging", () => {
    // The LCS table is quadratic; a thesis-length section would freeze the
    // browser. Degrading to "all of this becomes all of that" is honest and
    // instant.
    const big = "word ".repeat(1200);
    const parts = diffWords(big, `${big}extra`);
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe("removed");
    expect(parts[1].type).toBe("added");
  });

  it("handles Khmer text, which has no inter-word spaces", () => {
    const before = "ការសិក្សានេះ";
    const after = "ការសិក្សានេះ បន្ថែម";
    const parts = diffWords(before, after);
    expect(parts.filter((p) => p.type === "added").map((p) => p.text.trim()).join("")).toContain("បន្ថែម");
  });
});
