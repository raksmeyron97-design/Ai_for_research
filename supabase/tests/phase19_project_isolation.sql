-- Phase 19: project isolation for the research-integrity tables, verified
-- against real Postgres and real RLS rather than against a mock.
--
-- Same two things a mocked test cannot check that phase17/17b/18's own
-- isolation suites already established, now for the connective layer:
--
--   * RLS is a database feature. An in-memory fake returns whatever it is
--     asked for.
--   * The composite foreign keys are the barrier RLS does not provide. Its
--     policies check the row's OWN project_id, so a row honestly labelled
--     with the attacker's project but pointing at a victim's claim/construct
--     passes every policy. Only the composite key can refuse it.
--
-- Run with:
--
--   npm run db:verify:isolation:19
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

-- Project A: a claim, a citation with pmid/isbn set, a construct to link the
-- claim to, and one row in each of the three new tables.
insert into research_citations (id, project_id, citation_key, title, status, pmid, isbn)
  values ('aaaaaaaa-3333-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111',
          'sokA','Source A','user_provided','12345678','978-3-16-148410-0');

insert into research_claims (id, project_id, section_type, claim_text, claim_type)
  values ('aaaaaaaa-4444-4444-4444-444444444444','aaaaaaaa-1111-1111-1111-111111111111',
          'results','Teacher motivation predicts performance.','factual');

insert into research_constructs (id, project_id, name, role, conceptual_definition, operational_definition)
  values ('aaaaaaaa-cccc-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
          'Teacher motivation','independent','Willingness to invest effort.','Mean of the motivation items.');

insert into research_claim_methodology_links (id, project_id, claim_id, construct_id)
  values ('aaaaaaaa-5555-5555-5555-555555555555','aaaaaaaa-1111-1111-1111-111111111111',
          'aaaaaaaa-4444-4444-4444-444444444444','aaaaaaaa-cccc-1111-1111-111111111111');

insert into research_integrity_decisions (id, project_id, finding_id, status)
  values ('aaaaaaaa-6666-6666-6666-666666666666','aaaaaaaa-1111-1111-1111-111111111111',
          'citation:missing-citation:aaaaaaaa-4444-4444-4444-444444444444','dismissed');

insert into research_integrity_events (project_id, entity_type, entity_id, action, summary)
  values ('aaaaaaaa-1111-1111-1111-111111111111','finding',
          'aaaaaaaa-4444-4444-4444-444444444444','finding_dismissed','Dismissed a citation finding');

-- Project B needs a claim of its own, so the cross-project link tests fail
-- on the construct/claim reference rather than on a missing parent row.
insert into research_claims (id, project_id, section_type, claim_text, claim_type)
  values ('bbbbbbbb-4444-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222',
          'results','B has its own claim too.','factual');

-- Act as user B, who owns Project B only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n integer;
  failures integer := 0;
