import { describe, expect, it } from "vitest";
import { deleteQuestion, insertQuestions, listQuestions, updateQuestion } from "../questions";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("listQuestions", () => {
  it("orders by order_index ascending", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: [{ id: "q1" }], error: null } },
    });
    await listQuestions(client, "instrument-1");
    const orderCall = fromCalls[0].builder.calls.find((c) => c.method === "order");
    expect(orderCall?.args).toEqual(["order_index", { ascending: true }]);
  });
});

describe("insertQuestions", () => {
  it("does nothing for an empty array", async () => {
    const { client, fromCalls } = createSupabaseMock({});
    const result = await insertQuestions(client, []);
    expect(result).toEqual([]);
    expect(fromCalls).toHaveLength(0);
  });

  it("inserts all given questions in one call", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: [{ id: "q1" }, { id: "q2" }], error: null } },
    });
    const rows = [
      { instrument_id: "i1", project_id: "p1", section_label: "Demographics", question_text: "Age?", response_type: "numeric" as const, order_index: 0 },
      { instrument_id: "i1", project_id: "p1", section_label: "Demographics", question_text: "Sex?", response_type: "yes_no" as const, order_index: 1 },
    ];
    await insertQuestions(client, rows);
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual(rows);
  });

  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: null, error: { message: "denied" } } },
    });
    await expect(
      insertQuestions(client, [
        { instrument_id: "i1", project_id: "p1", section_label: "X", question_text: "?", response_type: "open_text", order_index: 0 },
      ]),
    ).rejects.toThrow(DbError);
  });
});

describe("updateQuestion / deleteQuestion", () => {
  it("updateQuestion sends only the patch fields", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: { id: "q1" }, error: null } },
    });
    await updateQuestion(client, "p1", "q1", { required: false });
    const updateCall = fromCalls[0].builder.calls.find((c) => c.method === "update");
    expect(updateCall?.args[0]).toEqual({ required: false });
  });

  // Phase 18 §27: an item id is not authorisation. Both mutations filter on
  // the project too, so RLS is not the only thing between an id and another
  // project's questionnaire.
  it("updateQuestion filters on the project as well as the id", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: { id: "q1" }, error: null } },
    });
    await updateQuestion(client, "p1", "q1", { required: false });
    const eqCalls = fromCalls[0].builder.calls.filter((c) => c.method === "eq");
    expect(eqCalls.map((c) => c.args)).toEqual([
      ["id", "q1"],
      ["project_id", "p1"],
    ]);
  });

  it("deleteQuestion filters on the project as well as the id", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: null, error: null } },
    });
    await deleteQuestion(client, "p1", "q1");
    const eqCalls = fromCalls[0].builder.calls.filter((c) => c.method === "eq");
    expect(eqCalls.map((c) => c.args)).toEqual([
      ["id", "q1"],
      ["project_id", "p1"],
    ]);
  });

  it("deleteQuestion throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { questionnaire_questions: { data: null, error: { message: "denied" } } },
    });
    await expect(deleteQuestion(client, "p1", "q1")).rejects.toThrow(DbError);
  });
});
