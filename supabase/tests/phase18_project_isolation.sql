-- Phase 18 §26/§27: project isolation for the methodology tables, verified
-- against real Postgres and real RLS rather than against a mock.
--
-- Two things a mocked test cannot check, and both matter here:
--
--   * RLS is a database feature. An in-memory fake returns whatever it is
--     asked for.
--   * The composite foreign keys are the barrier RLS does not provide. Its
--     policies check the row's OWN project_id, so a row honestly labelled with
--     the attacker's project but pointing at a victim's construct passes every
--     policy. Phase 17 found that hole by testing for it; these tables were
--     built with it closed, and this proves it stayed closed.
--
-- Run with:
--
--   npm run db:verify:isolation:18
--
-- Every check prints PASS or FAIL. The whole script runs in a transaction and
-- rolls back, so it leaves no rows behind.

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

-- Project A's methodology chain, complete enough that every reference type has
-- something to be pointed at.
insert into research_citations (id, project_id, citation_key, title, status)
  values ('aaaaaaaa-3333-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111','sokA','Source A','user_provided');

insert into research_questions (id, project_id, question_text, question_kind)
  values ('aaaaaaaa-aaaa-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
          'What is the relationship between teacher motivation and student performance?','correlational');

insert into research_objectives (id, project_id, question_id, objective_text)
  values ('aaaaaaaa-bbbb-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
          'aaaaaaaa-aaaa-1111-1111-111111111111','To measure the association.');

insert into research_constructs (id, project_id, name, role, conceptual_definition, operational_definition) values
  ('aaaaaaaa-cccc-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
   'Teacher motivation','independent','Willingness to invest effort.','Mean of the motivation items.'),
  ('aaaaaaaa-cccc-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111',
   'Student performance','dependent','Attainment in assessed work.','Mean exam score.');

insert into research_indicators (id, project_id, construct_id, name)
  values ('aaaaaaaa-dddd-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
          'aaaaaaaa-cccc-1111-1111-111111111111','Job satisfaction');

insert into research_hypotheses (id, project_id, objective_id, label, statement, hypothesis_form, direction)
  values ('aaaaaaaa-eeee-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
          'aaaaaaaa-bbbb-1111-1111-111111111111','H1',
          'Teacher motivation is positively associated with student performance.','association','positive');

insert into research_hypothesis_variables (project_id, hypothesis_id, construct_id, position) values
  ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-eeee-1111-1111-111111111111',
   'aaaaaaaa-cccc-1111-1111-111111111111','predictor');

insert into research_scales (id, project_id, name, points, polarity)
  values ('aaaaaaaa-ffff-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','Agreement 1-5',
          '[{"value":1,"label":"Strongly disagree"},{"value":5,"label":"Strongly agree"}]'::jsonb,'ascending');

insert into research_instruments (id, project_id, name)
  values ('aaaaaaaa-9999-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','Main survey');

insert into questionnaire_questions
  (id, instrument_id, project_id, section_label, question_text, response_type, order_index,
   construct_id, indicator_id, scale_id)
  values ('aaaaaaaa-8888-1111-1111-111111111111','aaaaaaaa-9999-1111-1111-111111111111',
          'aaaaaaaa-1111-1111-1111-111111111111','Motivation','I feel satisfied with my work.','likert',0,
          'aaaaaaaa-cccc-1111-1111-111111111111','aaaaaaaa-dddd-1111-1111-111111111111',
          'aaaaaaaa-ffff-1111-1111-111111111111');

insert into methodology_events (project_id, entity_type, entity_id, action, summary)
  values ('aaaaaaaa-1111-1111-1111-111111111111','construct','aaaaaaaa-cccc-1111-1111-111111111111',
          'created','Added construct: Teacher motivation');

-- Project B needs an instrument of its own, so the cross-project item test
-- fails on the construct reference rather than on the instrument.
insert into research_instruments (id, project_id, name)
  values ('bbbbbbbb-9999-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222','B survey');

-- Act as user B, who owns Project B only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n integer;
  failures integer := 0;
