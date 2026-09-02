-- Phase 20: project isolation for the conceptual-framework tables, verified
-- against real Postgres and real RLS rather than against a mock.
--
-- The same two things a mocked test cannot check, which every isolation suite
-- since Phase 17 exists to check:
--
--   * RLS is a database feature. An in-memory fake returns whatever it is
--     asked for.
--   * The composite foreign keys are the barrier RLS does not provide. Its
--     policies check the row's OWN project_id, so a node honestly labelled
--     with the attacker's project but pointing at a victim's construct passes
--     every policy. Only the composite key can refuse it.
--
-- Phase 20 adds a third thing to check, because §9 is answered by constraints
-- rather than by application code: the migration claims the database itself
-- refuses self-loops, duplicate edges and duplicate construct nodes. A claim
-- like that is worth exactly as much as its test, so each one is attempted
-- here as the owner, in its own project, where RLS is not what stops it.
--
-- Run with:
--
--   npm run db:verify:isolation:20
--
-- Every check prints PASS or FAIL. The whole script runs in a transaction
-- and rolls back, so it leaves no rows behind.

\set ON_ERROR_STOP on
\pset pager off

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','isolation-a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002','isolation-b@test.local')
on conflict do nothing;

insert into research_projects (id, user_id, title, language) values
  ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Project A','en'),
  ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000002','Project B','en');

-- Project A: two constructs, a hypothesis, and a framework drawn over them.
insert into research_constructs (id, project_id, name, role) values
  ('aaaaaaaa-cccc-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','Teacher motivation','independent'),
  ('aaaaaaaa-cccc-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111','Student performance','dependent');

insert into research_hypotheses (id, project_id, label, statement) values
  ('aaaaaaaa-8888-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','H1',
   'Teacher motivation predicts student performance.');

insert into research_framework_nodes (id, project_id, construct_id) values
  ('aaaaaaaa-9999-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-cccc-1111-1111-111111111111'),
  ('aaaaaaaa-9999-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-cccc-2222-2222-222222222222');

insert into research_framework_relationships
  (id, project_id, from_node_id, to_node_id, relation_type, hypothesis_id) values
  ('aaaaaaaa-abcd-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-9999-1111-1111-111111111111','aaaaaaaa-9999-2222-2222-222222222222',
   'predicts','aaaaaaaa-8888-1111-1111-111111111111');

-- Project B needs constructs and nodes of its own, so the cross-project tests
-- fail on the reference under test rather than on a missing parent row.
insert into research_constructs (id, project_id, name, role) values
  ('bbbbbbbb-cccc-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222','B own construct','independent'),
  ('bbbbbbbb-cccc-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222','B other construct','dependent');

insert into research_framework_nodes (id, project_id, construct_id) values
  ('bbbbbbbb-9999-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-cccc-1111-1111-111111111111'),
  ('bbbbbbbb-9999-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-cccc-2222-2222-222222222222');

-- Act as user B, who owns Project B only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n integer;
  failures integer := 0;
