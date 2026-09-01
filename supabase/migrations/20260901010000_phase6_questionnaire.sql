-- Phase 6: Questionnaire Builder — instruments + mapped questions.
--
-- Objectives/variables are NOT normalized into their own tables here —
-- they still live as free text in research_sections (section_type
-- 'objectives'/'variables', a Phase 2 scoping decision). Each question
-- below maps to an objective/variable/construct as descriptive text
-- (objective_label/variable_label), not a foreign key, because there is
-- no structured objectives/variables entity to reference yet. This is
-- honest to the current state of the app rather than adding foreign
-- keys to rows that don't exist — see docs/AI_QUESTIONNAIRE_BUILDER.md.

create table research_instruments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  name text not null,
  -- Section 26 (Validated Instrument Safety): never claim a tool is
  -- validated without evidence. Enforced two ways: the CHECK constraint
  -- below requires a source_reference for anything other than
  -- researcher_developed, and the generator's prompt (Section 26) is
  -- told to default to researcher_developed unless a real named
  -- instrument is actually being adapted.
  validation_status text not null default 'researcher_developed'
    check (validation_status in ('validated', 'adapted', 'researcher_developed')),
  source_reference text,
  adaptation_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint source_reference_required_unless_researcher_developed
    check (validation_status = 'researcher_developed' or source_reference is not null)
);

create index research_instruments_project_id_idx on research_instruments(project_id);

create trigger research_instruments_set_updated_at
  before update on research_instruments
  for each row execute function set_updated_at();

create table questionnaire_questions (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references research_instruments(id) on delete cascade,
  -- Denormalized (same reasoning as document_chunks.project_id in
  -- Phase 3): RLS and every query here filter by project, never need a
  -- join through research_instruments to get there.
  project_id uuid not null references research_projects(id) on delete cascade,

  section_label text not null,
  objective_label text,
  variable_label text,
  construct text,
  question_text text not null,
  response_type text not null
    check (response_type in ('likert', 'multiple_choice', 'yes_no', 'open_text', 'numeric')),
  -- Only meaningful for multiple_choice/likert; null otherwise.
  options jsonb,
  required boolean not null default true,
  order_index integer not null,

  created_at timestamptz not null default now()
);

create index questionnaire_questions_instrument_id_idx on questionnaire_questions(instrument_id);
create index questionnaire_questions_project_id_idx on questionnaire_questions(project_id);

grant select, insert, update, delete on research_instruments, questionnaire_questions to authenticated;
