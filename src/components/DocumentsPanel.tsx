"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResearchCitationRow, ResearchDocumentRow } from "@/lib/db/types";

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  processing: "bg-amber-100 text-amber-700",
  pending: "bg-neutral-100 text-neutral-600",
  failed: "bg-red-100 text-red-700",
};

/**
 * Suggests a citation key from a file name: "Sok_2024_antenatal.pdf" ->
 * "sok2024antenatal". Only a starting point — the key is what the researcher
 * types in their draft, so it stays editable. Restricted to the character set
 * `extractCitationKeys()` can round-trip out of `[key]` brackets.
 */
function suggestCitationKey(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const key = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
  return key.length >= 2 ? key : "source1";
}

/**
 * Per-document source control (Phase 16, finding F2). Linking a document to a
 * source is what makes its retrieved excerpts citable: `match_document_chunks`
 * joins through `research_documents.citation_id` to return a `citation_key`,
 * and the AI context labels each excerpt with it, so a grounded answer can
 * emit a key that citation verification resolves. An unlinked document's
 * excerpts are shown to the model as "source not linked" instead.
 */
function SourceLink({
  projectId,
  document,
  citations,
  onLinked,
  onCitationCreated,
}: {
  projectId: string;
  document: ResearchDocumentRow;
  citations: ResearchCitationRow[];
  onLinked: (document: ResearchDocumentRow) => void;
  onCitationCreated: (citation: ResearchCitationRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState(() => suggestCitationKey(document.file_name));
  const [newTitle, setNewTitle] = useState("");
  const [newYear, setNewYear] = useState("");

  const linked = citations.find((c) => c.id === document.citation_id) ?? null;

  async function link(citationId: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citationId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update the source link");
      onLinked(body as ResearchDocumentRow);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createAndLink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/citations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          citationKey: newKey.trim(),
          title: newTitle.trim() || undefined,
          year: newYear.trim() ? Number(newYear) : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the source");
      onCitationCreated(body.citation as ResearchCitationRow);
      await link((body.citation as ResearchCitationRow).id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-neutral-500">Source:</span>
        {linked ? (
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-800">[{linked.citation_key}]</code>
        ) : (
          <span className="text-amber-700">not linked — excerpts can&rsquo;t be cited</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-neutral-500 underline hover:text-neutral-900"
        >
          {open ? "Cancel" : linked ? "Change" : "Link"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded border border-neutral-200 bg-neutral-50 p-2">
          {citations.length > 0 && (
            <label className="block text-xs">
              <span className="text-neutral-600">Existing source</span>
              <select
                defaultValue={document.citation_id ?? ""}
                disabled={busy}
                onChange={(e) => link(e.target.value || null)}
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                <option value="">— none —</option>
                {citations.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.citation_key}] {c.title ?? "(untitled)"}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-1 border-t border-neutral-200 pt-2">
            <p className="text-xs text-neutral-600">
              {citations.length > 0 ? "Or create a new source" : "Create the source this document is"}
            </p>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="citation key, e.g. sok2024antenatal"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
            />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
            />
            <input
              value={newYear}
              onChange={(e) => setNewYear(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Year (optional)"
              inputMode="numeric"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={createAndLink}
              disabled={busy || newKey.trim().length < 2}
              className="w-full rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Create source & link"}
            </button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function DocumentsPanel({
  projectId,
  documents,
  onDocumentsChange,
  onClose,
}: {
  projectId: string;
  documents: ResearchDocumentRow[];
  onDocumentsChange: (documents: ResearchDocumentRow[]) => void;
  onClose: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citations, setCitations] = useState<ResearchCitationRow[]>([]);

  // Loaded here rather than passed in: the panel is the only place that needs
  // the source list, and it must stay current after a source is created from
  // inside it.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/projects/${projectId}/citations`)
      .then((res) => (res.ok ? res.json() : { citations: [] }))
      .then((body) => {
        if (!cancelled) setCitations(body.citations ?? []);
      })
      .catch(() => {
        // A failed source list degrades the picker to "create new", which is
        // still usable — it should not break the upload form above it.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleLinked = useCallback(
    (updated: ResearchDocumentRow) => {
      onDocumentsChange(documents.map((d) => (d.id === updated.id ? updated : d)));
    },
    [documents, onDocumentsChange],
  );

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append(
      "document_type",
      (form.elements.namedItem("document_type") as HTMLSelectElement).value,
    );

    try {
      const res = await fetch(`/api/research/projects/${projectId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      const { document } = await res.json();
      onDocumentsChange([document, ...documents]);
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: string) {
    const res = await fetch(`/api/research/projects/${projectId}/documents/${documentId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDocumentsChange(documents.filter((d) => d.id !== documentId));
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">Documents</h2>
          <button type="button" onClick={onClose} className="text-sm text-neutral-500 hover:text-neutral-900">
            Close
          </button>
        </div>

        <form onSubmit={handleUpload} className="mb-4 flex flex-col gap-2 border-b border-neutral-200 pb-4">
          <input type="file" name="file" required className="text-sm" />
          <select name="document_type" defaultValue="reference" className="rounded border border-neutral-300 px-2 py-1 text-sm">
            <option value="thesis">Thesis</option>
            <option value="article">Article</option>
            <option value="guideline">Guideline</option>
            <option value="questionnaire">Questionnaire</option>
            <option value="dataset">Dataset</option>
            <option value="reference">Reference</option>
            <option value="template">Template</option>
            <option value="other">Other</option>
          </select>
          <button
            type="submit"
            disabled={uploading}
            className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {uploading ? "Uploading & processing…" : "Upload"}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>

        <ul className="flex-1 space-y-2 overflow-y-auto">
          {documents.length === 0 && (
            <p className="text-sm text-neutral-400">No documents uploaded yet.</p>
          )}
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-start justify-between rounded border border-neutral-200 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{doc.file_name}</p>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[doc.extraction_status] ?? ""}`}>
                  {doc.extraction_status}
                </span>
                <SourceLink
                  projectId={projectId}
                  document={doc}
                  citations={citations}
                  onLinked={handleLinked}
                  onCitationCreated={(citation) => setCitations((prev) => [citation, ...prev])}
                />
              </div>
              <button
                type="button"
                onClick={() => handleDelete(doc.id)}
                className="ml-2 shrink-0 text-xs text-neutral-500 hover:text-red-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
