import { describe, expect, it, vi } from "vitest";

const mammothMock = vi.hoisted(() => ({
  extractRawText: vi.fn(async () => ({ value: "docx text", messages: [] })),
}));
vi.mock("mammoth", () => ({ default: mammothMock }));

const pdfParseMock = vi.hoisted(() => ({
  getText: vi.fn(async () => ({ text: "pdf text" })),
  destroy: vi.fn(async () => {}),
}));
vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn(function PDFParse() {
    return pdfParseMock;
  }),
}));

const exceljsMock = vi.hoisted(() => {
  const load = vi.fn(async () => {});
  const eachSheet = vi.fn((cb: (sheet: unknown) => void) => {
    cb({
      name: "Sheet1",
      eachRow: (rowCb: (row: { values: unknown[] }) => void) => {
        rowCb({ values: [undefined, "a", "b"] });
      },
    });
  });
  return {
    Workbook: vi.fn(function Workbook() {
      return { xlsx: { load }, eachSheet };
    }),
    load,
  };
});
vi.mock("exceljs", () => ({ default: { Workbook: exceljsMock.Workbook } }));

const { extractText, ExtractionError } = await import("../extract");

describe("extractText", () => {
  it("extracts text from a PDF by mime type", async () => {
    const result = await extractText(Buffer.from("x"), "application/pdf", "doc.pdf");
    expect(result).toBe("pdf text");
  });

  it("extracts text from a PDF by file extension when mime type is missing", async () => {
    const result = await extractText(Buffer.from("x"), null, "doc.PDF");
    expect(result).toBe("pdf text");
  });

  it("extracts text from a DOCX", async () => {
    const result = await extractText(
      Buffer.from("x"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "doc.docx",
    );
    expect(result).toBe("docx text");
  });

  it("extracts text from an XLSX, labeling each sheet", async () => {
    const result = await extractText(
      Buffer.from("x"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "data.xlsx",
    );
    expect(result).toContain("Sheet: Sheet1");
    expect(result).toContain("a, b");
  });

  it("passes plain text/csv through unmodified as utf-8", async () => {
    const result = await extractText(Buffer.from("hello,world"), "text/csv", "data.csv");
    expect(result).toBe("hello,world");
  });

  it("falls back to file extension for text files with a generic mime type", async () => {
    const result = await extractText(Buffer.from("plain content"), "application/octet-stream", "notes.txt");
    expect(result).toBe("plain content");
  });

  it("throws ExtractionError for an unsupported type", async () => {
    await expect(
      extractText(Buffer.from("x"), "application/x-unknown", "file.xyz"),
    ).rejects.toThrow(ExtractionError);
  });

  it("wraps a PDF library failure in ExtractionError", async () => {
    pdfParseMock.getText.mockRejectedValueOnce(new Error("corrupt PDF"));
    await expect(extractText(Buffer.from("x"), "application/pdf", "bad.pdf")).rejects.toThrow(ExtractionError);
  });
});
