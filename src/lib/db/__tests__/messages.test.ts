import { describe, expect, it } from "vitest";
import { getRecentMessages, insertMessage } from "../messages";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("insertMessage", () => {
  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { ai_messages: { data: null, error: { message: "denied" } } },
    });
    await expect(
      insertMessage(client, { conversation_id: "c1", role: "user", content: "hi" }),
    ).rejects.toThrow(DbError);
  });
});

describe("getRecentMessages", () => {
  it("reverses the desc-ordered page back into chronological order", async () => {
    const { client } = createSupabaseMock({
      tableResults: {
        ai_messages: {
          data: [
            { id: "m3", created_at: "3" },
            { id: "m2", created_at: "2" },
            { id: "m1", created_at: "1" },
          ],
          error: null,
        },
      },
    });
    const result = await getRecentMessages(client, "conv-1", 3);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("defaults to a limit of 6", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { ai_messages: { data: [], error: null } },
    });
    await getRecentMessages(client, "conv-1");
    const limitCall = fromCalls[0].builder.calls.find((c) => c.method === "limit");
    expect(limitCall?.args).toEqual([6]);
  });
});
