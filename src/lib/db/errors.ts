import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Wraps a Supabase/Postgrest error so callers (API routes) can branch on
 * `notFound` without string-matching Postgres error codes everywhere.
 * `PGRST116` is PostgREST's "no rows for .single()" code — that's a 404,
 * not a 500, and every other Postgrest error is surfaced but not detailed
 * (avoid leaking schema/constraint internals to a client response).
 */
export class DbError extends Error {
  constructor(
    message: string,
    public readonly notFound: boolean = false,
    public readonly cause?: PostgrestError | Error,
  ) {
    super(message);
    this.name = "DbError";
  }
}

export function toDbError(error: PostgrestError, context: string): DbError {
  if (error.code === "PGRST116") {
    return new DbError(`${context}: not found`, true, error);
  }
  return new DbError(`${context}: ${error.message}`, false, error);
}
