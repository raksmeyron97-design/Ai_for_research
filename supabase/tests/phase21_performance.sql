-- Phase 21 §30, §31, §49: profile the workspace queries against a realistic
-- library, in real Postgres.
--
-- Every performance claim made before this phase was an argument about the
-- shape of a query. This measures them, on a dataset big enough for the shape
-- to matter, so "the source search is indexed" stops being a comment in a
-- migration and becomes a number.
--
-- The fixture is synthetic and deterministic — generated from generate_series,
-- never copied from anyone's real project (§49). It is deliberately larger
-- than any single thesis:
--
--   150 sources, 240 claims, 180 evidence rows, 300 claim-evidence links,
--   24 constructs, 36 indicators, 60 questionnaire items, 24 hypotheses,
--   24 framework nodes and 40 relationships.
--
-- Budgets (§31) are practical rather than aspirational. These are single
-- queries against a local Docker Postgres with a cold cache, on a laptop that
-- is also running the application: 200ms for an interactive query is a
-- ceiling that catches a sequential scan over the library or an accidental
-- N+1 collapsed into one statement, without failing because a container was
-- busy. They are regression detectors, not SLOs.
--
-- Run with:
--
--   npm run db:profile
--
-- Everything happens inside a transaction that rolls back.

\set ON_ERROR_STOP on
\pset pager off

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001','perf@test.local')
on conflict do nothing;

insert into research_projects (id, user_id, title, language) values
  ('cccccccc-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000001','Perf fixture','en');

-- --------------------------------------------------------------------
-- Literature: 150 sources. Titles and authors are drawn from a small
-- vocabulary on purpose, so a text search matches a realistic *fraction* of
-- the library rather than one row — a search that matches one row out of 150
-- would make any query plan look fast.
-- --------------------------------------------------------------------
insert into research_citations
  (id, project_id, citation_key, title, authors, year, journal, doi, source_type, status)
