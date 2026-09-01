import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProject } from "@/lib/db/projects";
import { checkRateLimit, RATE_LIMITS, rateLimitResponseBody } from "@/lib/security/rate-limit";
import { createClient, requireUserId } from "@/lib/supabase/server";
import type { ResearchProjectRow } from "@/lib/db/types";

/**
 * The authorisation preamble every project-scoped route runs (§34).
 *
 * It was copy-pasted into each route before Phase 17B added a dozen more.
 * Extracting it is not tidiness: the risk with a repeated preamble is that one
 * copy drifts — a route that forgets the project check accepts any id from any
 * user, and RLS then has to be the only thing standing between projects. That
 * is the hole Phase 17 already found once, in the database.
 *
 * The project lookup is the check. `getProject` runs under the caller's RLS
 * context, so a project that is not theirs comes back null and the answer is
 * 404 — identical to a project that does not exist, so a probe learns nothing.
 */
export interface Authorized {
  supabase: SupabaseClient;
  userId: string;
  project: ResearchProjectRow;
}

export type AuthorizeResult = { ok: true; auth: Authorized } | { ok: false; response: NextResponse };

export async function authorizeProject(
  projectId: string,
  options: { rateLimit?: "ai" } = {},
): Promise<AuthorizeResult> {
  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 }),
    };
  }
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const supabase = await createClient();

  if (options.rateLimit === "ai") {
    const result = await checkRateLimit(supabase, userId, RATE_LIMITS.aiRequest);
    if (!result.allowed) {
      return { ok: false, response: NextResponse.json(rateLimitResponseBody(result), { status: 429 }) };
    }
  }

  let project: ResearchProjectRow | null;
  try {
    project = await getProject(supabase, projectId);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Database temporarily unavailable" }, { status: 503 }),
    };
  }
  if (!project) return { ok: false, response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  return { ok: true, auth: { supabase, userId, project } };
}

/**
 * A database failure a researcher can read (§39). Raw Postgres text —
 * constraint names, column names — tells an attacker about the schema and
 * tells a student nothing.
 */
export function dbErrorResponse(context: string): NextResponse {
  return NextResponse.json(
    { error: `${context} could not be completed. Nothing was changed — you can retry.` },
    { status: 500 },
  );
}
