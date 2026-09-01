import { notFound } from "next/navigation";
import ProjectWorkspace from "@/components/ProjectWorkspace";
import { listDocuments } from "@/lib/db/documents";
import { getProject } from "@/lib/db/projects";
import { listSections } from "@/lib/db/sections";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const project = await getProject(supabase, projectId);
  if (!project) notFound();

  const [sections, documents] = await Promise.all([
    listSections(supabase, projectId),
    listDocuments(supabase, projectId),
  ]);

  return <ProjectWorkspace project={project} initialSections={sections} initialDocuments={documents} />;
}
