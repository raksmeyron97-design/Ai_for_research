import {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { DocBlock, DocumentModel } from "./document-model";

const HEADING_LEVEL = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

function paragraphWithLineBreaks(text: string): Paragraph {
  const lines = text.split("\n");
  const children = lines.flatMap((line, i) =>
    i === 0 ? [new TextRun(line)] : [new TextRun({ text: line, break: 1 })],
  );
  return new Paragraph({ children });
}

function renderTable(block: Extract<DocBlock, { type: "table" }>): Table {
  const headerRow = new TableRow({
    children: block.headers.map(
      (h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] }),
    ),
  });
  const dataRows = block.rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })),
      }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
}

export async function renderDocx(model: DocumentModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  for (const block of model.blocks) {
    switch (block.type) {
      case "heading":
        children.push(new Paragraph({ text: block.text, heading: HEADING_LEVEL[block.level] }));
        break;
      case "paragraph":
        children.push(paragraphWithLineBreaks(block.text));
        break;
      case "table":
        children.push(renderTable(block));
        children.push(new Paragraph({ text: "" }));
        break;
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
