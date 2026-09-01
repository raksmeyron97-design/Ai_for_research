-- Fixes the same class of gap the Phase 5 migration fixed for
-- `authenticated` (20260901000300_grant_authenticated_privileges.sql), now
-- found for `service_role` while building Phase 10's admin analytics: RLS
-- policies restrict which *rows* a role can see, but Postgres still
-- requires a baseline GRANT on the *table* itself, and `service_role`
-- bypassing RLS does not exempt it from that. Verified against a real
-- local Postgres instance — every admin analytics query returned
-- "permission denied for table" until this was applied, even though
-- service_role is meant to see everything.

grant usage on schema public to service_role;

grant select, insert, update, delete on
  research_projects,
  research_sections,
  research_documents,
  research_citations,
  document_chunks,
  ai_conversations,
  ai_messages,
  ai_usage,
  research_instruments,
  questionnaire_questions,
  research_datasets
to service_role;

-- Ensures the same grant is applied automatically to any table created
-- by future migrations, so this can't silently regress again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
