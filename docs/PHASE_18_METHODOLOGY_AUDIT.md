# Phase 18A — Methodology Domain Audit

Written before any Phase 18 code, as §5 and §50 require. It records what the
repository actually contains, where the methodology chain is already modelled,
where it is only prose, and which of the two competing representations is
canonical going forward.

## 1. Repository state at phase start

- Branch at start: `feat/phase-17b-evidence-literature-workspace`, commit `981b09f`.
- **Phase 17B is NOT merged into `main`.** `main` is still `2dd79d5`. `git branch
  --contains 981b09f` lists only the feature branch.
- Phase 18 therefore branches from `981b09f`, not from `main`. Building on
  `main` would silently drop the entire evidence and literature workspace that
  Phase 18's measurement chain has to attach to.
- Baseline: 935 tests / 94 files, lint, typecheck, build and the offline dry
  benchmark clean.

## 2. The chain, and where each link currently lives

| Link | Where it lives today | Structured? |
| --- | --- | --- |
| Research question | `research_sections` row, `section_type='research_questions'` | **No — free text** |
| Objective | `research_sections`, `section_type='objectives'` | **No — free text** |
| Variable / construct | `research_sections`, `section_type='variables'` | **No — free text** |
| Conceptual framework | `research_frameworks.graph` JSONB (nodes + edges) | Partly — graph only, no editor |
| Hypothesis | nowhere | **No** |
| Operational definition | nowhere | **No** |
| Indicator | nowhere | **No** |
| Measurement item | `questionnaire_questions` | Yes, but unmapped |
| Questionnaire | `research_instruments` + `questionnaire_questions` | Yes |
| Analysis plan | `research_sections`, `section_type='data_analysis'` | **No — free text** |
| Source / evidence | Phase 17/17B tables | Yes |

The Phase 6 migration says this in its own header, plainly:

> Objectives/variables are NOT normalized into their own tables here — they
> still live as free text in research_sections. Each question maps to an
> objective/variable/construct as descriptive text (`objective_label` /
> `variable_label`), not a foreign key, because there is no structured
> objectives/variables entity to reference yet.

**That is the whole Phase 18 gap.** The questionnaire already wants to point at
objectives, variables and constructs, and has been pointing at *strings*
because there was nothing to point at. Every consistency question Phase 18 asks
— "does this item measure anything?", "is this construct measured at all?" —
is unanswerable while the target of the reference is a label a researcher
retyped slightly differently.

## 3. The two competing representations

There are exactly two, and they must not become three.

1. **Prose** in `research_sections` — what the thesis document says. This is
   what gets exported, and it is what the researcher writes.
2. **Structure** in the new Phase 18 tables — what the consistency engine
   reasons over.

**Canonical decision:** the structured tables are canonical *for reasoning*;
the section prose stays canonical *for the document*. Neither is derived from
the other automatically, because both directions of automatic derivation are
wrong: parsing prose into constructs would silently invent structure the
researcher never approved, and generating prose from structure would overwrite
writing.

Compatibility strategy, therefore:

- **No destructive migration.** No `research_sections` row is read, rewritten
  or dropped by Phase 18. Existing projects keep everything they have.
- The structured model starts **empty** for every existing project, and an
  empty model produces `null` metrics — "not computable" — never zeros that
  would read as failures.
- `questionnaire_questions.objective_label` / `variable_label` / `construct`
  are **kept**. They are the free-text mapping that already exists and may be
  all a project has. New nullable id columns are added beside them; a
  deterministic finding reports "this item names a construct in text but is not
  linked to one", which is a prompt to link, not a data loss.

## 4. What already exists and must be reused, not rebuilt

