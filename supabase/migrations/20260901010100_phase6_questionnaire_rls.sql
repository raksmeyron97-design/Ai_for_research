-- Phase 6 RLS — same EXISTS-based ownership pattern as research_sections
-- (Phase 2) and document_chunks (Phase 3): project_id is checked against
-- research_projects.user_id, not trusted from the client.

alter table research_instruments enable row level security;
alter table questionnaire_questions enable row level security;

create policy "research_instruments_select_own" on research_instruments
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = research_instruments.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_instruments_insert_own" on research_instruments
  for insert with check (
    exists (
      select 1 from research_projects p
      where p.id = research_instruments.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_instruments_update_own" on research_instruments
  for update using (
    exists (
      select 1 from research_projects p
      where p.id = research_instruments.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from research_projects p
      where p.id = research_instruments.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_instruments_delete_own" on research_instruments
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = research_instruments.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "questionnaire_questions_select_own" on questionnaire_questions
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = questionnaire_questions.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "questionnaire_questions_insert_own" on questionnaire_questions
  for insert with check (
    exists (
      select 1 from research_projects p
      where p.id = questionnaire_questions.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "questionnaire_questions_update_own" on questionnaire_questions
  for update using (
    exists (
      select 1 from research_projects p
      where p.id = questionnaire_questions.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from research_projects p
      where p.id = questionnaire_questions.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "questionnaire_questions_delete_own" on questionnaire_questions
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = questionnaire_questions.project_id
        and p.user_id = (select auth.uid())
    )
  );
