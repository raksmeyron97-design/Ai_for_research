/**
 * Where a citation goes in the text. Pure, so the placement rules are
 * testable without a database (§16-§17).
 *
 * The one rule that outranks tidiness: never silently rewrite the
 * researcher's paragraph. When the claim cannot be located — because the text
 * was edited after the claim was extracted, which is normal — this reports
 * that and changes nothing, rather than appending the citation somewhere
 * plausible. A citation attached to the wrong sentence is worse than a
 * citation the researcher places by hand.
 */
export type PlacementOutcome =
  | "placed"
  | "already_present"
  | "claim_not_located";

export interface PlacementResult {
  content: string;
  outcome: PlacementOutcome;
  /** Character index the citation was written at, when it was. */
  index: number | null;
}

/** Trailing sentence punctuation the citation should sit *before*. */
const SENTENCE_END = /[.!?។]["'”’)\]]*\s*$/;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Finds `claimText` in `content` allowing for whitespace differences, which
 * are the difference a textarea introduces between an extracted sentence and
 * the sentence still sitting in the section.
 */
export function locateClaim(content: string, claimText: string): [number, number] | null {
  const needle = normalize(claimText);
  if (!needle) return null;

  const direct = content.indexOf(claimText);
  if (direct >= 0) return [direct, direct + claimText.length];

  // Whitespace-tolerant scan: walk the content building a normalized index map
  // once, rather than trying a regex built from arbitrary user text.
  const map: number[] = [];
  let normalized = "";
  let lastWasSpace = true;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      normalized += " ";
      map.push(i);
      lastWasSpace = true;
    } else {
      normalized += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  const hit = normalized.indexOf(needle);
  if (hit < 0) return null;

  const start = map[hit];
  const endIndex = hit + needle.length - 1;
  const end = (map[endIndex] ?? content.length - 1) + 1;
  return [start, end];
}

/**
 * Inserts `[key]` at the end of the sentence carrying the claim, before its
 * closing punctuation — "…maternal wellbeing [sok2024]." — which is where a
 * reader expects it and what `extractCitationKeys` reads back.
 */
export function placeCitation(
  content: string,
  claimText: string,
  citationKey: string,
  offsets?: { start: number | null; end: number | null },
): PlacementResult {
  const token = `[${citationKey}]`;

  let span = locateClaim(content, claimText);

  // Stored offsets are a fallback, not the primary route: they are best-effort
  // and go stale the moment the section is edited, so they are only trusted
  // when the text they point at still matches.
  if (!span && offsets?.start != null && offsets.end != null) {
    const candidate = content.slice(offsets.start, offsets.end);
    if (normalize(candidate) === normalize(claimText)) span = [offsets.start, offsets.end];
  }

  if (!span) return { content, outcome: "claim_not_located", index: null };

  const [start, end] = span;
  const sentence = content.slice(start, end);

  if (sentence.includes(token)) {
    return { content, outcome: "already_present", index: null };
  }

  const match = SENTENCE_END.exec(sentence);
  const insertAt = match ? start + match.index : end;

  const before = content.slice(0, insertAt);
  const needsSpace = before.length > 0 && !/\s$/.test(before);

  return {
    content: `${before}${needsSpace ? " " : ""}${token}${content.slice(insertAt)}`,
    outcome: "placed",
    index: insertAt,
  };
}

/**
 * Replaces the claim's sentence with new text (§17's Replace Claim mode).
 * Only ever called when the researcher explicitly chose it.
 */
export function replaceClaimText(
  content: string,
  claimText: string,
  replacement: string,
  offsets?: { start: number | null; end: number | null },
): PlacementResult {
  let span = locateClaim(content, claimText);
  if (!span && offsets?.start != null && offsets.end != null) {
    const candidate = content.slice(offsets.start, offsets.end);
    if (normalize(candidate) === normalize(claimText)) span = [offsets.start, offsets.end];
  }
  if (!span) return { content, outcome: "claim_not_located", index: null };

  const [start, end] = span;
  return {
    content: `${content.slice(0, start)}${replacement}${content.slice(end)}`,
    outcome: "placed",
    index: start,
  };
}
