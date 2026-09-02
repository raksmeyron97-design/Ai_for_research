-- Phase 20: repair every composite `on delete set null` foreign key.
--
-- Found by executing the Phase 20 isolation suite's deletion checks against
-- real Postgres. The bug is in Phase 17 and Phase 18, not in this phase.
--
-- Since Phase 17 the rule has been: carry project_id into every reference, so
-- a row cannot point at another project's parent. That is right, and it is
-- what the isolation suites prove. But on a *composite* foreign key,
-- `on delete set null` with no column list nulls EVERY referencing column --
-- including project_id, which is `not null` on all of these tables. So the
-- cascade does not unlink the child, it raises:
--
--   null value in column "project_id" ... violates not-null constraint
--
-- and the parent delete fails outright.
--
-- That is a live, user-facing bug, not a theoretical one. Before this
-- migration:
--
--   * deleting a research question with an objective attached failed
--   * deleting an objective or question referenced by a hypothesis failed
--   * deleting a construct, indicator, scale or source referenced by a
--     questionnaire item failed
--   * deleting a document with evidence extracted from it failed
--
-- Each of those is an ordinary thing a researcher does, and each returned a
-- 500. The isolation suites did not catch it because they check that a
-- *stranger* cannot delete a row -- which RLS blocks before any cascade runs.
-- Nobody had tested the owner deleting their own row while a child pointed at
-- it. The Phase 20 suite now does, for the framework tables and for these.
--
-- The fix is the column list, supported since PostgreSQL 15: name the column
-- that should become null and project_id is left alone. Intent is unchanged
-- in every case -- these references were always meant to be severable while
-- the child row survives.
--
-- Constraints must be dropped and recreated: there is no ALTER for a foreign
-- key's delete action. Recreating validates existing rows, which is wanted --
-- if any row already violated its key this would say so rather than trusting
-- that it does not.

-- ---------------------------------------------------------------------
-- Phase 17: evidence keeps its excerpt when the document is removed.
--
-- The original comment on this one says the evidence should survive as a
-- "manually entered" excerpt. That was never what happened -- the delete just
-- failed.
-- ---------------------------------------------------------------------
alter table research_evidence
  drop constraint research_evidence_document_same_project;
alter table research_evidence
  add constraint research_evidence_document_same_project
  foreign key (document_id, project_id) references research_documents(id, project_id)
  on delete set null (document_id);

-- ---------------------------------------------------------------------
-- Phase 18: the methodology chain.
--
-- Every one of these is nullable on purpose -- Phase 18's own comment says an
-- objective written before its question is "ordinary work in progress, not an
-- error", and the consistency engine reports the missing link rather than the
-- database refusing the row. Severing the link on delete is exactly that same
-- decision applied in the other direction.
-- ---------------------------------------------------------------------
alter table research_objectives
  drop constraint research_objectives_question_same_project;
alter table research_objectives
  add constraint research_objectives_question_same_project
  foreign key (question_id, project_id) references research_questions(id, project_id)
  on delete set null (question_id);

alter table research_hypotheses
  drop constraint research_hypotheses_objective_same_project;
alter table research_hypotheses
  add constraint research_hypotheses_objective_same_project
  foreign key (objective_id, project_id) references research_objectives(id, project_id)
  on delete set null (objective_id);

alter table research_hypotheses
  drop constraint research_hypotheses_question_same_project;
alter table research_hypotheses
  add constraint research_hypotheses_question_same_project
  foreign key (question_id, project_id) references research_questions(id, project_id)
  on delete set null (question_id);

-- questionnaire_questions: an item outliving the construct it measured is the
-- state Phase 18's coverage checks are built to report ("this item measures
-- nothing"). Deleting the construct should produce that state, not an error.
alter table questionnaire_questions
  drop constraint questionnaire_questions_construct_same_project;
alter table questionnaire_questions
  add constraint questionnaire_questions_construct_same_project
  foreign key (construct_id, project_id) references research_constructs(id, project_id)
  on delete set null (construct_id);

alter table questionnaire_questions
  drop constraint questionnaire_questions_indicator_same_project;
alter table questionnaire_questions
  add constraint questionnaire_questions_indicator_same_project
  foreign key (indicator_id, project_id) references research_indicators(id, project_id)
  on delete set null (indicator_id);

alter table questionnaire_questions
  drop constraint questionnaire_questions_scale_same_project;
alter table questionnaire_questions
  add constraint questionnaire_questions_scale_same_project
  foreign key (scale_id, project_id) references research_scales(id, project_id)
  on delete set null (scale_id);

-- The source citation is the one case where losing the link changes a claim
-- about provenance: an item marked 'adapted' from a source that is now gone
-- no longer names it. Phase 18's own check constraint requires an adapted
-- item to name a source, so severing this link could leave a row that
-- violates it. That constraint is only enforced on write, so existing rows
-- are not re-checked -- and Phase 18's `item-source-missing` finding is what
-- surfaces the result to the researcher. Failing the delete instead would
-- mean a source can never be removed once any item cites it.
alter table questionnaire_questions
  drop constraint questionnaire_questions_citation_same_project;
alter table questionnaire_questions
  add constraint questionnaire_questions_citation_same_project
  foreign key (source_citation_id, project_id) references research_citations(id, project_id)
  on delete set null (source_citation_id);
