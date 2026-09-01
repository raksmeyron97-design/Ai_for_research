-- Phase 17: evidence as a first-class research object.
--
-- The chain the workspace needs is Source -> Evidence excerpt -> Claim ->
-- Citation -> Section. Before this, only Source (research_citations) and
-- Section existed. An excerpt lived transiently inside a prompt and was gone
-- afterwards; a claim was never modelled; a citation was a bracket token in
-- free text. Three of the five links did not exist, so nothing could be
-- queried, re-verified later, or counted -- which is also why evidence
-- coverage could not be computed without asking a model to invent the
-- denominator.
--
-- Three tables rather than extra columns: research_citations is a
-- bibliography row, not a claim or an excerpt, and document_chunks is a
-- retrieval artefact with no user-curated meaning.

-- ---------------------------------------------------------------------
-- research_claims -- an assertion made in a section.
--
-- claim_type drives whether evidence is expected at all: an interpretive or
-- user-provided claim legitimately has none, and counting it against evidence
-- coverage would punish honest writing (Phase 17 SS5: "do not treat every
-- sentence as needing a citation").
-- ---------------------------------------------------------------------
create table research_claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  section_type text not null,

  claim_text text not null,
  claim_type text not null default 'factual'
    check (claim_type in (
      'factual', 'statistical', 'clinical', 'comparative',
      'interpretive', 'user_provided', 'inference'
    )),

  -- Denormalised from claim_type at write time so the coverage denominator is
  -- a plain SQL count rather than application logic that could drift.
  needs_evidence boolean not null default true,

  -- Never silently upgraded. A claim only becomes SUPPORTED when a linked
  -- evidence row says so (Phase 17 SS6).
  evidence_status text not null default 'NEEDS_VERIFICATION'
    check (evidence_status in (
      'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED',
      'USER_PROVIDED', 'INFERENCE', 'NEEDS_VERIFICATION'
    )),

  -- Character offsets into the section content the claim was extracted from.
  -- Best-effort: section text changes underneath, so these locate a claim for
  -- review, they do not pin it.
  source_offset_start integer,
  source_offset_end integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_claims_project_idx on research_claims(project_id);
create index research_claims_section_idx on research_claims(project_id, section_type);

-- Target for the composite foreign keys below. RLS alone is NOT enough here:
-- its policies check the row's own project_id, so a user can write a relation
-- row labelled with their own project that points at another project's claim.
-- Verified against the live database before adding this -- the write
-- succeeded. The composite key makes the invariant structural rather than
-- something every future policy has to remember.
alter table research_claims add constraint research_claims_id_project_key unique (id, project_id);

-- ---------------------------------------------------------------------
-- research_evidence -- a curated excerpt from a source.
--
-- citation_id is required: an excerpt with no source is not evidence. The
-- optional chunk_id records which retrieved chunk it came from, so a later
-- re-verification can tell curated evidence from something typed by hand.
-- ---------------------------------------------------------------------
create table research_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  citation_id uuid not null,
  document_id uuid,
  chunk_id uuid references document_chunks(id) on delete set null,

  excerpt text not null,
  page integer,
  section_label text,

  -- Why this excerpt is relevant. Model-written when it comes from a search,
  -- researcher-written when curated by hand; either way it is a note, not a
  -- verdict.
  relevance_note text,

  created_at timestamptz not null default now()
);

create index research_evidence_project_idx on research_evidence(project_id);
create index research_evidence_citation_idx on research_evidence(citation_id);

alter table research_evidence add constraint research_evidence_id_project_key unique (id, project_id);

-- ---------------------------------------------------------------------
-- research_claim_evidence -- the link, carrying the support judgement.
--
-- Support belongs on the relation, not on either side: the same excerpt can
-- support one claim and fail to support another. That is exactly the case
-- Phase 17 SS15 is about -- a citation existing in the database does not mean
-- it supports the claim it was attached to.
-- ---------------------------------------------------------------------
create table research_claim_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  claim_id uuid not null,
  evidence_id uuid not null,

  support text not null default 'NEEDS_REVIEW'
    check (support in ('SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'NEEDS_REVIEW')),
  note text,

  -- Where the citation was inserted, when it was. Null while the researcher
  -- is still deciding.
  inserted_into_section text,
  inserted_at timestamptz,

  created_at timestamptz not null default now(),

  unique (claim_id, evidence_id)
);

create index research_claim_evidence_claim_idx on research_claim_evidence(claim_id);
create index research_claim_evidence_evidence_idx on research_claim_evidence(evidence_id);
create index research_claim_evidence_project_idx on research_claim_evidence(project_id);

-- ---------------------------------------------------------------------
-- Same-project referential integrity, enforced by the database.
--
-- Each of these carries project_id into the foreign key, so a row can only
-- reference a parent belonging to the same project. Without them, the
-- cross-project relation above is writable; with them it fails on the key,
-- regardless of what any RLS policy does or does not check.
-- ---------------------------------------------------------------------
alter table research_citations add constraint research_citations_id_project_key unique (id, project_id);
alter table research_documents add constraint research_documents_id_project_key unique (id, project_id);

alter table research_evidence
  add constraint research_evidence_citation_same_project
    foreign key (citation_id, project_id)
    references research_citations(id, project_id) on delete cascade,
  add constraint research_evidence_document_same_project
    foreign key (document_id, project_id)
    references research_documents(id, project_id) on delete set null;

alter table research_claim_evidence
  add constraint research_claim_evidence_claim_same_project
    foreign key (claim_id, project_id)
    references research_claims(id, project_id) on delete cascade,
  add constraint research_claim_evidence_evidence_same_project
    foreign key (evidence_id, project_id)
    references research_evidence(id, project_id) on delete cascade;

-- ---------------------------------------------------------------------
-- research_frameworks -- persisted conceptual framework (Phase 16 gap 3).
--
-- Stored as a single JSONB document rather than node/edge tables: it is
-- edited and saved as a whole by one researcher, is small, and has no
-- cross-framework queries. Node and edge tables would add joins and RLS
-- surface for no query anyone makes.
--
-- ai_suggested lives inside each node and edge in the JSON, so a suggestion
-- stays marked after the researcher edits around it.
-- ---------------------------------------------------------------------
create table research_frameworks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references research_projects(id) on delete cascade,
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

-- ---------------------------------------------------------------------
-- RLS. Same rule as every other project-scoped table: reachable only through
-- a project the caller owns. This is what gives Phase 17 SS29 its isolation --
-- evidence, claims, relations and frameworks are invisible across projects by
-- the same mechanism, not by a second bespoke check.
-- ---------------------------------------------------------------------
alter table research_claims enable row level security;
alter table research_evidence enable row level security;
alter table research_claim_evidence enable row level security;
alter table research_frameworks enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'research_claims', 'research_evidence', 'research_claim_evidence', 'research_frameworks'
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

grant select, insert, update, delete on research_claims to authenticated;
grant select, insert, update, delete on research_evidence to authenticated;
grant select, insert, update, delete on research_claim_evidence to authenticated;
grant select, insert, update, delete on research_frameworks to authenticated;
