import type { ChunkSearchResult, ResearchCitationRow, SectionType } from "../db/types";

/**
 * Deterministic evidence ranking (§14). No model is consulted here.
 *
 * The rule that shapes the whole formula is §14's last sentence: a
 * high-quality source that does not support the claim should rank poorly *for
 * that claim*. So quality is a multiplier on topical relevance, never an
 * addend. A landmark trial that says nothing about the claim scores
 * `0.02 × 1.25`, which is still ~0.02 — it cannot climb over a directly
 * relevant chapter from a weaker source. An additive bonus would let it, and
 * that is how a researcher ends up citing a famous paper that does not say
 * what they claimed it said.
 */

/** Below this, an excerpt is reported as off-topic regardless of its source. */
const RELEVANCE_FLOOR = 0.12;

/** Caps, so no single non-topical signal can dominate. */
const MAX_QUALITY_BONUS = 0.25;
const MAX_CONTEXT_BONUS = 0.15;

/**
 * Words carrying no topical information. Deliberately short: an aggressive
 * stop list starts removing domain words ("care", "health") that are exactly
 * what distinguishes one claim from another.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "in", "on", "at", "to", "for", "with",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "being", "that", "this",
  "these", "those", "it", "its", "can", "may", "might", "will", "would", "should", "has",
  "have", "had", "not", "no", "than", "then", "there", "their", "we", "our", "study",
]);

export function contentWords(text: string): string[] {
  const latin = (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  // Khmer has no inter-word spaces, so a word split finds nothing. Overlapping
  // 3-character shingles are a crude but symmetric stand-in: they match
  // between claim and excerpt the same way on both sides, which is all the
  // lexical signal needs to be.
  const khmerRun = text.match(/[ក-៿]{3,}/g) ?? [];
  const shingles: string[] = [];
  for (const run of khmerRun) {
    for (let i = 0; i + 3 <= run.length; i += 1) shingles.push(run.slice(i, i + 3));
  }
  return [...latin, ...shingles];
}

/**
 * How much of the claim's vocabulary the excerpt actually contains.
 *
 * Asymmetric on purpose: the question is whether the excerpt covers the
 * claim, not whether the two texts are similar in length. A three-page
 * excerpt that happens to mention every term in a one-sentence claim is a
 * good candidate; Jaccard would punish it for being long.
 */
export function lexicalOverlap(claim: string, excerpt: string): number {
  const claimWords = new Set(contentWords(claim));
  if (claimWords.size === 0) return 0;
  const excerptWords = new Set(contentWords(excerpt));
  let hits = 0;
  for (const w of claimWords) if (excerptWords.has(w)) hits += 1;
  return hits / claimWords.size;
}

/**
 * Source quality from what is actually recorded about the source.
 *
 * `tier` is the project's own ranking (1 = strongest). `status` matters
 * separately: an unverified source is not a bad source, but it is not yet a
 * checked one, and evidence search should not push it to the top.
 */
export function sourceQuality(citation: ResearchCitationRow | undefined): number {
  if (!citation) return 0;
  const tierScore = citation.tier ? { 1: 1, 2: 0.75, 3: 0.5, 4: 0.25 }[citation.tier] : 0.5;
  const statusScore =
    citation.status === "verified"
      ? 1
      : citation.status === "user_provided"
        ? 0.7
        : citation.status === "unverified"
          ? 0.4
          : 0.5;
  const recency = citation.year && citation.year >= new Date().getFullYear() - 10 ? 1 : 0.8;
  return tierScore * statusScore * recency;
}

export interface RankingInput {
  claimText: string;
  section: SectionType;
  chunk: ChunkSearchResult;
  citation: ResearchCitationRow | undefined;
  /** Citation keys already cited in the section being written. */
  keysAlreadyInSection?: string[];
}

export interface RankedEvidence {
  chunk: ChunkSearchResult;
  citation: ResearchCitationRow | undefined;
  /** 0-1. Semantic similarity and claim-vocabulary coverage only. */
  topicalRelevance: number;
  semantic: number;
  lexical: number;
  quality: number;
  contextBonus: number;
  /** The number the list is sorted by. */
  score: number;
  /** True when the excerpt is off-topic for this claim, whatever its source. */
  belowRelevanceFloor: boolean;
  /** Plain-language reason shown on the evidence card (§9). */
  explanation: string;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function rankEvidence(input: RankingInput): RankedEvidence {
  // Similarity from the vector index arrives as cosine similarity in [-1, 1];
  // clamp rather than rescale, because a negative similarity is "unrelated",
  // not "half related".
  const semantic = Math.max(0, Math.min(1, input.chunk.similarity));
  const lexical = lexicalOverlap(input.claimText, input.chunk.content);

  // Semantic carries more weight because it survives paraphrase, which is the
  // normal case for a claim written in the researcher's own words. Lexical is
  // kept as a real term rather than a tiebreak: embeddings routinely rate two
  // texts about the same broad topic as similar, and the claim's own
  // vocabulary is what separates "about postpartum depression" from "about
  // this specific assertion".
  const topicalRelevance = 0.65 * semantic + 0.35 * lexical;

  const quality = sourceQuality(input.citation);
  const qualityBonus = quality * MAX_QUALITY_BONUS;

  const alreadyCited =
    input.chunk.citation_key && (input.keysAlreadyInSection ?? []).includes(input.chunk.citation_key);
  const contextBonus = alreadyCited ? MAX_CONTEXT_BONUS : 0;

  const belowRelevanceFloor = topicalRelevance < RELEVANCE_FLOOR;

  // Multiplicative, and floored candidates keep their raw relevance as the
  // score so no bonus can lift one above a genuinely relevant excerpt.
  const score = belowRelevanceFloor
    ? topicalRelevance
    : topicalRelevance * (1 + qualityBonus + contextBonus);

  const reasons: string[] = [`${percent(semantic)} semantic match`];
  if (lexical > 0) reasons.push(`covers ${percent(lexical)} of the claim's key terms`);
  if (input.citation?.tier) reasons.push(`tier ${input.citation.tier} source`);
  if (alreadyCited) reasons.push("already cited in this section");

  const explanation = belowRelevanceFloor
    ? `Low topical match for this claim (${percent(topicalRelevance)}). Source quality does not change that — check it actually says what the claim asserts.`
    : reasons.join(" · ");

  return {
    chunk: input.chunk,
    citation: input.citation,
    topicalRelevance,
    semantic,
    lexical,
    quality,
    contextBonus,
    score,
    belowRelevanceFloor,
    explanation,
  };
}

/** Ranked best first. Off-topic candidates always sort after on-topic ones. */
export function rankAll(inputs: RankingInput[]): RankedEvidence[] {
  return inputs
    .map(rankEvidence)
    .sort((a, b) => {
      if (a.belowRelevanceFloor !== b.belowRelevanceFloor) return a.belowRelevanceFloor ? 1 : -1;
      return b.score - a.score;
    });
}
