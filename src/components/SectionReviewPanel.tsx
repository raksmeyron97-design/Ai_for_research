"use client";

import type { ReviewIssue, ReviewMetric, SectionReview } from "@/lib/evidence/section-review-service";

/**
 * Phase 17 §16-§17 / Phase 17B §3.
 *
 * Every bar here is a computed ratio with an explanation attached, not a model
 * opinion. That distinction is the whole design: a researcher shown "Evidence
 * coverage 70%" will reasonably assume the 70 counts something, so it has to.
 * Where a dimension is not computable the bar is absent and the reason is
 * shown, rather than a plausible number standing in for a missing one.
 *
 * The panel renders one normalized `SectionReview` and fetches nothing itself
 * (§4). Scoring lives in `section-review.ts`, where it is tested; a component
 * that recomputed any of it would be a second implementation waiting to drift.
 */
function scoreLabel(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function Meter({ metric }: { metric: ReviewMetric }) {
  const pct = metric.value === null ? 0 : Math.round(metric.value * 100);
  const tone =
    metric.value === null ? "bg-neutral-200" : pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-700">{metric.label}</span>
        <span className="text-xs tabular-nums text-neutral-600">{scoreLabel(metric.value)}</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded bg-neutral-200"
        role="meter"
        aria-label={metric.label}
        aria-valuenow={metric.value === null ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={metric.value === null ? "not applicable" : `${pct}%`}
      >
        {metric.value !== null && <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">{metric.explanation}</p>
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: "border-red-300 bg-red-50 text-red-900",
  MEDIUM: "border-amber-300 bg-amber-50 text-amber-900",
  LOW: "border-neutral-300 bg-neutral-50 text-neutral-700",
};

const ACTION_LABEL: Record<ReviewIssue["action"], string> = {
  find_evidence: "Find evidence",
  verify_citation: "Review citation",
  write_content: "Write section",
  review_alignment: "Check alignment",
  none: "",
};

export default function SectionReviewPanel({
  review,
  loading,
  error,
  onRefresh,
  onAction,
}: {
  review: SectionReview | null;
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onAction?: (issue: ReviewIssue) => void;
}) {
  return (
    <section aria-labelledby="section-health-heading" className="rounded border border-neutral-200 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 id="section-health-heading" className="text-sm font-medium">
          Section health
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <p role="status" aria-live="polite" className="text-xs text-neutral-500">
          Running the section checks…
        </p>
      )}

      {!loading && error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {!loading && !error && !review && (
        <div className="text-xs text-neutral-500">
          <p className="mb-2">This section hasn&rsquo;t been checked yet.</p>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Check this section
          </button>
        </div>
      )}

      {!loading && review && (
        <>
          <div className="space-y-3">
            <Meter metric={review.completeness} />
            <Meter metric={review.evidenceCoverage} />
            <Meter metric={review.alignment} />
            <Meter metric={review.citationIntegrity} />
          </div>

          <h4 className="mt-4 mb-2 text-xs font-medium text-neutral-700">
            Potential issues ({review.issues.length})
          </h4>

          {review.issues.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nothing flagged by these checks. That means the checks above passed, not that the section is finished.
            </p>
          ) : (
            <ul className="space-y-2">
              {review.issues.map((issue, i) => (
                <li key={i} className={`rounded border p-2 text-xs ${SEVERITY_STYLE[issue.severity]}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold">
                      {issue.severity}
                    </span>
                  </div>
                  {issue.claim && <p className="mb-1 italic">“{issue.claim}”</p>}
                  <p>{issue.reason}</p>
                  <p className="mt-1 opacity-80">{issue.recommendation}</p>
                  {onAction && issue.action !== "none" && (
                    <button
                      type="button"
                      onClick={() => onAction(issue)}
                      className="mt-1.5 rounded border border-current px-2 py-0.5 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
                    >
                      {ACTION_LABEL[issue.action]}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