begin
  -- ---------------- Reads: none of Project A's integrity rows are visible.
  select count(*) into n from research_claim_methodology_links;
  if n = 0 then raise notice 'PASS  B cannot read A claim-methodology links';
  else raise notice 'FAIL  B read % A claim-methodology links', n; failures := failures + 1; end if;

  select count(*) into n from research_integrity_decisions;
  if n = 0 then raise notice 'PASS  B cannot read A integrity decisions';
  else raise notice 'FAIL  B read % A integrity decisions', n; failures := failures + 1; end if;

  select count(*) into n from research_integrity_events;
  if n = 0 then raise notice 'PASS  B cannot read A integrity events';
  else raise notice 'FAIL  B read % A integrity events', n; failures := failures + 1; end if;

  -- ---------------- Cross-project references. B labels each row with its
  -- own project -- so every RLS policy passes -- and points it at A's claim
  -- or construct. Only the composite foreign key can refuse these.
  begin
    insert into research_claim_methodology_links (project_id, claim_id, construct_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','aaaaaaaa-4444-4444-4444-444444444444',
              'aaaaaaaa-cccc-1111-1111-111111111111');
    raise notice 'FAIL  B linked its own project to A claim';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project link-to-claim rejected';
  end;

  begin
    insert into research_claim_methodology_links (project_id, claim_id, construct_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-4444-2222-2222-222222222222',
              'aaaaaaaa-cccc-1111-1111-111111111111');
    raise notice 'FAIL  B linked its own claim to A construct';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project link-to-construct rejected';
  end;

  -- ---------------- Exactly one target: the check constraint, not RLS, but
  -- worth proving here since it is new business logic this phase added.
  begin
    insert into research_claim_methodology_links (project_id, claim_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-4444-2222-2222-222222222222');
    raise notice 'FAIL  a link with zero targets was accepted';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  a link naming zero targets is rejected';
  end;

  -- ---------------- B cannot write into A's project at all.
  begin
    insert into research_integrity_decisions (project_id, finding_id, status)
      values ('aaaaaaaa-1111-1111-1111-111111111111','citation:missing-citation:planted','dismissed');
    raise notice 'FAIL  B created a decision inside project A';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  B cannot create a decision inside project A';
  end;

  begin
    insert into research_integrity_events (project_id, entity_type, action, summary)
      values ('aaaaaaaa-1111-1111-1111-111111111111','finding','integrity_review','Planted by B');
    raise notice 'FAIL  B created an event inside project A';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  B cannot create an event inside project A';
  end;

  -- ---------------- Updates and deletes match nothing rather than erroring:
  -- A's rows are invisible. Only the row count tells "blocked" from "applied".
  update research_integrity_decisions set status = 'accepted'
    where id = 'aaaaaaaa-6666-6666-6666-666666666666';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot change A decision';
  else raise notice 'FAIL  B changed % A decision(s)', n; failures := failures + 1; end if;

  delete from research_claim_methodology_links where id = 'aaaaaaaa-5555-5555-5555-555555555555';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot delete A claim-methodology link';
  else raise notice 'FAIL  B deleted % A link(s)', n; failures := failures + 1; end if;

  -- ---------------- The audit log is append-only, even for its owner.
  begin
    update research_integrity_events set summary = 'rewritten'
      where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';
    raise notice 'FAIL  the integrity event log is updatable';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  the integrity event log cannot be updated';
  end;

  begin
    delete from research_integrity_events where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';
    raise notice 'FAIL  the integrity event log is deletable';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  the integrity event log cannot be deleted';
  end;

  -- ---------------- A second shape of the zero-targets case: naming a target
  -- column explicitly as null must not be treated differently from omitting
  -- it.
  begin
    insert into research_claim_methodology_links (project_id, claim_id, hypothesis_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-4444-2222-2222-222222222222', null);
    raise notice 'FAIL  a link naming hypothesis_id as an explicit null was accepted as a target';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  naming a target column with an explicit null still counts as zero targets';
  end;

  -- ---------------- B can still work normally in its own project.
  begin
    insert into research_integrity_decisions (project_id, finding_id, status)
      values ('bbbbbbbb-2222-2222-2222-222222222222','citation:missing-citation:own','open');
    raise notice 'PASS  B can create a decision in its own project';
  exception when others then
    raise notice 'FAIL  B could not work in its own project: %', sqlerrm;
    failures := failures + 1;
  end;

  if failures = 0 then
    raise notice '--- ALL PHASE 19 ISOLATION CHECKS PASSED ---';
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
  decision_status text;
  link_id uuid;
begin
  select status into decision_status from research_integrity_decisions
    where id = 'aaaaaaaa-6666-6666-6666-666666666666';
  if decision_status = 'dismissed' then raise notice 'PASS  A decision survived intact';
  else raise notice 'FAIL  A decision is now %', coalesce(decision_status,'(deleted)'); failures := failures + 1; end if;

  select id into link_id from research_claim_methodology_links
    where id = 'aaaaaaaa-5555-5555-5555-555555555555';
  if link_id is not null then raise notice 'PASS  A claim-methodology link survived intact';
  else raise notice 'FAIL  A claim-methodology link was deleted'; failures := failures + 1; end if;

  if failures > 0 then raise exception '% post-check(s) FAILED', failures; end if;
end $$;

rollback;
