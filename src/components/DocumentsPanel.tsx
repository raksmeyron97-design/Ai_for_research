"use client";

import { useState } from "react";
import type { ResearchDocumentRow } from "@/lib/db/types";

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  processing: "bg-amber-100 text-amber-700",
  pending: "bg-neutral-100 text-neutral-600",
  failed: "bg-red-100 text-red-700",
};

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
            <li key={doc.id} className="flex items-center justify-between rounded border border-neutral-200 p-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.file_name}</p>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[doc.extraction_status] ?? ""}`}>
                  {doc.extraction_status}
                </span>
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
