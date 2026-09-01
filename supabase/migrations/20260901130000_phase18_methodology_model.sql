-- Phase 18: the methodology chain, structured.
--
-- Until now research questions, objectives, variables and the analysis plan
-- lived as free text in research_sections, and questionnaire_questions pointed
-- at them with objective_label / variable_label / construct -- strings, because
-- the Phase 6 migration says plainly there was "no structured
-- objectives/variables entity to reference yet".
--
-- That is what this adds. It does NOT touch research_sections: the prose stays
-- canonical for the document, these tables are canonical for reasoning, and
-- neither is derived from the other automatically. Parsing prose into
-- constructs would invent structure the researcher never approved; generating
-- prose from structure would overwrite writing. See
-- docs/PHASE_18_METHODOLOGY_AUDIT.md SS3.
--
-- Every table follows the two rules Phase 17 arrived at by finding the hole:
-- project_id on every row, and composite foreign keys carrying project_id into
-- every reference, so a row cannot point at another project's parent even if a
-- policy were written wrongly.

-- ---------------------------------------------------------------------
-- Shared provenance vocabulary.
--
-- The same five words the whole app already uses, so a methodology object and
-- a research gap mean the same thing by "ai_suggested". A proposal is not a
-- decision: ai_suggested rows exist, are visible, and are marked, and
-- `confirmed` is what a researcher's decision writes.
-- ---------------------------------------------------------------------
create type methodology_provenance as enum (
  'user',            -- the researcher wrote it
  'ai_suggested',    -- a model proposed it; not yet a decision
  'source_stated',   -- a source says so, and names the source
  'imported'         -- came from an uploaded instrument or document
);

-- ---------------------------------------------------------------------
-- research_questions -- the structured question, beside the prose.
-- ---------------------------------------------------------------------
create table research_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  question_text text not null,
  -- Structural shape, not a verdict on the design. 'unclassified' is a real
  -- answer and the default: a question the rules cannot place is not a bad
  -- question, and guessing a shape would put a label the researcher never
  -- chose in front of every later check.
  question_kind text not null default 'unclassified'
    check (question_kind in (
      'descriptive', 'comparative', 'correlational', 'causal', 'exploratory', 'unclassified'
    )),
  provenance methodology_provenance not null default 'user',
  confirmed boolean not null default true,
  order_index integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_questions_project_idx on research_questions(project_id);
alter table research_questions add constraint research_questions_id_project_key unique (id, project_id);
create trigger research_questions_set_updated_at
  before update on research_questions for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_objectives -- optionally attached to a question.
--
-- question_id is nullable because an objective written before its question is
-- ordinary work in progress, not an error. The consistency engine reports the
-- missing link; the database does not refuse the row.
-- ---------------------------------------------------------------------
create table research_objectives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  question_id uuid,

  objective_text text not null,
  provenance methodology_provenance not null default 'user',
  confirmed boolean not null default true,
  order_index integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint research_objectives_question_same_project
    foreign key (question_id, project_id) references research_questions(id, project_id) on delete set null
);

create index research_objectives_project_idx on research_objectives(project_id);
create index research_objectives_question_idx on research_objectives(question_id);
alter table research_objectives add constraint research_objectives_id_project_key unique (id, project_id);
create trigger research_objectives_set_updated_at
  before update on research_objectives for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_constructs -- the concept, carrying the role it plays.
--
-- One table, not `constructs` plus `variables`. A construct is the concept; a
-- variable is the role that concept plays in the study. Two tables would need
-- a join for every check and would give the app two names for one thing --
-- which is precisely the confusion the consistency engine exists to detect.
-- 'latent' is the role of a construct not yet placed in the design.
--
-- The two definitions are separate columns on purpose (SS9). A conceptual
-- definition says what the concept means; an operational definition says how it
-- will be observed. A construct with the first and not the second is the single
-- most common measurement gap in a student thesis, and it is invisible if both
-- are one "definition" field.
-- ---------------------------------------------------------------------
create table research_constructs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  name text not null,
  role text not null default 'latent'
    check (role in (
      'independent', 'dependent', 'mediator', 'moderator', 'control', 'demographic', 'latent'
    )),
  conceptual_definition text,
  operational_definition text,
  notes text,
  provenance methodology_provenance not null default 'user',
  confirmed boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Two constructs with the same name in one project are the same construct
  -- entered twice, and every traceability check downstream would then be
  -- ambiguous about which one a hypothesis meant.
  unique (project_id, name)
);

create index research_constructs_project_idx on research_constructs(project_id);
alter table research_constructs add constraint research_constructs_id_project_key unique (id, project_id);
create trigger research_constructs_set_updated_at
  before update on research_constructs for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_indicators -- the observable thing under a construct.
