import { describe, expect, it } from "vitest";
import {
  getIntegrityDecision,
  linkClaimToMethodology,
  listClaimMethodologyLinks,
  listIntegrityDecisions,
  listIntegrityEvents,
  recordIntegrityEvent,
  unlinkClaimMethodology,
  upsertIntegrityDecision,
} from "../integrity";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("linkClaimToMethodology / listClaimMethodologyLinks / unlinkClaimMethodology", () => {
  it("inserts a link and returns the row", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_claim_methodology_links: {
          data: { id: "l1", project_id: "p1", claim_id: "c1", construct_id: "k1" },
          error: null,
        },
      },
    });
    const row = await linkClaimToMethodology(client, {
      project_id: "p1",
      claim_id: "c1",
      construct_id: "k1",
    });
    expect(row.id).toBe("l1");
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual({ project_id: "p1", claim_id: "c1", construct_id: "k1" });
  });

  it("lists links scoped to a claim when given one", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_claim_methodology_links: { data: [{ id: "l1" }], error: null } },
    });
    await listClaimMethodologyLinks(client, "p1", "c1");
    const eqCalls = fromCalls[0].builder.calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["project_id", "p1"] });
    expect(eqCalls).toContainEqual({ method: "eq", args: ["claim_id", "c1"] });
  });

  it("unlinkClaimMethodology throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_claim_methodology_links: { data: null, error: { message: "denied" } } },
    });
    await expect(unlinkClaimMethodology(client, "p1", "l1")).rejects.toThrow(DbError);
  });
});

describe("integrity decisions", () => {
  it("getIntegrityDecision returns null when none exists", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_integrity_decisions: { data: null, error: null } },
    });
    expect(await getIntegrityDecision(client, "p1", "citation:unresolved:c1")).toBeNull();
  });

  it("listIntegrityDecisions scopes to the project", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_integrity_decisions: { data: [{ id: "d1" }], error: null } },
    });
    await listIntegrityDecisions(client, "p1");
    const eqCall = fromCalls[0].builder.calls.find((c) => c.method === "eq");
    expect(eqCall?.args).toEqual(["project_id", "p1"]);
  });

  it("upsertIntegrityDecision upserts on (project_id, finding_id), never inserts blind", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_integrity_decisions: {
          data: { id: "d1", project_id: "p1", finding_id: "citation:unresolved:c1", status: "dismissed" },
          error: null,
        },
      },
    });
    const row = await upsertIntegrityDecision(client, "p1", "citation:unresolved:c1", {
      status: "dismissed",
      note: "Author confirmed by email",
    });
    expect(row.status).toBe("dismissed");
    const upsertCall = fromCalls[0].builder.calls.find((c) => c.method === "upsert");
    expect(upsertCall?.args[1]).toEqual({ onConflict: "project_id,finding_id" });
    expect(upsertCall?.args[0]).toEqual({
      project_id: "p1",
      finding_id: "citation:unresolved:c1",
      status: "dismissed",
      note: "Author confirmed by email",
    });
  });

  it("upsertIntegrityDecision throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_integrity_decisions: { data: null, error: { message: "denied" } } },
    });
    await expect(
      upsertIntegrityDecision(client, "p1", "citation:unresolved:c1", { status: "accepted" }),
    ).rejects.toThrow(DbError);
  });
});

describe("integrity events (append-only)", () => {
  it("recordIntegrityEvent inserts and returns the row", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_integrity_events: {
          data: { id: "e1", project_id: "p1", entity_type: "finding", action: "finding_dismissed" },
          error: null,
        },
      },
    });
    const row = await recordIntegrityEvent(client, {
      project_id: "p1",
      entity_type: "finding",
      action: "finding_dismissed",
      summary: "Dismissed unresolved-citation finding for claim c1",
    });
    expect(row.id).toBe("e1");
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall).toBeTruthy();
  });

  it("listIntegrityEvents orders newest first and caps the limit at 200", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_integrity_events: { data: [], error: null } },
    });
    await listIntegrityEvents(client, "p1", { limit: 5000 });
    const orderCall = fromCalls[0].builder.calls.find((c) => c.method === "order");
    expect(orderCall?.args).toEqual(["created_at", { ascending: false }]);
    const limitCall = fromCalls[0].builder.calls.find((c) => c.method === "limit");
    expect(limitCall?.args).toEqual([200]);
  });

  it("listIntegrityEvents filters by entityId when given", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_integrity_events: { data: [], error: null } },
    });
    await listIntegrityEvents(client, "p1", { entityId: "c1" });
    const eqCalls = fromCalls[0].builder.calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["entity_id", "c1"] });
  });
});
