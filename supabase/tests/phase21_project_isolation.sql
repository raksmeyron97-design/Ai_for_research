-- Phase 21: isolation and correctness for the two server-side functions the
-- workspace now depends on, verified against real Postgres and real RLS.
--
-- Both are new territory for these suites, and both are the same class of
-- risk: a SECURITY INVOKER function takes a `p_project_id` parameter, and a
-- reader has to be able to tell whether that parameter is the *barrier* or
-- merely the *query*. If it is the barrier, passing someone else's id is an
-- exploit. The claim in both migrations is that RLS is the barrier -- and a
-- claim like that is worth exactly what its test is worth.
--
--   * `search_project_sources` (Phase 20 §17-§19). §19 requires that a source
--     in project B can never appear in a search of project A, and that no
--     filter combination bypasses RLS. Application tests cannot check this:
--     they mock the database, which is the thing under test.
--
--   * `reorder_framework_nodes` (Phase 21 §13). It writes, in one statement,
--     across every node in a project. The interesting failures are partial
--     ones -- an order that half-applies, or that quietly succeeds while
--     naming a node the caller cannot see.
--
-- Run with:
--
--   npm run db:verify:isolation:21
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

-- ---------------------------------------------------------------------
-- Literature. The two projects deliberately hold sources that MATCH EACH
-- OTHER'S SEARCHES: same author surname, same title words, same year, same
-- DOI prefix. A leak has to be visible as a wrong row, not merely as a wrong
-- count, and identical-looking corpora are what make that possible.
-- ---------------------------------------------------------------------
insert into research_citations
  (id, project_id, citation_key, title, authors, year, journal, doi, source_type, status) values
  ('aaaaaaaa-5555-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
   'nguyen2021a','Teacher motivation in rural schools', array['Nguyen, T.'], 2021,
   'Journal of Education','10.1000/a-one','journal_article','verified'),
  ('aaaaaaaa-5555-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111',
   'nguyen2019a','Teacher motivation and retention', array['Nguyen, T.'], 2019,
   'Journal of Education', null,'journal_article','unverified');

insert into research_citations
  (id, project_id, citation_key, title, authors, year, journal, doi, source_type, status) values
  ('bbbbbbbb-5555-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222',
   'nguyen2021b','Teacher motivation in urban schools', array['Nguyen, T.'], 2021,
   'Journal of Education','10.1000/b-one','journal_article','verified');

-- ---------------------------------------------------------------------
-- Frameworks. Three nodes each, so a reorder has something to get wrong.
-- ---------------------------------------------------------------------
insert into research_constructs (id, project_id, name, role) values
  ('aaaaaaaa-cccc-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','A one','independent'),
  ('aaaaaaaa-cccc-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111','A two','dependent'),
  ('aaaaaaaa-cccc-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111','A three','mediator'),
  ('bbbbbbbb-cccc-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222','B one','independent'),
  ('bbbbbbbb-cccc-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222','B two','dependent');

insert into research_framework_nodes (id, project_id, construct_id, position_y) values
  ('aaaaaaaa-9999-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-cccc-1111-1111-111111111111',0),
  ('aaaaaaaa-9999-2222-2222-222222222222','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-cccc-2222-2222-222222222222',100),
  ('aaaaaaaa-9999-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-cccc-3333-3333-333333333333',200),
  ('bbbbbbbb-9999-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-cccc-1111-1111-111111111111',0),
  ('bbbbbbbb-9999-2222-2222-222222222222','bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-cccc-2222-2222-222222222222',100);

-- ---------------------------------------------------------------------
-- Act as user B, who owns Project B only.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n integer;
  ids uuid[];
  failures integer := 0;
