"use client";

import type { FindingSeverity, MethodologyFinding } from "@/lib/methodology/types";

/**
 * Findings, grouped (§21).
 *
 * Two things this deliberately does not do. It does not use alarming language
 * for ordinary incompleteness — a half-built model is normal work, and a wall
 * of red would teach the researcher to close the panel. And it never renders a
 * deterministic finding and an AI-suggested one identically: the badge is the
 * difference between "no item measures this indicator", which is a fact about
 * the stored rows, and "this wording may be leading", which is a reading.
 */
const GROUPS: { severity: FindingSeverity; heading: string; blurb: string; style: string }[] = [
  {
    severity: "error",
    heading: "Needs attention",
    blurb: "Something in the chain cannot be acted on as it stands.",
    style: "border-red-300 bg-red-50 text-red-900",
  },
  {
    severity: "warning",
    heading: "Gaps",
    blurb: "A link the project has started but not finished.",
    style: "border-amber-300 bg-amber-50 text-amber-900",
  },
  {
    severity: "info",
    heading: "Worth a look",
    blurb: "Prompts to check something, not defects.",
    style: "border-neutral-300 bg-neutral-50 text-neutral-700",
  },
];

const PROVENANCE_BADGE: Record<string, { label: string; style: string }> = {
  deterministic: { label: "CHECKED", style: "bg-neutral-900 text-white" },
  ai_suggested: { label: "AI SUGGESTED", style: "bg-violet-100 text-violet-900" },
  source_stated: { label: "FROM SOURCE", style: "bg-sky-100 text-sky-900" },
  user: { label: "YOURS", style: "bg-neutral-200 text-neutral-800" },
  imported: { label: "IMPORTED", style: "bg-neutral-200 text-neutral-800" },
};

export default function MethodologyFindings({
  findings,
  onNavigate,
}: {
  findings: MethodologyFinding[];
  /** Takes the researcher to the object the finding is about (§21). */
  onNavigate?: (finding: MethodologyFinding) => void;
}) {
  if (findings.length === 0) {
    return (
      <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
        Nothing flagged by these checks. That means the checks passed — not that the methodology is finished.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((group) => {
        const inGroup = findings.filter((f) => f.severity === group.severity);
        if (inGroup.length === 0) return null;

        return (
          <section key={group.severity} aria-labelledby={`findings-${group.severity}`}>
            <h4 id={`findings-${group.severity}`} className="text-xs font-medium text-neutral-700">
              {group.heading} ({inGroup.length})
            </h4>
            <p className="mb-1.5 text-[11px] text-neutral-500">{group.blurb}</p>

            <ul className="space-y-2">
              {inGroup.map((finding) => {
                const badge = PROVENANCE_BADGE[finding.provenance] ?? PROVENANCE_BADGE.deterministic;
                return (
                  <li key={finding.id} className={`rounded border p-2 text-xs ${group.style}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.style}`}>
                        {badge.label}
                      </span>
                      <span className="font-medium">{finding.title}</span>
                    </div>

                    <p className="leading-snug">{finding.explanation}</p>

                    {finding.evidence && (
                      <p className="mt-1 rounded bg-white/70 px-1.5 py-1 font-mono text-[11px] leading-snug">
                        {finding.evidence}
                      </p>
                    )}

                    {finding.remediation && <p className="mt-1 opacity-80">{finding.remediation}</p>}

                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate(finding)}
                        className="mt-1.5 rounded border border-current px-2 py-0.5 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
                      >
                        Go to {finding.targetType.replace(/_/g, " ")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
