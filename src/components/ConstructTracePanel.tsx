"use client";

import { useEffect, useRef, useState } from "react";
import { FRAMEWORK_RELATION_LABELS, HYPOTHESIS_POSITION_LABELS, SECTION_LABELS } from "@/lib/db/types";
import type { ConstructTrace } from "@/lib/methodology/construct-trace";

/**
 * What in the study depends on one concept (Phase 21 §25).
 *
 * The chain — indicators, questionnaire items, hypotheses, framework
 * relationships, manuscript claims — exists across five tables and five
 * screens, and the question a researcher actually asks about a concept spans
 * all of them: *what breaks if I rename this, and is it measured at all?*
 *
 * Fetched when the construct is expanded, not with the workspace (§32). A
 * project with thirty constructs would otherwise pay for thirty traces to
 * show a list of names.
 *
 * Every row here is a stored relationship. The absences are the point as much
 * as the presences: a concept nothing asks about is a finding, and it is
 * reported as the missing link it is rather than as a score.
 */
export default function ConstructTracePanel({
  projectId,
  constructId,
}: {
  projectId: string;
  constructId: string;
}) {
  const [trace, setTrace] = useState<ConstructTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // §51: expanding one construct, collapsing it and expanding another must
  // not let the first response paint over the second.
  const latest = useRef(0);

  useEffect(() => {
    const seq = ++latest.current;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/research/projects/${projectId}/methodology/constructs/${constructId}/trace`,
        );
        if (seq !== latest.current) return;
        if (!res.ok) throw new Error("This concept's connections could not be loaded.");
        const body = await res.json();
        if (seq !== latest.current) return;
        setTrace(body.trace);
        setError(null);
      } catch (err) {
        if (seq === latest.current) setError((err as Error).message);
      } finally {
        if (seq === latest.current) setLoading(false);
      }
    })();
  }, [projectId, constructId]);

  if (loading) {
    return (
      <p role="status" aria-live="polite" className="text-[11px] text-neutral-500">
        Loading what depends on this concept…
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-800">
        {error}
      </p>
    );
  }

  if (!trace) return null;

  return (
    <section aria-label={`What depends on ${trace.name}`} className="space-y-2 text-[11px]">
      <Group
        heading="Measured by"
        empty="No questionnaire item asks about this concept."
        items={trace.items.map((item) => ({
          key: item.id,
          // Saying *how* the item reaches the construct: naming it directly
          // and reaching it through an indicator are different statements
          // about how well the concept is pinned down.
          text: `${item.text}${item.via === "indicator" ? " (through an indicator)" : ""}`,
        }))}
      />

      <Group
        heading="Indicators"
        empty="No indicators — nothing yet says what the observable parts of this concept are."
        items={trace.indicators.map((i) => ({
          key: i.id,
          text: i.dimension ? `${i.name} · ${i.dimension}` : i.name,
        }))}
      />

      <Group
        heading="Hypotheses"
        empty="No hypothesis involves this concept."
        items={trace.hypotheses.map((h) => ({
          key: h.id,
          // The position is the one this construct holds in *this*
          // hypothesis, which is why it is read per row rather than off the
          // construct: the same concept can be predictor in one and outcome
          // in another.
          text: `${h.label ? `${h.label}: ` : ""}${h.statement} — as the ${
            HYPOTHESIS_POSITION_LABELS[h.position as keyof typeof HYPOTHESIS_POSITION_LABELS] ?? h.position
          }`,
        }))}
      />

      <Group
        heading="In the framework"
        empty="Not related to anything in your conceptual framework."
        items={trace.relationships.map((r) => ({
          key: r.id,
          text:
            r.direction === "from"
              ? `${FRAMEWORK_RELATION_LABELS[r.relationType as keyof typeof FRAMEWORK_RELATION_LABELS] ?? r.relationType} ${r.otherName}`
              : `${r.otherName} ${FRAMEWORK_RELATION_LABELS[r.relationType as keyof typeof FRAMEWORK_RELATION_LABELS] ?? r.relationType} this`,
        }))}
      />

      <Group
        heading="Claims that rest on it"
        empty="No claim in your manuscript is linked to this concept."
        items={trace.claims.map((c) => ({
          key: c.id,
          text: `${SECTION_LABELS[c.sectionType as keyof typeof SECTION_LABELS] ?? c.sectionType}: ${c.text}`,
        }))}
      />

      {trace.gaps.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2">
          <h5 className="font-medium text-amber-900">What is missing</h5>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-900">
            {trace.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          {/* Not "your construct scores 40%". These are absent links, each of
              which is a specific thing the researcher can go and create. */}
          <p className="mt-1 text-[10px] text-amber-800">
            Each of these is a connection that has not been recorded — not a judgement about the concept.
          </p>
        </div>
      )}
    </section>
  );
}

function Group({
  heading,
  empty,
  items,
}: {
  heading: string;
  empty: string;
  items: { key: string; text: string }[];
}) {
  return (
    <div>
      <h5 className="font-medium text-neutral-700">{heading}</h5>
      {items.length === 0 ? (
        <p className="text-neutral-500">{empty}</p>
      ) : (
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-neutral-700">
          {items.map((item) => (
            <li key={item.key}>{item.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
