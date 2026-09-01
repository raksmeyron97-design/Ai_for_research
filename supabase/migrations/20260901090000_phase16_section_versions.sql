-- Phase 16 §18: version history for section content.
--
-- Until now `research_sections` held only current content. `SectionEditor`
-- recorded coarse provenance (metadata.aiAssisted) but the previous text was
-- gone the moment anything replaced it. That makes "AI must never silently
-- overwrite user content" (§17) unverifiable after the fact: a researcher who
-- accepted a replacement had no way back.
--
-- One row per accepted change, holding what the content was and what it
-- became. Deliberately not a full CRDT or per-keystroke history — the unit
-- that matters is an accepted AI insertion or a manual save, which is what a
-- researcher would want to undo or point a supervisor at.

create table research_section_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  section_id uuid not null references research_sections(id) on delete cascade,
  section_type text not null,

  -- Content before and after. previous_content is '' for the first version
  -- of a section, which is meaningfully different from null.
  previous_content text not null default '',
  new_content text not null,

  -- How the change was made. 'manual' covers a researcher's own edit;
  -- the rest are the AI change-control actions from §17.
  action text not null check (action in ('manual', 'insert', 'replace', 'append', 'ai_generate')),

  -- Provenance, when the change came from an AI action. Null for manual
  -- edits — recording a model for a change no model made would be worse
  -- than recording nothing.
  provider text,
  model text,
  section_action text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index research_section_versions_section_idx
  on research_section_versions(section_id, created_at desc);
create index research_section_versions_project_idx
  on research_section_versions(project_id);

alter table research_section_versions enable row level security;

-- Same ownership rule as every other project-scoped table: reachable only
-- through a project the caller owns. Insert is allowed but update and delete
-- are not — a version history a user can rewrite is not a history.
create policy "own project section versions are readable"
  on research_section_versions for select
  using (
    exists (
      select 1 from research_projects p
      where p.id = research_section_versions.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "own project section versions are insertable"
  on research_section_versions for insert
  with check (
    exists (
      select 1 from research_projects p
      where p.id = research_section_versions.project_id
        and p.user_id = auth.uid()
    )
  );

grant select, insert on research_section_versions to authenticated;
