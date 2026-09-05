"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CitationStatus } from "@/lib/db/types";

/**
 * The source list, searched and filtered on the server (Phase 21 §17-§20).
 *
 * Phase 20 built `search_project_sources` and the route in front of it, and
 * then nothing called them: `LiteratureWorkspace` went on fetching
 * `/citations` — every row in the library, unpaginated — and filtering the
 * array in the browser. So the migration that existed to stop the whole
 * library crossing the wire on every load was, in practice, dead code.
 *
 * This is the caller. Every filter below is a database predicate:
 *
 *   * text search runs against a GIN index over title/authors/journal
 *   * "not linked to evidence" and "not cited" are `not exists` probes, which
 *     is the reason the endpoint is one function rather than a set of
 *     PostgREST queries — expressing a negative through PostgREST needs the
 *     client to fetch the id list first and send it back
 *   * paging is `limit`/`offset` over a stable sort, with `id` last so a row
 *     cannot appear on two pages
 *
 * §18: this searches THIS PROJECT'S LIBRARY. Not the internet, not a
 * database of published work. The empty state says so, because "no results"
 * from a search box is otherwise read as "no such research exists".
 */
const PAGE_SIZE = 25;

const STATUS_LABELS: Record<CitationStatus, string> = {
  verified: "Verified",
  source_required: "Source required",
  user_provided: "You provided it",
  inference: "Inferred",
  unverified: "Unverified",
};

/** Three-state, not a checkbox. "No opinion" and "explicitly no" are
 *  different filters — "sources with no DOI" is a real thing to look for when
 *  cleaning a bibliography — and a checkbox can only express two of the
 *  three. */
type Tri = "" | "true" | "false";

export interface SourceSearchRow {
  id: string;
  citation_key: string;
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  source_type: string | null;
  status: CitationStatus;
  evidence_count: number;
  claim_count: number;
}

interface Filters {
  q: string;
  yearFrom: string;
  yearTo: string;
  statuses: CitationStatus[];
  hasDoi: Tri;
  hasEvidence: Tri;
  isCited: Tri;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  yearFrom: "",
  yearTo: "",
  statuses: [],
  hasDoi: "",
  hasEvidence: "",
  isCited: "",
};

