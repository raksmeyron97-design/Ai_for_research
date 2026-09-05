import { describe, expect, it } from "vitest";
import {
  buildNoDatasetResponse,
  extractCitationKeys,
  isResearchIntegrityLabel,
  requiresDataset,
  verifyCitationKeys,
  verifyCitationsInText,
} from "../integrity-guard";
import {
  RESEARCH_INTEGRITY_INSTRUCTIONS,
  RESEARCH_INTEGRITY_LABELS,
} from "../research-integrity-guard";

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

/**
 * Phase 22 §22G. Found by the first live benchmark, not by any unit test and
 * not by the dry benchmark — the stub does not follow the system
 * instruction, because it is not a model.
 *
 * `research-integrity-guard.ts` rule 3 requires the model to label every
 * non-trivial claim with VERIFIED / SOURCE_REQUIRED / USER_PROVIDED /
 * INFERENCE / UNVERIFIED. Gemini complied, wrote them in brackets beside its
 * citations, and the verifier reported them to the researcher as `high`
 * severity citations matching no saved source. Five of the eight scored
 * executions in that run carried the warning; on the correct answers, the
 * only thing wrong with them was this.
 */
describe("the labels the system instruction requires are not citations (§22G)", () => {
  const emptySupabase = () =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  it("recognises every label the prompt asks for", () => {
    for (const label of RESEARCH_INTEGRITY_LABELS) {
      expect(isResearchIntegrityLabel(label), `${label} is not recognised`).toBe(true);
    }
    expect(isResearchIntegrityLabel("who2024")).toBe(false);
  });

  it("keeps the prompt's list and the code's list from drifting apart", () => {
    // If a label is added to one and not the other, the symptom is a
    // researcher being told their correct answer cites a fabricated source.
    for (const label of RESEARCH_INTEGRITY_LABELS) {
      expect(
        RESEARCH_INTEGRITY_INSTRUCTIONS,
        `${label} is exported but rule 3 no longer asks for it`,
      ).toContain(label);
    }
  });

  it("does not extract a claim label as a citation key", () => {
    // Verbatim shape of the real Gemini output that produced the warnings.
    const output =
      "The prevalence was 21.4% (95% CI: 18.2%-24.9%) [sok2024antenatal] [VERIFIED]. " +
      "A cost per case cannot be derived from these sources [SOURCE_REQUIRED] [INFERENCE].";

    expect(extractCitationKeys(output)).toEqual(["sok2024antenatal"]);
  });

  it("does not warn the researcher that VERIFIED is an unsaved source", async () => {
    const warnings = await verifyCitationsInText(
      emptySupabase(),
      "proj-1",
      "Prevalence was 21.4% [sok2024antenatal] [VERIFIED] [INFERENCE] [SOURCE_REQUIRED].",
    );

    // The real citation is still checked and still warned about; only the
    // labels stop being reported.
    expect(warnings.map((w) => w.message)).toEqual([
      'Citation "sok2024antenatal" was referenced but does not match any saved source for this project.',
    ]);
  });

  it("still honours a stored source whose key happens to be a label", async () => {
    // The labels are excluded from *warnings*, not from the lookup — same
    // reasoning that keeps a source keyed "1" working.
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ in: async () => ({ data: [{ citation_key: "UNVERIFIED" }], error: null }) }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(await verifyCitationsInText(supabase, "proj-1", "As in [UNVERIFIED].")).toEqual([]);
  });

  it("still catches a genuinely fabricated citation", async () => {
    // The fix must not become a way for an invented key to pass.
    const warnings = await verifyCitationsInText(
      emptySupabase(),
      "proj-1",
      "As shown in [smith2029invented] [VERIFIED].",
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("smith2029invented");
  });
});
