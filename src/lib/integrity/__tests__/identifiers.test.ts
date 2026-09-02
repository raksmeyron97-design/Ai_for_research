import { describe, expect, it } from "vitest";
import { normalizeDoi, normalizeIsbn, normalizeOrcid, normalizePmid } from "../identifiers";

describe("normalizeDoi", () => {
  it("accepts a bare DOI", () => {
    expect(normalizeDoi("10.1234/abcd.5678")).toEqual({ valid: true, normalized: "10.1234/abcd.5678" });
  });

  it("strips a doi.org URL prefix", () => {
    const result = normalizeDoi("https://doi.org/10.1234/abcd.5678");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("10.1234/abcd.5678");
  });

  it("strips a doi: label", () => {
    expect(normalizeDoi("doi:10.1234/abcd").normalized).toBe("10.1234/abcd");
  });

  it("rejects a malformed DOI without fabricating a correction", () => {
    const result = normalizeDoi("not-a-doi");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("rejects an empty value", () => {
    expect(normalizeDoi("").valid).toBe(false);
    expect(normalizeDoi(null).valid).toBe(false);
  });
});

describe("normalizePmid", () => {
  it("accepts a bare positive integer", () => {
    expect(normalizePmid("12345678")).toEqual({ valid: true, normalized: "12345678" });
  });

  it("strips a pmid: label", () => {
    expect(normalizePmid("PMID: 555").normalized).toBe("555");
  });

  it("rejects a leading zero", () => {
    expect(normalizePmid("0123").valid).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(normalizePmid("abc123").valid).toBe(false);
  });
});

describe("normalizeIsbn", () => {
  it("accepts a valid ISBN-10", () => {
    expect(normalizeIsbn("0-306-40615-2").valid).toBe(true);
  });

  it("accepts a valid ISBN-10 with an X check digit", () => {
    expect(normalizeIsbn("0-8044-2957-X").valid).toBe(true);
  });

  it("accepts a valid ISBN-13", () => {
    expect(normalizeIsbn("978-3-16-148410-0").valid).toBe(true);
  });

  it("rejects an ISBN-10 with a bad checksum", () => {
    expect(normalizeIsbn("0-306-40615-3").valid).toBe(false);
  });

  it("rejects an ISBN-13 not starting with 978/979", () => {
    expect(normalizeIsbn("1234567890123").valid).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(normalizeIsbn("12345").valid).toBe(false);
  });
});

describe("normalizeOrcid", () => {
  it("accepts a valid ORCID and formats it with hyphens", () => {
    // A known-valid sample ORCID (ISO 7064 MOD 11-2 checksum).
    const result = normalizeOrcid("0000-0002-1825-0097");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("0000-0002-1825-0097");
  });

  it("strips an orcid.org URL prefix", () => {
    expect(normalizeOrcid("https://orcid.org/0000-0002-1825-0097").valid).toBe(true);
  });

  it("rejects a bad checksum", () => {
    expect(normalizeOrcid("0000-0002-1825-0098").valid).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(normalizeOrcid("0000-0002-1825").valid).toBe(false);
  });
});