export default function SourceSearchPanel({
  projectId,
  themeFilter,
  onClearThemeFilter,
  onOpenSource,
}: {
  projectId: string;
  /** Set when the researcher filtered by a theme from the Themes tab. The id
   *  goes to the server; the name is only for saying which theme. */
  themeFilter?: { id: string; name: string } | null;
  onClearThemeFilter?: () => void;
  onOpenSource: (citationId: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<SourceSearchRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against a stale response overwriting a newer one (§51).
   *
   * Typing "motiv" fires a request per debounce window. They can come back
   * out of order — the network does not promise otherwise — and the last
   * response to arrive wins by default, which is how a search box ends up
   * showing results for a prefix of what it contains. Every request takes a
   * sequence number and only the newest one is allowed to write state.
   */
  const latestRequest = useRef(0);

  const runSearch = useCallback(
    async (active: Filters, activeOffset: number, themeId: string | null) => {
      const seq = ++latestRequest.current;
      setLoading(true);

      const params = new URLSearchParams();
      // Only set parameters the researcher actually chose: an omitted
      // parameter means "no opinion" server-side, and sending an empty string
      // for it would be a different query.
      if (active.q.trim()) params.set("q", active.q.trim());
      if (active.yearFrom) params.set("yearFrom", active.yearFrom);
      if (active.yearTo) params.set("yearTo", active.yearTo);
      if (active.statuses.length) params.set("statuses", active.statuses.join(","));
      if (active.hasDoi) params.set("hasDoi", active.hasDoi);
      if (active.hasEvidence) params.set("hasEvidence", active.hasEvidence);
      if (active.isCited) params.set("isCited", active.isCited);
      if (themeId) params.set("themeId", themeId);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(activeOffset));

      try {
        const res = await fetch(
          `/api/research/projects/${projectId}/sources/search?${params.toString()}`,
        );
        if (seq !== latestRequest.current) return;
        if (!res.ok) throw new Error("Your sources could not be searched. Nothing was changed.");
        const body = await res.json();
        if (seq !== latestRequest.current) return;

        setRows(body.sources ?? []);
        setTotal(body.total ?? 0);
        setFiltered(Boolean(body.filtered));
        setError(null);
      } catch (err) {
        if (seq !== latestRequest.current) return;
        setError((err as Error).message);
      } finally {
        // Also guarded: an older request finishing last would otherwise clear
        // the spinner while the newest one is still in flight.
        if (seq === latestRequest.current) setLoading(false);
      }
    },
    [projectId],
  );

  // Debounced, so a search is one request per pause rather than one per
  // keystroke. Everything except the text box applies immediately — a filter
  // is a decision, not a thing you type through.
  useEffect(() => {
    const delay = filters.q ? 300 : 0;
    const timer = setTimeout(() => {
      void runSearch(filters, offset, themeFilter?.id ?? null);
    }, delay);
    return () => clearTimeout(timer);
  }, [filters, offset, themeFilter?.id, runSearch]);

  /** Any filter change returns to page 1: staying on page 4 of a result set
   *  that now has one page shows an empty list over a non-empty search. */
  function update(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setOffset(0);
  }

  const anyFilter =
    filtered ||
    Boolean(themeFilter) ||
    filters.q.trim() !== "" ||
    filters.statuses.length > 0 ||
    filters.yearFrom !== "" ||
    filters.yearTo !== "" ||
    filters.hasDoi !== "" ||
    filters.hasEvidence !== "" ||
    filters.isCited !== "";

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="source-search" className="sr-only">
            Search your sources
          </label>
          <input
            id="source-search"
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search title, author, journal, DOI or key"
            className="w-full max-w-xs rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
          />
          {themeFilter && (
            <button
              type="button"
              onClick={() => {
                onClearThemeFilter?.();
                setOffset(0);
              }}
              className="rounded border border-neutral-300 px-2 py-1.5 text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Clear theme: {themeFilter.name}
            </button>
          )}
          {anyFilter && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                onClearThemeFilter?.();
                setOffset(0);
              }}
              className="rounded border border-neutral-300 px-2 py-1.5 text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Clear all filters
            </button>
          )}
        </div>

        <details className="rounded border border-neutral-200 px-2 py-1.5">
          {/* Collapsed by default: seven filters above a list is a wall, and
              the search box alone answers most questions. Native <details>
              rather than a custom disclosure, so it is keyboard- and
              screen-reader-correct without any code of ours. */}
          <summary className="cursor-pointer text-xs text-neutral-700">Filters</summary>

          <div className="mt-2 flex flex-wrap gap-3">
            <fieldset className="flex items-end gap-1.5">
              <legend className="sr-only">Publication year</legend>
              <label className="flex flex-col gap-1 text-[11px]">
                Year from
                <input
                  type="number"
                  inputMode="numeric"
                  value={filters.yearFrom}
                  min={1500}
                  max={2200}
                  onChange={(e) => update({ yearFrom: e.target.value })}
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px]">
                Year to
                <input
                  type="number"
                  inputMode="numeric"
                  value={filters.yearTo}
                  min={1500}
                  max={2200}
                  onChange={(e) => update({ yearTo: e.target.value })}
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs"
                />
              </label>
            </fieldset>

            <TriFilter
              id="src-has-doi"
              label="DOI"
              yes="Has a DOI"
              no="Missing a DOI"
              value={filters.hasDoi}
              onChange={(hasDoi) => update({ hasDoi })}
            />
            {/* "Has evidence" and "cited" are different questions, which is
                why both exist: an excerpt can be saved from a source and never
                attached to a sentence. */}
            <TriFilter
              id="src-has-evidence"
              label="Evidence"
              yes="Has saved evidence"
              no="No evidence saved"
              value={filters.hasEvidence}
              onChange={(hasEvidence) => update({ hasEvidence })}
            />
            <TriFilter
              id="src-is-cited"
              label="Cited"
              yes="Cited in the manuscript"
              no="Not cited anywhere"
              value={filters.isCited}
              onChange={(isCited) => update({ isCited })}
            />
          </div>

          <fieldset className="mt-2">
            <legend className="text-[11px] text-neutral-700">Verification status</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(Object.keys(STATUS_LABELS) as CitationStatus[]).map((status) => (
                <label key={status} className="flex items-center gap-1 text-[11px]">
                  <input
                    type="checkbox"
                    checked={filters.statuses.includes(status)}
                    onChange={(e) =>
                      update({
                        statuses: e.target.checked
                          ? [...filters.statuses, status]
                          : filters.statuses.filter((s) => s !== status),
                      })
                    }
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          </fieldset>
        </details>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {/* aria-live so a screen reader hears the result count change; the list
          itself updating silently is the usual failure here. */}
      <p role="status" aria-live="polite" className="mb-2 text-[11px] text-neutral-500">
        {loading && rows === null
          ? "Searching your sources…"
          : total === 0
            ? ""
            : `${total} source${total === 1 ? "" : "s"}${anyFilter ? " match these filters" : " in this library"}` +
              (pages > 1 ? ` · page ${page} of ${pages}` : "")}
      </p>

      {rows !== null && rows.length === 0 ? (
        <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
          {anyFilter ? (
            <>
              No sources in this library match the current search.
              {/* §18: the boundary, stated where the disappointment happens.
                  This box searches what the researcher has collected. */}
              <span className="mt-1 block text-neutral-500">
                This searches the sources you have added to this project, not the published
                literature.
              </span>
            </>
          ) : (
            "No sources yet. Add one from the Documents panel to start building your literature."
          )}
        </p>
      ) : (
        <ul className="space-y-1" aria-busy={loading}>
          {(rows ?? []).map((citation) => (
            <li key={citation.id}>
              <button
                type="button"
                onClick={() => onOpenSource(citation.id)}
                className="w-full rounded border border-neutral-200 p-2 text-left text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                <span className="font-medium">{citation.title ?? citation.citation_key}</span>
                <span className="mt-0.5 block text-[11px] text-neutral-500">
                  {(citation.authors.length ? citation.authors.join(", ") : "Unknown author") +
                    (citation.year ? ` · ${citation.year}` : "")}{" "}
                  · <span className="font-mono">[{citation.citation_key}]</span>
                </span>
                {/* Counts come back with the row from the same query, so the
                    list does not need a second request per source to say
                    whether anything uses it. */}
                <span className="mt-0.5 block text-[11px] text-neutral-500">
                  {citation.evidence_count === 0
                    ? "No evidence saved"
                    : `${citation.evidence_count} excerpt${citation.evidence_count === 1 ? "" : "s"}`}
                  {" · "}
                  {citation.claim_count === 0
                    ? "not cited"
                    : `supports ${citation.claim_count} claim${citation.claim_count === 1 ? "" : "s"}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Source list pages" className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            Previous
          </button>
          <span className="text-[11px] text-neutral-500">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={loading || page >= pages}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

/** Any / yes / no as a select. See the note on `Tri`. */
function TriFilter({
  id,
  label,
  yes,
  no,
  value,
  onChange,
}: {
  id: string;
  label: string;
  yes: string;
  no: string;
  value: Tri;
  onChange: (value: Tri) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Explicit htmlFor rather than a wrapping label: a <label> that wraps a
          <select> folds the selected option's text into the accessible name,
          so this would announce as "DOI Has a DOI". */}
      <label htmlFor={id} className="text-[11px]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as Tri)}
        className="rounded border border-neutral-300 px-2 py-1 text-xs"
      >
        <option value="">Any</option>
        <option value="true">{yes}</option>
        <option value="false">{no}</option>
      </select>
    </div>
  );
}
