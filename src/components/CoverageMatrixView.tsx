"use client";

import type { CoverageMatrix } from "@/lib/methodology/coverage";

/**
 * The coverage matrix (§12).
 *
 * Construct → dimension → indicator → item, showing what covers what. It
 * deliberately shows no target item count: §12 says not to invent one, and
 * three-per-indicator is a convention from one measurement tradition, not a
 * fact. Printing it as a target would turn a convention into a requirement the
 * researcher never chose, so "enough" stays their judgement.
 */
export default function CoverageMatrixView({
  matrix,
  onSelectIndicator,
  onSelectItem,
}: {
  matrix: CoverageMatrix;
  onSelectIndicator?: (indicatorId: string) => void;
  onSelectItem?: (itemId: string) => void;
}) {
  if (matrix.constructs.length === 0) {
    return (
      <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
        No constructs yet. Add the concepts your questions are about, and this will show which of them your
        questionnaire actually measures.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {matrix.constructs.map((construct) => {
        const byDimension = new Map<string, typeof construct.indicators>();
        for (const indicator of construct.indicators) {
          const key = indicator.dimension ?? "";
          byDimension.set(key, [...(byDimension.get(key) ?? []), indicator]);
        }

        return (
          <section
            key={construct.constructId}
            aria-labelledby={`coverage-${construct.constructId}`}
            className="rounded border border-neutral-200 p-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 id={`coverage-${construct.constructId}`} className="text-xs font-medium">
                {construct.name}
              </h4>
              <span className="text-[11px] text-neutral-500">
                {construct.indicators.length === 0
                  ? "no indicators"
                  : `${construct.indicators.filter((i) => i.items.length > 0).length} of ${construct.indicators.length} indicators covered`}
              </span>
            </div>

            {[...byDimension.entries()].map(([dimension, indicators]) => (
              <div key={dimension || "_none"} className="mt-2">
                {dimension && (
                  <p className="text-[11px] font-medium text-neutral-600">{dimension}</p>
                )}
                <ul className="mt-1 space-y-1">
                  {indicators.map((indicator) => (
                    <li key={indicator.indicatorId} className="rounded border border-neutral-200 p-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectIndicator?.(indicator.indicatorId)}
                          className="text-left text-[11px] font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                        >
                          {indicator.name}
                        </button>
                        <span
                          className={`text-[11px] ${indicator.items.length === 0 ? "text-red-700" : "text-neutral-500"}`}
                        >
                          {indicator.items.length === 0
                            ? "no items"
                            : `${indicator.items.length} item${indicator.items.length === 1 ? "" : "s"}`}
                        </span>
                      </div>

                      {indicator.items.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {indicator.items.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => onSelectItem?.(item.id)}
                                className="w-full text-left text-[11px] text-neutral-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                              >
                                {item.question_text}
                                {item.reverse_coded ? " · reverse-coded" : ""}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {construct.unassignedItems.length > 0 && (
              <p className="mt-2 text-[11px] text-neutral-500">
                {construct.unassignedItems.length} item
                {construct.unassignedItems.length === 1 ? "" : "s"} measure this construct directly, without an
                indicator.
              </p>
            )}
          </section>
        );
      })}

      {matrix.orphanItems.length > 0 && (
        <section aria-labelledby="coverage-orphans" className="rounded border border-amber-300 bg-amber-50 p-2.5">
          <h4 id="coverage-orphans" className="text-xs font-medium text-amber-900">
            Items measuring nothing ({matrix.orphanItems.length})
          </h4>
          <p className="mt-0.5 text-[11px] text-amber-900">
            These are in the questionnaire but are not linked to a construct, so they do not count towards any
            coverage.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {matrix.orphanItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectItem?.(item.id)}
                  className="w-full text-left text-[11px] text-amber-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-900"
                >
                  {item.question_text}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
