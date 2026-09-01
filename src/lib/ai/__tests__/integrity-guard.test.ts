import { describe, expect, it } from "vitest";
import {
  buildNoDatasetResponse,
  extractCitationKeys,
  requiresDataset,
  verifyCitationKeys,
  verifyCitationsInText,
} from "../integrity-guard";

describe("requiresDataset", () => {
  it("is true for results_generation and data_analysis", () => {
    expect(requiresDataset("results_generation")).toBe(true);
    expect(requiresDataset("data_analysis")).toBe(true);
  });

  it("is false for every other task type", () => {
    expect(requiresDataset("chat")).toBe(false);
    expect(requiresDataset("objective_generation")).toBe(false);
    expect(requiresDataset("discussion")).toBe(false);
  });
});

describe("buildNoDatasetResponse", () => {
  it("never mentions fabricated numbers, and states what's missing", () => {
    const response = buildNoDatasetResponse("gemini", "gemini-3.6-flash");
    expect(response.content).toContain("Missing:");
    expect(response.content).toContain("Dataset");
    expect(response.content).not.toMatch(/\d+%/);
  });

  it("attaches a critical data_integrity warning", () => {
    const response = buildNoDatasetResponse("openai", "gpt-5.6");
    expect(response.warnings).toHaveLength(1);
    expect(response.warnings[0].severity).toBe("critical");
    expect(response.warnings[0].category).toBe("data_integrity");
  });

  it("reports the provider/model it would have used", () => {
    const response = buildNoDatasetResponse("openai", "gpt-5.6");
    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-5.6");
  });
});

describe("extractCitationKeys", () => {
  it("extracts bracket-form citation keys", () => {
    expect(extractCitationKeys("As shown in [who2024] and [smith_2023].")).toEqual([
      "who2024",
      "smith_2023",
    ]);
  });

  it("de-duplicates repeated keys", () => {
    expect(extractCitationKeys("[who2024] then again [who2024] and [smith2023]")).toEqual([
      "who2024",
      "smith2023",
    ]);
  });

  // Phase 16A / F11: single letters and bare numbers are list markers, not
  // citation keys. See citation-grammar.test.ts for the full grammar.
  it("no longer treats a one- or two-character token as a citation key", () => {
    expect(extractCitationKeys("[a] then [b] and [ii]")).toEqual([]);
  });

  it("returns an empty array when there are no bracketed keys", () => {
    expect(extractCitationKeys("No citations here, just [some other text].".replace("[some other text]", "plain text"))).toEqual([]);
  });

  it("ignores brackets containing non-key characters", () => {
    expect(extractCitationKeys("[not a key, has spaces]")).toEqual([]);
  });
});

describe("verifyCitationKeys", () => {
  it("returns [] without querying when no keys are given", async () => {
    const from = () => {
      throw new Error("should not be called");
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await verifyCitationKeys({ from } as any, "proj-1", []);
    expect(result).toEqual([]);
  });

  it("flags keys that don't match any stored citation", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [{ citation_key: "who2024" }], error: null }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await verifyCitationKeys(supabase, "proj-1", ["who2024", "fake_key"]);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("high");
    expect(result[0].message).toContain("fake_key");
  });

  it("returns [] when every mentioned key is verified", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [{ citation_key: "a" }, { citation_key: "b" }], error: null }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await verifyCitationKeys(supabase, "proj-1", ["a", "b"]);
    expect(result).toEqual([]);
  });

  it("surfaces a low-severity issue instead of throwing when the query itself fails", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: null, error: { message: "db unreachable" } }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await verifyCitationKeys(supabase, "proj-1", ["a"]);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("low");
  });
});

describe("verifyCitationsInText", () => {
  it("extracts and verifies in one call", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await verifyCitationsInText(supabase, "proj-1", "See [who2024] for details.");
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("who2024");
  });
});