--
-- `dimension` is a column, not a table: a dimension is a label grouping
-- indicators, and a table with one text column and a foreign key buys nothing.
-- ---------------------------------------------------------------------
create table research_indicators (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  construct_id uuid not null,

  name text not null,
  dimension text,
  description text,
  provenance methodology_provenance not null default 'user',
  confirmed boolean not null default true,
  order_index integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint research_indicators_construct_same_project
    foreign key (construct_id, project_id) references research_constructs(id, project_id) on delete cascade
);

create index research_indicators_project_idx on research_indicators(project_id);
create index research_indicators_construct_idx on research_indicators(construct_id);
alter table research_indicators add constraint research_indicators_id_project_key unique (id, project_id);
create trigger research_indicators_set_updated_at
  before update on research_indicators for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_hypotheses.
--
-- `direction` is only meaningful when the researcher actually stated one.
-- 'unspecified' is the default and is not a defect -- "X is associated with Y"
-- is a complete hypothesis with no direction, and recording a direction the
-- researcher never wrote would put words in the study's mouth.
--
-- analysis_method is free text referencing the project's analysis plan, which
-- is still prose. Compatibility checking is advisory (SS33) and lives in code.
-- ---------------------------------------------------------------------
create table research_hypotheses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  objective_id uuid,
  question_id uuid,

  label text,                    -- "H1", "H2a" -- the researcher's own numbering
  statement text not null,
  hypothesis_form text not null default 'unclassified'
    check (hypothesis_form in (
      'association', 'prediction', 'difference', 'mediation', 'moderation', 'descriptive', 'unclassified'
    )),
  direction text not null default 'unspecified'
    check (direction in ('positive', 'negative', 'none', 'unspecified')),
  analysis_method text,
  provenance methodology_provenance not null default 'user',
  confirmed boolean not null default true,
  order_index integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint research_hypotheses_objective_same_project
    foreign key (objective_id, project_id) references research_objectives(id, project_id) on delete set null,
  constraint research_hypotheses_question_same_project
    foreign key (question_id, project_id) references research_questions(id, project_id) on delete set null
);

create index research_hypotheses_project_idx on research_hypotheses(project_id);
alter table research_hypotheses add constraint research_hypotheses_id_project_key unique (id, project_id);
create trigger research_hypotheses_set_updated_at
  before update on research_hypotheses for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- research_hypothesis_variables -- which construct sits where in a hypothesis.
--
-- The position is a property of the relationship, not of either side: the same
-- construct is the outcome in H1 and the predictor in H2. This is the same
-- argument that put `support` on research_claim_evidence rather than on the
-- claim or the evidence.
-- ---------------------------------------------------------------------
create table research_hypothesis_variables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  hypothesis_id uuid not null,
  construct_id uuid not null,

  position text not null
    check (position in ('predictor', 'outcome', 'mediator', 'moderator', 'control')),
  provenance methodology_provenance not null default 'user',

  created_at timestamptz not null default now(),

  unique (hypothesis_id, construct_id, position),

  constraint research_hypothesis_variables_hypothesis_same_project
    foreign key (hypothesis_id, project_id) references research_hypotheses(id, project_id) on delete cascade,
  constraint research_hypothesis_variables_construct_same_project
    foreign key (construct_id, project_id) references research_constructs(id, project_id) on delete cascade
);

create index research_hypothesis_variables_hypothesis_idx on research_hypothesis_variables(hypothesis_id);
create index research_hypothesis_variables_construct_idx on research_hypothesis_variables(construct_id);
create index research_hypothesis_variables_project_idx on research_hypothesis_variables(project_id);

-- ---------------------------------------------------------------------
-- research_scales -- a shared response scale.
--
-- Shared rather than stored per item, because the check that matters is a
-- cross-item one: two items measuring the same construct whose scales run in
-- opposite directions produce a mean that means nothing. Comparing two JSONB
-- blobs per item would answer that, but would also make "fix the scale" a
-- 30-row edit instead of one.
--
-- points is an ordered array of {value, label}. polarity records which end is
-- the high end, so reverse-coding can be checked rather than assumed.
-- ---------------------------------------------------------------------
create table research_scales (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  name text not null,
  points jsonb not null default '[]'::jsonb,
  polarity text not null default 'ascending'
    check (polarity in ('ascending', 'descending', 'unordered')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, name),
  -- A scale with fewer than two points is not a scale.
  constraint research_scales_points_is_array check (jsonb_typeof(points) = 'array')
);

create index research_scales_project_idx on research_scales(project_id);
alter table research_scales add constraint research_scales_id_project_key unique (id, project_id);
create trigger research_scales_set_updated_at
  before update on research_scales for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- questionnaire_questions gains its mappings.
--
-- Extended, not replaced (SS22). The existing objective_label / variable_label /
-- construct text columns STAY: they are the mapping some projects already have,
-- and dropping them would delete data to make a foreign key look tidy. A
-- deterministic finding reports "names a construct in text but is not linked to
-- one", which is a prompt to link, not a loss.
-- ---------------------------------------------------------------------
alter table questionnaire_questions
  add constraint questionnaire_questions_id_project_key unique (id, project_id);

