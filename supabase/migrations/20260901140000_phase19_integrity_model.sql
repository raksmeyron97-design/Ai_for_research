-- Phase 19: research integrity connective layer.
--
-- Phase 17/17B built the chain Source -> Evidence -> Claim -> Citation ->
-- Section. Phase 18 built the chain Question -> Objective -> Construct ->
-- Indicator -> Questionnaire Item -> Hypothesis. Neither phase connects a
-- manuscript claim to the methodology graph, and nothing yet records a
-- researcher's disposition of a derived finding, or an audit trail of
-- integrity-specific actions. This migration adds exactly those three
-- things and nothing else: findings themselves stay fully derived, computed
-- fresh on every review, never stored as a source of truth.
--
-- Same two rules as every phase since 17: project_id on every row, and
-- composite foreign keys carrying project_id into every reference, so a row
-- cannot point at another project's parent even if a policy were wrong.

-- ---------------------------------------------------------------------
-- research_citations gains PMID and ISBN.
--
-- Both are 1:1 with a work exactly like DOI already is, so they're columns
-- on the same row, not a new table. ORCID is different in kind -- it
-- identifies a person, and `authors` is a bare text[] with no per-author row
-- to attach an id to -- so Phase 19 ships a format validator for ORCID in
-- application code and does not persist it here.
-- ---------------------------------------------------------------------
alter table research_citations
  add column pmid text,
  add column isbn text;

-- ---------------------------------------------------------------------
-- research_claim_methodology_links -- a claim, traced to the methodology
-- node it is about.
--
-- Nullable composite FKs, one per possible target, exactly the shape
-- Phase 18 already used for questionnaire_questions -> construct_id /
-- indicator_id / scale_id. A polymorphic (entity_type, entity_id) pair was
-- the alternative, but that pattern exists elsewhere (methodology_events)
-- specifically because an audit log must survive the deletion of what it
-- describes -- a live link should keep real referential integrity instead.
-- ---------------------------------------------------------------------
create table research_claim_methodology_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  claim_id uuid not null,

  construct_id uuid,
  hypothesis_id uuid,
  indicator_id uuid,
  objective_id uuid,
  question_id uuid,

  note text,
  created_at timestamptz not null default now(),

  constraint research_claim_methodology_links_claim_same_project
    foreign key (claim_id, project_id) references research_claims(id, project_id) on delete cascade,
  constraint research_claim_methodology_links_construct_same_project
    foreign key (construct_id, project_id) references research_constructs(id, project_id) on delete cascade,
  constraint research_claim_methodology_links_hypothesis_same_project
    foreign key (hypothesis_id, project_id) references research_hypotheses(id, project_id) on delete cascade,
  constraint research_claim_methodology_links_indicator_same_project
    foreign key (indicator_id, project_id) references research_indicators(id, project_id) on delete cascade,
  constraint research_claim_methodology_links_objective_same_project
    foreign key (objective_id, project_id) references research_objectives(id, project_id) on delete cascade,
  constraint research_claim_methodology_links_question_same_project
    foreign key (question_id, project_id) references research_questions(id, project_id) on delete cascade,

  -- Exactly one target: a link that names two nodes at once is ambiguous
  -- about which one the claim is actually about.
  constraint research_claim_methodology_links_one_target check (
    (case when construct_id is not null then 1 else 0 end) +
    (case when hypothesis_id is not null then 1 else 0 end) +
    (case when indicator_id is not null then 1 else 0 end) +
    (case when objective_id is not null then 1 else 0 end) +
    (case when question_id is not null then 1 else 0 end) = 1
  ),

  unique (claim_id, construct_id, hypothesis_id, indicator_id, objective_id, question_id)
);

