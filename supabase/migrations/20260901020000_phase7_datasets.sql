-- Phase 7: Data Analysis — dataset storage.
--
-- Parsed row data is stored as jsonb directly on the row rather than a
-- separate per-row table: these are academic-scale datasets (survey
-- responses, not big data), analysis runs entirely in application code
-- (real computation, not SQL aggregation — see
-- docs/AI_DATA_ANALYSIS.md), and a separate rows table would add
-- per-row RLS overhead for no querying benefit since nothing ever
-- filters by an individual row's contents at the database layer.

create table research_datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),

  file_name text not null,
  row_count integer not null,
  -- [{ name: string, type: 'numeric'|'categorical'|'text'|'date', missing_count: number }, ...]
  column_schema jsonb not null,
  -- Array of row objects, keyed by column name. Capped at upload time
  -- (see MAX_DATASET_ROWS in src/lib/data/parse-dataset.ts) — this column
  -- is not meant for arbitrarily large data.
  data jsonb not null,

  created_at timestamptz not null default now()
);

create index research_datasets_project_id_idx on research_datasets(project_id);

alter table research_datasets enable row level security;

create policy "research_datasets_select_own" on research_datasets
  for select using (
    exists (
      select 1 from research_projects p
      where p.id = research_datasets.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_datasets_insert_own" on research_datasets
  for insert with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from research_projects p
      where p.id = research_datasets.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "research_datasets_delete_own" on research_datasets
  for delete using (
    exists (
      select 1 from research_projects p
      where p.id = research_datasets.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- No update policy: a re-upload should replace the row (delete + insert),
-- not mutate one in place — same "immutable upload" reasoning as
-- research_documents.

grant select, insert, delete on research_datasets to authenticated;
