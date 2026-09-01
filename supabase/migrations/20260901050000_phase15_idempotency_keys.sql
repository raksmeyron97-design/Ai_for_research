-- Phase 15: idempotency-key support for expensive, side-effecting AI
-- routes (questionnaire generation in particular creates a whole new
-- instrument + question set per call — a double-click or a client retry
-- after a slow/dropped response previously had no way to recognize "this
-- exact request already succeeded" and would create a full duplicate).
--
-- Only successful responses are ever stored here (see
-- src/lib/security/idempotency.ts) — a failed attempt is not cached, so a
-- retry after a real failure (e.g. a transient provider outage) is always
-- allowed to actually retry, not replay the same failure forever.

create table idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  key text not null,
  status_code integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),

  unique (user_id, route, key)
);

create index idempotency_keys_lookup_idx on idempotency_keys(user_id, route, key);

alter table idempotency_keys enable row level security;

create policy "idempotency_keys_select_own" on idempotency_keys
  for select using (user_id = (select auth.uid()));

create policy "idempotency_keys_insert_own" on idempotency_keys
  for insert with check (user_id = (select auth.uid()));

-- No update/delete policy: entries are write-once, like ai_usage and
-- rate_limit_events.

grant select, insert on idempotency_keys to authenticated;
