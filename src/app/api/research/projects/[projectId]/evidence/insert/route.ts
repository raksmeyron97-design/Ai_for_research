import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject } from "@/lib/api/authorize";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { EvidenceInsertionError, insertEvidence } from "@/lib/evidence/insertion";

const bodySchema = z.object({
  sectionType: sectionTypeSchema,
  claimId: z.string().uuid(),
  citationId: z.string().uuid(),
  mode: z.enum(["citation_only", "evidence_citation", "replace_claim"]),

  excerpt: z.string().trim().max(10_000).optional(),
  page: z.number().int().min(1).nullable().optional(),
  sectionLabel: z.string().max(200).nullable().optional(),
  chunkId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid().nullable().optional(),
  relevanceNote: z.string().max(2000).nullable().optional(),

  /**
   * The researcher's judgement from the preview step. Required, with no
   * default: defaulting it to SUPPORTED would make "I attached a source" and
   * "I checked the source says this" the same action (§15).
   */
  support: z.enum(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NEEDS_REVIEW"]),
  note: z.string().max(2000).nullable().optional(),

  replacementText: z.string().trim().max(20_000).optional(),
  evidenceId: z.string().uuid().optional(),
});

/** Claim → Evidence → Citation → Relation → Section, persisted (§16-§19). */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const result = await insertEvidence(auth.auth.supabase, {
      projectId,
      section: parsed.data.sectionType,
      claimId: parsed.data.claimId,
      citationId: parsed.data.citationId,
      mode: parsed.data.mode,
      excerpt: parsed.data.excerpt,
      page: parsed.data.page,
      sectionLabel: parsed.data.sectionLabel,
      chunkId: parsed.data.chunkId,
      documentId: parsed.data.documentId,
      relevanceNote: parsed.data.relevanceNote,
      support: parsed.data.support,
      note: parsed.data.note,
      replacementText: parsed.data.replacementText,
      evidenceId: parsed.data.evidenceId,
      userId: auth.auth.userId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof EvidenceInsertionError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    return NextResponse.json(
      { error: "The evidence could not be linked. Nothing was changed — you can retry." },
      { status: 500 },
    );
  }
}
