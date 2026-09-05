"use client";

import { useMemo, useState } from "react";
import { diffWords } from "@/lib/text/diff-words";
import type { SectionVersionRow } from "@/lib/db/section-versions";

/**
 * Phase 17 §21-§23, closing Phase 16 gap #5.
 *
 * Restore is presented as "create a new version from this one", not as
 * "revert", because that is what it does (§22): the versions in between are
 * kept. Wording it as a revert would imply the intermediate drafts are
 * discarded and make a researcher hesitate to use it.
 */
const ACTION_LABEL: Record<string, string> = {
  manual: "Manual edit",
  insert: "AI insert",
  append: "AI append",
  replace: "AI replace",
  ai_generate: "AI generate",
  restore: "Restored",
  // Distinct from "AI insert" on purpose (§29): the researcher chose a source
  // and the app placed a citation. Calling that an AI rewrite would misreport
  // the one thing the history exists to keep straight.
  evidence_insert: "Evidence insert",
};

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86_400_000).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (sameDay) return `Today — ${time}`;
  if (yesterday) return `Yesterday — ${time}`;
  return `${date.toLocaleDateString()} — ${time}`;
}

/** Net change in words, which is what a researcher scanning history actually wants. */
function delta(version: SectionVersionRow): string {
  const count = (t: string) => (t.match(/\S+/g) ?? []).length;
  const diff = count(version.new_content) - count(version.previous_content);
  if (diff === 0) return "no length change";
  return diff > 0 ? `+${diff} words` : `${diff} words`;
}

export default function VersionHistory({
  versions,
  loading,
  onRestore,
  onClose,
}: {
  versions: SectionVersionRow[];
  loading?: boolean;
  onRestore: (version: SectionVersionRow) => void;
  onClose?: () => void;
}) {
  const [inspecting, setInspecting] = useState<string | null>(null);

  const selected = versions.find((v) => v.id === inspecting) ?? null;
  const diff = useMemo(
    () => (selected ? diffWords(selected.previous_content, selected.new_content) : null),
    [selected],
  );

  return (
    <section aria-labelledby="version-history-heading" className="rounded border border-neutral-200 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 id="version-history-heading" className="text-sm font-medium">
          Version history
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Close
          </button>
        )}
      </div>

      {loading && (
        <p role="status" aria-live="polite" className="text-xs text-neutral-500">
          Loading history…
        </p>
      )}

      {!loading && versions.length === 0 && (
        <p className="text-xs text-neutral-500">
          No saved versions yet. Every edit and accepted AI change will appear here.
        </p>
      )}

      {!loading && versions.length > 0 && (
        <ul className="space-y-1">
          {versions.map((version) => (
            <li key={version.id} className="rounded border border-neutral-200">
              <div className="flex items-center justify-between gap-2 p-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{when(version.created_at)}</p>
                  <p className="text-[11px] text-neutral-500">
                    {ACTION_LABEL[version.action] ?? version.action}
                    {version.model ? ` · ${version.model}` : ""} · {delta(version)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setInspecting((id) => (id === version.id ? null : version.id))}
                    aria-expanded={inspecting === version.id}
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                  >
                    {inspecting === version.id ? "Hide" : "Compare"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRestore(version)}
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                  >
                    Restore
                  </button>
                </div>
              </div>

              {inspecting === version.id && diff && (
                <div className="border-t border-neutral-200 p-2">
                  <p className="mb-1 text-[11px] text-neutral-500">
                    Restoring this creates a new version from it. Nothing after it is deleted.
                  </p>
                  <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">
                    {diff.map((part, i) => (
                      <span
                        key={i}
                        className={
                          part.type === "added"
                            ? "bg-green-100 text-green-900"
                            : part.type === "removed"
                              ? "bg-red-100 text-red-900 line-through"
                              : ""
                        }
                      >
                        {part.text}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