select
  ('cccccccc-5555-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  'author' || i || (1990 + (i % 35)),
  case i % 4
    when 0 then 'Teacher motivation and student outcomes, study ' || i
    when 1 then 'Student performance in rural schools, report ' || i
    when 2 then 'School climate and retention, paper ' || i
    else 'Assessment practices review ' || i
  end,
  array['Surname' || (i % 20) || ', A.', 'Other' || (i % 7) || ', B.'],
  1990 + (i % 35),
  case i % 3 when 0 then 'Journal of Education' when 1 then 'Educational Review' else 'Teaching Quarterly' end,
  case when i % 5 = 0 then null else '10.1000/perf.' || i end,
  case i % 4 when 0 then 'journal_article' when 1 then 'book' when 2 then 'thesis' else 'report' end,
  case i % 5 when 0 then 'verified' when 1 then 'unverified' when 2 then 'user_provided'
              when 3 then 'source_required' else 'inference' end
from generate_series(1, 150) i;

-- --------------------------------------------------------------------
-- Methodology: constructs, indicators, hypotheses, scale and items.
-- --------------------------------------------------------------------
insert into research_constructs (id, project_id, name, role, conceptual_definition, operational_definition)
select
  ('cccccccc-3333-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  'Construct ' || i,
  case i % 4 when 0 then 'independent' when 1 then 'dependent' when 2 then 'mediator' else 'moderator' end,
  'Conceptual definition ' || i,
  -- A quarter left unmeasured, so the checks have something real to find.
  case when i % 4 = 0 then null else 'Operational definition ' || i end
from generate_series(1, 24) i;

insert into research_indicators (id, project_id, construct_id, name, dimension)
select
  ('cccccccc-4444-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  ('cccccccc-3333-0000-0000-' || lpad(((i % 24) + 1)::text, 12, '0'))::uuid,
  'Indicator ' || i,
  'dimension ' || (i % 3)
from generate_series(1, 36) i;

insert into research_hypotheses (id, project_id, label, statement)
select
  ('cccccccc-8888-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  'H' || i,
  'Construct ' || i || ' predicts construct ' || (i + 1) || '.'
from generate_series(1, 24) i;

insert into research_hypothesis_variables (project_id, hypothesis_id, construct_id, position)
select
  'cccccccc-1111-1111-1111-111111111111',
  ('cccccccc-8888-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  ('cccccccc-3333-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  case i % 2 when 0 then 'predictor' else 'outcome' end
from generate_series(1, 24) i;

insert into research_instruments (id, project_id, name)
values ('cccccccc-9000-0000-0000-000000000001','cccccccc-1111-1111-1111-111111111111','Perf instrument');

insert into questionnaire_questions
  (id, project_id, instrument_id, section_label, question_text, response_type, order_index,
   construct_id, indicator_id)
select
  ('cccccccc-9999-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  'cccccccc-9000-0000-0000-000000000001',
  'Section ' || (i % 5),
  'Item ' || i || ': I find this statement applies to me.',
  'likert',
  i,
  ('cccccccc-3333-0000-0000-' || lpad(((i % 24) + 1)::text, 12, '0'))::uuid,
  ('cccccccc-4444-0000-0000-' || lpad(((i % 36) + 1)::text, 12, '0'))::uuid
from generate_series(1, 60) i;

-- --------------------------------------------------------------------
-- Framework: 24 nodes, 40 relationships.
-- --------------------------------------------------------------------
insert into research_framework_nodes (id, project_id, construct_id, position_y)
select
  ('cccccccc-6666-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  ('cccccccc-3333-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  (i - 1) * 100
from generate_series(1, 24) i;

-- Both endpoints are taken modulo the node count, or the series would name
-- nodes 25..40 which do not exist. The stride of 7 is coprime with 24, so the
-- pairs keep changing instead of repeating every cycle, and self-loops are
-- excluded because the database refuses them by constraint.
insert into research_framework_relationships
  (project_id, from_node_id, to_node_id, relation_type)
select
  'cccccccc-1111-1111-1111-111111111111',
  ('cccccccc-6666-0000-0000-' || lpad(((i % 24) + 1)::text, 12, '0'))::uuid,
  ('cccccccc-6666-0000-0000-' || lpad((((i * 7) % 24) + 1)::text, 12, '0'))::uuid,
  case i % 3 when 0 then 'predicts' when 1 then 'influences' else 'associated_with' end
from generate_series(1, 40) i
where (i % 24) <> ((i * 7) % 24)
-- The unique-edge index still refuses a repeat of the same typed pair.
-- Skipping those keeps the fixture honest rather than tuning the series until
-- it happens not to collide.
on conflict do nothing;

-- --------------------------------------------------------------------
-- Manuscript: sections, 240 claims, 180 evidence rows, 300 links.
-- --------------------------------------------------------------------
insert into research_sections (project_id, section_type, content)
values ('cccccccc-1111-1111-1111-111111111111','results','Results content for the performance fixture.');

insert into research_claims (id, project_id, section_type, claim_text, claim_type)
select
  ('cccccccc-bbbb-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  case i % 4 when 0 then 'results' when 1 then 'discussion' when 2 then 'conclusion' else 'literature_review' end,
  'Claim ' || i || ': the observed association held across subgroups.',
  case i % 3 when 0 then 'factual' when 1 then 'interpretive' else 'statistical' end
from generate_series(1, 240) i;

insert into research_evidence (id, project_id, citation_id, excerpt)
select
  ('cccccccc-aaaa-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'cccccccc-1111-1111-1111-111111111111',
  -- Modulo 120, not 150: thirty sources are left with no evidence at all, so
  -- the "no evidence / uncited" filter has rows to find. A filter measured
  -- against a fixture where nothing matches is measuring an empty answer.
  ('cccccccc-5555-0000-0000-' || lpad(((i % 120) + 1)::text, 12, '0'))::uuid,
  'Excerpt ' || i || ' from the source, quoted for the fixture.'
from generate_series(1, 180) i;

insert into research_claim_evidence (project_id, claim_id, evidence_id)
select
  'cccccccc-1111-1111-1111-111111111111',
  ('cccccccc-bbbb-0000-0000-' || lpad(((i % 240) + 1)::text, 12, '0'))::uuid,
  ('cccccccc-aaaa-0000-0000-' || lpad(((i % 180) + 1)::text, 12, '0'))::uuid
from generate_series(1, 300) i
on conflict do nothing;

analyze;

-- --------------------------------------------------------------------
-- Measure. Each query is run as the owner, under RLS, exactly as the
-- application runs it.
-- --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  t0 timestamptz;
  ms numeric;
  n integer;
  failures integer := 0;
  budget_ms constant numeric := 200;

  procedure_note text;
begin
  raise notice 'fixture: 150 sources, 240 claims, 180 evidence, 24 constructs, 60 items, 24 nodes';
  raise notice 'budget: % ms per interactive query', budget_ms;
  raise notice '---';

  -- 1. Unfiltered first page. The default literature view.
  t0 := clock_timestamp();
  select count(*) into n from search_project_sources('cccccccc-1111-1111-1111-111111111111');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'source search, first page          % rows in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;
  if n <> 25 then raise notice '  FAIL expected a page of 25, got %', n; failures := failures + 1; end if;

  -- 2. Text search across the library. The GIN index is what this measures.
  t0 := clock_timestamp();
  select count(*) into n from search_project_sources(
    'cccccccc-1111-1111-1111-111111111111', 'motivation');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'source search, text query          % rows in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 3. The negative filters. These are the `not exists` probes the function
  -- exists for, and the ones a client-side implementation would have needed
  -- two round trips and the whole library to answer.
  t0 := clock_timestamp();
  select count(*) into n from search_project_sources(
    'cccccccc-1111-1111-1111-111111111111', null, null, null, null, null, null, false, false);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'source search, uncited + no evid.  % rows in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;
  -- The filter has to actually find the thirty sources the fixture leaves
  -- without evidence, or this is timing an empty answer.
  if n = 0 then raise notice '  FAIL negative filter matched nothing'; failures := failures + 1; end if;

  -- 4. The last page. Deep offsets are where a naive pager falls over.
  t0 := clock_timestamp();
  select count(*) into n from search_project_sources(
    'cccccccc-1111-1111-1111-111111111111', null, null, null, null, null, null, null, null, null,
    25, 125);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'source search, last page (off 125) % rows in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 5. Identifier lookup, which has its own index.
  t0 := clock_timestamp();
  select count(*) into n from search_project_sources(
    'cccccccc-1111-1111-1111-111111111111', '10.1000/perf.77');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'source search, DOI lookup          % rows in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 6. Framework load: both lists, as the workspace fetches them.
  t0 := clock_timestamp();
  perform * from research_framework_nodes
    where project_id = 'cccccccc-1111-1111-1111-111111111111'
    order by position_y, position_x, created_at, id;
  perform * from research_framework_relationships
    where project_id = 'cccccccc-1111-1111-1111-111111111111';
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'framework load (nodes + edges)     in % ms', round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 7. A full reorder. One statement over every node in the project.
  t0 := clock_timestamp();
  perform reorder_framework_nodes(
    'cccccccc-1111-1111-1111-111111111111',
    (select array_agg(id order by position_y desc) from research_framework_nodes
      where project_id = 'cccccccc-1111-1111-1111-111111111111'));
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'framework reorder (24 nodes)       in % ms', round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 8. Questionnaire load.
  t0 := clock_timestamp();
  select count(*) into n from questionnaire_questions
   where project_id = 'cccccccc-1111-1111-1111-111111111111';
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'questionnaire load                 % items in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 9. The integrity/cross-system review's whole fetch, which is the largest
  -- read the application makes: every claim, citation, evidence row and link
  -- in the project at once.
  t0 := clock_timestamp();
  perform * from research_claims where project_id = 'cccccccc-1111-1111-1111-111111111111';
  perform * from research_citations where project_id = 'cccccccc-1111-1111-1111-111111111111';
  perform * from research_evidence where project_id = 'cccccccc-1111-1111-1111-111111111111';
  perform * from research_claim_evidence where project_id = 'cccccccc-1111-1111-1111-111111111111';
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'integrity review fetch (all rows)  in % ms', round(ms, 1);
  -- Deliberately a looser ceiling: this one legitimately reads the project.
  if ms > budget_ms * 3 then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  -- 10. The construct trace's per-construct reads (§25). Scoped, so this must
  -- stay far below the whole-project fetch above.
  t0 := clock_timestamp();
  select count(*) into n from questionnaire_questions
   where project_id = 'cccccccc-1111-1111-1111-111111111111'
     and construct_id = 'cccccccc-3333-0000-0000-000000000005';
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'construct trace, items for one     % rows in % ms', n, round(ms, 1);
  if ms > budget_ms then failures := failures + 1; raise notice '  OVER BUDGET'; end if;

  raise notice '---';
  if failures = 0 then
    raise notice '--- ALL PHASE 21 PERFORMANCE BUDGETS MET ---';
  else
    raise exception '% query/queries exceeded budget or returned the wrong shape', failures;
  end if;

  procedure_note := null;
end $$;

rollback;
