"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialogOverlay } from "@/lib/ui/use-dialog-overlay";
import {
  REVIEW_CATEGORY_LABELS,
  type ResearchSystemReview,
  type ReviewCategory,
  type ReviewFinding,
  type ReviewMetric,
} from "@/lib/review/types";
import type { SectionType } from "@/lib/db/types";

/**
 * The cross-system review (§20, §21, §44).
 *
 * §44 is the design constraint that shapes this whole component: no single
 * "Academic Quality: 94/100". A composite score is the one number a
 * researcher would remember and the one number that means nothing — it mixes
 * a broken citation with an unwritten operational definition and reports
 * their average. So the top of this panel is a list of category metrics, each
 * of which says what is missing rather than how good the study is.
 *
 * Nothing here is stored. The review is recomputed on every open (§21), which
 * is why there is a visible "recheck" rather than a cached badge: a stale
 * finding that says a study is consistent after the researcher has just
 * broken it is worse than a slow one.
 */
const CATEGORY_ORDER: ReviewCategory[] = [
  "traceability",
  "evidence",
  "citations",
  "literature",
  "methodology",
  "framework",
  "questionnaire",
  "analysis",
  "provenance",
];

/** Ten cells, so a bar is readable as a proportion without needing the number
 *  beside it — and a `null` metric draws no bar at all rather than an empty
 *  one, because an empty bar reads as zero. */
function MetricBar({ value }: { value: number | null }) {
  if (value === null) return null;
  const filled = Math.round(value * 10);
  return (
    <span aria-hidden="true" className="font-mono text-[11px] tracking-tight text-neutral-700">
      {"█".repeat(filled)}
      {"░".repeat(10 - filled)}
    </span>
  );
}

function MetricRow({ metric }: { metric: ReviewMetric }) {
  const percent = metric.value === null ? null : Math.round(metric.value * 100);

  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-xs font-medium">{metric.label}</span>
        <span className="flex items-center gap-2">
          <MetricBar value={metric.value} />
          {/* "Not computable", never 0%. §21: null is not zero, and a project
              with nothing to check yet has not failed every check. */}
          <span
            className={`text-xs ${
              metric.status === "not_computable"
                ? "text-neutral-500"
                : metric.status === "ok"
                  ? "text-green-700"
                  : metric.status === "attention"
                    ? "text-amber-800"
                    : "text-red-800"
            }`}
          >
            {percent === null ? "Not computable" : `${percent}%`}
          </span>
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-600">{metric.reason}</p>
      {metric.evidence && (
        <p className="text-[11px] text-neutral-500">
          {metric.evidence.covered} of {metric.evidence.total}
        </p>
      )}
    </li>
  );
}

