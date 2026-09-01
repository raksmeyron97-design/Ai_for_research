import PDFDocument from "pdfkit";
import type { DocBlock, DocumentModel } from "./document-model";

const HEADING_SIZE = { 1: 20, 2: 15, 3: 12 } as const;
const MARGIN = 50;

const CELL_PAD = 4;
const MIN_COL_WIDTH_FRACTION = 0.08;

/**
 * Column widths are proportional to each column's typical content length
 * (headers + all rows), not divided equally — an equal split truncated
 * long free-text columns (question text, answer options) in a fixed-height
 * cell, silently dropping real instrument content from the export.
 */
function computeColumnWidths(usableWidth: number, headers: string[], rows: string[][]): number[] {
  const avgLengths = headers.map((h, i) => {
    const lengths = [h.length, ...rows.map((r) => (r[i] ?? "").length)];
    return lengths.reduce((a, b) => a + b, 0) / lengths.length;
  });
  const total = avgLengths.reduce((a, b) => a + b, 0) || 1;
  const minWidth = usableWidth * MIN_COL_WIDTH_FRACTION;
  const raw = avgLengths.map((len) => Math.max(minWidth, (len / total) * usableWidth));
  const scale = usableWidth / raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w * scale);
}

function renderTable(doc: PDFKit.PDFDocument, block: Extract<DocBlock, { type: "table" }>) {
  const usableWidth = doc.page.width - MARGIN * 2;
  const colWidths = computeColumnWidths(usableWidth, block.headers, block.rows);
  const colX = colWidths.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? MARGIN) + (i === 0 ? 0 : colWidths[i - 1])], [MARGIN]);

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    const rowHeight = Math.max(
      16,
      ...cells.map((cell, i) => doc.heightOfString(cell, { width: colWidths[i] - CELL_PAD }) + CELL_PAD),
    );
    if (doc.y + rowHeight > doc.page.height - MARGIN) doc.addPage();
    const y = doc.y;
    cells.forEach((cell, i) => {
      doc.text(cell, colX[i], y, { width: colWidths[i] - CELL_PAD });
    });
    doc.y = y + rowHeight;
  };

  drawRow(block.headers, true);
  for (const row of block.rows) drawRow(row, false);
  doc.moveDown();
}

export async function renderPdf(model: DocumentModel): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica").fontSize(11);

  for (const block of model.blocks) {
    switch (block.type) {
      case "heading":
        doc
          .moveDown(0.5)
          .font("Helvetica-Bold")
          .fontSize(HEADING_SIZE[block.level])
          .text(block.text)
          .moveDown(0.3);
        doc.font("Helvetica").fontSize(11);
        break;
      case "paragraph":
        doc.text(block.text, { align: "left" }).moveDown(0.5);
        break;
      case "table":
        renderTable(doc, block);
        break;
      case "pagebreak":
        doc.addPage();
        break;
    }
  }

  doc.end();
  return done;
}
