-- Phase 17B §33/§34: project isolation for the literature workspace tables,
-- verified against real Postgres and real RLS rather than against a mock.
--
-- The Phase 17 script covers the evidence chain. This one covers what Phase
-- 17B added -- themes, theme/source assignments, source profiles and research
-- gaps -- plus the two database-level guarantees the application layer is not
-- allowed to be the only enforcer of: the composite foreign keys that stop a
-- row pointing at another project's parent, and the check constraint that
-- stops a gap claiming a source stated it when it names no source.
--
-- Run with:
--
--   npm run db:verify:isolation:17b
--
--   -- or directly:
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     < supabase/tests/phase17b_project_isolation.sql
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

insert into research_citations (id, project_id, citation_key, title, status) values
  ('aaaaaaaa-3333-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111','sokA','Source A','user_provided'),
  -- A second source of A's, deliberately left out of every theme below. The
  -- cross-project write test must fail on the composite foreign key, not on
  -- the (theme_id, citation_id) unique index -- a unique violation would look
  -- like a pass while proving nothing.
  ('aaaaaaaa-3333-3333-3333-33333333333b','aaaaaaaa-1111-1111-1111-111111111111','sokA2','Source A2','user_provided');

insert into research_themes (id, project_id, name, ai_suggested, confirmed) values
  ('aaaaaaaa-8888-8888-8888-888888888888','aaaaaaaa-1111-1111-1111-111111111111','Adoption barriers', false, true);

insert into research_theme_sources (project_id, theme_id, citation_id) values
  ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-8888-8888-8888-888888888888','aaaaaaaa-3333-3333-3333-333333333333');

insert into research_source_profiles (project_id, citation_id, population, main_finding, field_provenance) values
  ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-3333-3333-3333-333333333333',
   'Smallholder farmers','Adoption rose after training','{"population":"source_stated"}'::jsonb);

insert into research_gaps (id, project_id, citation_id, gap_text, basis, supporting_text) values
  ('aaaaaaaa-9999-9999-9999-999999999999','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-3333-3333-3333-333333333333','No longitudinal follow-up','source_stated','We did not follow participants beyond one season.');

-- §29: the version action vocabulary must actually admit an evidence
-- insertion. If the migration's check constraint were not widened this seed
-- fails, which is the point of asserting it here rather than in a mock.
insert into research_sections (id, project_id, section_type, content)
  values ('aaaaaaaa-6666-6666-6666-666666666666','aaaaaaaa-1111-1111-1111-111111111111','research_gap','A content [sokA]');
insert into research_section_versions (project_id, section_id, section_type, previous_content, new_content, action)
  values ('aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-6666-6666-6666-666666666666','research_gap','A content','A content [sokA]','evidence_insert');

-- Act as user B, who owns Project B only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n integer;
  failures integer := 0;
