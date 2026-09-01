import { NextResponse } from "next/server";
import { AdminAnalyticsError, compileAdminAnalytics } from "@/lib/admin/analytics";
import { isAdminEmail } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Admin analytics is not configured (SUPABASE_SERVICE_ROLE_KEY missing)" },
      { status: 503 },
    );
  }

  try {
    const summary = await compileAdminAnalytics(admin);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof AdminAnalyticsError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
