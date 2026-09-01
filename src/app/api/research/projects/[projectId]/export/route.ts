import { NextResponse } from "next/server";
import { compileDocumentModel } from "@/lib/export/document-model";
import { renderDocx } from "@/lib/export/to-docx";
import { renderMarkdown } from "@/lib/export/to-markdown";
import { renderPdf } from "@/lib/export/to-pdf";
import { createClient, requireUserId } from "@/lib/supabase/server";

const CONTENT_TYPE = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
} as const;

type Format = keyof typeof CONTENT_TYPE;

function isFormat(value: string | null): value is Format {
  return value === "docx" || value === "pdf" || value === "md";
}

function safeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "research-project";
}

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const format = new URL(req.url).searchParams.get("format");
  if (!isFormat(format)) {
    return NextResponse.json({ error: "format must be one of: docx, pdf, md" }, { status: 400 });
  }

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  let model;
  try {
    model = await compileDocumentModel(supabase, projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: Buffer | string;
  if (format === "docx") body = await renderDocx(model);
  else if (format === "pdf") body = await renderPdf(model);
  else body = renderMarkdown(model);

  const filename = `${safeFilename(model.title)}.${format}`;
  return new NextResponse(body as never, {
    headers: {
      "Content-Type": CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
