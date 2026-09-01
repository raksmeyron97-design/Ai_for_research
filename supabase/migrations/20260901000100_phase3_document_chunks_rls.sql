-- Phase 3: RLS for document_chunks. Same one-hop pattern as ai_conversations
-- (project_id stored directly on the row, checked against research_projects
-- ownership) — see docs/AI_DATABASE_SCHEMA.md.

alter table document_chunks enable row level security;

create policy "document_chunks_select_own" on document_chunks
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = document_chunks.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "document_chunks_insert_own" on document_chunks
  for insert with check (
    exists (
      select 1 from research_projects p
      where p.id = document_chunks.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "document_chunks_delete_own" on document_chunks
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = document_chunks.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- No update policy: re-processing a document deletes its old chunks and
-- inserts fresh ones (see deleteChunksForDocument/insertChunks in
-- src/lib/db/chunks.ts) rather than editing embeddings in place.

grant execute on function match_document_chunks(vector(768), uuid, int) to authenticated;