begin
  -- ---------------- Reads: none of Project A's framework is visible.
  select count(*) into n from research_framework_nodes
    where project_id = 'aaaaaaaa-1111-1111-1111-111111111111';
  if n = 0 then raise notice 'PASS  B cannot read A framework nodes';
  else raise notice 'FAIL  B read % A framework nodes', n; failures := failures + 1; end if;

  select count(*) into n from research_framework_relationships
    where project_id = 'aaaaaaaa-1111-1111-1111-111111111111';
  if n = 0 then raise notice 'PASS  B cannot read A framework relationships';
  else raise notice 'FAIL  B read % A framework relationships', n; failures := failures + 1; end if;

  -- ---------------- Cross-project references. B labels each row with its own
  -- project -- so every RLS policy passes -- and points it at A's construct,
  -- node or hypothesis. Only the composite foreign key can refuse these.
  begin
    insert into research_framework_nodes (project_id, construct_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-cccc-1111-1111-111111111111');
    raise notice 'FAIL  B linked its own node to A construct';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project node-to-construct link rejected';
  end;

  begin
    insert into research_framework_relationships (project_id, from_node_id, to_node_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-9999-1111-1111-111111111111',
              'bbbbbbbb-9999-1111-1111-111111111111');
    raise notice 'FAIL  B drew a relationship from A node';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project relationship-from-node rejected';
  end;

  begin
    insert into research_framework_relationships (project_id, from_node_id, to_node_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-1111-1111-111111111111',
              'aaaaaaaa-9999-2222-2222-222222222222');
    raise notice 'FAIL  B drew a relationship to A node';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project relationship-to-node rejected';
  end;

  begin
    insert into research_framework_relationships
      (project_id, from_node_id, to_node_id, hypothesis_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-1111-1111-111111111111',
              'bbbbbbbb-9999-2222-2222-222222222222','aaaaaaaa-8888-1111-1111-111111111111');
    raise notice 'FAIL  B justified its own relationship with A hypothesis';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project relationship-to-hypothesis rejected';
  end;

  -- ---------------- B cannot write into A's project at all.
  begin
    insert into research_framework_nodes (project_id, label)
      values ('aaaaaaaa-1111-1111-1111-111111111111','Planted by B');
    raise notice 'FAIL  B created a node inside project A';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  B cannot create a node inside project A';
  end;

  -- ---------------- Updates and deletes match nothing rather than erroring:
  -- A's rows are invisible. Only the row count tells "blocked" from "applied".
  update research_framework_nodes set position_x = 999
    where id = 'aaaaaaaa-9999-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot move A framework node';
  else raise notice 'FAIL  B moved % A node(s)', n; failures := failures + 1; end if;

  update research_framework_nodes set construct_id = null
    where id = 'aaaaaaaa-9999-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot unlink A node from its construct';
  else raise notice 'FAIL  B unlinked % A node(s)', n; failures := failures + 1; end if;

  update research_framework_relationships set relation_type = 'moderates'
    where id = 'aaaaaaaa-abcd-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot change A relationship type';
  else raise notice 'FAIL  B changed % A relationship(s)', n; failures := failures + 1; end if;

  delete from research_framework_relationships
    where id = 'aaaaaaaa-abcd-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot delete A framework relationship';
  else raise notice 'FAIL  B deleted % A relationship(s)', n; failures := failures + 1; end if;

  delete from research_framework_nodes where id = 'aaaaaaaa-9999-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot delete A framework node';
  else raise notice 'FAIL  B deleted % A node(s)', n; failures := failures + 1; end if;

  -- ---------------- §9's structural rules, attempted by the owner inside its
  -- own project, where RLS is not what stops them. The migration says the
  -- database refuses these; this is what makes that a fact rather than a
  -- comment.
  begin
    insert into research_framework_relationships (project_id, from_node_id, to_node_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-1111-1111-111111111111',
              'bbbbbbbb-9999-1111-1111-111111111111');
    raise notice 'FAIL  a self-referential relationship was accepted';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  self-referential relationship rejected';
  end;

  begin
    insert into research_framework_nodes (project_id, construct_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-cccc-1111-1111-111111111111');
    raise notice 'FAIL  a second node for the same construct was accepted';
    failures := failures + 1;
  exception when unique_violation then
    raise notice 'PASS  duplicate construct node rejected';
  end;

  begin
    insert into research_framework_nodes (project_id) values ('bbbbbbbb-2222-2222-2222-222222222222');
    raise notice 'FAIL  a node with neither construct nor label was accepted';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  node with no construct and no label rejected';
  end;

  begin
    insert into research_framework_nodes (project_id, label)
      values ('bbbbbbbb-2222-2222-2222-222222222222','   ');
    raise notice 'FAIL  a node labelled only with whitespace was accepted';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  whitespace-only label rejected';
  end;

  -- Any number of *unmapped* nodes may coexist: two legacy boxes both reading
  -- "motivation" are an ambiguity for the researcher to resolve, and the
  -- database has no basis to call them the same thing (§40).
  begin
    insert into research_framework_nodes (project_id, label) values
      ('bbbbbbbb-2222-2222-2222-222222222222','motivation'),
      ('bbbbbbbb-2222-2222-2222-222222222222','motivation');
    raise notice 'PASS  two unmapped nodes with the same label are allowed';
  exception when others then
    raise notice 'FAIL  unmapped nodes must not be deduplicated by label: %', sqlerrm;
    failures := failures + 1;
  end;

  begin
    insert into research_framework_relationships (project_id, from_node_id, to_node_id, relation_type)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-1111-1111-111111111111',
              'bbbbbbbb-9999-2222-2222-222222222222','predicts');
    insert into research_framework_relationships (project_id, from_node_id, to_node_id, relation_type)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-1111-1111-111111111111',
              'bbbbbbbb-9999-2222-2222-222222222222','predicts');
    raise notice 'FAIL  the same relationship was recorded twice';
    failures := failures + 1;
  exception when unique_violation then
    raise notice 'PASS  duplicate relationship rejected';
  end;

  -- Two *differently typed* edges over the same pair say different things and
  -- must both be allowed.
  begin
    insert into research_framework_relationships (project_id, from_node_id, to_node_id, relation_type)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-1111-1111-111111111111',
              'bbbbbbbb-9999-2222-2222-222222222222','moderates');
    raise notice 'PASS  a differently typed edge over the same pair is allowed';
  exception when others then
    raise notice 'FAIL  a differently typed edge was refused: %', sqlerrm;
    failures := failures + 1;
  end;

  begin
    insert into research_framework_relationships (project_id, from_node_id, to_node_id, relation_type)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-9999-2222-2222-222222222222',
              'bbbbbbbb-9999-1111-1111-111111111111','causes');
    raise notice 'FAIL  a relation type outside the vocabulary was accepted';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  relation type outside the vocabulary rejected';
  end;

  -- ---------------- The framework audit trail is append-only, even for its
  -- owner. Phase 18's revoke has to still cover the two entity types Phase 20
  -- added to it.
  insert into methodology_events (project_id, entity_type, entity_id, action, summary)
    values ('bbbbbbbb-2222-2222-2222-222222222222','framework_node',
            'bbbbbbbb-9999-1111-1111-111111111111','mapped','Linked node to construct');

  begin
    update methodology_events set summary = 'rewritten'
      where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';
    raise notice 'FAIL  the framework audit trail is updatable';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  the framework audit trail cannot be updated';
  end;

  begin
    delete from methodology_events where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';
    raise notice 'FAIL  the framework audit trail is deletable';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  the framework audit trail cannot be deleted';
  end;

  -- ---------------- B can still work normally in its own project.
  begin
    insert into research_framework_nodes (project_id, construct_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-cccc-2222-2222-222222222222')
      on conflict do nothing;
    update research_framework_nodes set position_x = 42
      where id = 'bbbbbbbb-9999-1111-1111-111111111111';
    get diagnostics n = row_count;
    if n = 1 then raise notice 'PASS  B can move a node in its own project';
    else raise notice 'FAIL  B could not move its own node'; failures := failures + 1; end if;
  exception when others then
    raise notice 'FAIL  B could not work in its own project: %', sqlerrm;
    failures := failures + 1;
  end;

  if failures = 0 then
    raise notice '--- ALL PHASE 20 ISOLATION CHECKS PASSED ---';
  else
    raise exception '% isolation check(s) FAILED', failures;
  end if;
end $$;

-- Back to the owner's view: prove A's framework really is untouched, rather
-- than trusting that the blocked writes above were the only ones attempted.
reset role;

do $$
declare
  failures integer := 0;
  x integer;
  linked uuid;
  rel_type text;
begin
  select position_x, construct_id into x, linked from research_framework_nodes
    where id = 'aaaaaaaa-9999-1111-1111-111111111111';
  if x = 0 then raise notice 'PASS  A framework node was not moved';
  else raise notice 'FAIL  A node position is now %', coalesce(x::text,'(deleted)'); failures := failures + 1; end if;

  if linked = 'aaaaaaaa-cccc-1111-1111-111111111111' then
    raise notice 'PASS  A framework node is still linked to its construct';
  else raise notice 'FAIL  A node construct link is now %', coalesce(linked::text,'(null)'); failures := failures + 1; end if;

  select relation_type into rel_type from research_framework_relationships
    where id = 'aaaaaaaa-abcd-1111-1111-111111111111';
  if rel_type = 'predicts' then raise notice 'PASS  A framework relationship survived intact';
  else raise notice 'FAIL  A relationship is now %', coalesce(rel_type,'(deleted)'); failures := failures + 1; end if;

  if failures > 0 then
    raise exception '% owner-side check(s) FAILED', failures;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Deletion behaviour, as the owner. These are design decisions the migration
-- argues for in prose; here they are executed.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
  surviving uuid;
begin
  -- Deleting a construct must NOT delete the researcher's diagram node. The
  -- node survives as unmapped, which is the visible outcome §8 asks for.
  delete from research_constructs where id = 'aaaaaaaa-cccc-1111-1111-111111111111';

  select construct_id into surviving from research_framework_nodes
    where id = 'aaaaaaaa-9999-1111-1111-111111111111';
  select count(*) into n from research_framework_nodes
    where id = 'aaaaaaaa-9999-1111-1111-111111111111';

  if n = 1 and surviving is null then
    raise notice 'PASS  deleting a construct leaves its framework node, unmapped';
  else
    raise exception 'FAIL  deleting a construct removed or kept the node wrongly (n=%, construct=%)', n, surviving;
  end if;

  -- Deleting a hypothesis must leave the drawn relationship in place and
  -- merely unlink it, so the researcher sees a relationship that lost its
  -- justification rather than a diagram that quietly changed shape.
  delete from research_hypotheses where id = 'aaaaaaaa-8888-1111-1111-111111111111';

  select count(*) into n from research_framework_relationships
    where id = 'aaaaaaaa-abcd-1111-1111-111111111111' and hypothesis_id is null;
  if n = 1 then raise notice 'PASS  deleting a hypothesis unlinks but keeps the relationship';
  else raise exception 'FAIL  deleting a hypothesis did not leave an unlinked relationship'; end if;

  -- Deleting a node DOES remove its relationships: a relationship whose
  -- endpoint is gone is the dangling edge §9 wants prevented, not information
  -- to preserve.
  delete from research_framework_nodes where id = 'aaaaaaaa-9999-1111-1111-111111111111';
  select count(*) into n from research_framework_relationships
    where id = 'aaaaaaaa-abcd-1111-1111-111111111111';
  if n = 0 then raise notice 'PASS  deleting a node removes its relationships';
  else raise exception 'FAIL  a relationship survived the deletion of its endpoint'; end if;

  raise notice '--- ALL PHASE 20 DELETION CHECKS PASSED ---';
end $$;

-- ---------------------------------------------------------------------
-- The repaired Phase 17/18 composite foreign keys.
--
-- These are not framework tables, but this is the suite that found the bug,
-- so this is where it stays tested. Before
-- 20260902000100_phase20_composite_fk_set_null_repair.sql every one of these
-- deletes raised `null value in column "project_id" ... violates not-null
-- constraint` and failed -- because a bare `on delete set null` on a
-- composite key nulls project_id too.
--
-- The earlier isolation suites could not catch this: they check that a
-- stranger cannot delete a row, and RLS blocks that before any cascade runs.
-- What was never tested is the owner deleting their own row while a child
-- points at it, which is an ordinary thing a researcher does.
-- ---------------------------------------------------------------------
do $$
declare
  failures integer := 0;
  linked uuid;
  n integer;
begin
  insert into research_questions (id, project_id, question_text)
    values ('aaaaaaaa-7777-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','RQ under test?');
  insert into research_objectives (id, project_id, question_id, objective_text)
    values ('aaaaaaaa-7777-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-7777-1111-1111-111111111111','Objective under test');
  insert into research_hypotheses (id, project_id, objective_id, statement)
    values ('aaaaaaaa-7777-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-7777-2222-2222-222222222222','Hypothesis under test');

  -- question -> objective
  begin
    delete from research_questions where id = 'aaaaaaaa-7777-1111-1111-111111111111';
    select question_id into linked from research_objectives
      where id = 'aaaaaaaa-7777-2222-2222-222222222222';
    if linked is null then raise notice 'PASS  deleting a question unlinks but keeps its objective';
    else raise notice 'FAIL  objective still points at the deleted question'; failures := failures + 1; end if;
  exception when others then
    raise notice 'FAIL  deleting a question with an objective raised: %', sqlerrm;
    failures := failures + 1;
  end;

  -- objective -> hypothesis
  begin
    delete from research_objectives where id = 'aaaaaaaa-7777-2222-2222-222222222222';
    select objective_id into linked from research_hypotheses
      where id = 'aaaaaaaa-7777-3333-3333-333333333333';
    if linked is null then raise notice 'PASS  deleting an objective unlinks but keeps its hypothesis';
    else raise notice 'FAIL  hypothesis still points at the deleted objective'; failures := failures + 1; end if;
  exception when others then
    raise notice 'FAIL  deleting an objective with a hypothesis raised: %', sqlerrm;
    failures := failures + 1;
  end;

  -- construct / indicator / scale / citation -> questionnaire item
  insert into research_instruments (id, project_id, name)
    values ('aaaaaaaa-7777-4444-4444-444444444444','aaaaaaaa-1111-1111-1111-111111111111','Instrument');
  insert into research_indicators (id, project_id, construct_id, name)
    values ('aaaaaaaa-7777-5555-5555-555555555555','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-cccc-2222-2222-222222222222','Indicator under test');
  insert into research_scales (id, project_id, name, points)
    values ('aaaaaaaa-7777-6666-6666-666666666666','aaaaaaaa-1111-1111-1111-111111111111','Scale',
            '[{"value":1,"label":"Low"},{"value":2,"label":"High"}]'::jsonb);
  insert into research_citations (id, project_id, citation_key, title, status)
    values ('aaaaaaaa-7777-7777-7777-777777777777','aaaaaaaa-1111-1111-1111-111111111111',
            'srcA','A source','user_provided');
  insert into questionnaire_questions
    (id, project_id, instrument_id, section_label, order_index, question_text, response_type,
     construct_id, indicator_id, scale_id, source_citation_id)
    values ('aaaaaaaa-7777-8888-8888-888888888888','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-7777-4444-4444-444444444444','Section A',0,'An item?','likert',
            'aaaaaaaa-cccc-2222-2222-222222222222','aaaaaaaa-7777-5555-5555-555555555555',
            'aaaaaaaa-7777-6666-6666-666666666666','aaaaaaaa-7777-7777-7777-777777777777');

  begin
    delete from research_scales where id = 'aaaaaaaa-7777-6666-6666-666666666666';
    delete from research_citations where id = 'aaaaaaaa-7777-7777-7777-777777777777';
    delete from research_indicators where id = 'aaaaaaaa-7777-5555-5555-555555555555';
    delete from research_constructs where id = 'aaaaaaaa-cccc-2222-2222-222222222222';

    select count(*) into n from questionnaire_questions
      where id = 'aaaaaaaa-7777-8888-8888-888888888888'
        and construct_id is null and indicator_id is null
        and scale_id is null and source_citation_id is null;
    if n = 1 then
      raise notice 'PASS  deleting a construct, indicator, scale and source unlinks but keeps the item';
    else
      raise notice 'FAIL  the questionnaire item did not survive unlinked'; failures := failures + 1;
    end if;
  exception when others then
    raise notice 'FAIL  deleting a measurement parent with an item raised: %', sqlerrm;
    failures := failures + 1;
  end;

  -- document -> evidence (Phase 17)
  insert into research_documents (id, project_id, uploaded_by, file_name, storage_path, document_type)
    values ('aaaaaaaa-7777-9999-9999-999999999999','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001','paper.pdf','a/paper.pdf','reference');
  -- Evidence needs a source of its own: `citation_id` is not null, and the
  -- source used above was deleted by the previous check.
  insert into research_citations (id, project_id, citation_key, title, status)
    values ('aaaaaaaa-7777-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-1111-1111-1111-111111111111',
            'srcB','Another source','user_provided');
  insert into research_evidence (id, project_id, citation_id, document_id, excerpt)
    values ('aaaaaaaa-7777-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-7777-bbbb-bbbb-bbbbbbbbbbbb',
            'aaaaaaaa-7777-9999-9999-999999999999','An excerpt from the paper.');

  begin
    delete from research_documents where id = 'aaaaaaaa-7777-9999-9999-999999999999';
    select document_id into linked from research_evidence
      where id = 'aaaaaaaa-7777-aaaa-aaaa-aaaaaaaaaaaa';
    select count(*) into n from research_evidence
      where id = 'aaaaaaaa-7777-aaaa-aaaa-aaaaaaaaaaaa';
    if n = 1 and linked is null then
      raise notice 'PASS  deleting a document unlinks but keeps its evidence excerpt';
    else
      raise notice 'FAIL  evidence did not survive the deletion of its document'; failures := failures + 1;
    end if;
  exception when others then
    raise notice 'FAIL  deleting a document with evidence raised: %', sqlerrm;
    failures := failures + 1;
  end;

  if failures = 0 then
    raise notice '--- ALL PHASE 20 REPAIRED-CASCADE CHECKS PASSED ---';
  else
    raise exception '% repaired-cascade check(s) FAILED', failures;
  end if;
end $$;

rollback;
