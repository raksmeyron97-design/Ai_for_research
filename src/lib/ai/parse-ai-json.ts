import type { ZodType } from "zod";

/**
 * One place where model output becomes typed application state.
 *
 * Before Phase 16A, three call sites each did their own `JSON.parse` inside
 * their own try/catch, with three different failure behaviours and no shared
 * notion of *why* a parse failed (finding F10). Centralising it does not make
 * the failures identical — they legitimately differ, and the caller still
 * decides — but it makes the parsing itself, the fence handling, and the
 * error shape uniform, so a malformed response can never become trusted state
 * through a path nobody checked.
 *
 * This never returns partial or repaired data. A response that does not
 * validate produces a failure, never a half-populated object that looks
 * valid downstream.
 */
export type AIJsonFailureReason =
  /** Empty or whitespace-only response. */
  | "empty"
  /** Not parseable as JSON at all. */
  | "not_json"
  /** Parsed, but did not satisfy the task's schema. */
  | "schema_mismatch";

export interface AIJsonParseSuccess<T> {
  ok: true;
  data: T;
  /** True when the model wrapped its JSON in a markdown code fence. */
  wasFenced: boolean;
}

export interface AIJsonParseFailure {
  ok: false;
  reason: AIJsonFailureReason;
  /** Human-readable, safe to show a researcher — never contains raw model output. */
  message: string;
  /** Schema violation paths, when the failure was a schema mismatch. */
  issues: string[];
}

export type AIJsonParseResult<T> = AIJsonParseSuccess<T> | AIJsonParseFailure;

export class AIJsonParseError extends Error {
  constructor(
    public readonly reason: AIJsonFailureReason,
    public readonly task: string,
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "AIJsonParseError";
  }
}

/**
 * Providers asked for JSON sometimes wrap it in a markdown fence despite a
 * structured-output schema. Stripping it is not "repairing" the payload —
 * the JSON inside is untouched — it just removes a wrapper that would
 * otherwise turn a perfectly good response into a hard failure.
 */
function stripCodeFence(raw: string): { text: string; wasFenced: boolean } {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenced ? { text: fenced[1].trim(), wasFenced: true } : { text: trimmed, wasFenced: false };
}

export function parseAIJson<T>(params: {
  raw: string;
  schema: ZodType<T>;
  /** Task name, used only in error messages and logs. */
  task: string;
}): AIJsonParseResult<T> {
  const { raw, schema, task } = params;

  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: `The ${task} response was empty.`,
      issues: [],
    };
  }

  const { text, wasFenced } = stripCodeFence(raw);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: "not_json",
      message: `The ${task} response was not valid JSON.`,
      issues: [],
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return {
      ok: false,
      reason: "schema_mismatch",
      message: `The ${task} response did not match the expected structure.`,
      issues,
    };
  }

  return { ok: true, data: result.data, wasFenced };
}

/**
 * Throwing variant, for callers whose correct response to bad output is to
 * abort rather than degrade — questionnaire generation, where a partial save
 * would leave an instrument in the database that failed its own validation.
 */
export function parseAIJsonOrThrow<T>(params: { raw: string; schema: ZodType<T>; task: string }): T {
  const result = parseAIJson(params);
  if (result.ok) return result.data;
  throw new AIJsonParseError(
    result.reason,
    params.task,
    `${result.message}${result.issues.length ? ` (${result.issues[0]})` : ""}`,
    result.issues,
  );
}
