-- Phase 2: Research Project Data Model
-- Tables covering: projects, documents, research sections, citations,
-- AI chat history, and token usage tracking (spec §4, §12, §21).
--
-- Deliberately NOT included in this migration (deferred to later phases,
-- see docs/AI_DATABASE_SCHEMA.md): normalized ResearchObjective/
-- ResearchVariable/ResearchHypothesis/SamplingPlan tables — for now these
-- live inside research_sections.metadata (jsonb) until the questionnaire
-- builder / alignment engine need to query them as individual rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- updated_at trigger helper (shared by every table with an updated_at column)
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- research_projects — one row per thesis/research project. Project
-- isolation (never mix Project A's data into Project B) is enforced by
-- every other table carrying a project_id FK + RLS keyed off this table's
-- user_id (see the RLS migration).
-- ---------------------------------------------------------------------
create table research_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  language text not null default 'en' check (language in ('km', 'en')),
  discipline text,
  -- Free text, not an enum: methodology design vocabulary varies too much
  -- across disciplines to force into a fixed list at the DB layer.
  study_design text,
  target_population text[] not null default '{}',
  location text,
  sample_size integer check (sample_size is null or sample_size > 0),
  sampling_method text,

  status text not null default 'active'
    check (status in ('draft', 'active', 'completed', 'archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_projects_user_id_idx on research_projects(user_id);
create index research_projects_created_at_idx on research_projects(created_at);

create trigger research_projects_set_updated_at
  before update on research_projects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_sections — one row per section of the Title -> ... ->
-- Appendices chain (spec's opening "keep the chain aligned" requirement).
-- section_type is the alignment key the Quality Check / Alignment Engine
-- (Phase 5) will walk in order.
-- ---------------------------------------------------------------------
create table research_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  section_type text not null check (section_type in (
    'title', 'research_problem', 'rationale', 'research_gap',
    'objectives', 'research_questions', 'variables',
    'conceptual_framework', 'methodology', 'questionnaire',
    'data_collection', 'data_analysis', 'results', 'discussion',
    'conclusion', 'recommendations', 'references', 'appendices'
  )),

  content text not null default '',
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  -- Structured per-section data that doesn't need its own table yet, e.g.
  -- { "objectives": [...], "variables": [...] }. Shape is section_type-specific
  -- and validated at the application layer (zod), not the DB layer.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, section_type)
);

create index research_sections_project_id_idx on research_sections(project_id);

create trigger research_sections_set_updated_at
  before update on research_sections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_documents — uploaded file metadata. File bytes live in Supabase
-- Storage (bucket "research-documents", path = storage_path below);
-- extracted_text/extraction_status are populated by the Phase 3 RAG
-- pipeline, not this migration.
-- ---------------------------------------------------------------------
create table research_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),

  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  document_type text not null default 'other'
    check (document_type in (
      'thesis', 'article', 'guideline', 'questionnaire',
      'dataset', 'reference', 'template', 'other'
    )),

  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extracted_text text,

  created_at timestamptz not null default now()
);

create index research_documents_project_id_idx on research_documents(project_id);
create index research_documents_uploaded_by_idx on research_documents(uploaded_by);

-- ---------------------------------------------------------------------
-- research_citations — sources. Mirrors the Citation shape in
-- src/lib/ai/types.ts (status uses the same EvidenceStatus values so a
-- provider-returned Citation can be persisted without translation).
-- ---------------------------------------------------------------------
create table research_citations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  citation_key text not null,
  title text,
  authors text[] not null default '{}',
  year integer,
  journal text,
  doi text,
  url text,
  source_type text,
  tier smallint check (tier is null or tier between 1 and 4),
  status text not null default 'unverified'
    check (status in ('verified', 'source_required', 'user_provided', 'inference', 'unverified')),

  created_at timestamptz not null default now(),

  unique (project_id, citation_key)
);

create index research_citations_project_id_idx on research_citations(project_id);

-- ---------------------------------------------------------------------
-- ai_conversations / ai_messages — chat history, scoped to a project.
-- user_id is duplicated onto ai_conversations (not just reachable via
-- research_projects) so RLS on ai_messages only needs one join, not two.
-- ---------------------------------------------------------------------
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create index ai_conversations_project_id_idx on ai_conversations(project_id);
create index ai_conversations_user_id_idx on ai_conversations(user_id);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,

  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  task_type text,
  provider text check (provider is null or provider in ('gemini', 'openai')),
  model text,
  structured_data jsonb,

  created_at timestamptz not null default now()
);

create index ai_messages_conversation_id_idx on ai_messages(conversation_id);
create index ai_messages_created_at_idx on ai_messages(created_at);

-- ---------------------------------------------------------------------
-- ai_usage — persists token-manager.ts's UsageRecord (currently only
-- logged to stdout; this table is the sink Phase 10's admin analytics
-- dashboard reads from). One row per orchestrator call, success or fail.
-- ---------------------------------------------------------------------
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,

  task_type text not null,
  provider text not null check (provider in ('gemini', 'openai')),
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  latency_ms integer,
  success boolean not null,
  fallback boolean not null default false,

  created_at timestamptz not null default now()
);

create index ai_usage_project_id_idx on ai_usage(project_id);
create index ai_usage_user_id_idx on ai_usage(user_id);
create index ai_usage_created_at_idx on ai_usage(created_at);
create index ai_usage_task_type_idx on ai_usage(task_type);
