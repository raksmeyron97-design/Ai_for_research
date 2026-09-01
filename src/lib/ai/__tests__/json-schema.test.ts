import { describe, expect, it } from "vitest";
import { toGeminiSchema } from "../json-schema";

describe("toGeminiSchema", () => {
  it("uppercases a top-level type", () => {
    expect(toGeminiSchema({ type: "object" })).toEqual({ type: "OBJECT" });
  });

  it("recursively uppercases nested property types", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
    });
    expect(result).toEqual({
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        count: { type: "NUMBER" },
      },
    });
  });

  it("uppercases array item types", () => {
    const result = toGeminiSchema({
      type: "array",
      items: { type: "string" },
    });
    expect(result).toEqual({ type: "ARRAY", items: { type: "STRING" } });
  });

  it("preserves non-type fields untouched", () => {
    const result = toGeminiSchema({
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: { name: { type: "string", enum: ["a", "b"] } },
    });
    expect(result.required).toEqual(["name"]);
    expect(result.additionalProperties).toBe(false);
    expect((result.properties as Record<string, unknown>).name).toEqual({
      type: "STRING",
      enum: ["a", "b"],
    });
  });

  it("does not mutate the input object", () => {
    const input = { type: "object", properties: { a: { type: "string" } } };
    toGeminiSchema(input);
    expect(input.type).toBe("object");
    expect(input.properties.a.type).toBe("string");
  });
});
