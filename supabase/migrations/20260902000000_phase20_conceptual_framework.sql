-- Phase 20: the conceptual framework, bound to canonical constructs.
--
-- Phase 17 created `research_frameworks`: one row per project holding the
-- whole diagram as a `graph` jsonb blob of {nodes, edges} with free-text
-- labels. The Phase 20 audit found that table has never been read or written
-- by application code -- there is no route, no db module and no UI for it,
-- and `validateFramework()` in src/lib/evidence/framework-validation.ts is
-- reachable only from its own test. The diagram a researcher actually has is
-- the prose in the `conceptual_framework` section.
--
-- So the framework is not being "migrated" here so much as connected, and the
-- point of connecting it is §5: a framework node should name a canonical
-- Phase 18 construct rather than repeat its name as a string. A node that
-- says "Teacher Motivation" as text and a construct called "Teacher
-- Motivation" are two sources of truth for one concept, and every consistency
-- check between them is then string comparison -- which is exactly what
-- Phase 18 built `research_constructs` to stop doing.
--
-- The legacy jsonb table is left completely alone. §40: existing free-text
-- nodes must not be silently mapped onto constructs by name similarity, so
-- nothing is copied across. A project's legacy graph stays readable where it
-- is, and the researcher maps it deliberately or not at all.
--
-- Same two rules as every table since Phase 17: project_id on every row, and
-- composite foreign keys carrying project_id into every reference, so a row
-- cannot point at another project's construct even if a policy were wrong.

-- ---------------------------------------------------------------------
-- research_framework_nodes -- a position in the diagram, naming a construct.
--
-- There is deliberately no `role` column. The role a concept plays
-- (independent, dependent, mediator, ...) is already on research_constructs,
-- and copying it here would create the second source of truth this migration
-- exists to remove: the node's role and the construct's role could then
-- disagree, and nothing would say which one the study meant. Role is read
-- through construct_id.
--
-- construct_id is nullable, and `label` survives beside it, for two honest
-- states rather than one:
--   * construct_id set                  -- canonical, checkable
--   * construct_id null, label set      -- unmapped; a legacy or in-progress
--                                          node awaiting researcher decision
-- The check constraint requires at least one, so a node is always
-- identifiable as something.
--
-- on delete set null, not cascade: deleting a construct must not silently
-- delete the researcher's diagram node. The node survives as unmapped and
-- the validation engine reports it, which is the visible outcome §8 asks for.
-- ---------------------------------------------------------------------
create table research_framework_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  construct_id uuid,
  -- Presentation text. Kept when a construct is linked so a legacy node's
  -- original wording is not lost by mapping it, but the construct's name is
  -- what every check reads.
  label text,

  -- Layout only (§10). Coordinates are presentation data and no check,
  -- finding or metric may read them -- moving a box must not change what the
  -- study claims.
  position_x integer not null default 0,
  position_y integer not null default 0,

  provenance methodology_provenance not null default 'user',
  -- False while an AI proposal is still awaiting the researcher (§11).
  confirmed boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint research_framework_nodes_identifiable
    check (construct_id is not null or (label is not null and length(btrim(label)) > 0)),

  constraint research_framework_nodes_construct_same_project
    -- The column list matters. A bare `on delete set null` on a composite key
    -- nulls *every* referencing column, project_id included -- and project_id
    -- is not null, so deleting a construct would fail outright instead of
    -- unmapping the node. Phases 17 and 18 both carry that bug; the next
    -- migration repairs them.
    foreign key (construct_id, project_id) references research_constructs(id, project_id)
      on delete set null (construct_id)
);

create index research_framework_nodes_project_idx on research_framework_nodes(project_id);
create index research_framework_nodes_construct_idx on research_framework_nodes(construct_id);
alter table research_framework_nodes add constraint research_framework_nodes_id_project_key unique (id, project_id);
create trigger research_framework_nodes_set_updated_at
  before update on research_framework_nodes for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Deleting a construct must leave a node the researcher can still recognise.
--
-- The two rules above interact: `on delete set null (construct_id)` unmaps
-- the node, but a node created straight from a construct has no `label`, and
-- the identifiable check then refuses the row -- so the construct could not
-- be deleted at all.
--
-- Filling the label from the construct on the way out fixes that and is the
-- better behaviour anyway: the diagram keeps a box reading "Teacher
-- motivation", marked unmapped, instead of losing the position and the
-- relationships the researcher drew around it. The label is last-known
-- display text and never authoritative -- `resolveNodes()` reads the
-- construct's name whenever one is linked -- so this does not reintroduce the
-- second source of truth the table exists to avoid.
--
-- BEFORE DELETE on the parent runs ahead of the foreign key's own action,
-- which is what makes the label present by the time the check is evaluated.
-- ---------------------------------------------------------------------
create function framework_node_keep_label_on_construct_delete()
returns trigger
language plpgsql
as $$
begin
  update research_framework_nodes
     set label = old.name
   where construct_id = old.id
     and project_id = old.project_id
     and (label is null or length(btrim(label)) = 0);
  return old;
end;
$$;

create trigger research_constructs_keep_framework_label
  before delete on research_constructs
  for each row execute function framework_node_keep_label_on_construct_delete();