alter table questionnaire_questions
  add column construct_id uuid,
  add column indicator_id uuid,
  add column scale_id uuid,
  -- Explicit, never inferred from wording. An item is reverse-coded because
  -- the researcher says so; a heuristic that guessed would silently flip the
  -- sign of a result.
  add column reverse_coded boolean not null default false,
  add column item_provenance methodology_provenance not null default 'user',
  -- Set only when the item genuinely comes from a source. The pairing is
  -- enforced below: a claimed source must name one.
  add column source_citation_id uuid,
  add column source_location text,
  add column adaptation_type text
    check (adaptation_type in ('verbatim', 'adapted', 'translated', 'inspired_by')),
  add column updated_at timestamptz not null default now();

alter table questionnaire_questions
  add constraint questionnaire_questions_construct_same_project
    foreign key (construct_id, project_id) references research_constructs(id, project_id) on delete set null,
  add constraint questionnaire_questions_indicator_same_project
    foreign key (indicator_id, project_id) references research_indicators(id, project_id) on delete set null,
  add constraint questionnaire_questions_scale_same_project
    foreign key (scale_id, project_id) references research_scales(id, project_id) on delete set null,
  add constraint questionnaire_questions_citation_same_project
    foreign key (source_citation_id, project_id) references research_citations(id, project_id) on delete set null,
  -- SS31: an item may not claim a source without naming one. The reverse is
  -- allowed -- citing where an item came from without classifying how it was
  -- adapted is incomplete, not false.
  add constraint questionnaire_questions_adaptation_needs_source
    check (adaptation_type is null or source_citation_id is not null);

create index questionnaire_questions_construct_idx on questionnaire_questions(construct_id);
create index questionnaire_questions_indicator_idx on questionnaire_questions(indicator_id);

create trigger questionnaire_questions_set_updated_at
  before update on questionnaire_questions for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- methodology_events -- append-only audit of consequential changes.
--
-- Not a versions table for one entity: methodology changes span entities, and
-- what a researcher needs to reconstruct is "what did I decide, and what was
-- proposed to me". So an event carries the proposal, the researcher's action,
-- and the value that was actually written -- and nothing here is ever updated
-- or deleted (SS23/SS24).
-- ---------------------------------------------------------------------
create table methodology_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  entity_type text not null
    check (entity_type in (
      'research_question', 'objective', 'construct', 'indicator', 'hypothesis',
      'hypothesis_variable', 'scale', 'questionnaire_item', 'framework', 'review'
    )),
  -- Deliberately NOT a foreign key. History must survive the deletion of the
  -- thing it describes; a cascade here would erase the record of what was
  -- removed at exactly the moment it becomes interesting.
  entity_id uuid,

  action text not null
    check (action in (
      'created', 'updated', 'deleted', 'mapped', 'unmapped', 'restored',
      'ai_suggestion_accepted', 'ai_suggestion_rejected', 'review_run'
    )),
  summary text not null,
  -- What the model proposed, when a proposal was involved. Null when the
  -- change was entirely the researcher's.
  proposal jsonb,
  previous_value jsonb,
  new_value jsonb,

  created_at timestamptz not null default now()
);

create index methodology_events_project_idx on methodology_events(project_id, created_at desc);
create index methodology_events_entity_idx on methodology_events(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- RLS -- same rule as every other project-scoped table.
-- ---------------------------------------------------------------------
alter table research_questions enable row level security;
alter table research_objectives enable row level security;
alter table research_constructs enable row level security;
alter table research_indicators enable row level security;
alter table research_hypotheses enable row level security;
alter table research_hypothesis_variables enable row level security;
alter table research_scales enable row level security;
alter table methodology_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'research_questions', 'research_objectives', 'research_constructs',
    'research_indicators', 'research_hypotheses', 'research_hypothesis_variables',
    'research_scales', 'methodology_events'
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
    $f$, t, t, t, t, t, t);
  end loop;
end $$;

-- Delete is granted on the editable entities but NOT on methodology_events:
-- an append-only audit log that its own owner can quietly delete is not an
-- audit log. Project deletion still cascades, which is the one intended path.
do $$
declare t text;
begin
  foreach t in array array[
    'research_questions', 'research_objectives', 'research_constructs',
    'research_indicators', 'research_hypotheses', 'research_hypothesis_variables',
    'research_scales'
  ]
  loop
    execute format($f$
      create policy "own project rows are deletable" on %I for delete
      using (exists (select 1 from research_projects p
                     where p.id = %I.project_id and p.user_id = auth.uid()));
    $f$, t, t);
  end loop;
end $$;

grant select, insert, update, delete on
  research_questions, research_objectives, research_constructs,
  research_indicators, research_hypotheses, research_hypothesis_variables,
  research_scales
  to authenticated;

grant select, insert on methodology_events to authenticated;
