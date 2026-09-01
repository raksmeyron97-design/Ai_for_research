"use client";

import type { SectionHealth } from "@/lib/evidence/section-review";

/**
 * Phase 17 §16-§17, closing Phase 16 gap #2.
 *
 * Every bar here is a computed ratio with an explanation attached, not a model
 * opinion. That distinction is the whole design: a researcher shown "Evidence
 * coverage 70%" will reasonably assume the 70 counts something, so it has to.
 * Where a dimension is not computable the bar is absent and the reason is
 * shown, rather than a plausible number standing in for a missing one.
 */
function scoreLabel(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function Meter({ label, value, explanation }: { label: string; value: number | null; explanation: string }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  const tone = value === null ? "bg-neutral-200" : pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-700">{label}</span>
        <span className="text-xs tabular-nums text-neutral-600">{scoreLabel(value)}</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded bg-neutral-200"
        role="meter"
        aria-label={label}
        aria-valuenow={value === null ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={value === null ? "not applicable" : `${pct}%`}
      >
        {value !== null && <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">{explanation}</p>
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: "border-red-300 bg-red-50 text-red-900",
  MEDIUM: "border-amber-300 bg-amber-50 text-amber-900",
  LOW: "border-neutral-300 bg-neutral-50 text-neutral-700",
};

export default function SectionReviewPanel({
  health,
  loading,
  onRefresh,
  onAction,
}: {
  health: SectionHealth | null;
  loading?: boolean;
  onRefresh: () => void;
  onAction?: (action: string, claim?: string) => void;
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

      {!loading && !health && (
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

      {!loading && health && (
        <>
          <div className="space-y-3">
            <Meter label="Completeness" value={health.completeness} explanation={health.explanations.completeness} />
            <Meter
              label="Evidence coverage"
              value={health.evidenceCoverage}
              explanation={health.explanations.evidenceCoverage}
            />
            <Meter
              label="Research alignment"
              value={health.researchAlignment}
              explanation={health.explanations.researchAlignment}
            />
            <Meter
              label="Citation integrity"
              value={health.citationIntegrity}
              explanation={health.explanations.citationIntegrity}
            />
          </div>

          <h4 className="mt-4 mb-2 text-xs font-medium text-neutral-700">
            Potential issues ({health.findings.length})
          </h4>

          {health.findings.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nothing flagged by these checks. That means the checks above passed, not that the section is finished.
            </p>
          ) : (
            <ul className="space-y-2">
              {health.findings.map((finding, i) => (
                <li key={i} className={`rounded border p-2 text-xs ${SEVERITY_STYLE[finding.severity]}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold">
                      {finding.severity}
                    </span>
                  </div>
                  {finding.claim && <p className="mb-1 italic">“{finding.claim}”</p>}
                  <p>{finding.reason}</p>
                  <p className="mt-1 opacity-80">{finding.recommendation}</p>
                  {onAction && finding.action !== "none" && (
                    <button
                      type="button"
                      onClick={() => onAction(finding.action, finding.claim)}
                      className="mt-1.5 rounded border border-current px-2 py-0.5 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
                    >
                      {finding.action === "find_evidence"
                        ? "Find evidence"
                        : finding.action === "verify_citation"
                          ? "Review citation"
                          : finding.action === "write_content"
                            ? "Write section"
                            : "Check alignment"}
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