begin
  -- ---------------- Reads: none of Project A's methodology is visible.
  select count(*) into n from research_questions;
  if n = 0 then raise notice 'PASS  B cannot read A research questions';
  else raise notice 'FAIL  B read % A research questions', n; failures := failures + 1; end if;

  select count(*) into n from research_objectives;
  if n = 0 then raise notice 'PASS  B cannot read A objectives';
  else raise notice 'FAIL  B read % A objectives', n; failures := failures + 1; end if;

  select count(*) into n from research_constructs;
  if n = 0 then raise notice 'PASS  B cannot read A constructs';
  else raise notice 'FAIL  B read % A constructs', n; failures := failures + 1; end if;

  select count(*) into n from research_indicators;
  if n = 0 then raise notice 'PASS  B cannot read A indicators';
  else raise notice 'FAIL  B read % A indicators', n; failures := failures + 1; end if;

  select count(*) into n from research_hypotheses;
  if n = 0 then raise notice 'PASS  B cannot read A hypotheses';
  else raise notice 'FAIL  B read % A hypotheses', n; failures := failures + 1; end if;

  select count(*) into n from research_hypothesis_variables;
  if n = 0 then raise notice 'PASS  B cannot read A hypothesis links';
  else raise notice 'FAIL  B read % A hypothesis links', n; failures := failures + 1; end if;

  select count(*) into n from research_scales;
  if n = 0 then raise notice 'PASS  B cannot read A response scales';
  else raise notice 'FAIL  B read % A response scales', n; failures := failures + 1; end if;

  select count(*) into n from methodology_events;
  if n = 0 then raise notice 'PASS  B cannot read A methodology history';
  else raise notice 'FAIL  B read % A history entries', n; failures := failures + 1; end if;

  -- ---------------- Cross-project references. B labels each row with its own
  -- project -- so every RLS policy passes -- and points it at A's parent. The
  -- composite foreign keys are the only thing that can refuse these.
  begin
    insert into research_objectives (project_id, question_id, objective_text)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-aaaa-1111-1111-111111111111','stolen objective');
    raise notice 'FAIL  B attached an objective to A research question';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project objective-to-question link rejected';
  end;

  begin
    insert into research_indicators (project_id, construct_id, name)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-cccc-1111-1111-111111111111','stolen indicator');
    raise notice 'FAIL  B added an indicator under A construct';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project indicator-to-construct link rejected';
  end;

  begin
    insert into research_hypotheses (project_id, objective_id, statement)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-bbbb-1111-1111-111111111111','stolen hypothesis');
    raise notice 'FAIL  B attached a hypothesis to A objective';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project hypothesis-to-objective link rejected';
  end;

  begin
    insert into research_hypothesis_variables (project_id, hypothesis_id, construct_id, position)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-eeee-1111-1111-111111111111',
              'aaaaaaaa-cccc-2222-2222-222222222222','outcome');
    raise notice 'FAIL  B linked A hypothesis to A construct under its own project';
    failures := failures + 1;
  exception
    when foreign_key_violation then
      raise notice 'PASS  cross-project hypothesis-variable link rejected';
    when unique_violation then
      -- Would mean the fixture collided instead of the barrier firing.
      raise notice 'FAIL  test is unsound: unique index fired before the foreign key';
      failures := failures + 1;
  end;

  begin
    insert into questionnaire_questions
      (instrument_id, project_id, section_label, question_text, response_type, order_index, construct_id)
      values ('bbbbbbbb-9999-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222',
              'S','Stolen mapping','likert',0,'aaaaaaaa-cccc-1111-1111-111111111111');
    raise notice 'FAIL  B mapped its own item to A construct';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project item-to-construct mapping rejected';
  end;

  begin
    insert into questionnaire_questions
      (instrument_id, project_id, section_label, question_text, response_type, order_index, scale_id)
      values ('bbbbbbbb-9999-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222',
              'S','Stolen scale','likert',1,'aaaaaaaa-ffff-1111-1111-111111111111');
    raise notice 'FAIL  B used A response scale';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project item-to-scale link rejected';
  end;

  -- ---------------- B cannot write into A's project at all.
  begin
    insert into research_constructs (project_id, name)
      values ('aaaaaaaa-1111-1111-1111-111111111111','Construct planted by B');
    raise notice 'FAIL  B created a construct inside project A';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  B cannot create a construct inside project A';
  end;

  -- ---------------- Updates and deletes match nothing rather than erroring:
  -- A's rows are invisible. Only the row count tells "blocked" from "applied".
  update research_constructs set name = 'hijacked'
    where id = 'aaaaaaaa-cccc-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot rename A construct';
  else raise notice 'FAIL  B renamed % A construct(s)', n; failures := failures + 1; end if;

  update research_hypotheses set direction = 'negative'
    where id = 'aaaaaaaa-eeee-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot change the direction of A hypothesis';
  else raise notice 'FAIL  B changed % A hypothesis direction(s)', n; failures := failures + 1; end if;

  update questionnaire_questions set construct_id = null
    where id = 'aaaaaaaa-8888-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot unmap A questionnaire item';
  else raise notice 'FAIL  B unmapped % A item(s)', n; failures := failures + 1; end if;

  delete from research_constructs where id = 'aaaaaaaa-cccc-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot delete A construct';
  else raise notice 'FAIL  B deleted % A construct(s)', n; failures := failures + 1; end if;

  -- ---------------- The audit log is append-only, even for its owner.
  -- A history its own owner can quietly rewrite is not a history.
  begin
    update methodology_events set summary = 'rewritten'
      where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';
    raise notice 'FAIL  the methodology history is updatable';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  the methodology history cannot be updated';
  end;

  begin
    delete from methodology_events where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';
    raise notice 'FAIL  the methodology history is deletable';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  the methodology history cannot be deleted';
  end;

  -- ---------------- §31: an item may not claim a source without naming one.
  begin
    insert into questionnaire_questions
      (instrument_id, project_id, section_label, question_text, response_type, order_index, adaptation_type)
      values ('bbbbbbbb-9999-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222',
              'S','Claims a source it does not name','likert',2,'verbatim');
    raise notice 'FAIL  an item claimed a source with no citation';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  an item cannot claim a source without naming one';
  end;

  -- ---------------- B can still work normally in its own project.
  begin
    insert into research_constructs (project_id, name, role)
      values ('bbbbbbbb-2222-2222-2222-222222222222','B own construct','dependent');
    raise notice 'PASS  B can create a construct in its own project';
  exception when others then
    raise notice 'FAIL  B could not work in its own project: %', sqlerrm;
    failures := failures + 1;
  end;

  if failures = 0 then
    raise notice '--- ALL PHASE 18 ISOLATION CHECKS PASSED ---';
  else
    raise exception '% isolation check(s) FAILED', failures;
  end if;
end $$;

-- Back to the owner's view: prove A's rows really are untouched, rather than
-- trusting that the blocked writes above were the only ones attempted.
reset role;

do $$
declare
  failures integer := 0;
  construct_name text;
  mapped uuid;
begin
  select name into construct_name from research_constructs
    where id = 'aaaaaaaa-cccc-1111-1111-111111111111';
  if construct_name = 'Teacher motivation' then raise notice 'PASS  A construct survived intact';
  else raise notice 'FAIL  A construct is now %', coalesce(construct_name,'(deleted)'); failures := failures + 1; end if;

  select construct_id into mapped from questionnaire_questions
    where id = 'aaaaaaaa-8888-1111-1111-111111111111';
  if mapped = 'aaaaaaaa-cccc-1111-1111-111111111111' then raise notice 'PASS  A item mapping survived intact';
  else raise notice 'FAIL  A item mapping is now %', coalesce(mapped::text,'(null)'); failures := failures + 1; end if;

  if failures > 0 then raise exception '% post-check(s) FAILED', failures; end if;
end $$;

rollback;