begin
  -- ---------------- Reads: none of Project A's rows may be visible.
  select count(*) into n from research_themes;
  if n = 0 then raise notice 'PASS  B cannot read A themes';
  else raise notice 'FAIL  B read % A themes', n; failures := failures + 1; end if;

  select count(*) into n from research_theme_sources;
  if n = 0 then raise notice 'PASS  B cannot read A theme-source assignments';
  else raise notice 'FAIL  B read % A theme-source assignments', n; failures := failures + 1; end if;

  select count(*) into n from research_source_profiles;
  if n = 0 then raise notice 'PASS  B cannot read A source profiles';
  else raise notice 'FAIL  B read % A source profiles', n; failures := failures + 1; end if;

  select count(*) into n from research_gaps;
  if n = 0 then raise notice 'PASS  B cannot read A research gaps';
  else raise notice 'FAIL  B read % A research gaps', n; failures := failures + 1; end if;

  -- ---------------- Cross-project links: B labels the row with its own
  -- project but points it at A's parent. RLS alone does NOT stop this -- its
  -- policies check the row's own project_id -- so the composite foreign keys
  -- are what must.
  begin
    insert into research_theme_sources (project_id, theme_id, citation_id)
      values ('bbbbbbbb-2222-2222-2222-222222222222',
              'aaaaaaaa-8888-8888-8888-888888888888',
              'aaaaaaaa-3333-3333-3333-33333333333b');
    raise notice 'FAIL  B assigned a source under A theme';
    failures := failures + 1;
  exception
    when foreign_key_violation then
      raise notice 'PASS  cross-project theme-source link rejected';
    when unique_violation then
      raise notice 'FAIL  test is unsound: unique index fired before the foreign key';
      failures := failures + 1;
  end;

  begin
    insert into research_source_profiles (project_id, citation_id, main_finding)
      values ('bbbbbbbb-2222-2222-2222-222222222222',
              'aaaaaaaa-3333-3333-3333-333333333333',
              'stolen finding');
    raise notice 'FAIL  B profiled A source';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project source profile rejected';
  end;

  begin
    insert into research_gaps (project_id, citation_id, gap_text, basis)
      values ('bbbbbbbb-2222-2222-2222-222222222222',
              'aaaaaaaa-3333-3333-3333-333333333333',
              'stolen gap','user_observation');
    raise notice 'FAIL  B attributed a gap to A source';
    failures := failures + 1;
  exception when foreign_key_violation then
    raise notice 'PASS  cross-project gap-to-source link rejected';
  end;

  -- ---------------- B cannot write into A's project at all.
  begin
    insert into research_themes (project_id, name)
      values ('aaaaaaaa-1111-1111-1111-111111111111','Theme planted by B');
    raise notice 'FAIL  B created a theme inside project A';
    failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  B cannot create a theme inside project A';
  end;

  -- ---------------- Updates and deletes against A's rows are not errors --
  -- the rows are simply invisible, so they must match nothing. Asserting the
  -- row count is the only way to tell "blocked" from "silently applied".
  update research_themes set name = 'hijacked'
    where id = 'aaaaaaaa-8888-8888-8888-888888888888';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot rename A theme';
  else raise notice 'FAIL  B renamed % A theme(s)', n; failures := failures + 1; end if;

  update research_gaps set verified = true
    where id = 'aaaaaaaa-9999-9999-9999-999999999999';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot mark A gap verified';
  else raise notice 'FAIL  B verified % A gap(s)', n; failures := failures + 1; end if;

  delete from research_gaps where id = 'aaaaaaaa-9999-9999-9999-999999999999';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot delete A gap';
  else raise notice 'FAIL  B deleted % A gap(s)', n; failures := failures + 1; end if;

  delete from research_themes where id = 'aaaaaaaa-8888-8888-8888-888888888888';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  B cannot delete A theme';
  else raise notice 'FAIL  B deleted % A theme(s)', n; failures := failures + 1; end if;

  -- ---------------- §24: a gap that names no source cannot claim a source
  -- stated it. Enforced by the database, not only by the route, because the
  -- distinction between "the paper says so" and "a model inferred it" is the
  -- whole value of the basis column.
  begin
    insert into research_gaps (project_id, citation_id, gap_text, basis)
      values ('bbbbbbbb-2222-2222-2222-222222222222', null, 'sourceless gap','source_stated');
    raise notice 'FAIL  a source_stated gap was accepted with no source';
    failures := failures + 1;
  exception when check_violation then
    raise notice 'PASS  source_stated gap without a source rejected';
  end;

  -- The same gap without the source attribution is legitimate -- an
  -- observation across the literature -- and must still be writable.
  begin
    insert into research_gaps (project_id, citation_id, gap_text, basis)
      values ('bbbbbbbb-2222-2222-2222-222222222222', null, 'cross-literature gap','ai_inference');
    raise notice 'PASS  sourceless ai_inference gap accepted in own project';
  exception when others then
    raise notice 'FAIL  B could not record a gap in its own project: %', sqlerrm;
    failures := failures + 1;
  end;

  if failures = 0 then
    raise notice '--- ALL PHASE 17B ISOLATION CHECKS PASSED ---';
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
  theme_name text;
  gap_verified boolean;
begin
  select name into theme_name from research_themes where id = 'aaaaaaaa-8888-8888-8888-888888888888';
  if theme_name = 'Adoption barriers' then raise notice 'PASS  A theme survived intact';
  else raise notice 'FAIL  A theme is now %', coalesce(theme_name,'(deleted)'); failures := failures + 1; end if;

  select verified into gap_verified from research_gaps where id = 'aaaaaaaa-9999-9999-9999-999999999999';
  if gap_verified is false then raise notice 'PASS  A gap survived intact and unverified';
  else raise notice 'FAIL  A gap is now verified=%', coalesce(gap_verified::text,'(deleted)'); failures := failures + 1; end if;

  if failures > 0 then raise exception '% post-check(s) FAILED', failures; end if;
end $$;

rollback;
