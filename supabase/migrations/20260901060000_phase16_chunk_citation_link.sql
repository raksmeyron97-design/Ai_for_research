-- Phase 16, finding F2: retrieved chunks had no citable identifier.
--
-- Every task prompt (src/lib/ai/prompts/*.ts) instructs the model to cite
-- "its exact [citation_key] from context", and
-- integrity-guard.ts:verifyCitationKeys() checks the bracket tokens a
-- response emits against research_citations. But document_chunks had no
-- path to research_citations, so context-manager.ts could only label
-- retrieved excerpts [1], [2], ... A model grounding on retrieved evidence
-- therefore had no key it could emit that would verify — the retrieval loop
-- and the citation-verification loop were structurally disconnected.
--
-- The link goes on research_documents rather than document_chunks: a source
-- is a property of the uploaded file, not of each of its chunks, so putting
-- it on the document keeps one row to update when a file is identified and
-- makes it impossible for two chunks of the same PDF to claim different
-- sources.
--
-- Nullable on purpose. A document may be uploaded before anyone records what
-- source it is, and a citation may exist with no uploaded file (a source the
-- researcher entered by hand). on delete set null: deleting a source record
-- must not delete the document or its chunks, it just makes the excerpts
-- uncitable again.

alter table research_documents
  add column citation_id uuid references research_citations(id) on delete set null;

comment on column research_documents.citation_id is
  'The source record this document is. Nullable: an unidentified upload has no citation, and its retrieved excerpts are rendered as uncitable rather than given a fabricated key.';

create index research_documents_citation_id_idx on research_documents(citation_id);

-- ---------------------------------------------------------------------
-- match_document_chunks now returns the citation key alongside each chunk.
--
-- Dropped and recreated rather than CREATE OR REPLACE: Postgres will not
-- replace a function whose OUT columns change.
--
-- Still SECURITY INVOKER (the default — no "security definer" here), so the
-- caller's RLS applies to document_chunks and to both new joins. The joins
-- are LEFT so an unlinked document still returns its chunks, with a null
-- key, instead of vanishing from retrieval.
-- ---------------------------------------------------------------------
drop function if exists match_document_chunks(vector(768), uuid, int);

create function match_document_chunks(
  query_embedding vector(768),
  match_project_id uuid,
  match_count int default 8
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  page integer,
  section text,
  citation_key text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    c.page,
    c.section,
    rc.citation_key,
    1 - (c.embedding <=> query_embedding) as similarity
  from document_chunks c
  join research_documents d on d.id = c.document_id
  left join research_citations rc on rc.id = d.citation_id
  where c.project_id = match_project_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
