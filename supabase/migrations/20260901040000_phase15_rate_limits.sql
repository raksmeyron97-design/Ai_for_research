-- Phase 15: generic rate-limiting bookkeeping. One row per throttled
-- action, checked/inserted by src/lib/security/rate-limit.ts. Deliberately
-- one generic table rather than one per resource type (AI calls, uploads,
-- ...) — the limiter only ever needs "how many did this user do in bucket
-- X in the last N seconds," and every caller already has an authenticated
-- Supabase client in hand, so this reuses the same RLS-enforced,
-- insert-own pattern as ai_usage rather than adding new infrastructure
-- (no Redis/external rate-limit service — unnecessary at this scale, and
-- Postgres is already the durable source of truth for everything else).

create table rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  created_at timestamptz not null default now()
);

-- The limiter's only query shape: count rows for (user_id, bucket) newer
-- than a cutoff.
create index rate_limit_events_user_bucket_created_idx
  on rate_limit_events(user_id, bucket, created_at);

-- Old rows are never read after their window passes — nothing preserves
-- them for audit purposes, unlike ai_usage. A periodic cleanup job could
-- delete rows older than the longest configured window; not built yet
-- (documented in the Phase 15 readiness report) since an unbounded but
-- slowly-growing table of tiny rows is not an urgent problem at this
-- scale, and deleting rows here has no user-visible effect either way.
alter table rate_limit_events enable row level security;

create policy "rate_limit_events_select_own" on rate_limit_events
  for select using (user_id = (select auth.uid()));

create policy "rate_limit_events_insert_own" on rate_limit_events
  for insert with check (user_id = (select auth.uid()));

-- No update/delete policy: events are write-once, like ai_usage.

grant select, insert on rate_limit_events to authenticated;
