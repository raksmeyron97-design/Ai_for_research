-- Phase 17 §28/§29: project isolation, verified against real Postgres and
-- real RLS rather than against a mock.
--
-- Mocked DB tests cannot check this: RLS is a database feature, and an
-- in-memory fake will happily return whatever it is asked for. Run with:
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     < supabase/tests/phase17_project_isolation.sql
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

insert into research_citations (id, project_id, citation_key, title, status)
  values ('aaaaaaaa-3333-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111','sokA','Source A','user_provided');
insert into research_sections (id, project_id, section_type, content)
  values ('aaaaaaaa-6666-6666-6666-666666666666','aaaaaaaa-1111-1111-1111-111111111111','research_problem','A content');
insert into research_section_versions (project_id, section_id, section_type, previous_content, new_content, action)
  values ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-6666-6666-6666-666666666666','research_problem','','A content','manual');
insert into research_claims (id, project_id, section_type, claim_text)
  values ('aaaaaaaa-4444-4444-4444-444444444444','aaaaaaaa-1111-1111-1111-111111111111','research_problem','Claim in A');
insert into research_evidence (id, project_id, citation_id, excerpt) values
  ('aaaaaaaa-5555-5555-5555-555555555555','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-3333-3333-3333-333333333333','Excerpt in A'),
  -- A second, UNLINKED excerpt. The cross-project write test below must fail
  -- on the composite foreign key, not on the (claim_id, evidence_id) unique
  -- index -- a unique violation would look like a pass while proving nothing.
  ('aaaaaaaa-7777-7777-7777-777777777777','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-3333-3333-3333-333333333333','Second excerpt in A');
insert into research_claim_evidence (project_id, claim_id, evidence_id, support)
  values ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-4444-4444-4444-444444444444','aaaaaaaa-5555-5555-5555-555555555555','SUPPORTED');
insert into research_frameworks (project_id, graph)
  values ('aaaaaaaa-1111-1111-1111-111111111111','{"nodes":[{"id":"n1","label":"X","role":"outcome","ai_suggested":false}],"edges":[]}');

-- Act as user B, who owns Project B only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n integer;
  failures integer := 0;
begin
  -- Reads: none of Project A's rows may be visible.
  select count(*) into n from research_claims;
  if n = 0 then raise notice 'PASS  B cannot read A claims';
  else raise notice 'FAIL  B read % A claims', n; failures := failures + 1; end if;

  select count(*) into n from research_evidence;
  if n = 0 then raise notice 'PASS  B cannot read A evidence';
  else raise notice 'FAIL  B read % A evidence rows', n; failures := failures + 1; end if;

  select count(*) into n from research_claim_evidence;
  if n = 0 then raise notice 'PASS  B cannot read A claim-evidence relations';
  else raise notice 'FAIL  B read % A relations', n; failures := failures + 1; end if;

  select count(*) into n from research_frameworks;
  if n = 0 then raise notice 'PASS  B cannot read A framework';
  else raise notice 'FAIL  B read % A frameworks', n; failures := failures + 1; end if;

  select count(*) into n from research_section_versions;
  if n = 0 then raise notice 'PASS  B cannot read A version history';
  else raise notice 'FAIL  B read % A versions', n; failures := failures + 1; end if;

  -- Writes: B labels a relation with B's own project but points it at A's
  -- claim and evidence. RLS alone does NOT stop this -- its policies check the
  -- row's own project_id -- so the composite foreign keys are what must.
  begin
    insert into research_claim_evidence (project_id, claim_id, evidence_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222',
              'aaaaaaaa-4444-4444-4444-444444444444',
              'aaaaaaaa-7777-7777-7777-777777777777');
    raise notice 'FAIL  B linked its project to A claim/evidence';
    failures := failures + 1;
  exception
    when foreign_key_violation then
      raise notice 'PASS  cross-project claim-evidence link rejected';
    when unique_violation then
      -- Would mean the fixture collided instead of the barrier firing.
      raise notice 'FAIL  test is unsound: unique index fired before the foreign key';
      failures := failures + 1;
  end;

  -- Same for evidence pointing at another project's source.
  begin
    insert into research_evidence (project_id, citation_id, excerpt)
      values ('bbbbbbbb-2222-2222-2222-222222222222',
              'aaaaaaaa-3333-3333-3333-333333333333',
              'stolen excerpt');
    raise notice 'FAIL  B created evidence from A source';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project evidence-to-source link rejected';
  end;

  -- B cannot write into A's project at all.
  begin
    insert into research_frameworks (project_id, graph)
      values ('aaaaaaaa-1111-1111-1111-111111111111','{"nodes":[],"edges":[]}');
    raise notice 'FAIL  B wrote a framework into project A';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  B cannot write a framework into project A';
  end;

  if failures = 0 then
    raise notice '--- ALL ISOLATION CHECKS PASSED ---';
  else
    raise exception '% isolation check(s) FAILED', failures;
  end if;
end $$;

rollback;
