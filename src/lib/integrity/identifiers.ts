/**
 * Deterministic identifier normalization. No network call, ever — an
 * identifier is checked for well-formedness only, never resolved against a
 * live registry (Crossref, PubMed, WorldCat, ORCID's own API). Format
 * validity is not existence: a syntactically valid DOI can still point at
 * nothing, and this module has no way to know that and does not pretend to.
 */

export interface IdentifierCheck {
  valid: boolean;
  /** The identifier in its canonical form, only when valid. Never a guess at what a malformed value "should" be. */
  normalized: string | null;
  reason?: string;
}

function invalid(reason: string): IdentifierCheck {
  return { valid: false, normalized: null, reason };
}

/** Strips a doi.org URL prefix or a bare "doi:" label, so both paste-in forms normalize the same way. */
export function normalizeDoi(raw: string | null | undefined): IdentifierCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return invalid("Empty DOI.");

  const stripped = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();

  // 10.<4-9 digit registrant>/<suffix>, per the DOI Handbook's own grammar.
  // The suffix has no fixed shape by design (registrants choose it), so this
  // checks structure, not content.
  if (!/^10\.\d{4,9}\/\S+$/.test(stripped)) {
    return invalid('DOI must match "10.<registrant>/<suffix>".');
  }
  return { valid: true, normalized: stripped };
}

/** PMID is a bare positive integer, 1-8 digits (PubMed has not exceeded 8 digits as of this writing). */
export function normalizePmid(raw: string | null | undefined): IdentifierCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return invalid("Empty PMID.");

  const stripped = trimmed.replace(/^pmid:\s*/i, "").trim();
  if (!/^[1-9]\d{0,7}$/.test(stripped)) {
    return invalid("PMID must be a positive integer with no leading zero.");
  }
  return { valid: true, normalized: stripped };
}

/** ISBN-10 (with its mod-11 checksum, 'X' allowed as the final digit) or ISBN-13 (mod-10, EAN 978/979 prefix). */
export function normalizeIsbn(raw: string | null | undefined): IdentifierCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return invalid("Empty ISBN.");

  const stripped = trimmed.replace(/[\s-]/g, "").toUpperCase();

  if (stripped.length === 10) {
    if (!/^\d{9}[\dX]$/.test(stripped)) return invalid("ISBN-10 must be 9 digits plus a check digit or 'X'.");
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (10 - i) * Number(stripped[i]);
    const last = stripped[9] === "X" ? 10 : Number(stripped[9]);
    sum += last;
    if (sum % 11 !== 0) return invalid("ISBN-10 check digit does not match.");
    return { valid: true, normalized: stripped };
  }

  if (stripped.length === 13) {
    if (!/^\d{13}$/.test(stripped)) return invalid("ISBN-13 must be 13 digits.");
    if (!stripped.startsWith("978") && !stripped.startsWith("979")) {
      return invalid("ISBN-13 must start with 978 or 979.");
    }
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(stripped[i]) * (i % 2 === 0 ? 1 : 3);
    if (sum % 10 !== 0) return invalid("ISBN-13 check digit does not match.");
    return { valid: true, normalized: stripped };
  }

  return invalid("ISBN must be 10 or 13 characters after removing hyphens/spaces.");
}

/**
 * Validator only — this phase does not persist ORCID anywhere.
 * `research_citations.authors` is a bare `text[]` of names with no
 * per-author row to attach an id to; inventing one is out of scope here.
 * Format: 0000-0000-0000-000X, ISO 7064 MOD 11-2 checksum, 'X' = 10.
 */
export function normalizeOrcid(raw: string | null | undefined): IdentifierCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return invalid("Empty ORCID.");

  const stripped = trimmed
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();

  if (!/^\d{15}[\dX]$/.test(stripped)) {
    return invalid("ORCID must be 16 characters (15 digits plus a check digit or 'X') after removing hyphens.");
  }

  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + Number(stripped[i])) * 2;
  const remainder = total % 11;
  const check = (12 - remainder) % 11;
  const expected = check === 10 ? "X" : String(check);
  if (stripped[15] !== expected) return invalid("ORCID check digit does not match.");

  const formatted = `${stripped.slice(0, 4)}-${stripped.slice(4, 8)}-${stripped.slice(8, 12)}-${stripped.slice(12)}`;
  return { valid: true, normalized: formatted };
}
