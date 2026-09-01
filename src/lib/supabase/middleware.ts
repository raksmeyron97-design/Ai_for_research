import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/auth/callback"];

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr — without this, server components can see an expired
 * session) and redirects unauthenticated users away from protected
 * routes. This is the standard Supabase + Next.js middleware pattern.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // If Supabase env vars are missing/invalid, createServerClient() throws
  // synchronously — which, unhandled, would 500 *every* request including
  // /login itself. Fail open instead: let the request through unmodified.
  // Pages/routes downstream already handle "no session" gracefully (see
  // requireUserId()'s try/catch pattern in every API route), so this
  // keeps that same behavior consistent at the middleware layer rather
  // than making config problems fatal here specifically.
  let supabase;
  try {
    supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          },
        },
      },
    );
  } catch {
    return response;
  }

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    return response;
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  const isApiPath = request.nextUrl.pathname.startsWith("/api");

  if (!user && !isPublicPath && !isApiPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}
