import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyError,
  recordEvent,
  scrubEvent,
  setEventSink,
  withEvent,
  type OperationalEvent,
} from "../events";

/**
 * Phase 21 §33-§34, §56.
 *
 * The point of these is not that logging works — it is that logging cannot
 * carry a researcher's work out of the system. The type makes free text
 * unrepresentable; these check the runtime half, which is what protects
 * against `as any`, a value widened through a generic, and a field someone
 * adds later without thinking.
 */
const PROJECT = "aaaaaaaa-1111-1111-1111-111111111111";

function captured(): { events: OperationalEvent[] } {
  const events: OperationalEvent[] = [];
  setEventSink((e) => events.push(e));
  return { events };
}

afterEach(() => {
  setEventSink((event) => console.log(JSON.stringify({ kind: "event", ...event })));
  vi.restoreAllMocks();
});

describe("operational events cannot carry research content", () => {
  it("drops any field that is not in the vocabulary", () => {
    // The shape a careless caller reaches for. None of it may survive.
    const smuggled = {
      name: "source_search",
      status: "ok",
      projectId: PROJECT,
      message: "Teacher motivation was positively associated with student performance.",
      excerpt: "…the sample comprised 412 teachers…",
      prompt: "You are a research assistant. The manuscript says: …",
      query: "postpartum depression screening",
      apiKey: "sk-not-a-real-key-000000000000",
    } as unknown as OperationalEvent;

    const safe = scrubEvent(smuggled)!;

    expect(Object.keys(safe).sort()).toEqual(["name", "projectId", "status"]);
    expect(JSON.stringify(safe)).not.toMatch(/motivation|teachers|assistant|depression|sk-/i);
  });

  it("drops an id that is not a uuid rather than truncating it", () => {
    // A prefix of a researcher's sentence is still a researcher's sentence.
    const safe = scrubEvent({
      name: "claim_trace_opened",
      status: "ok",
      objectId: "Motivation is the single most important factor in education.",
    })!;

    expect(safe.objectId).toBeUndefined();
  });

  it("refuses an event name it does not recognise", () => {
    // So an ad-hoc `log("saving " + title)` cannot become an event name
    // carrying a document title.
    expect(
      scrubEvent({ name: "saving Prevalence study" as never, status: "ok" }),
    ).toBeNull();
  });

  it("keeps the fields that are safe by construction", () => {
    const safe = scrubEvent({
      name: "integrity_review_completed",
      status: "partial",
      projectId: PROJECT,
      objectId: "bbbbbbbb-2222-2222-2222-222222222222",
      durationMs: 1234.6,
      count: 7,
      errorClass: "database",
    })!;

    expect(safe).toEqual({
      name: "integrity_review_completed",
      status: "partial",
      projectId: PROJECT,
      objectId: "bbbbbbbb-2222-2222-2222-222222222222",
      durationMs: 1235,
      count: 7,
      errorClass: "database",
    });
  });

  it("drops a non-finite duration rather than logging it as an absence", () => {
    const safe = scrubEvent({ name: "source_search", status: "ok", durationMs: Number.NaN })!;
    expect(safe.durationMs).toBeUndefined();
  });
});

describe("errors are classified, never quoted", () => {
  it("buckets a database error without reading its message", () => {
    // A Postgres message names constraints and columns. Classification must
    // not depend on matching it, because matching is how it ends up logged.
    const err = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
      name: "DbError",
    });
    expect(classifyError(err)).toBe("database");
  });

  it("recognises not-found from the flag the db layer already sets", () => {
    expect(classifyError({ notFound: true })).toBe("not_found");
  });

  it("falls back to unknown rather than inventing a class", () => {
    expect(classifyError(new Error("something"))).toBe("unknown");
    expect(classifyError("a string")).toBe("unknown");
  });

  it("never puts the error's text in the event", () => {
    const { events } = captured();

    return withEvent({ name: "source_search", projectId: PROJECT }, async () => {
      throw new Error("connection to server at 10.0.0.4 failed: password authentication failed");
    })
      .then(() => expect.unreachable("should have rethrown"))
      .catch(() => {
        expect(events[0].status).toBe("error");
        expect(JSON.stringify(events[0])).not.toMatch(/10\.0\.0\.4|password|authentication/i);
      });
  });
});

describe("withEvent", () => {
  it("emits one event per operation, with a duration and a count", async () => {
    const { events } = captured();

    const result = await withEvent(
      { name: "source_search", projectId: PROJECT },
      async () => ["a", "b", "c"],
      (rows) => ({ count: rows.length, status: rows.length === 0 ? "empty" : "ok" }),
    );

    expect(result).toEqual(["a", "b", "c"]);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("source_search");
    expect(events[0].count).toBe(3);
    expect(events[0].status).toBe("ok");
    expect(typeof events[0].durationMs).toBe("number");
  });

  it("rethrows unchanged, so observability cannot alter what the researcher sees", async () => {
    captured();
    const original = new Error("the original");

    await expect(
      withEvent({ name: "source_search", projectId: PROJECT }, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("a broken sink loses events, never work", async () => {
    setEventSink(() => {
      throw new Error("the log aggregator is down");
    });

    await expect(
      withEvent({ name: "source_search", projectId: PROJECT }, async () => "fine"),
    ).resolves.toBe("fine");
  });

  it("reports an empty result as empty rather than as a failure", async () => {
    // §42/§48: nothing found is a state, not an error, and a project with no
    // sources is not a broken project.
    const { events } = captured();

    await withEvent(
      { name: "source_search", projectId: PROJECT },
      async () => [] as string[],
      (rows) => ({ count: rows.length, status: rows.length === 0 ? "empty" : "ok" }),
    );

    expect(events[0].status).toBe("empty");
    expect(events[0].count).toBe(0);
  });
});

describe("recordEvent", () => {
  it("silently drops an event the scrubber rejects", () => {
    const { events } = captured();
    recordEvent({ name: "not_a_real_event" as never, status: "ok" });
    expect(events).toHaveLength(0);
  });
});
