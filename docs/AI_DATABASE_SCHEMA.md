# Database Schema (Phase 2)

## How to apply the migrations

Three migration files live in `supabase/migrations/`, applied in filename
order (they're already timestamp-ordered):

1. `20260831230000_phase2_core_schema.sql` — tables, indexes, `updated_at` triggers.
2. `20260831230100_phase2_rls_policies.sql` — enables RLS and adds per-table policies. Depends on (1).
3. `20260831230200_phase2_storage.sql` — creates the `research-documents` storage bucket + storage-level policies. Depends on (1) (its policies reference `research_projects`).

### Option A — Supabase CLI (recommended once you have a project)

```bash
npm install -g supabase        # if you don't have it already
supabase login
supabase link --project-ref <your-project-ref>   # find this in Supabase dashboard > Project Settings
supabase db push                                  # applies every migration in supabase/migrations/ in order
```

`supabase link` only needs to be run once per machine/checkout. After
that, any new migration file added to `supabase/migrations/` is picked up
by `supabase db push`.

### Option B — Manual, via the Supabase dashboard SQL Editor

If you don't want to install the CLI: open your project's **SQL Editor**
in the Supabase dashboard and run the three files' contents **in order**
(1, then 2, then 3) — paste each file's full contents as one query and
run it before moving to the next file. This produces the identical
schema; it just isn't tracked as a "migration" the CLI knows about, so if
you later also start using the CLI, run `supabase migration repair` (or
just re-run `supabase db push`, which no-ops on objects that already
exist) to reconcile.

### After applying

Fill in `.env.local` from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and — only for server-only admin jobs,
not this app's request-scoped routes — `SUPABASE_SERVICE_ROLE_KEY`).
`src/lib/supabase/server.ts`'s `requireUserId()` (already wired into
`/api/ai/*`) will then resolve real sessions instead of failing with
"Authentication service unavailable".

## Schema overview

```
auth.users (Supabase-managed)
    │
    ▼
research_projects ──┬── research_sections   (1 row per section_type, 18-section chain)
  (the isolation     ├── research_documents (+ storage.objects, bucket "research-documents")
   boundary — every   ├── research_citations
   other table hangs   ├── ai_conversations ── ai_messages
   off this)           └── ai_usage
```

