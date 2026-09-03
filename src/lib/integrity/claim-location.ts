import { locateClaim } from "../evidence/citation-insertion";

/**
 * Where a claim currently sits in its section's text (§13).
 *
 * Phase 19 could only navigate to the section. Getting from there to the
 * sentence is the gap this closes, and the rule that governs it is the one
 * `citation-insertion.ts` already arrived at for the same problem: never
 * guess. A researcher sent to the wrong sentence is worse off than one sent
 * to the right section and left to find it, because the wrong highlight looks
 * authoritative.
 *
 * So `claim_not_located` is a first-class outcome, not an error. A claim is
 * extracted from a snapshot of the prose and the prose keeps being edited;
 * losing the exact span is ordinary, and the interface says so rather than
 * highlighting something approximate.
 */
export type ClaimLocationOutcome = "located" | "claim_not_located" | "section_empty";

export interface ClaimLocation {
  outcome: ClaimLocationOutcome;
  /** Character span in the section's current text, when it was found. */
  start: number | null;
  end: number | null;
  /**
   * How the span was found. `text` means the sentence itself was matched;
   * `offset` means the stored offsets still point at matching text. Offsets
   * are never trusted on their own — see below.
   */
  matchedBy: "text" | "offset" | null;
  /** Plain-language explanation, shown when there is nothing to highlight. */
  explanation: string;
}

function notLocated(explanation: string): ClaimLocation {
  return { outcome: "claim_not_located", start: null, end: null, matchedBy: null, explanation };
}

/**
 * `content` is the section's *current* text, straight from the editor — not
 * the version the claim was extracted from. That is the whole point: the
 * question being asked is "is this sentence still here", and asking it
 * against a stale snapshot would always answer yes.
 */
export function locateClaimInSection(
  content: string,
  claim: { claim_text: string; source_offset_start: number | null; source_offset_end: number | null },
): ClaimLocation {
  if (!content.trim()) {
    return {
      outcome: "section_empty",
      start: null,
      end: null,
      matchedBy: null,
      explanation: "This section has no text yet, so there is nothing to highlight.",
    };
  }

  const normalise = (value: string) => value.replace(/\s+/g, " ").trim();

  // Offsets first, but only ever when the text they point at still *is* the
  // claim. That ordering is deliberate and was not the obvious one.
  //
  // `locateClaim` normalises whitespace, so any span the offsets could verify
  // is also findable by text — which makes the offset path look redundant. It
  // is not, for one case: a sentence that appears twice. Text search returns
  // the first occurrence; the offsets say which occurrence the claim was
  // actually extracted from. Highlighting the wrong identical sentence is a
  // small error that quietly puts the researcher in the wrong paragraph.
  //
  // The verification is what keeps this safe. A drifted offset points at
  // different text with total confidence — the brittleness §13 warns about —
  // so the offset only ever proposes a span and the claim text confirms it.
  const { source_offset_start: start, source_offset_end: end } = claim;
  if (start != null && end != null && start >= 0 && end <= content.length && start < end) {
    if (normalise(content.slice(start, end)) === normalise(claim.claim_text)) {
      return {
        outcome: "located",
        start,
        end,
        matchedBy: "offset",
        explanation: "Found this sentence at its recorded position.",
      };
    }
  }

  // Whatever the offsets said, the text is the authority. This tolerates the
  // difference a textarea introduces between an extracted sentence and the
  // sentence still on screen.
  const span = locateClaim(content, claim.claim_text);
  if (span) {
    return {
      outcome: "located",
      start: span[0],
      end: span[1],
      matchedBy: "text",
      explanation: "Found this sentence in the section.",
    };
  }

  return notLocated(
    "This sentence is no longer in the section as written — it has been edited or removed since the claim was extracted. Nothing has been highlighted.",
  );
}

/** The fields a claim must carry to be locatable. Deliberately narrower than
 *  `ResearchClaimRow` so a component can accept a claim-shaped object without
 *  the editor depending on the whole row type. */
export interface HighlightableClaim {
  claim_text: string;
  source_offset_start: number | null;
  source_offset_end: number | null;
}
