import type { DocumentModel } from "./document-model";

export function renderMarkdown(model: DocumentModel): string {
  const lines: string[] = [];

  for (const block of model.blocks) {
    switch (block.type) {
      case "heading":
        lines.push(`${"#".repeat(block.level)} ${block.text}`, "");
        break;
      case "paragraph":
        lines.push(block.text, "");
        break;
      case "table":
        lines.push(`| ${block.headers.join(" | ")} |`);
        lines.push(`| ${block.headers.map(() => "---").join(" | ")} |`);
        for (const row of block.rows) {
          lines.push(`| ${row.map((cell) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
        }
        lines.push("");
        break;
      case "pagebreak":
        lines.push("---", "");
        break;
    }
  }

  return lines.join("\n").trim() + "\n";
}
