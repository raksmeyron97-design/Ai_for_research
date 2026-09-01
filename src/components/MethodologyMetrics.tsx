"use client";

import type { MethodologyMetric } from "@/lib/methodology/types";

/**
 * The methodology health tiles (§20).
 *
 * There is deliberately no single overall score. §14 forbids one, and it is
 * right to: a project can be perfectly traceable and measure the wrong things,
 * so one number would either hide that or imply an endorsement nothing here can
 * make. Nine named dimensions can each be acted on; one average cannot.
 *
 * `null` renders as "—", never as 0%. A project with no constructs has no
 * construct completeness to report, and a 0% bar would read as a failing study
 * rather than an empty model.
 */
const STATUS_STYLE: Record<MethodologyMetric["status"], string> = {
  ok: "text-green-700",
  attention: "text-amber-700",
  incomplete: "text-red-700",
  not_computable: "text-neutral-400",
};

const BAR_STYLE: Record<MethodologyMetric["status"], string> = {
  ok: "bg-green-500",
  attention: "bg-amber-500",
  incomplete: "bg-red-500",
  not_computable: "bg-neutral-200",
};

export default function MethodologyMetrics({
  metrics,
  onSelect,
}: {
  metrics: MethodologyMetric[];
  /** Every tile is a way in to the thing it counts (§20) — a dashboard with no
   *  path to the underlying object is decoration. */
  onSelect?: (metric: MethodologyMetric) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((metric) => {
        const percent = metric.value === null ? null : Math.round(metric.value * 100);
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-neutral-700">{metric.label}</span>
              <span className={`text-xs tabular-nums ${STATUS_STYLE[metric.status]}`}>
                {percent === null ? "—" : `${percent}%`}
              </span>
            </div>

            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-neutral-200"
              role="meter"
              aria-label={metric.label}
              aria-valuenow={percent ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={percent === null ? "not computable" : `${percent}%`}
            >
              {percent !== null && (
                <div className={`h-full ${BAR_STYLE[metric.status]}`} style={{ width: `${percent}%` }} />
              )}
            </div>

            <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
              {metric.evidence ? `${metric.evidence.covered} of ${metric.evidence.total}. ` : ""}
              {metric.reason}
            </p>
          </>
        );

        return (
          <li key={metric.id}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(metric)}
                className="w-full rounded border border-neutral-200 p-2.5 text-left hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                {body}
              </button>
            ) : (
              <div className="rounded border border-neutral-200 p-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
