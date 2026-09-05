-- Phase 17B: the literature half of the evidence workspace.
--
-- Phase 17 modelled the chain Source -> Evidence -> Claim -> Citation ->
-- Section. What it did not model is everything a researcher does *across*
-- sources rather than within one: grouping them into themes, comparing them
-- field by field, and recording where the literature stops.
--
-- All four tables follow the two rules Phase 17 established: project_id on
-- every row, and composite foreign keys carrying project_id into every
-- reference so a row cannot point at another project's parent even if a
-- policy were written wrongly.

-- ---------------------------------------------------------------------
-- research_themes -- researcher-owned grouping of sources.
--
-- ai_suggested is on the theme, not on the assignment: a suggestion is a
-- proposed *name*, and the researcher confirming it is what makes it theirs.
-- The flag survives renaming and re-assignment, so provenance is not lost the
-- first time the researcher tidies the list (Phase 17B SS22).
-- ---------------------------------------------------------------------
create table research_themes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  name text not null,
  description text,
  ai_suggested boolean not null default false,
  -- Confirmation is explicit and separate from the suggestion flag: an
  -- unconfirmed AI suggestion must never be presented as the researcher's own
  -- categorisation.
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

create index research_themes_project_idx on research_themes(project_id);
alter table research_themes add constraint research_themes_id_project_key unique (id, project_id);

-- ---------------------------------------------------------------------
-- research_theme_sources -- which sources sit under which theme.
--
-- A source can belong to several themes; that is the normal case in a
-- literature review, so this is a join table rather than a column on the
-- citation.
-- ---------------------------------------------------------------------
create table research_theme_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  theme_id uuid not null,
  citation_id uuid not null,
  ai_suggested boolean not null default false,
  created_at timestamptz not null default now(),
  unique (theme_id, citation_id),

  constraint research_theme_sources_theme_same_project
    foreign key (theme_id, project_id) references research_themes(id, project_id) on delete cascade,
  constraint research_theme_sources_citation_same_project
    foreign key (citation_id, project_id) references research_citations(id, project_id) on delete cascade
);

create index research_theme_sources_theme_idx on research_theme_sources(theme_id);
create index research_theme_sources_project_idx on research_theme_sources(project_id);

-- ---------------------------------------------------------------------
-- research_source_profiles -- the comparable facts about one source.
--
-- One row per source, every field nullable. Null means "not available in
-- source" and the UI renders exactly that (Phase 17B SS20): a comparison table
-- that silently fills a blank cell with a plausible sentence is worse than one
-- with a gap in it, because the reader cannot tell which is which.
--
-- field_provenance records, per field, whether the text was stated by the
-- source, inferred, or typed by the researcher, so an inference can never be
-- read back as a source fact.
-- ---------------------------------------------------------------------
create table research_source_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  citation_id uuid not null,

  population text,
  study_design text,
  sample text,
  variables text,
  main_finding text,
  limitations text,
  relevance text,

  -- {"population": "source_stated", "limitations": "ai_inference", ...}
  field_provenance jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, citation_id),

  constraint research_source_profiles_citation_same_project
    foreign key (citation_id, project_id) references research_citations(id, project_id) on delete cascade
);

create index research_source_profiles_project_idx on research_source_profiles(project_id);

-- ---------------------------------------------------------------------
-- research_gaps -- what the literature does not answer.
--
-- basis is the whole point of the table. A gap a paper states in its own
-- "future work" paragraph and a gap a model inferred from a small sample size
-- are both useful and are not the same claim, and a matrix that renders them
-- identically turns the second into the first (Phase 17B SS24).
--
-- citation_id is nullable: a gap can be an observation across the literature
-- rather than about one study. When it is null the basis must not be
-- 'source_stated', which is enforced below rather than left to the caller.
-- ---------------------------------------------------------------------
create table research_gaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  citation_id uuid,

  gap_text text not null,
  basis text not null default 'needs_verification'
    check (basis in (
      'source_stated',        -- the source says so, in its own words
      'derived_limitation',   -- follows from a limitation the source states
      'ai_inference',         -- a model's reading; never a source fact
      'user_observation',     -- the researcher's own judgement
      'needs_verification'
    )),
  -- The sentence the basis rests on, so a reader can check it without
  -- reopening the paper.
  supporting_text text,
  verified boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint research_gaps_citation_same_project
    foreign key (citation_id, project_id) references research_citations(id, project_id) on delete cascade,
  -- A gap attributed to no source cannot claim a source stated it.
  constraint research_gaps_stated_needs_source
    check (basis <> 'source_stated' or citation_id is not null)
);

create index research_gaps_project_idx on research_gaps(project_id);
create index research_gaps_citation_idx on research_gaps(citation_id);

-- ---------------------------------------------------------------------
-- Version actions gain 'evidence_insert'.
--
-- Phase 17B SS29: the action recorded must be the action performed. Reusing
-- 'insert' for an evidence insertion would make the history say "AI insert"
-- for a change the researcher made by attaching a source they chose, which is
-- the one thing the history exists to keep straight.
-- ---------------------------------------------------------------------
alter table research_section_versions
  drop constraint research_section_versions_action_check;

alter table research_section_versions
  add constraint research_section_versions_action_check
  check (action in (
    'manual', 'insert', 'replace', 'append', 'ai_generate', 'restore', 'evidence_insert'
  ));

-- ---------------------------------------------------------------------
-- RLS -- same rule as every other project-scoped table.
-- ---------------------------------------------------------------------
alter table research_themes enable row level security;
alter table research_theme_sources enable row level security;
alter table research_source_profiles enable row level security;
alter table research_gaps enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'research_themes', 'research_theme_sources', 'research_source_profiles', 'research_gaps'
  ]
  loop
    execute format($f$
      create policy "own project rows are selectable" on %I for select
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
      create policy "own project rows are insertable" on %I for insert
      with check (exists (select 1 from research_projects p
                          where p.id = %I.project_id and p.user_id = auth.uid()));
      create policy "own project rows are updatable" on %I for update
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
      create policy "own project rows are deletable" on %I for delete
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
    $f$, t, t, t, t, t, t, t, t);
  end loop;
end $$;

grant select, insert, update, delete on research_themes to authenticated;
grant select, insert, update, delete on research_theme_sources to authenticated;
grant select, insert, update, delete on research_source_profiles to authenticated;
grant select, insert, update, delete on research_gaps to authenticated;
