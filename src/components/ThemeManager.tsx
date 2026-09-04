"use client";

import { useEffect, useState } from "react";
import type { ResearchCitationRow, ResearchThemeRow, ResearchThemeSourceRow } from "@/lib/db/types";
import type { ThemeSuggestion } from "@/lib/evidence/theme-suggestions";

/**
 * Literature themes (§22).
 *
 * A suggestion is rendered as a proposal — labelled `AI SUGGESTED`, sitting
 * outside the theme list, with a Confirm button — because the alternative
 * (write the rows, flag them, let the researcher clean up) makes the model's
 * filing the default and the researcher's the correction. Confirming is what
 * creates the row; discarding leaves no trace.
 */
export default function ThemeManager({
  projectId,
  citations,
  onFilter,
}: {
  projectId: string;
  citations: ResearchCitationRow[];
  /** Filters the Sources tab to a theme, which is what makes themes useful rather than decorative. */
  /** Filter the Sources tab by this theme. Phase 21: the theme's identity,
   *  not the list of citation ids assigned to it — the Sources tab filters on
   *  the server now, so it needs the predicate rather than a precomputed
   *  answer that goes stale the moment an assignment changes. */
  onFilter?: (theme: { id: string; name: string } | null) => void;
}) {
  const [themes, setThemes] = useState<ResearchThemeRow[]>([]);
  const [assignments, setAssignments] = useState<ResearchThemeSourceRow[]>([]);
  const [suggestions, setSuggestions] = useState<ThemeSuggestion[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/research/projects/${projectId}/themes`);
      if (!res.ok) throw new Error("Themes could not be loaded.");
      const body = await res.json();
      setThemes(body.themes ?? []);
      setAssignments(body.assignments ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function createTheme(name: string, description?: string, citationIds?: string[], aiSuggested?: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/themes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, citationIds, aiSuggested }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That theme could not be created.");
      await load();
      setNewName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeTheme(themeId: string) {
    setBusy(true);
    try {
      await fetch(`/api/research/projects/${projectId}/themes/${themeId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleSource(themeId: string, citationId: string, assigned: boolean) {
    setBusy(true);
    try {
      if (assigned) {
        await fetch(
          `/api/research/projects/${projectId}/themes/${themeId}/sources?citationId=${citationId}`,
          { method: "DELETE" },
        );
      } else {
        await fetch(`/api/research/projects/${projectId}/themes/${themeId}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ citationId }),
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/themes/suggest`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Theme suggestions could not be generated.");
      setSuggestions(body.suggestions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sourcesFor = (themeId: string) =>
    assignments.filter((a) => a.theme_id === themeId).map((a) => a.citation_id);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="new-theme" className="text-[11px] font-medium text-neutral-500">
            New theme
          </label>
          <input
            id="new-theme"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Screening barriers"
            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={() => createTheme(newName.trim())}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Create theme
        </button>
        <button
          type="button"
          disabled={busy || citations.length < 2}
          onClick={suggest}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Suggest themes
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-800">
          {error}
        </p>
      )}

      {suggestions && suggestions.length > 0 && (
        <section aria-labelledby="suggested-themes" className="rounded border border-dashed border-neutral-400 p-3">
          <h4 id="suggested-themes" className="mb-2 text-xs font-medium">
            Suggested groupings
          </h4>
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="rounded border border-neutral-200 p-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700">
                    AI SUGGESTED
                  </span>
                  <span className="font-medium">{s.name}</span>
                </div>
                {s.description && <p className="mt-1 text-[11px] text-neutral-600">{s.description}</p>}
                <p className="mt-1 text-[11px] text-neutral-500">
                  {s.citationIds.length} source{s.citationIds.length === 1 ? "" : "s"}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void createTheme(s.name, s.description, s.citationIds, true);
                      setSuggestions((prev) => (prev ?? []).filter((_, j) => j !== i));
                    }}
                    className="rounded bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestions((prev) => (prev ?? []).filter((_, j) => j !== i))}
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px]"
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loaded && themes.length === 0 ? (
        <div className="rounded border border-neutral-200 p-4 text-center">
          <p className="mb-2 text-neutral-600">No themes yet.</p>
          <p className="text-[11px] text-neutral-500">
            Group your sources so you can see what the literature covers — and what it does not.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {themes.map((theme) => {
            const assigned = sourcesFor(theme.id);
            return (
              <li key={theme.id} className="rounded border border-neutral-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-medium">{theme.name}</h4>
                      {theme.ai_suggested && (
                        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700">
                          AI SUGGESTED
                        </span>
                      )}
                    </div>
                    {theme.description && <p className="mt-0.5 text-[11px] text-neutral-600">{theme.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {onFilter && (
                      <button
                        type="button"
                        onClick={() => onFilter({ id: theme.id, name: theme.name })}
                        className="rounded border border-neutral-300 px-2 py-1 text-[11px]"
                      >
                        Filter
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeTheme(theme.id)}
                      className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <fieldset className="mt-2">
                  <legend className="sr-only">Sources in {theme.name}</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {citations.map((citation) => {
                      const isAssigned = assigned.includes(citation.id);
                      return (
                        <label
                          key={citation.id}
                          className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
                            isAssigned ? "border-neutral-900 bg-neutral-100" : "border-neutral-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            disabled={busy}
                            onChange={() => toggleSource(theme.id, citation.id, isAssigned)}
                            className="h-3 w-3"
                          />
                          {citation.citation_key}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
