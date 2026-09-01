-- Phase 16, finding F6: distinguish measured token counts from estimated ones.
--
-- token-manager.ts falls back to estimateTokens() (~4 chars/token) whenever a
-- provider reports no usage metadata. Until the streaming adapters were fixed
-- in this phase, that was *every* /api/ai/chat call — the highest-volume AI
-- route — so the admin dashboard's cost figures were built mostly on
-- estimates while presenting them exactly like measurements.
--
-- The streaming paths now report real usage, but the fallback still exists
-- (a provider can omit usage, and a mid-stream failure may cut off before it
-- arrives). This column makes the difference visible instead of implicit, so
-- the dashboard can say what share of its cost total is actually measured.
--
-- Defaults to false, which is the honest value for every row written before
-- this migration: those were estimates.

alter table ai_usage
  add column tokens_measured boolean not null default false;

comment on column ai_usage.tokens_measured is
  'True when input/output token counts came from the provider''s own usage metadata; false when they were locally estimated from text length. Rows predating Phase 16 are all false.';

create index ai_usage_tokens_measured_idx on ai_usage(tokens_measured);