begin
  -- =================================================================
  -- §19 -- source search obeys project isolation.
  -- =================================================================

  -- The whole point: B passes A's project id. If the parameter were the
  -- barrier this returns A's library. RLS is the barrier, so it returns
  -- nothing.
  select count(*) into n from search_project_sources('aaaaaaaa-1111-1111-1111-111111111111');
  if n = 0 then raise notice 'PASS  B cannot search A''s library by passing A''s project id';
  else raise notice 'FAIL  B read % of A''s sources through the search', n; failures := failures + 1; end if;

  -- The same query, run by each owner, must return each owner's rows -- so
  -- "returns nothing" above is isolation and not a broken function.
  select count(*) into n
    from search_project_sources('bbbbbbbb-2222-2222-2222-222222222222', 'motivation');
  if n = 1 then raise notice 'PASS  B''s own search returns B''s own source';
  else raise notice 'FAIL  B''s own search returned % rows, expected 1', n; failures := failures + 1; end if;

  -- A text search that matches rows in BOTH projects returns only B's. This
  -- is the check a count alone would pass by accident.
  select array_agg(id order by id) into ids
    from search_project_sources('bbbbbbbb-2222-2222-2222-222222222222', 'Nguyen');
  if ids = array['bbbbbbbb-5555-1111-1111-111111111111']::uuid[] then
    raise notice 'PASS  a query matching both libraries returns only B''s row';
  else
    raise notice 'FAIL  cross-matching query returned %', ids; failures := failures + 1;
  end if;

  -- Filters must not be a second way in. Each of these is a different code
  -- path through the function -- identifier prefix, negative existence, year
  -- range, enumerated status -- and every one is run against A's project id.
  select count(*) into n from search_project_sources(
    'aaaaaaaa-1111-1111-1111-111111111111', '10.1000/a-one');
  if n = 0 then raise notice 'PASS  DOI lookup does not bypass isolation';
  else raise notice 'FAIL  DOI lookup leaked % row(s)', n; failures := failures + 1; end if;

  select count(*) into n from search_project_sources(
    'aaaaaaaa-1111-1111-1111-111111111111', null, null, null, null, null, null, false, false);
  if n = 0 then raise notice 'PASS  negative filters (no evidence, uncited) do not bypass isolation';
  else raise notice 'FAIL  negative filters leaked % row(s)', n; failures := failures + 1; end if;

  select count(*) into n from search_project_sources(
    'aaaaaaaa-1111-1111-1111-111111111111', null, 1900, 2100);
  if n = 0 then raise notice 'PASS  a year range spanning everything does not bypass isolation';
  else raise notice 'FAIL  year range leaked % row(s)', n; failures := failures + 1; end if;

  select count(*) into n from search_project_sources(
    'aaaaaaaa-1111-1111-1111-111111111111', null, null, null, null,
    array['verified','unverified']);
  if n = 0 then raise notice 'PASS  a status filter listing every status does not bypass isolation';
  else raise notice 'FAIL  status filter leaked % row(s)', n; failures := failures + 1; end if;

  -- total_count drives the pager. If it counted pre-RLS rows it would leak
  -- the size of A's library even while returning none of it.
  select coalesce(max(total_count), 0) into n
    from search_project_sources('bbbbbbbb-2222-2222-2222-222222222222');
  if n = 1 then raise notice 'PASS  total_count counts only rows the caller may see';
  else raise notice 'FAIL  total_count was %, expected 1', n; failures := failures + 1; end if;

  -- =================================================================
  -- §13 -- reorder_framework_nodes.
  -- =================================================================

  -- B names A's nodes. Every one is invisible to B, so nothing updates, and
  -- the function must fail rather than report a successful no-op reorder.
  begin
    perform reorder_framework_nodes('aaaaaaaa-1111-1111-1111-111111111111', array[
      'aaaaaaaa-9999-3333-3333-333333333333',
      'aaaaaaaa-9999-2222-2222-222222222222',
      'aaaaaaaa-9999-1111-1111-111111111111']::uuid[]);
    raise notice 'FAIL  B reordered A''s framework';
    failures := failures + 1;
  exception when others then
    raise notice 'PASS  B cannot reorder A''s framework';
  end;

  -- Right length, but one entry belongs to A. The count check cannot see this
  -- one -- only the updated-row count catches it -- and a partial apply here
  -- would be the worst outcome: half of B's order, silently.
  begin
    perform reorder_framework_nodes('bbbbbbbb-2222-2222-2222-222222222222', array[
      'bbbbbbbb-9999-1111-1111-111111111111',
      'aaaaaaaa-9999-1111-1111-111111111111']::uuid[]);
    raise notice 'FAIL  an order naming A''s node was accepted';
    failures := failures + 1;
  exception when others then
    raise notice 'PASS  an order smuggling in A''s node is rejected whole';
  end;

  -- ...and B's own framework is untouched by that attempt.
  select position_y into n from research_framework_nodes
    where id = 'bbbbbbbb-9999-1111-1111-111111111111';
  if n = 0 then raise notice 'PASS  the rejected reorder changed nothing';
  else raise notice 'FAIL  a rejected reorder moved a node to position %', n; failures := failures + 1; end if;

  -- A partial order: the nodes left out would keep their old positions and
  -- interleave with the new ones, producing an order nobody chose.
  begin
    perform reorder_framework_nodes('bbbbbbbb-2222-2222-2222-222222222222',
      array['bbbbbbbb-9999-2222-2222-222222222222']::uuid[]);
    raise notice 'FAIL  a partial order was accepted';
    failures := failures + 1;
  exception when others then
    raise notice 'PASS  a partial order is rejected';
  end;

  -- A duplicate would give one node two positions; `update ... from` picks a
  -- match arbitrarily rather than erroring, so this must be refused up front.
  begin
    perform reorder_framework_nodes('bbbbbbbb-2222-2222-2222-222222222222', array[
      'bbbbbbbb-9999-1111-1111-111111111111',
      'bbbbbbbb-9999-1111-1111-111111111111']::uuid[]);
    raise notice 'FAIL  a duplicated node id was accepted';
    failures := failures + 1;
  exception when others then
    raise notice 'PASS  a duplicated node id is rejected';
  end;

  -- The positive control. Without it every check above passes on a function
  -- that refuses everything.
  begin
    perform reorder_framework_nodes('bbbbbbbb-2222-2222-2222-222222222222', array[
      'bbbbbbbb-9999-2222-2222-222222222222',
      'bbbbbbbb-9999-1111-1111-111111111111']::uuid[]);

    select array_agg(id order by position_y, position_x, created_at, id) into ids
      from research_framework_nodes
     where project_id = 'bbbbbbbb-2222-2222-2222-222222222222';

    if ids = array['bbbbbbbb-9999-2222-2222-222222222222',
                   'bbbbbbbb-9999-1111-1111-111111111111']::uuid[] then
      raise notice 'PASS  B can reorder its own framework, and the order persists';
    else
      raise notice 'FAIL  B''s framework came back in the order %', ids; failures := failures + 1;
    end if;
  exception when others then
    raise notice 'FAIL  B could not reorder its own framework: %', sqlerrm;
    failures := failures + 1;
  end;

  -- §15: a reorder is presentation only. It must not have touched the
  -- construct binding, the label, or anything a check reads.
  select count(*) into n from research_framework_nodes
   where project_id = 'bbbbbbbb-2222-2222-2222-222222222222'
     and construct_id is null;
  if n = 0 then raise notice 'PASS  reordering did not disturb the canonical construct binding';
  else raise notice 'FAIL  % node(s) lost their construct in a reorder', n; failures := failures + 1; end if;

  -- A's framework is still in its original order after everything above.
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  select array_agg(id order by position_y, position_x, created_at, id) into ids
    from research_framework_nodes
   where project_id = 'aaaaaaaa-1111-1111-1111-111111111111';
  if ids = array['aaaaaaaa-9999-1111-1111-111111111111',
                 'aaaaaaaa-9999-2222-2222-222222222222',
                 'aaaaaaaa-9999-3333-3333-333333333333']::uuid[] then
    raise notice 'PASS  A''s framework order survived B''s attempts intact';
  else
    raise notice 'FAIL  A''s framework order is now %', ids; failures := failures + 1;
  end if;

  if failures = 0 then
    raise notice '--- ALL PHASE 21 ISOLATION CHECKS PASSED ---';
  else
    raise exception '% Phase 21 isolation check(s) FAILED', failures;
  end if;
end $$;

rollback;
