import Link from "next/link";
import { getProjectProgress, listProjects } from "@/lib/db/projects";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardPage() {
  const supabase = await createClient();
  const projects = await listProjects(supabase);
  const withProgress = await Promise.all(
    projects.map(async (project) => ({
      project,
      progress: await getProjectProgress(supabase, project.id),
    })),
  );

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Research Projects</h1>
          <p className="text-sm text-neutral-500">Each project keeps its own context — never mixed with another.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/new"
            className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
          >
            New Project
          </Link>
          <SignOutButton />
        </div>
      </div>

      {withProgress.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No projects yet. Create your first one to get started.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {withProgress.map(({ project, progress }) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block rounded border border-neutral-200 p-4 hover:border-neutral-400"
              >
                <h2 className="font-medium">{project.title}</h2>
                <p className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
                  {project.status} · {project.language === "km" ? "Khmer" : "English"}
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-neutral-900"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-500">{progress.percent}% complete</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
