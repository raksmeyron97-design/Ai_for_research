import { describe, expect, it } from "vitest";
import { DatasetParseError, MAX_DATASET_ROWS, parseDataset } from "../parse-dataset";

function csv(text: string): Buffer {
  return Buffer.from(text.trim() + "\n");
}

describe("parseDataset — CSV", () => {
  it("parses columns and rows from a simple CSV", async () => {
    const result = await parseDataset(csv("age,group\n20,A\n30,B\n40,A"), "text/csv", "data.csv");
    expect(result.columns.map((c) => c.name)).toEqual(["age", "group"]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ age: 20, group: "A" });
  });

  it("infers numeric columns as numeric type with parsed number values", async () => {
    const result = await parseDataset(csv("score\n1\n2\n3"), "text/csv", "data.csv");
    expect(result.columns[0].type).toBe("numeric");
    expect(result.rows.map((r) => r.score)).toEqual([1, 2, 3]);
  });

  it("infers a low-cardinality string column as categorical", async () => {
    const result = await parseDataset(
      csv("group\n" + Array(30).fill(0).map((_, i) => (i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "C")).join("\n")),
      "text/csv",
      "data.csv",
    );
    expect(result.columns[0].type).toBe("categorical");
  });

  it("infers a high-cardinality string column as text", async () => {
    const rows = Array(30).fill(0).map((_, i) => `unique-value-${i}`).join("\n");
    const result = await parseDataset(csv(`notes\n${rows}`), "text/csv", "data.csv");
    expect(result.columns[0].type).toBe("text");
  });

  it("infers an ISO date column as date", async () => {
    const result = await parseDataset(
      csv("visited\n2024-01-01\n2024-02-15\n2024-03-20"),
      "text/csv",
      "data.csv",
    );
    expect(result.columns[0].type).toBe("date");
  });

  it("counts missing values as empty strings become null, not the string 'null'", async () => {
    // A single blank line in a single-column CSV is ambiguous with "no row
    // at all" and gets dropped by skip_empty_lines — so this uses a second
    // populated column to make the missing `age` field unambiguous.
    const result = await parseDataset(csv("age,note\n20,a\n,b\n30,c"), "text/csv", "data.csv");
    expect(result.columns.find((c) => c.name === "age")?.missingCount).toBe(1);
    expect(result.rows[1].age).toBeNull();
  });

  it("throws DatasetParseError for a file with no data rows", async () => {
    await expect(parseDataset(csv("age,group"), "text/csv", "empty.csv")).rejects.toThrow(DatasetParseError);
  });

  it("throws DatasetParseError when the row count exceeds the limit", async () => {
    const header = "x\n";
    const rows = Array(MAX_DATASET_ROWS + 1).fill("1").join("\n");
    await expect(parseDataset(csv(header + rows), "text/csv", "big.csv")).rejects.toThrow(DatasetParseError);
  });

  it("handles quoted fields containing commas", async () => {
    const result = await parseDataset(
      Buffer.from('name,note\n"Smith, John","has, a comma"\n'),
      "text/csv",
      "data.csv",
    );
    expect(result.rows[0].name).toBe("Smith, John");
    expect(result.rows[0].note).toBe("has, a comma");
  });
});

describe("parseDataset — unsupported/malformed input", () => {
  it("does not silently produce a numeric type for a mixed numeric/text column", async () => {
    const result = await parseDataset(csv("mixed\n1\ntwo\n3"), "text/csv", "data.csv");
    // Not every value is numeric, so this must not be classified as numeric.
    expect(result.columns[0].type).not.toBe("numeric");
  });
});
