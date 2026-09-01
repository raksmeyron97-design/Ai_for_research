import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip static assets and image optimization files. Deliberately does
     * not skip /api — API routes still need the refreshed session cookie
     * (though updateSession() itself exempts /api from the login
     * redirect; routes there return their own 401 JSON instead).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
