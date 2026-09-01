"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<"en" | "km">("en");
  const [discipline, setDiscipline] = useState("");
  const [studyDesign, setStudyDesign] = useState("");
  const [population, setPopulation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/research/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        language,
        discipline: discipline || undefined,
        study_design: studyDesign || undefined,
        target_population: population
          ? population.split(",").map((p) => p.trim()).filter(Boolean)
          : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create project");
      setSubmitting(false);
      return;
    }

    const { project } = await res.json();
    router.push(`/projects/${project.id}`);
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-6 text-xl font-semibold">New Research Project</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Title *
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Maternal mental health before and after childbirth"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Language
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "km")}
            className="rounded border border-neutral-300 px-3 py-2"
          >
            <option value="en">English</option>
            <option value="km">Khmer</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Discipline
          <input
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
            placeholder="e.g. midwifery"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Study design
          <input
            value={studyDesign}
            onChange={(e) => setStudyDesign(e.target.value)}
            placeholder="e.g. Cross-sectional / Mixed-methods"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Target population (comma-separated)
          <input
            value={population}
            onChange={(e) => setPopulation(e.target.value)}
            placeholder="midwives, pregnant women, postpartum women"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create project"}
        </button>
      </form>
    </main>
  );
}
