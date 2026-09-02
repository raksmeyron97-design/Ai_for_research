import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { searchCitations } from "@/lib/db/citations";

/**
 * Server-side source search (§17-§19).
 *
 * GET with query parameters rather than POST with a body: a search is a read,
 * and a URL a researcher can bookmark or a browser can cache is worth more
 * than the tidier body. Every parameter is optional; none of them means "no
 * opinion", which is different from an explicit `false`.
 *
 * `limit` is capped in two places — here and in the SQL function — because
 * the cap is what stops a caller asking for the whole library through the
 * paginated endpoint, and that is worth stating twice.
 */
const boolParam = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const csvParam = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .refine((list) => list.length > 0 && list.length <= 20, {
    message: "Between 1 and 20 values",
  })
  .optional();

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  yearFrom: z.coerce.number().int().min(1500).max(2200).optional(),
  yearTo: z.coerce.number().int().min(1500).max(2200).optional(),
  sourceTypes: csvParam,
  statuses: csvParam,
  hasDoi: boolParam,
  hasEvidence: boolParam,
  isCited: boolParam,
  themeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const input = parsed.data;
  // A reversed range returns nothing rather than erroring: it is a slider
  // dragged past itself, not a malformed request, and an empty result with
  // the filters still shown is the readable answer.
  try {
    const result = await searchCitations(auth.auth.supabase, projectId, {
      query: input.q ?? null,
      yearFrom: input.yearFrom ?? null,
      yearTo: input.yearTo ?? null,
      sourceTypes: input.sourceTypes ?? null,
      statuses: input.statuses ?? null,
      hasDoi: input.hasDoi ?? null,
      hasEvidence: input.hasEvidence ?? null,
      isCited: input.isCited ?? null,
      themeId: input.themeId ?? null,
      limit: input.limit,
      offset: input.offset,
    });

    return NextResponse.json({
      sources: result.rows,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      // So the empty state can say "no sources match these filters" rather
      // than "no sources", which would imply an empty library (§19).
      filtered:
        input.q !== undefined ||
        input.yearFrom !== undefined ||
        input.yearTo !== undefined ||
        input.sourceTypes !== undefined ||
        input.statuses !== undefined ||
        input.hasDoi !== undefined ||
        input.hasEvidence !== undefined ||
        input.isCited !== undefined ||
        input.themeId !== undefined,
    });
  } catch {
    return dbErrorResponse("Searching sources");
  }
}
