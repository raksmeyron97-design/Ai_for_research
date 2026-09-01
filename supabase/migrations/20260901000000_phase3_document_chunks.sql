-- Phase 3: Document & RAG — chunk storage + vector similarity search.
--
-- project_id is denormalized onto document_chunks (not just reachable via
-- research_documents) for the same reason as ai_conversations.user_id in
-- Phase 2: RLS and the match_document_chunks() search function below only
-- need one join, not two, and every retrieval query filters by project_id
-- anyway (never search across projects).

create extension if not exists vector;

-- Embedding dimensionality must match GEMINI_EMBEDDING_DIMENSIONS in
-- src/lib/ai/model-config.ts (default 768). Changing that env var without
-- a matching migration + full re-embed will break retrieval silently
-- (dimension mismatch errors on insert, not corrupt-but-working results).
create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references research_documents(id) on delete cascade,
  project_id uuid not null references research_projects(id) on delete cascade,

  chunk_index integer not null,
  content text not null,
  token_count integer not null default 0,
  page integer,
  section text,
  embedding vector(768) not null,

  created_at timestamptz not null default now(),

  unique (document_id, chunk_index)
);

create index document_chunks_project_id_idx on document_chunks(project_id);
create index document_chunks_document_id_idx on document_chunks(document_id);

-- HNSW over ivfflat: no training/list-count tuning needed, and it's the
-- pgvector-recommended default for cosine distance as of pgvector 0.5+.
create index document_chunks_embedding_hnsw_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- match_document_chunks — semantic search, callable via supabase.rpc().
-- Deliberately SECURITY INVOKER (the default — no "security definer"
-- here): it runs as the calling user, so document_chunks' own RLS policy
-- (next migration) still applies inside this function. A project_id the
-- caller doesn't own simply returns zero rows, the same as a direct
-- SELECT would.
-- ---------------------------------------------------------------------
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
  similarity float
)
language sql
stable
as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.chunk_index,
    document_chunks.content,
    document_chunks.page,
    document_chunks.section,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  where document_chunks.project_id = match_project_id
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;