-- One node per construct. "Duplicate construct nodes" is listed in §9 as a
-- thing to detect, but a duplicate that the database refuses cannot occur in
-- the first place, and a constraint is a better guarantee than a check that
-- runs after the fact. Partial, so any number of unmapped nodes may coexist --
-- two legacy boxes both reading "motivation" are exactly the ambiguity a
-- researcher has to resolve by hand, and the database has no basis to call
-- them the same thing.
create unique index research_framework_nodes_one_per_construct
  on research_framework_nodes(project_id, construct_id)
  where construct_id is not null;

-- ---------------------------------------------------------------------
-- research_framework_relationships -- a directed, typed edge.
--
-- relation_type is constrained to the six words in §7 and no more. The
-- vocabulary is deliberately not richer than the methodology model can
-- justify: 'mediates' and 'moderates' correspond to construct roles Phase 18
-- already stores, 'predicts'/'influences' correspond to the directional
-- hypotheses it stores, and 'associated_with' is the non-directional default
-- for a relationship the researcher does not want to overclaim.
--
-- hypothesis_id hangs off the relationship rather than off either node,
-- because a hypothesis is a statement *about a pair* of constructs. Putting
-- it on a node would say "this construct has a hypothesis", which is not a
-- claim anyone makes. This is the same shape as
-- research_hypothesis_variables (a position held by a link, not by a
-- construct) and research_claim_evidence (support held by the link).
--
-- on delete set null for the hypothesis: deleting a hypothesis must leave the
-- drawn relationship in place and merely unlink it, so the researcher sees a
-- relationship that lost its justification instead of a diagram that quietly
-- changed shape.
-- ---------------------------------------------------------------------
create table research_framework_relationships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,

  from_node_id uuid not null,
  to_node_id uuid not null,

  relation_type text not null default 'associated_with'
    check (relation_type in (
      'predicts', 'influences', 'mediates', 'moderates', 'associated_with', 'supports'
    )),

  hypothesis_id uuid,
  rationale text,

  provenance methodology_provenance not null default 'user',
  confirmed boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- §9 lists self-referential relationships as something to detect. Refusing
  -- them is better than detecting them: there is no reading of "A predicts A"
  -- that a researcher meant to record.
  constraint research_framework_relationships_no_self_loop
    check (from_node_id <> to_node_id),

  -- Cascade on the endpoints. A relationship whose node is gone is not
  -- information to preserve -- it is the dangling edge §9 wants prevented --
  -- and methodology_events keeps the record that it existed.
  constraint research_framework_relationships_from_same_project
    foreign key (from_node_id, project_id) references research_framework_nodes(id, project_id) on delete cascade,
  constraint research_framework_relationships_to_same_project
    foreign key (to_node_id, project_id) references research_framework_nodes(id, project_id) on delete cascade,
  constraint research_framework_relationships_hypothesis_same_project
    foreign key (hypothesis_id, project_id) references research_hypotheses(id, project_id)
      on delete set null (hypothesis_id)
);

create index research_framework_relationships_project_idx on research_framework_relationships(project_id);
create index research_framework_relationships_from_idx on research_framework_relationships(from_node_id);
create index research_framework_relationships_to_idx on research_framework_relationships(to_node_id);
create index research_framework_relationships_hypothesis_idx on research_framework_relationships(hypothesis_id);
alter table research_framework_relationships
  add constraint research_framework_relationships_id_project_key unique (id, project_id);
create trigger research_framework_relationships_set_updated_at
  before update on research_framework_relationships for each row execute function set_updated_at();

-- The same edge drawn twice (§9). Typed, so "A influences B" and "A mediates
-- B" can coexist -- those say different things -- while the same statement
-- cannot be recorded twice.
create unique index research_framework_relationships_unique_edge
  on research_framework_relationships(project_id, from_node_id, to_node_id, relation_type);

-- ---------------------------------------------------------------------
-- methodology_events gains the two framework entity types.
--
-- Reused rather than replaced. Phase 18 already put 'framework' in this
-- enum and already has 'mapped'/'unmapped' actions, and a separate
-- framework_events table would be a second audit log for the same project --
-- the researcher would then have to look in two places to reconstruct one
-- afternoon's decisions. The table stays append-only: no update or delete
-- policy, and Phase 18's explicit revoke still stands.
-- ---------------------------------------------------------------------
alter table methodology_events drop constraint methodology_events_entity_type_check;

alter table methodology_events add constraint methodology_events_entity_type_check
  check (entity_type in (
    'research_question', 'objective', 'construct', 'indicator', 'hypothesis',
    'hypothesis_variable', 'scale', 'questionnaire_item', 'framework', 'review',
    'framework_node', 'framework_relationship'
  ));

-- ---------------------------------------------------------------------
-- RLS -- same rule as every other project-scoped table.
-- ---------------------------------------------------------------------
alter table research_framework_nodes enable row level security;
alter table research_framework_relationships enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'research_framework_nodes', 'research_framework_relationships'
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

grant select, insert, update, delete on
  research_framework_nodes, research_framework_relationships
  to authenticated;