Every child table carries `project_id`; every read/write goes through
RLS keyed off `research_projects.user_id`, not a client-supplied value —
see "Row-Level Security" below. This is what keeps Project A and Project
B fully isolated (spec's "never mix projects" requirement), and it's
enforced at the database layer, not just in application code.

### `research_projects`

The project entity — title, language, discipline, study design, target
population, location, sample size, sampling method, status. Matches the
"research profile" shape from spec §12 closely enough that
`ContextManager` (Phase 3) can build the compact AI-readable profile
directly from a `SELECT *` here plus one `getProjectProgress()` call.

`study_design` is a free-text column, not an enum — methodology
vocabulary varies too much across disciplines to force into a fixed list
at the database layer. `status` (draft/active/completed/archived) *is*
constrained, since that's genuinely a closed set.

### `research_sections`

One row per section of the Title → Research Problem → ... → Appendices
chain (18 `section_type` values, enforced by a `CHECK` constraint —
see `SECTION_CHAIN` in `src/lib/db/projects.ts`, which must stay in sync
with the migration if the chain ever changes). `content` is the section's
text; `metadata` is a `jsonb` catch-all for section-specific structured
data (e.g. an objectives list, a variables table) that doesn't warrant
its own table yet.

**Deliberately not built in Phase 2**: normalized `ResearchObjective` /
`ResearchVariable` / `ResearchHypothesis` / `SamplingPlan` tables from the
master spec's full 18-entity list (§4). Those become worth their own
tables once the questionnaire builder or alignment engine need to query
individual objectives/variables as rows (join, filter, foreign-key into a
question) rather than read/write a section's content as a blob. Until
then, `research_sections.metadata` holds that structured data. This is a
scoping decision, not an oversight — extending later doesn't require
migrating existing data, since `research_sections.content`/`metadata`
would just become one input to the new tables.

**Progress is computed, not stored.** There's no `progress_percent`
column on `research_projects` — `getProjectProgress()` in
`src/lib/db/projects.ts` derives it from `research_sections` rows each
time it's called (a section with no row yet counts as `not_started`).
Storing a synced percentage risks drifting from the real section
statuses; computing it is one indexed query.

### `research_documents`

File **metadata** only — the actual bytes live in Supabase Storage
(bucket `research-documents`, path convention
`{project_id}/{uuid}-{sanitized_filename}`, built by
`buildStoragePath()`). `extraction_status`/`extracted_text` exist now so
the column doesn't need a schema migration when Phase 3's RAG pipeline
starts populating them — they're unused until then.

### `research_citations`

Mirrors `Citation`/`EvidenceStatus` in `src/lib/ai/types.ts` field-for-
field, so a citation a provider returns can be persisted without
translation once Phase 5 wires up citation persistence.

### `ai_conversations` / `ai_messages`

Chat history, scoped to a project. `ai_conversations.user_id` is stored
directly (not just reachable by joining through `research_projects`) so
`ai_messages`' RLS only needs one join (`ai_messages` → `ai_conversations`),
not two. Messages are append-only: no `update`/`delete` RLS policy exists
for `ai_messages`, so both are denied by default — chat history isn't
meant to be edited after the fact.

### `ai_usage`

The persistence sink for `buildUsageRecord()`/`UsageRecord` in
`src/lib/ai/token-manager.ts`, which currently only logs to stdout
(`recordUsage()`). Wiring `recordUsage()` to insert into this table is
the natural next step once an authenticated Supabase client is available
inside `AIOrchestrator` — not done in this pass, since the orchestrator
is currently provider-only and doesn't hold a request-scoped DB client.
Insert-only from RLS's perspective: usage rows are immutable audit data.

## Row-Level Security

Every table has RLS enabled with **no bypass** — there's no
"trust the app layer" fallback. Policies follow one pattern:

- `research_projects`: `user_id = auth.uid()` directly.
- Every child table (`research_sections`, `research_documents`,
  `research_citations`): an `EXISTS` subquery back to
  `research_projects` checking `user_id = auth.uid()`. Because
  `research_projects` itself has RLS enabled, this subquery is *also*
  restricted by RLS — there's no need for a `SECURITY DEFINER` bypass to
  make the check work correctly.
- `ai_conversations`: `user_id` is stored directly (one hop, not two).
- `ai_messages`: one hop through `ai_conversations.user_id`.
- `ai_usage`: `user_id` stored directly, plus an `EXISTS` check on insert
  that the referenced `project_id` is also owned by the same user (belt
  and suspenders — prevents attributing usage to a project you don't own
  even if you do own the row you're inserting).
- Storage (`storage.objects`, bucket `research-documents`): reads the
  `project_id` back out of the object path via
  `storage.foldername(name)[1]` and checks it the same way — so file
  bytes get the identical isolation guarantee as the metadata rows.

All policies wrap `auth.uid()` as `(select auth.uid())` — a documented
Postgres/Supabase optimization that lets the planner evaluate it once per
statement instead of once per row; functionally identical to the bare
form, just faster on large tables.

**What this closes from Phase 1**: the Phase 1 audit flagged
`/api/ai/*` as checking "is this user logged in," not "does this user own
`projectId`." RLS is what actually closes that gap now — even if a route
handler forgot to check project ownership itself, the database would
still refuse to return or modify another user's row. Route handlers
should still check ownership explicitly for a clean 403/404 instead of a
confusing empty result, but RLS is the real boundary.

## TypeScript layer

- `src/lib/db/types.ts` — hand-written row/insert/update types mirroring
  the migrations. If the project gets linked to the Supabase CLI later,
  `supabase gen types typescript --linked > src/lib/db/types.generated.ts`
  can produce a canonical version; until then, keep this file in sync
  with the SQL by hand when the schema changes.
- `src/lib/db/errors.ts` — `DbError` wraps Postgrest errors, with a
  `notFound` flag derived from PostgREST's `PGRST116` code (the "no rows
  for `.single()`" error) so callers can return 404 vs 500 without
  string-matching Postgres internals.
- `src/lib/db/projects.ts`, `src/lib/db/documents.ts` — CRUD functions.
  Every function takes the caller's request-scoped Supabase client
  (from `src/lib/supabase/server.ts`'s `createClient()`, built from the
  caller's session cookies) as the first argument. Reads/updates/deletes
  don't add a redundant `.eq('user_id', ...)` filter — RLS is the
  authoritative boundary, and adding a second copy of that logic here
  would just be two places that can drift out of sync. Inserts do pass
  `user_id`/`uploaded_by` explicitly, matching what each `with check`
  clause requires.
- `src/lib/db/__tests__/` — unit tests using a hand-rolled mock of the
  chainable Supabase query builder (`supabase-mock.ts`) so the data-access
  logic (payload construction, error wrapping, upload/delete rollback
  ordering, progress computation) is tested without a live database.
  These test this codebase's query-construction logic, not that Postgres
  actually enforces the RLS policies — see "RLS verification" below for
  that, which was done a different way.

## RLS verification

Once a real Docker daemon became available in this environment, the RLS
policies were verified for real — not just written and reasoned about —
using `supabase start` (local Postgres + Auth + Storage + PostgREST) and
two real users created through the actual Auth API:

- `research_projects` (direct `user_id` ownership): user B's REST client
  listing projects returns `[]`, not user A's row; fetching it by id
  returns `[]`; attempting to `DELETE` it affects 0 rows; user A's data is
  untouched throughout.
- `research_sections` (EXISTS-based child-table ownership): user B
  attempting to `INSERT` a section under user A's `project_id` gets a
  `403` with `"new row violates row-level security policy"`; user A's own
  insert into her own project succeeds; user B's read of user A's
  sections returns `[]`.
- `ai_conversations`/`ai_messages` (one-hop via `ai_conversations.user_id`):
  same pattern — user B can't read or insert into user A's conversation.
- `document_chunks` + the `match_document_chunks()` RPC: inserted a real
  768-dim embedding as user A, called the RPC as user A (got the chunk
  back with `similarity: 1` for an identical query vector — pgvector's
  HNSW index and cosine-distance search work correctly end to end) and as
  user B for the *same* `match_project_id` (got `[]`, not an error —
  confirms the function is genuinely `SECURITY INVOKER` and RLS applies
  inside it, not just at the outer query).
- Storage bucket (`research-documents`): user A uploads and downloads her
  own object; user B requesting the same path gets a `404` (the object is
  invisible to her, not merely access-denied — slightly better than a
  generic 403 since it doesn't confirm the path exists to an
  unauthorized caller).

**A real bug was found this way and is now fixed**
(`20260901000300_grant_authenticated_privileges.sql`): the earlier
migrations enabled RLS and wrote policies, but never issued the
underlying `GRANT SELECT/INSERT/UPDATE/DELETE ... TO authenticated`.
Postgres requires both — a table-level grant *and* a satisfied RLS
policy — and without the grant, every query was rejected outright with
`"permission denied for table"`, regardless of how correct the RLS
policy itself was. This was completely invisible from reading the SQL or
from the mocked unit tests; it only showed up the moment a real
authenticated request hit a real Postgres instance. If you fork this
schema for a new Supabase project, don't skip this migration.

## What's still not tested

- **Migration idempotency/rollback** — these are forward-only migrations;
  `supabase db reset` (full recreate + reapply) was exercised, but
  rolling back a single already-applied migration was not.
- **Concurrent/load behavior** — the RLS verification above used one
  request at a time; it says nothing about behavior under concurrent
  writes or connection-pool exhaustion.
- **Production Supabase-hosted specifics** — verified against the
  Supabase CLI's local Docker stack, not a hosted Supabase project.
  Hosted projects auto-configure some things (default grants among them,
  on projects created through the dashboard) that this local stack did
  not — re-verify grants specifically if migrations are applied to a
  hosted project via a path other than `supabase db push`.
