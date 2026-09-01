import type { SupabaseClient } from "@supabase/supabase-js";

export interface CachedResponse {
  status: number;
  body: unknown;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Looks up a previously-saved response for (user, route, client-supplied
 * key). A route calls this before doing expensive/side-effecting work —
 * if a hit comes back, the original response is replayed instead of
 * redoing the work. Returns null on a lookup failure (fails open, the
 * same as the rate limiter — an idempotency-check outage must not block
 * the route it's protecting).
 */
export async function getCachedIdempotentResponse(
  supabase: SupabaseClient,
  userId: string,
  route: string,
  key: string,
): Promise<CachedResponse | null> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("status_code, response_body")
    .eq("user_id", userId)
    .eq("route", route)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error(JSON.stringify({ type: "idempotency_lookup_failed", route, error: error.message }));
    return null;
  }
  if (!data) return null;
  return { status: data.status_code as number, body: data.response_body };
}

/**
 * Saves a response for future replay under the same key — but only a
 * successful (2xx) one. A failed attempt (provider outage, validation
 * error, ...) is deliberately never cached: the point of an idempotency
 * key is "don't redo work that already succeeded," not "remember this
 * failure forever" — a retry after a real failure should always be free
 * to actually retry.
 */
export async function saveIdempotentResponse(
  supabase: SupabaseClient,
  userId: string,
  route: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status < 200 || status >= 300) return;

  const { error } = await supabase
    .from("idempotency_keys")
    .insert({ user_id: userId, route, key, status_code: status, response_body: body as never });

  // A unique-constraint hit means a concurrent request with the same key
  // already saved a response first — not a real error, just a race this
  // table's own constraint resolved correctly.
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error(JSON.stringify({ type: "idempotency_save_failed", route, error: error.message }));
  }
}

/** Reads the client-supplied idempotency key from a request, if any. Idempotency is opt-in per request — a caller that doesn't send this header gets no duplicate protection, the same as before this existed. */
export function getIdempotencyKey(req: Request): string | null {
  return req.headers.get("Idempotency-Key");
}
