-- Fixes a real gap found by testing the Phase 2/3 migrations against a
-- real local Postgres instance (Docker): RLS policies restrict which
-- *rows* a role can see, but Postgres still requires a baseline GRANT on
-- the *table* itself first — without one, every query is rejected with
-- "permission denied for table", regardless of how permissive or strict
-- the RLS policies are. This project's earlier migrations enabled RLS
-- and wrote policies but never issued the underlying GRANTs, so every
-- table was completely inaccessible to the `authenticated` role. This
-- was invisible without an actual database to query against.

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  research_projects,
  research_sections,
  research_documents,
  research_citations,
  document_chunks,
  ai_conversations,
  ai_messages,
  ai_usage
to authenticated;

-- Ensures the same grant is applied automatically to any table created
-- by future migrations, so this can't silently regress again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
