import type { SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitConfig {
  bucket: string;
  maxEvents: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

/** Per-user limits for every throttled action (Phase 15 §2 — API abuse, request flooding, token exhaustion). */
export const RATE_LIMITS = {
  /** Shared across every route that calls the AI orchestrator (chat, generate, questionnaire/discussion/conclusion generation) — the thing worth limiting is total AI spend per user, not spend-per-endpoint. */
  aiRequest: { bucket: "ai_request", maxEvents: 60, windowSeconds: 600 } satisfies RateLimitConfig,
  documentUpload: { bucket: "document_upload", maxEvents: 20, windowSeconds: 3600 } satisfies RateLimitConfig,
  datasetUpload: { bucket: "dataset_upload", maxEvents: 20, windowSeconds: 3600 } satisfies RateLimitConfig,
} as const;

/**
 * A soft, best-effort per-user rate limiter backed by `rate_limit_events`
 * (Phase 15). Two properties worth being explicit about:
 *
 * - **Not atomic.** This is a check, then a separate insert — under
 *   concurrent requests right at the boundary a user could slip very
 *   slightly over `maxEvents`. That's an acceptable trade-off for the
 *   actual threat model (a flooding script or a runaway client retry
 *   loop, not a precisely-metered billing boundary — `ai_usage`'s real
 *   cost tracking is unaffected by this and remains the source of truth
 *   for spend).
 * - **Fails open.** If the rate-limit check itself errors (table
 *   unreachable, etc.), the request is allowed through rather than
 *   blocked — a broken rate limiter must never take down the feature
 *   it's protecting. The failure is logged so an outage is still visible
 *   to an admin, not silent.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const cutoff = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("bucket", config.bucket)
    .gte("created_at", cutoff);

  if (error) {
    console.error(
      JSON.stringify({ type: "rate_limit_check_failed", bucket: config.bucket, error: error.message }),
    );
    return { allowed: true, remaining: config.maxEvents };
  }

  const used = count ?? 0;
  if (used >= config.maxEvents) {
    return { allowed: false, remaining: 0, retryAfterSeconds: config.windowSeconds };
  }

  const { error: insertError } = await supabase
    .from("rate_limit_events")
    .insert({ user_id: userId, bucket: config.bucket });
  if (insertError) {
    console.error(
      JSON.stringify({ type: "rate_limit_record_failed", bucket: config.bucket, error: insertError.message }),
    );
  }

  return { allowed: true, remaining: config.maxEvents - used - 1 };
}

export function rateLimitResponseBody(result: RateLimitResult) {
  return {
    error: "Too many requests. Please slow down and try again shortly.",
    retryAfterSeconds: result.retryAfterSeconds,
  };
}
