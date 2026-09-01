import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import { authorizeProject, dbErrorResponse } from "./authorize";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";
import type { MethodologyEntityType } from "@/lib/db/types";

/**
 * The shared shape of a methodology CRUD route (§27, §23).
 *
 * Ten entity routes with the same preamble is ten chances for one of them to
 * drift — and the copy that forgets the ownership check accepts any id from any
 * user. Phase 17B extracted `authorizeProject` for that reason; this goes one
 * step further and extracts the whole route, because these ten are genuinely
 * identical apart from the table and the schema.
 *
 * It also makes the audit unconditional. §23 asks for consequential methodology
 * changes to be recorded, and an audit that each route has to remember to write
 * is an audit with holes in it.
 */
export interface CrudRow {
  id: string;
}

export interface CollectionConfig<TRow extends CrudRow, TCreate> {
  /** Used in error text a researcher reads: "Loading research questions". */
  label: string;
  entityType: MethodologyEntityType;
  list: (supabase: SupabaseClient, projectId: string) => Promise<TRow[]>;
  createSchema: ZodType<TCreate>;
  create: (supabase: SupabaseClient, projectId: string, input: TCreate) => Promise<TRow>;
  /** One line for the history entry. */
  summary: (row: TRow) => string;
  /** Key the collection appears under in the JSON response. */
  key: string;
}

/**
 * Writes the audit entry. A failure here does not fail the mutation — the
 * change has already happened, and rolling a researcher's edit back because the
 * log was unavailable would be worse. It is reported instead: `audited: false`
 * says the change is real but unrecorded, rather than leaving the caller to
 * assume a history entry exists.
 */
async function audit(
  supabase: SupabaseClient,
  input: Parameters<typeof recordMethodologyEvent>[1],
): Promise<boolean> {
  try {
    await recordMethodologyEvent(supabase, input);
    return true;
  } catch {
    return false;
  }
}

export function collectionRoute<TRow extends CrudRow, TCreate>(config: CollectionConfig<TRow, TCreate>) {
  async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const auth = await authorizeProject(projectId);
    if (!auth.ok) return auth.response;

    try {
      return NextResponse.json({ [config.key]: await config.list(auth.auth.supabase, projectId) });
    } catch {
      return dbErrorResponse(`Loading ${config.label}`);
    }
  }

  async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;

    const body = await req.json().catch(() => null);
    const parsed = config.createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await authorizeProject(projectId);
    if (!auth.ok) return auth.response;

    try {
      const row = await config.create(auth.auth.supabase, projectId, parsed.data);
      const audited = await audit(auth.auth.supabase, {
        project_id: projectId,
        entity_type: config.entityType,
        entity_id: row.id,
        action: "created",
        summary: config.summary(row),
        new_value: row as unknown as Record<string, unknown>,
      });
      return NextResponse.json({ [config.key.replace(/s$/, "")]: row, audited }, { status: 201 });
    } catch {
      // Covers the composite foreign keys too: a body id belonging to another
      // project fails on the key rather than being trusted (§27).
      return dbErrorResponse(`Saving that ${config.label.replace(/s$/, "")}`);
    }
  }

  return { GET, POST };
}

export interface EntityConfig<TRow extends CrudRow, TPatch> {
  label: string;
  entityType: MethodologyEntityType;
  patchSchema: ZodType<TPatch>;
  get?: (supabase: SupabaseClient, projectId: string, id: string) => Promise<TRow | null>;
  update: (supabase: SupabaseClient, projectId: string, id: string, patch: TPatch) => Promise<TRow>;
  remove: (supabase: SupabaseClient, projectId: string, id: string) => Promise<void>;
  summary: (row: TRow) => string;
  key: string;
}

export function entityRoute<TRow extends CrudRow, TPatch>(
  config: EntityConfig<TRow, TPatch>,
  idParam: string,
) {
  async function PATCH(req: Request, { params }: { params: Promise<Record<string, string>> }) {
    const resolved = await params;
    const projectId = resolved.projectId;
    const id = resolved[idParam];

    const body = await req.json().catch(() => null);
    const parsed = config.patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await authorizeProject(projectId);
    if (!auth.ok) return auth.response;

    try {
      // Read before writing so the history has a before as well as an after.
      const previous = await config.get?.(auth.auth.supabase, projectId, id);
      const row = await config.update(auth.auth.supabase, projectId, id, parsed.data);
      const audited = await audit(auth.auth.supabase, {
        project_id: projectId,
        entity_type: config.entityType,
        entity_id: row.id,
        action: "updated",
        summary: config.summary(row),
        previous_value: (previous as unknown as Record<string, unknown>) ?? null,
        new_value: row as unknown as Record<string, unknown>,
      });
      return NextResponse.json({ [config.key]: row, audited });
    } catch (err) {
      if ((err as { notFound?: boolean }).notFound) {
        return NextResponse.json({ error: `That ${config.label} was not found.` }, { status: 404 });
      }
      return dbErrorResponse(`Updating that ${config.label}`);
    }
  }

  async function DELETE(_req: Request, { params }: { params: Promise<Record<string, string>> }) {
    const resolved = await params;
    const projectId = resolved.projectId;
    const id = resolved[idParam];

    const auth = await authorizeProject(projectId);
    if (!auth.ok) return auth.response;

    try {
      const previous = await config.get?.(auth.auth.supabase, projectId, id);
      await config.remove(auth.auth.supabase, projectId, id);
      // The event survives the row: entity_id is deliberately not a foreign
      // key, so the record of a deletion is not deleted with it.
      await audit(auth.auth.supabase, {
        project_id: projectId,
        entity_type: config.entityType,
        entity_id: id,
        action: "deleted",
        summary: previous ? config.summary(previous) : `Deleted a ${config.label}`,
        previous_value: (previous as unknown as Record<string, unknown>) ?? null,
      });
      return new NextResponse(null, { status: 204 });
    } catch {
      return dbErrorResponse(`Deleting that ${config.label}`);
    }
  }

  return { PATCH, DELETE };
}
