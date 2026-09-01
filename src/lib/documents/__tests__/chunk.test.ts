import { describe, expect, it } from "vitest";
import { chunkText } from "../chunk";

describe("chunkText", () => {
  it("returns an empty array for empty/whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    const chunks = chunkText("A single short paragraph.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("A single short paragraph.");
    expect(chunks[0].index).toBe(0);
  });

  it("packs multiple short paragraphs into one chunk when they fit", () => {
    const text = "Para one.\n\nPara two.\n\nPara three.";
    const chunks = chunkText(text, { maxChars: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Para one.");
    expect(chunks[0].content).toContain("Para three.");
  });

  it("splits into multiple chunks once maxChars is exceeded", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph number ${i} with some filler text.`);
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text, { maxChars: 150, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(150 + 50); // some slack for the joining newline
    }
  });

  it("assigns sequential zero-based indices", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}. `.repeat(20));
    const chunks = chunkText(paragraphs.join("\n\n"), { maxChars: 200 });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("repeats trailing content from the previous chunk as overlap", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}. `.repeat(20));
    const chunks = chunkText(paragraphs.join("\n\n"), { maxChars: 200, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    const endOfFirst = chunks[0].content.slice(-50);
    expect(chunks[1].content.startsWith(endOfFirst) || chunks[1].content.includes(endOfFirst.slice(-20))).toBe(true);
  });

  it("hard-splits a single paragraph with no sentence punctuation that exceeds maxChars", () => {
    const noPunctuation = "word ".repeat(100); // ~500 chars, no periods
    const chunks = chunkText(noPunctuation, { maxChars: 100, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("splits an oversized paragraph on sentence boundaries when punctuation exists", () => {
    const sentence = "This is one sentence of moderate length. ";
    const paragraph = sentence.repeat(20); // one giant paragraph, well over maxChars
    const chunks = chunkText(paragraph, { maxChars: 200, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should end at (or very near) a sentence boundary, not mid-word.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.trim().endsWith(".")).toBe(true);
    }
  });

  it("estimates a positive token count for every chunk", () => {
    const chunks = chunkText("Some reasonably long text content here.");
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });
});
