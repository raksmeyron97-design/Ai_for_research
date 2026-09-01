# Admin Analytics (Phase 10)

## What this phase adds

```
Usage sink      src/lib/ai/token-manager.ts       recordUsage() now persists
                src/lib/ai/orchestrator.ts        threads a Supabase client through
Access control  src/lib/admin/auth.ts             isAdminEmail()
Aggregation     src/lib/admin/analytics.ts        compileAdminAnalytics()
Admin client    src/lib/supabase/admin.ts         createAdminClient()
Route           GET /api/admin/analytics
UI              /admin (server component) + src/components/AdminDashboard.tsx
```

This is the last phase in the spec's original sequence. Unlike Phases
2-9, it's operator-facing, not part of the researcher's own workflow —
no researcher-facing schema or UI changed.

## `recordUsage()` finally writes to the database

`ai_usage` has existed since Phase 2, with a comment on the table
pointing straight at this moment ("this table is the sink Phase 10's
admin analytics dashboard reads from"), but nothing ever wrote to it —
`recordUsage()` just logged a JSON line to stdout. That's fixed now, but
minimally: `AIOrchestrator` gained one new constructor option
(`supabase?: SupabaseClient`), and every one of its 8 real call sites
(2 API routes, 6 section generators) now passes the request-scoped
client it already had in hand. `recordUsage()` itself takes that client
as its first argument and, when present, inserts a row; when absent
(tests, or any future caller that doesn't have one) it falls back to the
original console log, so nothing that already called the orchestrator
without a client breaks.

Writes go through the **request-scoped `authenticated` client**, not an
admin/service-role client — the Phase 5 RLS policy on `ai_usage`
(`ai_usage_insert_own`) already allows a user to insert a usage row for
their own `user_id` and one of their own projects, so no new policy was
needed. A failed insert is logged and swallowed, never thrown — usage
tracking must never be the reason a real AI response fails to reach the
user.

## Reading across every user's data needs the service-role client

The admin dashboard's whole point is aggregating across every
researcher's usage and projects, which by definition RLS won't allow for
any single `authenticated` user. `createAdminClient()`
(`lib/supabase/admin.ts`) wraps the service-role key — bypasses RLS
entirely — and was always the intended design here: both
`.env.example`'s `SUPABASE_SERVICE_ROLE_KEY` comment and
`lib/supabase/server.ts`'s doc comment have said "used only for trusted
server-side jobs (e.g. admin analytics aggregation)" since Phase 0/1,
before this phase existed. It is never constructed from a request-scoped
code path, and every caller must independently check `isAdminEmail()`
first.

## Admin access: an env allowlist, not a roles table

There's no `profiles`/roles table anywhere in this schema, and this
phase doesn't add one. `isAdminEmail()` checks the authenticated user's
email against a comma-separated `ADMIN_EMAILS` env var. This is a
deliberately minimal choice: a real roles table (plus the RLS policy
changes it would need) is schema/policy surface that isn't worth taking
on for the single admin-gated feature that exists so far. Revisit if a
second admin-only surface shows up.

`/admin` calls `notFound()` for a logged-in non-admin rather than
rendering a "Forbidden" page — a non-admin shouldn't learn the route
exists. `GET /api/admin/analytics` returns a plain `403` instead, since
API responses aren't trying to hide anything from someone already poking
at API routes directly.

## Two real bugs found only by running this against a real database

**1. `service_role` had no table grants either.** The Phase 5 migration
(`20260901000300_grant_authenticated_privileges.sql`) fixed this exact
class of gap for the `authenticated` role — RLS restricts which rows a
role can see, but Postgres still requires a baseline `GRANT` on the
table itself, independent of RLS. That fix never touched `service_role`,
and it turns out this local `supabase start` stack hadn't granted it
either: every single admin-analytics query returned `permission denied
for table research_projects` (or `ai_usage`) the first time the real
`/admin` page was loaded, even though `service_role` is supposed to see
everything. Fixed with
`20260901030000_grant_service_role_privileges.sql`, granting the same
`select, insert, update, delete` + `alter default privileges` pattern as
the Phase 5 migration, to `service_role` on every table in the schema.

**2. `compileAdminAnalytics()` was silently swallowing that exact
error.** None of its four Supabase queries checked `.error` before the
fix — a `count` or `data` of `null` from a failed query was treated as
"0 projects" / "no usage yet" instead of a failure. Combined with bug
#1, the very first real load of `/admin` rendered a completely
healthy-looking, empty dashboard instead of an error — the worst
possible failure mode for a monitoring tool, since it looks identical to
"the app genuinely has no activity yet." Fixed by checking `.error` on
every query and throwing a dedicated `AdminAnalyticsError` that the
route turns into a `500` with the real message, and the page renders as
a visible error banner instead of a quiet lie. Neither bug was visible
to `typecheck`/`lint`/`vitest`/`build` — both were only found by
actually loading the real page against the real local Supabase stack.

## Aggregates are computed over the most recent 5,000 `ai_usage` rows

`compileAdminAnalytics()` fetches up to `MAX_USAGE_ROWS` (5,000, the same
scale already used for Phase 7's `MAX_DATASET_ROWS`) most-recent usage
rows and computes every total, breakdown, and daily bucket from that one
fetch — deliberately, to keep one query shape instead of separate
lifetime-total and recent-activity code paths. This means totals stop
being exact once a deployment has logged more than 5,000 calls; older
activity ages out of every number on the dashboard. `usageRowsCapped` in
the API response says whether this limit was actually hit, and the UI
surfaces it ("Based on the N most recent AI calls..."). This is a real,
stated scaling boundary — acceptable for a dashboard meant to answer
"what's happening lately" for a research-assistant tool, not a
billing-grade ledger.

## Verification

30 new unit tests (274 total): `isAdminEmail`'s allowlist matching
(case-insensitivity, whitespace tolerance, unset-env denies everyone),
and `compileAdminAnalytics`'s aggregation logic — distinct-researcher
counting, cost/success/fallback totals, per-provider and per-task-type
breakdowns, daily bucketing, the 10-item failure cap, the
`usageRowsCapped` flag at exactly `MAX_USAGE_ROWS`, and — as a direct
regression test for bug #2 above — that a query returning `.error` makes
the function throw `AdminAnalyticsError` rather than returning zeros.

**Verified for real, against the local Supabase instance and a real
running server**: this is where both bugs above were actually found, not
theorized. After fixing them: signed up two real users through the real
Auth API (one added to `ADMIN_EMAILS`, one not), created a real project
as the admin user, and triggered a real (intentionally failing, since no
AI provider keys exist in this environment) `/api/ai/generate` call.
Confirmed directly against the database that this call persisted a real
row into `ai_usage` with the correct `project_id`/`user_id`/`success:
false`/`fallback: true`. Reloaded `/admin` and confirmed every number on
the dashboard — researchers, projects, AI calls, cost, success rate,
fallback rate, the by-provider table, the by-task-type table, the
"projects by status" counts, and the recent-failures table — matched
that real data exactly. Confirmed the non-admin user gets a real `404`
on the page and a real `403` on the API route, not just in theory.

**Not verified**: behavior once `ai_usage` actually holds more than
`MAX_USAGE_ROWS` rows (the capping logic is unit-tested, but no real
deployment in this environment has produced that much data), and real
AI provider cost/latency numbers under production load (no real
Gemini/OpenAI keys in this environment — the one real usage row
recorded here is a real failed-call record, not a real successful one).

## What's not built in Phase 10

- A roles table / any admin action beyond viewing this one dashboard —
  intentionally out of scope until a second admin-gated feature exists
  to justify it (see "Admin access" above).
- Historical trend charts beyond the current daily-usage bar strip, cost
  budgets/alerts, or per-project cost breakdowns (the dashboard is
  system-wide, not scoped to one project).
- Exact lifetime totals once a deployment exceeds `MAX_USAGE_ROWS` — see
  the scaling note above.
