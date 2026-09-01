import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Only for trusted server-only
 * jobs that must aggregate across every user's data (currently: admin
 * analytics). Never construct this from a request-scoped code path, and
 * never return it or anything derived from it to a caller that hasn't
 * already been verified as an admin (see `isAdminEmail` in `lib/admin/auth`).
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set to use the admin client.",
    );
  }
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}
