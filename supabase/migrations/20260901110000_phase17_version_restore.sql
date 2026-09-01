-- Phase 17 §22: restoring a version creates a new one.
--
-- Restore is recorded as its own action rather than reusing 'replace',
-- because "the researcher rolled back to an earlier draft" and "the
-- researcher accepted an AI replacement" are different events and the history
-- is the one place that distinction survives.
--
-- Nothing is deleted: restoring v7 while at v10 produces v11 whose content
-- came from v7, and v8-v10 remain. The table has no update or delete policy,
-- so append-only is enforced by RLS rather than by convention.

alter table research_section_versions
  drop constraint research_section_versions_action_check;

alter table research_section_versions
  add constraint research_section_versions_action_check
  check (action in ('manual', 'insert', 'replace', 'append', 'ai_generate', 'restore'));

-- Which version this one was restored from, so the history can show
-- "restored from 3 Sept 14:22" rather than an unexplained content jump.
alter table research_section_versions
  add column restored_from_version_id uuid references research_section_versions(id) on delete set null;
