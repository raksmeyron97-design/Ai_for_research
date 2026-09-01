import { notFound } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";
import { AdminAnalyticsError, compileAdminAnalytics } from "@/lib/admin/analytics";
import { isAdminEmail } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // notFound() rather than a 403 page — a non-admin shouldn't learn this
  // route exists at all.
  if (!user || !isAdminEmail(user.email)) notFound();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-xl font-semibold">Admin Analytics</h1>
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Not configured: <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set in this environment.
        </p>
      </main>
    );
  }

  let summary;
  try {
    summary = await compileAdminAnalytics(admin);
  } catch (err) {
    const message = err instanceof AdminAnalyticsError ? err.message : "Failed to load analytics.";
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-xl font-semibold">Admin Analytics</h1>
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-xl font-semibold">Admin Analytics</h1>
      <p className="mt-1 text-sm text-neutral-500">
        AI usage, cost, and project activity across every researcher — visible only to admin accounts.
      </p>
      <AdminDashboard initialSummary={summary} />
    </main>
  );
}