function FindingRow({
  finding,
  onOpen,
}: {
  finding: ReviewFinding;
  onOpen?: (finding: ReviewFinding) => void;
}) {
  return (
    <li className="rounded border border-neutral-200 p-2 text-xs">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            finding.severity === "error"
              ? "bg-red-100 text-red-800"
              : finding.severity === "warning"
                ? "bg-amber-100 text-amber-900"
                : "bg-neutral-100 text-neutral-700"
          }`}
        >
          {finding.severity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{finding.title}</p>
          <p className="mt-0.5 text-neutral-600">{finding.explanation}</p>
          {finding.remediation && <p className="mt-0.5 text-neutral-500">{finding.remediation}</p>}
          {/* §23: a proposal must never look like a fact. */}
          {finding.provenance === "ai_suggested" && (
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
              AI suggested — not checked against your data
            </p>
          )}
          {onOpen && (
            <button
              type="button"
              onClick={() => onOpen(finding)}
              className="mt-1 rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Take me there
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ResearchReviewWorkspace({
  projectId,
  onClose,
  onGoToSection,
  onOpenFramework,
  onOpenMethodology,
}: {
  projectId: string;
  onClose: () => void;
  /** Claims live in the manuscript, so a claim finding goes to the editor. */
  onGoToSection?: (section: SectionType) => void;
  onOpenFramework?: () => void;
  onOpenMethodology?: () => void;
}) {
  const [review, setReview] = useState<ResearchSystemReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const overlayRef = useDialogOverlay(onClose);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/review`);
      if (!res.ok) throw new Error("The research review could not be run.");
      setReview((await res.json()).review);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = useMemo(() => {
    const map = new Map<ReviewCategory, { metrics: ReviewMetric[]; findings: ReviewFinding[] }>();
    for (const category of CATEGORY_ORDER) map.set(category, { metrics: [], findings: [] });
    for (const metric of review?.metrics ?? []) map.get(metric.category)?.metrics.push(metric);
    for (const finding of review?.findings ?? []) map.get(finding.category)?.findings.push(finding);
    return map;
  }, [review]);

  /**
   * Which workspace a finding's work belongs in. §20 asks a finding to lead
   * the researcher to the exact place needing attention; `canOpen` then
   * withholds the button entirely when the caller wired no destination,
   * rather than offering one that goes nowhere.
   */
  function destinationOf(finding: ReviewFinding): "section" | "framework" | "methodology" {
    if (finding.targetType === "claim" || finding.targetType === "section") return "section";
    // Category before target type. "This construct is not in the framework"
    // targets a construct, but the work it asks for is drawing a node — so it
    // belongs in the framework, not in the construct editor. Routing purely
    // by target type sent it to the wrong workspace, which is the opposite of
    // §20's "lead the researcher to the exact place requiring attention".
    if (finding.category === "framework") return "framework";
    if (finding.targetType === "framework_node" || finding.targetType === "framework_relationship") {
      return "framework";
    }
    return "methodology";
  }

  function openTarget(finding: ReviewFinding) {
    const destination = destinationOf(finding);
    if (destination === "section") {
      onGoToSection?.("results");
      onClose();
      return;
    }
    if (destination === "framework") {
      onOpenFramework?.();
      return;
    }
    onOpenMethodology?.();
  }

  function canOpen(finding: ReviewFinding): boolean {
    const destination = destinationOf(finding);
    if (destination === "section") return !!onGoToSection;
    if (destination === "framework") return !!onOpenFramework;
    return !!onOpenMethodology;
  }

  const errorCount = review?.findings.filter((f) => f.severity === "error").length ?? 0;
  const warningCount = review?.findings.filter((f) => f.severity === "warning").length ?? 0;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Research review"
      className="fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-medium">Research review</h2>
          <p className="text-[11px] text-neutral-500">
            How the parts of your study connect — what is traceable, what is missing, and what
            disagrees.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            Recheck
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            Close
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        )}

        {loading && (
          <p role="status" aria-live="polite" className="text-xs text-neutral-500">
            Checking your study against itself…
          </p>
        )}

        {review && !loading && (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {/* A count of what needs attention, deliberately not a score.
                §44: the researcher should learn what to look at, not be
                given a grade. */}
            <p className="text-xs text-neutral-600">
              {review.findings.length === 0
                ? "Nothing inconsistent between the parts of your study. This checks how they connect, not whether the research is right."
                : `${review.findings.length} thing${review.findings.length === 1 ? "" : "s"} to look at` +
                  (errorCount > 0 ? ` — ${errorCount} structural` : "") +
                  (warningCount > 0 ? `, ${warningCount} worth checking` : "") +
                  "."}
            </p>

            {CATEGORY_ORDER.map((category) => {
              const bucket = byCategory.get(category)!;
              if (bucket.metrics.length === 0 && bucket.findings.length === 0) return null;

              return (
                <section
                  key={category}
                  aria-labelledby={`review-cat-${category}`}
                  className="rounded border border-neutral-200 p-3"
                >
                  <h3 id={`review-cat-${category}`} className="text-sm font-medium">
                    {REVIEW_CATEGORY_LABELS[category]}
                  </h3>

                  {bucket.metrics.length > 0 && (
                    <ul className="mt-1 divide-y divide-neutral-100">
                      {bucket.metrics.map((m) => (
                        <MetricRow key={m.id} metric={m} />
                      ))}
                    </ul>
                  )}

                  {bucket.findings.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {bucket.findings.map((f) => (
                        <FindingRow
                          key={f.id}
                          finding={f}
                          onOpen={canOpen(f) ? openTarget : undefined}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
