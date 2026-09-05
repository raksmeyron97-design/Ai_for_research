-- Phase 20 §17-§19: server-side search and filtering for the source library.
--
-- `listCitations` does `select * from research_citations where project_id = ?`
-- with no limit, and `LiteratureWorkspace` filters the result in the browser.
-- That is fine at 12 sources and wrong at 250: the whole library crosses the
-- wire on every load, and every filter is a client-side array scan over rows
-- the researcher never looks at.
--
-- This is one function rather than a set of PostgREST queries because two of
-- the filters §17 asks for are negative — "not linked to evidence", "not
-- cited" — and PostgREST expresses those as a NOT IN over a list of ids the
-- client must first fetch and send back. That is two round trips, an
-- unbounded URL, and a filter whose cost grows with the library it is meant
-- to make cheap. `not exists` in SQL is one index probe per row.
--
-- SECURITY INVOKER (the default -- no `security definer` here), like
-- `match_document_chunks`. The caller's RLS applies to research_citations and
-- to every table joined below, so this function cannot read across projects
-- even if p_project_id were wrong. The project filter is still applied: RLS
-- is the barrier, the parameter is the query.

-- ---------------------------------------------------------------------
-- Indexes.
--
-- Only what the query below actually uses (§18: no speculative indexes).
--
-- pg_trgm is not installed, so this is a tsvector index rather than a
-- trigram one. The practical difference: word and prefix search work,
-- mid-word substring search does not. For a bibliography -- where people
-- search author surnames and title words -- that is the right trade, and it
-- is the reason the identifier columns get their own exact-match path below
-- rather than being folded into the text search.
-- ---------------------------------------------------------------------
-- `array_to_string` is only STABLE (its output depends on the element type's
-- output function), so Postgres refuses it in an index expression. Wrapping
-- it is safe and is the standard answer: over `text[]` with a constant
-- delimiter the result is deterministic, which is what IMMUTABLE asserts.
create function citation_search_text(p_title text, p_authors text[], p_journal text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(p_title, '') || ' ' ||
         coalesce(array_to_string(p_authors, ' '), '') || ' ' ||
         coalesce(p_journal, '');
$$;

create index research_citations_search_idx on research_citations
  using gin (to_tsvector('simple', citation_search_text(title, authors, journal)));

-- The library's default ordering, so an unfiltered first page is an index
-- scan rather than a sort of the whole table.
create index research_citations_project_year_idx
  on research_citations(project_id, year desc nulls last, id);

-- Identifier lookup. A researcher pasting a DOI wants that one row.
create index research_citations_doi_idx on research_citations(lower(doi))
  where doi is not null;
create index research_citations_key_idx on research_citations(project_id, lower(citation_key));

-- research_evidence(citation_id) already has an index from Phase 17, which is
-- what the has_evidence filter probes. Nothing to add for it here (§18: no
-- speculative indexes, and no duplicate ones either).

-- ---------------------------------------------------------------------
-- search_project_sources
--
-- `total_count` comes back on every row via a window function. The
-- alternative is a second count(*) query with the same predicates, which is
-- the same work done twice and can disagree with the page under concurrent
-- writes.
-- ---------------------------------------------------------------------
create function search_project_sources(
  p_project_id uuid,
  p_query text default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_source_types text[] default null,
  p_statuses text[] default null,
  p_has_doi boolean default null,
  p_has_evidence boolean default null,
  p_is_cited boolean default null,
  p_theme_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  project_id uuid,
  citation_key text,
  title text,
  authors text[],
  year integer,
  journal text,
  doi text,
  url text,
  source_type text,
  tier smallint,
  status text,
  pmid text,
  isbn text,
  created_at timestamptz,
  evidence_count bigint,
  claim_count bigint,
  total_count bigint
)
language sql
stable
as $$
  with normalised as (
    select nullif(btrim(p_query), '') as q
  ),
  matched as (
    select
      c.*,
      (select count(*) from research_evidence e where e.citation_id = c.id) as evidence_count,
      -- A claim reaches a source through evidence, not through a key on the
      -- claim row: research_claims -> research_claim_evidence ->
      -- research_evidence -> research_citations. Counting distinct claims,
      -- because two excerpts from the same source supporting one claim is
      -- one claim, not two.
      (select count(distinct ce.claim_id)
         from research_claim_evidence ce
         join research_evidence e on e.id = ce.evidence_id
        where e.citation_id = c.id) as claim_count
    from research_citations c, normalised n
    where c.project_id = p_project_id

      -- Text search over title/authors/journal, OR an identifier prefix. A
      -- pasted DOI and a typed author surname are different intents and both
      -- have to work from the one box the researcher is given.
      and (
        n.q is null
        or to_tsvector('simple', citation_search_text(c.title, c.authors, c.journal))
             @@ websearch_to_tsquery('simple', n.q)
        or lower(c.citation_key) like lower(n.q) || '%'
        or lower(coalesce(c.doi, '')) like lower(n.q) || '%'
        or coalesce(c.pmid, '') like n.q || '%'
        or replace(lower(coalesce(c.isbn, '')), '-', '')
             like replace(lower(n.q), '-', '') || '%'
      )

      -- Every filter below is skipped when its parameter is null, so "no
      -- opinion" and "explicitly false" stay different things. `p_has_doi =>
      -- false` means "show me the ones missing a DOI", which is a real thing
      -- to look for when cleaning a bibliography.
      and (p_year_from is null or c.year >= p_year_from)
      and (p_year_to is null or c.year <= p_year_to)
      and (p_source_types is null or c.source_type = any(p_source_types))
      and (p_statuses is null or c.status = any(p_statuses))
      and (p_has_doi is null or (c.doi is not null and btrim(c.doi) <> '') = p_has_doi)
      and (
        p_theme_id is null
        or exists (
          select 1 from research_theme_sources ts
          where ts.citation_id = c.id and ts.theme_id = p_theme_id
        )
      )
      and (
        p_has_evidence is null
        or exists (select 1 from research_evidence e where e.citation_id = c.id) = p_has_evidence
      )
      -- "Cited" and "has evidence" are different questions, which is why
      -- both filters exist. An excerpt can be saved from a source and never
      -- attached to a sentence; that source has evidence and is not cited.
      and (
        p_is_cited is null
        or exists (
          select 1 from research_claim_evidence ce
          join research_evidence e on e.id = ce.evidence_id
          where e.citation_id = c.id
        ) = p_is_cited
      )
  )
  select
    m.id, m.project_id, m.citation_key, m.title, m.authors, m.year, m.journal,
    m.doi, m.url, m.source_type, m.tier, m.status, m.pmid, m.isbn, m.created_at,
    m.evidence_count, m.claim_count,
    count(*) over () as total_count
  from matched m
  -- `id` last, always. Without a unique tiebreaker two sources published in
  -- the same year can swap places between page 1 and page 2, so a row is
  -- shown twice and another never appears.
  order by m.year desc nulls last, lower(coalesce(m.title, '')), m.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function search_project_sources is
  'Server-side source search for the literature workspace. SECURITY INVOKER: the caller''s RLS decides what is visible, and the project filter is the query rather than the barrier.';

grant execute on function search_project_sources to authenticated;
