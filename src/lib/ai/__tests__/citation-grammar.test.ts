import { describe, expect, it, vi } from "vitest";
import {
  extractBracketTokens,
  extractCitationKeys,
  isCitationKeyShaped,
  verifyCitationsInText,
} from "../integrity-guard";

/**
 * Phase 16A, finding F11. The extractor matched any bracket token, so an
 * ordinary numbered list produced "citation does not match any saved source"
 * warnings — invisible until F3 began appending citation warnings to the
 * chat answer itself, at which point they became user-facing noise.
 */
describe("citation key grammar", () => {
  it.each(["smith2024", "WHO2025", "abc_2024", "who-2025", "Sok2024Antenatal"])(
    "treats %s as a citation key",
    (token) => {
      expect(isCitationKeyShaped(token)).toBe(true);
    },
  );

  it.each(["1", "2", "10", "999", "42"])("does not treat list number %s as a citation key", (token) => {
    expect(isCitationKeyShaped(token)).toBe(false);
  });

  it.each(["i", "ab", "2024who"])("rejects %s (too short, or starts with a digit)", (token) => {
    expect(isCitationKeyShaped(token)).toBe(false);
  });
});

describe("extraction", () => {
  it("keeps every bracket token in the raw extractor", () => {
    expect(extractBracketTokens("[1] a [smith2024] b [2] c").sort()).toEqual(["1", "2", "smith2024"]);
  });

  it("returns only key-shaped tokens as citation keys", () => {
    expect(extractCitationKeys("[1] a [smith2024] b [2] c")).toEqual(["smith2024"]);
  });

  it("does not treat a numbered list as citations", () => {
    const text = "[1] First point\n[2] Second point\n[10] Tenth point";
    expect(extractCitationKeys(text)).toEqual([]);
  });

  it("deduplicates repeated keys", () => {
    expect(extractCitationKeys("[smith2024] and again [smith2024]")).toEqual(["smith2024"]);
  });
});

function supabaseWith(storedKeys: string[], onQuery?: (keys: string[]) => void) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_col: string, keys: string[]) => {
            onQuery?.(keys);
            return Promise.resolve({
              data: keys.filter((k) => storedKeys.includes(k)).map((citation_key) => ({ citation_key })),
              error: null,
            });
          },
        }),
      }),
    }),
  } as never;
}

describe("verifyCitationsInText", () => {
  it("does not warn about a numbered list", async () => {
    const warnings = await verifyCitationsInText(
      supabaseWith(["smith2024"]),
      "proj-1",
      "[1] First point\n[2] Second point",
    );
    expect(warnings).toEqual([]);
  });

  it("checks only the real key in a mixed list", async () => {
    const text = "[1] Study design\n[smith2024] Evidence\n[2] Method";
    const warnings = await verifyCitationsInText(supabaseWith(["smith2024"]), "proj-1", text);
    expect(warnings).toEqual([]);
  });

  it("still flags a fabricated key mixed into a numbered list", async () => {
    const text = "[1] Study design\n[invented2020key] Evidence\n[2] Method";
    const warnings = await verifyCitationsInText(supabaseWith(["smith2024"]), "proj-1", text);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("invented2020key");
    expect(warnings[0].severity).toBe("high");
  });

  it("honours a stored key that does not match the grammar, rather than discarding it", async () => {
    // A project that genuinely keyed a source "1" is unusual but legal; the
    // grammar must filter candidates, not overrule the database.
    const warnings = await verifyCitationsInText(supabaseWith(["1"]), "proj-1", "As shown in [1].");
    expect(warnings).toEqual([]);
  });

  it("looks up ambiguous tokens as well as candidates, so a stored key is findable", async () => {
    const queried: string[][] = [];
    await verifyCitationsInText(supabaseWith([], (keys) => queried.push(keys)), "proj-1", "[1] a [smith2024] b");
    expect(queried[0].sort()).toEqual(["1", "smith2024"]);
  });

  it("never warns about an ambiguous token that resolves to nothing", async () => {
    const warnings = await verifyCitationsInText(supabaseWith([]), "proj-1", "[1] a [2] b [10] c");
    expect(warnings).toEqual([]);
  });

  it("skips the query entirely when the text has no bracket tokens", async () => {
    const spy = vi.fn();
    const warnings = await verifyCitationsInText(supabaseWith([], spy), "proj-1", "No brackets here at all.");
    expect(warnings).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces a verification failure rather than claiming everything is fine", async () => {
    const broken = {
      from: () => ({
        select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "db down" } }) }) }),
      }),
    } as never;

    const warnings = await verifyCitationsInText(broken, "proj-1", "[smith2024]");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].category).toBe("citation_verification");
  });

  it("flags every unresolved candidate, not just the first", async () => {
    const warnings = await verifyCitationsInText(
      supabaseWith(["smith2024"]),
      "proj-1",
      "[smith2024] ok, [fake2020a] no, [fake2020b] also no",
    );
    expect(warnings.map((w) => w.message)).toHaveLength(2);
  });
});
