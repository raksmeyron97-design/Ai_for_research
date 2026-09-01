"use client";

import { useState } from "react";

interface QualityScoreBreakdown {
  methodology: number;
  evidence: number;
  alignment: number;
  writing: number;
  references: number;
  dataIntegrity: number;
  overall: number;
}

interface Issue {
  severity: "critical" | "high" | "medium" | "low" | "informational";
  category: string;
  section?: string;
  message: string;
  recommendation?: string;
}

const SEVERITY_STYLE: Record<Issue["severity"], string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-neutral-100 text-neutral-600",
  informational: "bg-blue-100 text-blue-700",
};

const SCORE_LABELS: [keyof QualityScoreBreakdown, string][] = [
  ["methodology", "Methodology"],
  ["evidence", "Evidence"],
  ["alignment", "Alignment"],
  ["writing", "Writing"],
  ["references", "References"],
  ["dataIntegrity", "Data Integrity"],
  ["overall", "Overall"],
];

export default function QualityCheckPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    scores: QualityScoreBreakdown;
    issues: Issue[];
    scoresAvailable: boolean;
    disclaimer: string;
  } | null>(null);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/quality-check`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Quality check failed");
      }
      setResult(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">Quality Check</h2>
          <button type="button" onClick={onClose} className="text-sm text-neutral-500 hover:text-neutral-900">
            Close
          </button>
        </div>

        {!result && (
          <button
            type="button"
            onClick={runCheck}
            disabled={loading}
            className="mb-4 rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Checking…" : "Run quality check"}
          </button>
        )}
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {result && (
          <div className="flex-1 overflow-y-auto">
            <p className="mb-3 text-xs italic text-neutral-500">{result.disclaimer}</p>

            {/*
              A failed scorer returns zeros, which are the same shape as a
              genuine score of 0. Showing them as numbers would read as a
              damning assessment of the project rather than a check that did
              not run (Phase 16A, F10).
            */}
            {result.scoresAvailable ? (
              <div className="mb-4 grid grid-cols-2 gap-2">
                {SCORE_LABELS.map(([key, label]) => (
                  <div key={key} className="rounded border border-neutral-200 p-2">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="text-lg font-semibold">{Math.round(result.scores[key])}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                No scores were produced for this run — see the issues below. This is not a score of zero.
              </p>
            )}

            <h3 className="mb-2 text-sm font-medium">Issues ({result.issues.length})</h3>
            <ul className="space-y-2">
              {result.issues.map((issue, i) => (
                <li key={i} className="rounded border border-neutral-200 p-2 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY_STYLE[issue.severity]}`}>
                      {issue.severity}
                    </span>
                    <span className="text-xs text-neutral-500">{issue.category}</span>
                    {issue.section && <span className="text-xs text-neutral-400">· {issue.section}</span>}
                  </div>
                  <p>{issue.message}</p>
                  {issue.recommendation && (
                    <p className="mt-1 text-xs text-neutral-500">→ {issue.recommendation}</p>
                  )}
                </li>
              ))}
              {result.issues.length === 0 && (
                <p className="text-sm text-neutral-400">No issues found.</p>
              )}
            </ul>

            <button
              type="button"
              onClick={runCheck}
              disabled={loading}
              className="mt-4 rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {loading ? "Checking…" : "Run again"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
