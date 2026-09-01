import { estimateTokens } from "../ai/token-manager";

export interface TextChunk {
  index: number;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target chunk size in characters, not tokens — kept simple and provider-agnostic. */
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk, so a fact split across a boundary is still retrievable from either chunk. */
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 200;

/**
 * Paragraph-aware sliding-window chunking: pack whole paragraphs up to
 * maxChars, falling back to sentence-boundary (then hard character) splits
 * only for a paragraph that alone exceeds maxChars. This is the standard
 * baseline RAG chunking strategy — no semantic/embedding-based splitting,
 * which would be a much bigger investment for a marginal quality gain at
 * this stage.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces = paragraphs.flatMap((p) => splitOversizedParagraph(p, maxChars));

  const chunks: TextChunk[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length > maxChars && current) {
      chunks.push(makeChunk(chunks.length, current));
      // `.slice(-0)` returns the *whole* string in JS (not ""), so this
      // must be guarded explicitly rather than relying on slice's default
      // behavior for a zero-length overlap.
      const overlap = overlapChars > 0 ? current.slice(-overlapChars) : "";
      current = overlap ? `${overlap}\n\n${piece}` : piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(makeChunk(chunks.length, current));

  return chunks;
}

function makeChunk(index: number, content: string): TextChunk {
  const trimmed = content.trim();
  return { index, content: trimmed, tokenCount: estimateTokens(trimmed) };
}

function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];

  const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      pieces.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
    // A single "sentence" longer than maxChars (e.g. no punctuation at
    // all) still needs a hard split — otherwise it would produce one
    // chunk far larger than the target size.
    while (current.length > maxChars) {
      pieces.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) pieces.push(current);

  return pieces;
}
