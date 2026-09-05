"use client";

import { useEffect, useState } from "react";
import { SECTION_LABELS } from "@/lib/db/types";
import type {
  ResearchCitationRow,
  ResearchClaimEvidenceRow,
  ResearchClaimRow,
  ResearchDocumentRow,
  ResearchEvidenceRow,
  ResearchSourceProfileRow,
  ResearchThemeRow,
  SectionType,
} from "@/lib/db/types";

/**
 * Everything about one source (§26).
 *
 * The panel answers the question a researcher actually has when they open a
 * paper from their library: *where does this appear in my thesis?* So the
 * headline is not the bibliography — it is the sections, claims and excerpts
 * that rest on it, with a way back to the section that cites it.
 */
interface SourceDetail {
  citation: ResearchCitationRow;
  profile: ResearchSourceProfileRow | null;
  documents: ResearchDocumentRow[];
  evidence: ResearchEvidenceRow[];
  claims: ResearchClaimRow[];
  links: ResearchClaimEvidenceRow[];
  sections: SectionType[];
  themes: ResearchThemeRow[];
}

const SUPPORT_LABEL: Record<string, string> = {
  SUPPORTED: "supports",
  PARTIAL: "partly supports",
  UNSUPPORTED: "does not support",
  NEEDS_REVIEW: "not checked yet",
};

export default function SourceDetailPanel({
  projectId,
  citationId,
  onClose,
  onGoToSection,
}: {
  projectId: string;
  citationId: string;
  onClose: () => void;
  /** Takes the researcher back to the section that cites this source (§26). */
  onGoToSection?: (section: SectionType) => void;
}) {
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/sources/${citationId}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "That source could not be loaded.");
        if (!cancelled) setDetail(body);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, citationId]);

  if (error) {
    return (
      <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
        {error}
      </p>
    );
  }

  if (!detail) {
    return (
      <p role="status" aria-live="polite" className="text-xs text-neutral-500">
        Loading source…
      </p>
    );
  }

  const claimById = new Map(detail.claims.map((c) => [c.id, c]));

  return (
    <div className="space-y-4 text-xs">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{detail.citation.title ?? detail.citation.citation_key}</h3>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {(detail.citation.authors.length ? detail.citation.authors.join(", ") : "Unknown author") +
              (detail.citation.year ? ` · ${detail.citation.year}` : "") +
              (detail.citation.journal ? ` · ${detail.citation.journal}` : "")}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-neutral-500">[{detail.citation.citation_key}]</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-neutral-300 px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Back
        </button>
      </header>

      <section aria-labelledby="source-status-heading">
        <h4 id="source-status-heading" className="mb-1 text-xs font-medium">
          Documents
        </h4>
        {detail.documents.length === 0 ? (
          <p className="text-[11px] text-neutral-500">
            No uploaded document is linked to this source, so its text cannot be searched for evidence.
          </p>
        ) : (
          <ul className="space-y-1">
            {detail.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between rounded border border-neutral-200 p-2">
                <span className="truncate">{doc.file_name}</span>
                <span className="shrink-0 text-[11px] text-neutral-500">{doc.extraction_status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="source-usage-heading">
        <h4 id="source-usage-heading" className="mb-1 text-xs font-medium">
          Where this source is used
        </h4>
        {detail.sections.length === 0 ? (
          <p className="text-[11px] text-neutral-500">Not yet cited in any section.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {detail.sections.map((section) => (
              <button
                key={section}
                type="button"
                onClick={() => onGoToSection?.(section)}
                className="rounded border border-neutral-300 px-2 py-1 text-[11px] hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
              >
                {SECTION_LABELS[section]}
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="source-evidence-heading">
        <h4 id="source-evidence-heading" className="mb-1 text-xs font-medium">
          Saved excerpts and the claims they carry
        </h4>
        {detail.evidence.length === 0 ? (
          <p className="text-[11px] text-neutral-500">No excerpts saved from this source yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.evidence.map((evidence) => {
              const links = detail.links.filter((l) => l.evidence_id === evidence.id);
              return (
                <li key={evidence.id} className="rounded border border-neutral-200 p-2">
                  <blockquote className="rounded bg-neutral-50 p-2 leading-relaxed text-neutral-800">
                    “{evidence.excerpt}”
                    {evidence.page && (
                      <cite className="mt-1 block not-italic text-[11px] text-neutral-500">p. {evidence.page}</cite>
                    )}
                  </blockquote>
                  {links.length === 0 ? (
                    <p className="mt-1 text-[11px] text-neutral-500">Not linked to a claim.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {links.map((link) => {
                        const claim = claimById.get(link.claim_id);
                        return (
                          <li key={link.id} className="text-[11px] text-neutral-600">
                            <span className="italic">“{claim?.claim_text ?? "(claim removed)"}”</span>{" "}
                            — {SUPPORT_LABEL[link.support]}
                            {claim && ` · ${SECTION_LABELS[claim.section_type]}`}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="source-themes-heading">
        <h4 id="source-themes-heading" className="mb-1 text-xs font-medium">
          Themes
        </h4>
        {detail.themes.length === 0 ? (
          <p className="text-[11px] text-neutral-500">Not assigned to a theme.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {detail.themes.map((theme) => (
              <span key={theme.id} className="rounded border border-neutral-300 px-2 py-0.5 text-[11px]">
                {theme.name}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
