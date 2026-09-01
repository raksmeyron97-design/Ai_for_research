-- Phase 16A, finding F7: record whether a row's cost figure is backed by a
-- verified provider rate.
--
-- Until this phase, estimated_cost_usd was computed from a placeholder rate
-- table whose own comment disowned it, and which was wrong by 10-30x against
-- the providers' published prices. The dashboard summed those numbers and
-- presented them like any other total.
--
-- Cost now has two independent sources of doubt, and both must be visible:
--   tokens_measured  - did the provider tell us the token counts?
--   cost_confidence  - do we have a verified price for this model?
-- A dollar figure is only authoritative when both hold.
--
-- Defaults to 'unverified', the honest value for every pre-existing row.

alter table ai_usage
  add column cost_confidence text not null default 'unverified'
    check (cost_confidence in ('verified', 'unverified'));

comment on column ai_usage.cost_confidence is
  'verified = estimated_cost_usd was computed from a rate read from the provider''s published pricing page (see src/lib/ai/pricing.ts). unverified = no rate is on file for this model, or the recorded rate has expired; the cost figure is not authoritative.';

create index ai_usage_cost_confidence_idx on ai_usage(cost_confidence);
