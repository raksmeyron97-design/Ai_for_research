import { extractCitationKeys } from "../ai/integrity-guard";
import { normalizeDoi, normalizeIsbn, normalizePmid } from "./identifiers";
import type { ResearchCitationRow, ResearchEvidenceRow, ResearchSectionRow } from "../db/types";
import type { IntegrityFinding } from "./types";

/**
 * §19: bibliography integrity. Deterministic identifier matching first —
 * duplicate detection here never uses fuzzy text similarity, only equal
 * normalized identifiers or an exact normalized title+year+first-author
 * match. Ambiguous cases stay in AI-advisory territory (see
 * `suggestions.ts`'s `suggestDuplicateReferences`), which never auto-merges
 * either — a merge is always a researcher action recorded via
 * `research_integrity_events`.
 */

/** Every citation key mentioned anywhere in the manuscript's own prose, project-wide. */
function mentionedKeys(sections: Pick<ResearchSectionRow, "content">[]): Set<string> {
  const keys = new Set<string>();
  for (const section of sections) {
    for (const key of extractCitationKeys(section.content)) keys.add(key);
  }
  return keys;
}

export function findMissingBibliographyEntries(
  sections: Pick<ResearchSectionRow, "content">[],
  citations: Pick<ResearchCitationRow, "citation_key">[],
): IntegrityFinding[] {
  const known = new Set(citations.map((c) => c.citation_key));
  return [...mentionedKeys(sections)]
    .filter((key) => !known.has(key))
    .map((key) => ({
      id: `reference:missing-bibliography-entry:${key}`,
      category: "reference" as const,
      severity: "warning" as const,
      title: "Citation key has no bibliography entry",
      explanation: `"${key}" is referenced in the manuscript but does not match any saved source for this project.`,
      targetType: "reference",
      targetId: key,
      provenance: "deterministic" as const,
      remediation: "Add this source to the project's references, or correct the citation key.",
    }));
}

export function findUnusedReferences(
  sections: Pick<ResearchSectionRow, "content">[],
  citations: Pick<ResearchCitationRow, "id" | "citation_key">[],
  evidence: Pick<ResearchEvidenceRow, "citation_id">[],
): IntegrityFinding[] {
  const mentioned = mentionedKeys(sections);
  const citedViaEvidence = new Set(evidence.map((e) => e.citation_id));

  return citations
    .filter((c) => !mentioned.has(c.citation_key) && !citedViaEvidence.has(c.id))
    .map((c) => ({
      id: `reference:unused:${c.id}`,
      category: "reference" as const,
      severity: "info" as const,
      title: "Reference is not used anywhere",
      explanation: `"${c.citation_key}" is saved as a source but is neither cited in the manuscript nor linked to any evidence.`,
      targetType: "citation",
      targetId: c.id,
      provenance: "deterministic" as const,
      remediation: "Cite it, link evidence to it, or remove it if it is no longer needed.",
    }));
}

/** Normalized identifier and value, for grouping — only when the citation actually has one. */
function identifierKeys(citation: Pick<ResearchCitationRow, "doi" | "pmid" | "isbn">): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(citation.doi);
  if (doi.valid) keys.push(`doi:${doi.normalized}`);
  const pmid = normalizePmid(citation.pmid);
  if (pmid.valid) keys.push(`pmid:${pmid.normalized}`);
  const isbn = normalizeIsbn(citation.isbn);
  if (isbn.valid) keys.push(`isbn:${isbn.normalized}`);
  return keys;
}

function titleYearAuthorKey(
  citation: Pick<ResearchCitationRow, "title" | "year" | "authors">,
): string | null {
  const title = citation.title?.trim().toLowerCase();
  const firstAuthor = citation.authors[0]?.trim().toLowerCase();
  if (!title || !citation.year || !firstAuthor) return null;
  return `title:${title}|year:${citation.year}|author:${firstAuthor}`;
}

export function findDuplicateReferences(
  citations: Pick<ResearchCitationRow, "id" | "citation_key" | "doi" | "pmid" | "isbn" | "title" | "year" | "authors">[],
): IntegrityFinding[] {
  const groups = new Map<string, string[]>();
  for (const citation of citations) {
    const keys = [...identifierKeys(citation), ...(() => {
      const k = titleYearAuthorKey(citation);
      return k ? [k] : [];
    })()];
    for (const key of keys) {
      groups.set(key, [...(groups.get(key) ?? []), citation.id]);
    }
  }

  const flaggedPairs = new Set<string>();
  const findings: IntegrityFinding[] = [];
  for (const [key, ids] of groups) {
    const distinctIds = [...new Set(ids)];
    if (distinctIds.length < 2) continue;
    const pairKey = distinctIds.slice().sort().join(",");
    if (flaggedPairs.has(pairKey)) continue;
    flaggedPairs.add(pairKey);

    const byId = new Map(citations.map((c) => [c.id, c]));
    const keys = distinctIds.map((id) => byId.get(id)?.citation_key).filter(Boolean);
    findings.push({
      id: `reference:duplicate:${distinctIds[0]}`,
      category: "reference",
      severity: "warning",
      title: "Possible duplicate reference",
      explanation: `${keys.map((k) => `"${k}"`).join(" and ")} match on ${key.split(":")[0]} — they may be the same source saved twice.`,
      targetType: "citation",
      targetId: distinctIds[0],
      provenance: "deterministic",
      remediation: "Merge them if they are the same source, or leave them if they genuinely differ.",
    });
  }
  return findings;
}

export function findMalformedIdentifiers(
  citations: Pick<ResearchCitationRow, "id" | "citation_key" | "doi" | "pmid" | "isbn">[],
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const checks: { field: "doi" | "pmid" | "isbn"; normalize: typeof normalizeDoi }[] = [
    { field: "doi", normalize: normalizeDoi },
    { field: "pmid", normalize: normalizePmid },
    { field: "isbn", normalize: normalizeIsbn },
  ];

  for (const citation of citations) {
    for (const { field, normalize } of checks) {
      const raw = citation[field];
      if (!raw) continue; // absent is incomplete, not malformed — see findMissingMetadata.
      const result = normalize(raw);
      if (result.valid) continue;
      findings.push({
        id: `reference:malformed-identifier:${citation.id}:${field}`,
        category: "reference",
        severity: "error",
        title: `Malformed ${field.toUpperCase()}`,
        explanation: `"${citation.citation_key}" has a ${field.toUpperCase()} that does not match the expected format: ${result.reason}`,
        targetType: "citation",
        targetId: citation.id,
        provenance: "deterministic",
        remediation: `Correct or remove the ${field.toUpperCase()}.`,
      });
    }
  }
  return findings;
}

export function findMissingMetadata(
  citations: Pick<ResearchCitationRow, "id" | "citation_key" | "title" | "authors" | "year" | "source_type">[],
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const citation of citations) {
    const missing: string[] = [];
    if (!citation.title?.trim()) missing.push("title");
    if (citation.authors.length === 0) missing.push("authors");
    if (!citation.year) missing.push("year");
    if (!citation.source_type) missing.push("source type");
    if (missing.length === 0) continue;

    findings.push({
      id: `reference:missing-metadata:${citation.id}`,
      category: "reference",
      severity: missing.includes("title") ? "warning" : "info",
      title: "Reference is missing metadata",
      explanation: `"${citation.citation_key}" has no ${missing.join(", ")}.`,
      targetType: "citation",
      targetId: citation.id,
      provenance: "deterministic",
      remediation: "Fill in the missing bibliographic details.",
    });
  }
  return findings;
}
