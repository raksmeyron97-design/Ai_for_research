import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import ExcelJS from "exceljs";

export class ExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
  }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Dispatches to the right extractor by MIME type (falling back to file
 * extension for uploads with a generic/missing content-type). Returns
 * plain text — cleaning/normalization happens in chunk.ts, not here.
 */
export async function extractText(buffer: Buffer, mimeType: string | null, fileName: string): Promise<string> {
  const type = resolveType(mimeType, fileName);

  switch (type) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "xlsx":
      return extractXlsx(buffer);
    case "text":
      return buffer.toString("utf-8");
    default:
      throw new ExtractionError(`Unsupported file type for text extraction: ${mimeType ?? fileName}`);
  }
}

type FileKind = "pdf" | "docx" | "xlsx" | "text" | "unsupported";

function resolveType(mimeType: string | null, fileName: string): FileKind {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === DOCX_MIME) return "docx";
  if (mimeType === XLSX_MIME) return "xlsx";
  if (mimeType?.startsWith("text/")) return "text";

  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "pdf";
    case "docx": return "docx";
    case "xlsx": return "xlsx";
    case "txt": case "csv": case "md": return "text";
    default: return "unsupported";
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } catch (err) {
    throw new ExtractionError(`PDF extraction failed: ${(err as Error).message}`, err);
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err) {
    throw new ExtractionError(`DOCX extraction failed: ${(err as Error).message}`, err);
  }
}

/** Each sheet becomes a labeled section so downstream chunking/citations can reference "Sheet: X". */
async function extractXlsx(buffer: Buffer): Promise<string> {
  try {
    const workbook = new ExcelJS.Workbook();
    // exceljs's index.d.ts declares its own ambient global
    // `interface Buffer extends ArrayBuffer {}`, which merges with (and
    // corrupts) the real Node Buffer type project-wide against current
    // @types/node — a known upstream typing defect, not fixable by casting
    // to "Buffer" since that name now resolves to the same broken merged
    // type everywhere. `any` is the documented workaround; the runtime
    // value is a real Node Buffer regardless of what TS thinks here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);

    const sections: string[] = [];
    workbook.eachSheet((sheet) => {
      const rows: string[] = [];
      sheet.eachRow((row) => {
        // row.values is normally an array (index 0 unused, ExcelJS is 1-indexed);
        // it can be a keyed object for template-defined rows, which we skip
        // rather than crash on for an untrusted, arbitrary uploaded file.
        if (!Array.isArray(row.values)) return;
        const cells = row.values.slice(1).map((v) => (v == null ? "" : String(v)));
        rows.push(cells.join(", "));
      });
      sections.push(`## Sheet: ${sheet.name}\n${rows.join("\n")}`);
    });

    return sections.join("\n\n");
  } catch (err) {
    throw new ExtractionError(`XLSX extraction failed: ${(err as Error).message}`, err);
  }
}