| Concern | Existing implementation | Phase 18 use |
| --- | --- | --- |
| Route authorisation | `src/lib/api/authorize.ts` — `authorizeProject`, `dbErrorResponse` | Every new route |
| Metric contract | `ReviewMetric` in `section-review-service.ts`, `value: number \| null` | Same shape for methodology metrics |
| AI proposal pattern | `claim-extraction.ts` — minimal context, Zod + JSON Schema pair, `parseAIJson`, derived fields never taken from the model | Every methodology suggestion |
| Structured output parsing | `parse-ai-json.ts` (`parseAIJson`, no repair, no partial persist) | Unchanged |
| Injection defence | `research-integrity-guard.ts` §6 rule + `detectPromptInjection` | Unchanged; new fixtures added |
| Deterministic mock provider | `ai/testing/mock-provider.ts` (`withMockProvider` patches providers in place) | All AI tests |
| In-memory Supabase | `ai/testing/in-memory-supabase.ts` | Workflow tests |
| Framework structural checks | `evidence/framework-validation.ts` | Reused; its `variables`/`objectives` context now comes from the canonical tables |
| Provenance vocabulary | Phase 17B `field_provenance`, `GapBasis`, `ai_suggested`/`confirmed` | Same vocabulary, not a new one |
| Version/restore discipline | `section-versions.ts` — write the target first, then append | Same rule for methodology history |
| Responsive shell | `WorkspacePanes` (one DOM tree, panes stay mounted) | Methodology workspace mounts into it |
| Overlay workspace | `LiteratureWorkspace` (full-screen over the editor) | Methodology workspace mirrors it |

## 5. Deliberate non-tables

§25 warns against creating every entity it lists. Two are deliberately **not**
created:

- **`methodology_findings` / `methodology_reviews`.** Findings are derived from
  state. Persisting them creates a second source of truth that goes stale the
  moment a construct is renamed, and Phase 17B already established the opposite
  precedent: `SectionReview` is computed on request and the coverage number is
  recounted from rows rather than remembered. Methodology review follows it.
- **A dimensions table.** A dimension is a label grouping indicators under a
  construct. It becomes a column on the indicator, not a table with one text
  column and a foreign key.

## 6. Canonical Phase 18 model

```
research_questions ──< research_objectives
                            │
research_constructs ────────┘  (construct carries its study role:
   │                            independent / dependent / mediator /
   │                            moderator / control / demographic / latent)
   ├──< research_indicators (dimension is a column, not a table)
   │        │
   │        └──< questionnaire_questions.indicator_id
   └──< questionnaire_questions.construct_id

research_hypotheses ──< research_hypothesis_variables >── research_constructs
   │
   └── objective_id / question_id / analysis_method

research_scales ──< questionnaire_questions.scale_id

methodology_events  (append-only audit of every consequential change)
```

**Why one construct table instead of `constructs` + `variables`.** A construct
is the concept; a variable is the role that concept plays in the study. Two
tables would need a join for every check and would drift the moment someone
renames one side — and the app would then have two names for the same thing,
which is exactly the confusion the consistency engine exists to detect. A
`role` column on the construct expresses the same information, keeps
"undefined variable used in hypothesis" a single lookup, and maps cleanly onto
the conceptual-framework node roles that already exist.

**Why hypothesis→construct is a link table.** A hypothesis names several
constructs in different positions (predictor, outcome, mediator, moderator,
control). That position is a property of the *relationship*, not of either
side — the same construct is an outcome in H1 and a predictor in H2. This is
the identical argument that put `support` on `research_claim_evidence` in
Phase 17 rather than on the claim or the evidence.

## 7. Isolation strategy

Every new table follows the rule Phase 17 arrived at by finding the hole:
`project_id` on every row **plus** composite foreign keys carrying `project_id`
into every reference, so a row cannot point at another project's parent even if
a policy were written wrongly. `questionnaire_questions` and
`research_citations` gain the `(id, project_id)` unique keys they need to be
composite-referenceable.

## 8. Open question deferred to implementation

The conceptual framework (§34) currently stores free-text node labels. Once
constructs are canonical, a framework node should reference a construct id. The
graph is JSONB, so this is an additive optional field on the node rather than a
migration — and unlinked nodes stay legal, because a researcher sketching a
framework before naming constructs is normal work, not an error.
