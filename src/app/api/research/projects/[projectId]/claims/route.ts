import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { createClaims, listClaims } from "@/lib/db/evidence";
import { sectionTypeSchema } from "@/lib/db/project-schema";

const CLAIM_TYPES = [
  "factual", "statistical", "clinical", "comparative",
  "interpretive", "user_provided", "inference",
] as const;

const createSchema = z.object({
  sectionType: sectionTypeSchema,
  claims: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        type: z.enum(CLAIM_TYPES).optional(),
        offsetStart: z.number().int().min(0).nullable().optional(),
        offsetEnd: z.number().int().min(0).nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * Claims for a section, or for the project when no section is named.
 *
 * Filtered server-side rather than fetched whole and filtered in the browser:
 * a section review needs one section's claims and §5 is explicit that it must
 * not pull the project to get them.
 */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const raw = new URL(req.url).searchParams.get("sectionType");
  const section = raw ? sectionTypeSchema.safeParse(raw) : null;
  if (raw && !section?.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });

  try {
    const claims = await listClaims(auth.auth.supabase, projectId, section?.success ? section.data : undefined);
    return NextResponse.json({ claims });
  } catch {
    return dbErrorResponse("Loading claims");
  }
}

/**
 * Saves the claims a researcher confirmed after extraction (§11).
 *
 * `needs_evidence` and `evidence_status` are not accepted from the client at
 * all — `createClaims` derives both from the type. A client able to send them
 * could mark a claim SUPPORTED before anything supports it, which is the one
 * thing the evidence model exists to prevent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const claims = await createClaims(
      auth.auth.supabase,
      parsed.data.claims.map((c) => ({
        project_id: projectId,
        section_type: parsed.data.sectionType,
        claim_text: c.text,
        claim_type: c.type ?? "factual",
        source_offset_start: c.offsetStart ?? null,
        source_offset_end: c.offsetEnd ?? null,
      })),
    );
    return NextResponse.json({ claims }, { status: 201 });
  } catch {
    return dbErrorResponse("Saving those claims");
  }
}
