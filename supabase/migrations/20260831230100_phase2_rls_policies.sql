-- Phase 2: Row-Level Security
-- Strict per-user project isolation: a user can only see/modify rows that
-- belong to a research_projects row they own. Every child table's policy
-- goes through research_projects.user_id (or ai_conversations.user_id,
-- one hop closer for ai_messages) rather than trusting a client-supplied
-- user_id column, so RLS is the actual enforcement boundary, not just the
-- app-layer "is this user logged in" check in the API routes.
--
-- `(select auth.uid())` (not bare `auth.uid()`) is used throughout: wrapping
-- it lets Postgres evaluate it once per statement instead of once per row.

alter table research_projects enable row level security;
alter table research_sections enable row level security;
alter table research_documents enable row level security;
alter table research_citations enable row level security;
alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
alter table ai_usage enable row level security;

-- ---------------------------------------------------------------------
-- research_projects
-- ---------------------------------------------------------------------
create policy "research_projects_select_own" on research_projects
  for select using (user_id = (select auth.uid()));

create policy "research_projects_insert_own" on research_projects
  for insert with check (user_id = (select auth.uid()));

create policy "research_projects_update_own" on research_projects
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "research_projects_delete_own" on research_projects
  for delete using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- research_sections (via research_projects ownership)
-- ---------------------------------------------------------------------
create policy "research_sections_select_own" on research_sections
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = research_sections.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_sections_insert_own" on research_sections
  for insert with check (
    exists (
      select 1 from research_projects p
      where p.id = research_sections.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_sections_update_own" on research_sections
  for update using (
    exists (
      select 1 from research_projects p
      where p.id = research_sections.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from research_projects p
      where p.id = research_sections.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_sections_delete_own" on research_sections
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = research_sections.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- research_documents (via research_projects ownership)
-- ---------------------------------------------------------------------
create policy "research_documents_select_own" on research_documents
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = research_documents.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_documents_insert_own" on research_documents
  for insert with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from research_projects p
      where p.id = research_documents.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_documents_update_own" on research_documents
  for update using (
    exists (
      select 1 from research_projects p
      where p.id = research_documents.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from research_projects p
      where p.id = research_documents.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_documents_delete_own" on research_documents
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = research_documents.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- research_citations (via research_projects ownership)
-- ---------------------------------------------------------------------
create policy "research_citations_select_own" on research_citations
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = research_citations.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_citations_insert_own" on research_citations
  for insert with check (
    exists (
      select 1 from research_projects p
      where p.id = research_citations.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_citations_update_own" on research_citations
  for update using (
    exists (
      select 1 from research_projects p
      where p.id = research_citations.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from research_projects p
      where p.id = research_citations.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_citations_delete_own" on research_citations
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = research_citations.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- ai_conversations (user_id stored directly)
-- ---------------------------------------------------------------------
create policy "ai_conversations_select_own" on ai_conversations
  for select using (user_id = (select auth.uid()));

create policy "ai_conversations_insert_own" on ai_conversations
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from research_projects p
      where p.id = ai_conversations.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "ai_conversations_update_own" on ai_conversations
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "ai_conversations_delete_own" on ai_conversations
  for delete using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- ai_messages (via ai_conversations ownership — one hop, not two)
-- ---------------------------------------------------------------------
create policy "ai_messages_select_own" on ai_messages
  for select using (
    exists (
      select 1 from ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

create policy "ai_messages_insert_own" on ai_messages
  for insert with check (
    exists (
      select 1 from ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- Chat history is append-only: no update/delete policy is defined, so
-- both are denied by default (RLS with no matching policy = no access).

-- ---------------------------------------------------------------------
-- ai_usage (insert-only from the app; user_id stored directly)
-- ---------------------------------------------------------------------
create policy "ai_usage_select_own" on ai_usage
  for select using (user_id = (select auth.uid()));

create policy "ai_usage_insert_own" on ai_usage
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from research_projects p
      where p.id = ai_usage.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- No update/delete policy: usage records are immutable audit data.