create index research_claim_methodology_links_project_idx on research_claim_methodology_links(project_id);
create index research_claim_methodology_links_claim_idx on research_claim_methodology_links(claim_id);
create index research_claim_methodology_links_construct_idx on research_claim_methodology_links(construct_id);
create index research_claim_methodology_links_hypothesis_idx on research_claim_methodology_links(hypothesis_id);
create index research_claim_methodology_links_indicator_idx on research_claim_methodology_links(indicator_id);
create index research_claim_methodology_links_objective_idx on research_claim_methodology_links(objective_id);
create index research_claim_methodology_links_question_idx on research_claim_methodology_links(question_id);

-- ---------------------------------------------------------------------
-- research_integrity_decisions -- the one genuinely stateful thing here.
--
-- Findings are always derived and have no stable database row -- a finding
-- id is a computed string, the same way MethodologyFinding.id already is.
-- But a researcher's disposition of a finding ("I looked at this, it's
-- fine") must survive the next recompute, or dismissing a finding would be
-- pointless. This table is that mutable state, keyed on the finding's own
-- stable id rather than a foreign key, because the finding itself is never
-- a row.
-- ---------------------------------------------------------------------
create table research_integrity_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  finding_id text not null,
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'accepted', 'dismissed', 'resolved_manually')),
  note text,
  actor_id uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, finding_id)
);

create index research_integrity_decisions_project_idx on research_integrity_decisions(project_id);
create trigger research_integrity_decisions_set_updated_at
  before update on research_integrity_decisions for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_integrity_events -- append-only audit, same shape as
-- methodology_events.
--
-- entity_id is deliberately NOT a foreign key for the same reason it isn't
-- one on methodology_events: history must survive the deletion of the thing
-- it describes.
-- ---------------------------------------------------------------------
create table research_integrity_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  entity_type text not null
    check (entity_type in (
      'claim', 'citation', 'evidence', 'source', 'reference', 'methodology', 'finding', 'review'
    )),
  entity_id uuid,

  action text not null
    check (action in (
      'integrity_review', 'finding_reviewed', 'finding_dismissed', 'citation_changed',
      'evidence_linked', 'claim_reclassified', 'reference_merged', 'reference_unmerged'
    )),
  summary text not null,
  proposal jsonb,
  previous_value jsonb,
  new_value jsonb,

  created_at timestamptz not null default now()
);

create index research_integrity_events_project_idx on research_integrity_events(project_id, created_at desc);
create index research_integrity_events_entity_idx on research_integrity_events(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- RLS -- same rule as every other project-scoped table.
-- ---------------------------------------------------------------------
alter table research_claim_methodology_links enable row level security;
alter table research_integrity_decisions enable row level security;
alter table research_integrity_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'research_claim_methodology_links', 'research_integrity_decisions', 'research_integrity_events'
  ]
  loop
    execute format($f$
      create policy "own project rows are selectable" on %I for select
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
      create policy "own project rows are insertable" on %I for insert
      with check (exists (select 1 from research_projects p
                          where p.id = %I.project_id and p.user_id = auth.uid()));
    $f$, t, t, t, t);
  end loop;
end $$;

-- Update and delete policies only for the two editable/mutable tables --
-- research_integrity_events stays append-only.
do $$
declare t text;
begin
  foreach t in array array[
    'research_claim_methodology_links', 'research_integrity_decisions'
  ]
  loop
    execute format($f$
      create policy "own project rows are updatable" on %I for update
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
      create policy "own project rows are deletable" on %I for delete
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
    $f$, t, t, t, t);
  end loop;
end $$;

grant select, insert, update, delete on
  research_claim_methodology_links, research_integrity_decisions
  to authenticated;

-- research_integrity_events is append-only, and saying so is not enough --
-- see the identical note on methodology_events. Phase 3's
-- `alter default privileges` grants update/delete on every new table by
-- default; the revoke here makes an attempt fail loudly instead of
-- silently succeeding as a no-op nobody notices.
grant select, insert on research_integrity_events to authenticated;
revoke update, delete, truncate on research_integrity_events from authenticated;
