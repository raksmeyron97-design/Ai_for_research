import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (route handlers, server components). Reads
 * the caller's session from cookies so RLS policies apply per-user. Never
 * use the service-role key here — that belongs only in trusted server-only
 * jobs (e.g. admin analytics aggregation), never in a request-scoped client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll is called from a Server Component sometimes; middleware
            // refreshes the session there instead, so this can be ignored.
          }
        },
      },
    },
  );
}

/** Returns the authenticated user's id, or null. Every AI/API route must check this before doing work (Section 39). */
export async function requireUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
