import { describe, expect, it } from "vitest";
import { renderDocx } from "../to-docx";
import type { DocumentModel } from "../document-model";

describe("renderDocx", () => {
  it("produces a real .docx (zip) file — magic bytes, non-trivial size", async () => {
    const model: DocumentModel = {
      title: "Test",
      project: {} as never,
      blocks: [
        { type: "heading", level: 1, text: "Chapter 1" },
        { type: "paragraph", text: "Line one.\nLine two." },
        { type: "table", headers: ["A", "B"], rows: [["1", "2"]] },
        { type: "pagebreak" },
      ],
    };
    const buffer = await renderDocx(model);
    expect(buffer.length).toBeGreaterThan(1000);
    // .docx files are zip archives — "PK" magic bytes.
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("does not throw on an otherwise-empty document", async () => {
    const model: DocumentModel = { title: "Empty", project: {} as never, blocks: [] };
    const buffer = await renderDocx(model);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
