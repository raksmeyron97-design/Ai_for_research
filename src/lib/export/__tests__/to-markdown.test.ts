import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../to-markdown";
import type { DocumentModel } from "../document-model";

function model(blocks: DocumentModel["blocks"]): DocumentModel {
  return { title: "Test", project: {} as never, blocks };
}

describe("renderMarkdown", () => {
  it("renders headings at the right level", () => {
    const md = renderMarkdown(model([{ type: "heading", level: 1, text: "Chapter 1" }]));
    expect(md).toContain("# Chapter 1");
  });

  it("renders a level-2 heading with two hashes", () => {
    const md = renderMarkdown(model([{ type: "heading", level: 2, text: "Objectives" }]));
    expect(md).toContain("## Objectives");
  });

  it("renders a paragraph as plain text", () => {
    const md = renderMarkdown(model([{ type: "paragraph", text: "Some prose." }]));
    expect(md).toContain("Some prose.");
  });

  it("renders a table with a header separator row and escapes pipes in cells", () => {
    const md = renderMarkdown(
      model([{ type: "table", headers: ["A", "B"], rows: [["1", "a|b"]] }]),
    );
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | a\\|b |");
  });

  it("renders a page break as a horizontal rule", () => {
    const md = renderMarkdown(model([{ type: "pagebreak" }]));
    expect(md).toContain("---");
  });
});
