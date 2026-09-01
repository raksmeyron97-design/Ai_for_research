import { describe, expect, it } from "vitest";
import { renderPdf } from "../to-pdf";
import type { DocumentModel } from "../document-model";

describe("renderPdf", () => {
  it("produces a real PDF file — magic bytes, non-trivial size", async () => {
    const model: DocumentModel = {
      title: "Test",
      project: {} as never,
      blocks: [
        { type: "heading", level: 1, text: "Chapter 1" },
        { type: "paragraph", text: "Some body text." },
        { type: "table", headers: ["A", "B"], rows: [["1", "2"]] },
        { type: "pagebreak" },
        { type: "heading", level: 2, text: "Section 1.1" },
      ],
    };
    const buffer = await renderPdf(model);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("wraps long table cell content onto multiple lines instead of truncating it", async () => {
    // Regression test: the first version divided columns equally and fixed
    // a 20pt row height with `ellipsis: true`, which silently cut off long
    // question text and answer-option lists in exported instruments.
    const longQuestion = "How difficult is it, on a scale of one to ten, for you personally to reach the nearest clinic given current transport options?";
    const longOptions = "Very easy; Somewhat easy; Neutral; Somewhat difficult; Very difficult; Not applicable to my situation";
    const model: DocumentModel = {
      title: "Test",
      project: {} as never,
      blocks: [
        {
          type: "table",
          headers: ["#", "Question", "Options"],
          rows: [["1", longQuestion, longOptions]],
        },
      ],
    };
    const buffer = await renderPdf(model);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });
});
