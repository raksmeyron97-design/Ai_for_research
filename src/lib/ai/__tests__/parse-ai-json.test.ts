import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIJsonParseError, parseAIJson, parseAIJsonOrThrow } from "../parse-ai-json";

const schema = z.object({
  name: z.string().min(1),
  count: z.number().int(),
});

const task = "test task";

/** Phase 16A finding F10: one parser, uniform failure shape, no repaired data. */
describe("parseAIJson", () => {
  it("parses valid JSON that satisfies the schema", () => {
    const result = parseAIJson({ raw: '{"name":"a","count":2}', schema, task });
    expect(result).toMatchObject({ ok: true, data: { name: "a", count: 2 }, wasFenced: false });
  });

  it("reports malformed JSON as not_json", () => {
    const result = parseAIJson({ raw: "{not json at all", schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_json");
    expect(result.message).toContain("test task");
  });

  it("reports valid JSON with the wrong schema as schema_mismatch, listing the paths", () => {
    const result = parseAIJson({ raw: '{"name":"a","count":"two"}', schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_mismatch");
    expect(result.issues.join(" ")).toContain("count");
  });

  it("reports missing required fields", () => {
    const result = parseAIJson({ raw: '{"name":"a"}', schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_mismatch");
    expect(result.issues.join(" ")).toContain("count");
  });

  it("strips unknown extra properties rather than failing, since the schema is not strict", () => {
    const result = parseAIJson({ raw: '{"name":"a","count":2,"extra":true}', schema, task });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ name: "a", count: 2 });
    expect(result.data).not.toHaveProperty("extra");
  });

  it("rejects extra properties when the schema is strict", () => {
    const strict = schema.strict();
    const result = parseAIJson({ raw: '{"name":"a","count":2,"extra":true}', schema: strict, task });
    expect(result.ok).toBe(false);
  });

  it("reports a JSON null as a schema mismatch, never as success", () => {
    const result = parseAIJson({ raw: "null", schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_mismatch");
  });

  it("reports an empty string as empty", () => {
    const result = parseAIJson({ raw: "", schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty");
  });

  it("reports whitespace-only output as empty", () => {
    const result = parseAIJson({ raw: "   \n\t ", schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty");
  });

  it("accepts JSON wrapped in a markdown fence and says it was fenced", () => {
    const result = parseAIJson({ raw: '```json\n{"name":"a","count":2}\n```', schema, task });
    expect(result).toMatchObject({ ok: true, wasFenced: true });
  });

  it("accepts a bare fence with no language tag", () => {
    const result = parseAIJson({ raw: '```\n{"name":"a","count":2}\n```', schema, task });
    expect(result).toMatchObject({ ok: true, wasFenced: true });
  });

  it("never returns partially valid data", () => {
    const result = parseAIJson({ raw: '{"name":"","count":2}', schema, task });
    expect(result.ok).toBe(false);
    // No `data` on a failure — a caller cannot accidentally read half an object.
    expect(result).not.toHaveProperty("data");
  });

  it("keeps raw model output out of the message shown to a researcher", () => {
    const result = parseAIJson({ raw: "I'm sorry, I cannot comply with that.", schema, task });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("I'm sorry");
  });
});

describe("parseAIJsonOrThrow", () => {
  it("returns data on success", () => {
    expect(parseAIJsonOrThrow({ raw: '{"name":"a","count":2}', schema, task })).toEqual({ name: "a", count: 2 });
  });

  it("throws AIJsonParseError carrying the reason and task", () => {
    try {
      parseAIJsonOrThrow({ raw: "nope", schema, task });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AIJsonParseError);
      expect((err as AIJsonParseError).reason).toBe("not_json");
      expect((err as AIJsonParseError).task).toBe(task);
    }
  });

  it("includes the first schema issue in the thrown message", () => {
    try {
      parseAIJsonOrThrow({ raw: '{"name":"a"}', schema, task });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as AIJsonParseError).issues.length).toBeGreaterThan(0);
    }
  });
});
