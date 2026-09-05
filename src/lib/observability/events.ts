/**
 * The operational event vocabulary (Phase 21 §33-§34).
 *
 * Before this there was no operational logging at all: a handful of
 * `console.error` calls in catch blocks and nothing that said what the
 * application was doing or how long it took. Adding logging to a system that
 * handles unpublished research is not a free action, though — the obvious
 * implementation, a `log(message, context)` helper, is one careless call away
 * from putting a researcher's manuscript into a log aggregator forever.
 *
 * So the shape is the safety, not the rule. `OperationalEvent` admits only:
 *
 *   * a name from a closed vocabulary
 *   * opaque identifiers (uuids)
 *   * numbers, booleans, and a small set of enumerated statuses
 *
 * There is no `message` field, no `details`, no `Record<string, unknown>`.
 * Free text cannot be passed because there is nowhere to put it, so §34's
 * "never log manuscript text, source text, excerpts, prompts or model
 * responses" is enforced by the type rather than remembered by the author.
 *
 * `scrubEvent` is the belt to that braces: it runs at emit time and drops
 * anything that reached the payload despite the type — `as any`, a value
 * widened through a generic, a field added later without thinking. §56 asks
 * for a test that logs cannot contain private research data; the enforcement
 * point being one function is what makes such a test possible at all.
 */

/**
 * The closed vocabulary (§33).
 *
 * Deliberately about researcher-visible operations rather than about
 * functions. "integrity_review_completed" is a thing that happened to someone;
 * "buildIntegrityReview returned" is a thing that happened to a stack frame,
 * and the second is only useful to whoever wrote it.
 */
export const OPERATIONAL_EVENTS = [
  "workspace_opened",

  "integrity_review_started",
  "integrity_review_completed",
  "integrity_review_failed",

  "methodology_review_started",
  "methodology_review_completed",
  "methodology_review_failed",

  "framework_updated",
  "framework_reordered",

  "source_search",

  "claim_trace_opened",
  "citation_trace_opened",
  "construct_trace_opened",

  // AI stays advisory, and the vocabulary says so: a proposal is requested,
  // completed, and then accepted or rejected BY SOMEONE. There is deliberately
  // no "ai_proposal_applied" — nothing is applied without a decision, and an
  // event name implying otherwise would misdescribe the system.
  "ai_proposal_requested",
  "ai_proposal_completed",
  "ai_proposal_failed",
  "ai_proposal_accepted",
  "ai_proposal_rejected",

  "ai_provider_unavailable",
] as const;

export type OperationalEventName = (typeof OPERATIONAL_EVENTS)[number];

export type OperationalStatus = "ok" | "empty" | "partial" | "unavailable" | "denied" | "error";

/**
 * The error *class*, never the error text.
 *
 * A Postgres message names constraints and columns; a provider message can
 * carry a fragment of the prompt back. Both are exactly what §34 forbids, and
 * both are what a naive `err.message` writes. Five buckets are enough to tell
 * an outage from a bug.
 */
export type ErrorClass = "validation" | "authorization" | "not_found" | "database" | "provider" | "unknown";

export interface OperationalEvent {
  name: OperationalEventName;
  /** Opaque uuids. Which project and which object, never their contents. */
  projectId?: string;
  objectId?: string;
  status: OperationalStatus;
  durationMs?: number;
  errorClass?: ErrorClass;
  /**
   * Cardinality only: how many findings, how many results, how many nodes.
   * A count is the thing worth trending and cannot leak what was counted.
   */
  count?: number;
}

/** A uuid, or nothing. Anything else is not an id we put in a log. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduce an event to the fields that are safe by construction (§34, §56).
 *
 * Every rule here exists because the corresponding mistake is easy:
 *
 *   * an unknown event name is dropped rather than passed through, so an
 *     ad-hoc `log("saving " + title)` cannot become an event name carrying a
 *     document title
 *   * an id that is not a uuid is dropped rather than truncated — a
 *     non-uuid in an id field is a string from somewhere else, and a prefix
 *     of a researcher's sentence is still a researcher's sentence
 *   * any field not named above is dropped, so adding one to a call site does
 *     not silently start logging it
 *   * non-finite numbers are dropped, so `NaN` does not reach a sink that
 *     serialises it as `null` and makes a duration look like an absence
 */
export function scrubEvent(input: OperationalEvent): OperationalEvent | null {
  if (!OPERATIONAL_EVENTS.includes(input.name)) return null;

  const safe: OperationalEvent = { name: input.name, status: input.status };

  if (input.projectId && UUID.test(input.projectId)) safe.projectId = input.projectId;
  if (input.objectId && UUID.test(input.objectId)) safe.objectId = input.objectId;
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    safe.durationMs = Math.round(input.durationMs);
  }
  if (typeof input.count === "number" && Number.isFinite(input.count)) {
    safe.count = Math.round(input.count);
  }
  if (input.errorClass) safe.errorClass = input.errorClass;

  return safe;
}

/**
 * Where events go. Replaceable so a deployment can ship them somewhere;
 * `console` by default, because a structured line on stdout is what every
 * hosting platform already collects and it adds no dependency.
 */
export type EventSink = (event: OperationalEvent) => void;

let sink: EventSink = (event) => {
  // One JSON object per line. `event` as the discriminator so these are
  // filterable out of application noise.
  console.log(JSON.stringify({ kind: "event", ...event }));
};

export function setEventSink(next: EventSink): void {
  sink = next;
}

export function recordEvent(event: OperationalEvent): void {
  const safe = scrubEvent(event);
  if (!safe) return;
  try {
    sink(safe);
  } catch {
    // Observability must never be able to fail a researcher's operation. A
    // broken sink loses events; it does not lose work.
  }
}

/**
 * Map a thrown value to a bucket, without reading its text.
 *
 * The DbError shape carries a `notFound` flag, which is the one distinction
 * worth keeping from an error object. Everything else is classified by type,
 * never by matching on a message — message matching is how a log ends up
 * containing the message it was matching on.
 */
export function classifyError(err: unknown): ErrorClass {
  if (err && typeof err === "object") {
    if ((err as { notFound?: boolean }).notFound) return "not_found";
    if ((err as { name?: string }).name === "DbError") return "database";
  }
  return "unknown";
}

/**
 * Time an operation and emit exactly one event for it.
 *
 * One event, not a started/finished pair, for anything that completes inside a
 * request: two events for one operation doubles the volume and makes every
 * query a join. The `*_started` names in the vocabulary are for the operations
 * a researcher kicks off and waits on, where the start is itself interesting.
 */
export async function withEvent<T>(
  event: Omit<OperationalEvent, "status" | "durationMs">,
  operation: () => Promise<T>,
  describe?: (result: T) => { status?: OperationalStatus; count?: number },
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    const described = describe?.(result) ?? {};
    recordEvent({
      ...event,
      status: described.status ?? "ok",
      count: described.count ?? event.count,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    recordEvent({
      ...event,
      status: "error",
      errorClass: classifyError(err),
      durationMs: Date.now() - started,
    });
    // Rethrown unchanged: the caller's error handling is what a researcher
    // sees, and observability must not alter it.
    throw err;
  }
}
