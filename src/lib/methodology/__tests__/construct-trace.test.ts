import { describe, expect, it } from "vitest";
import { traceConstruct, type ConstructTraceInput } from "../construct-trace";
import { EMPTY_MODEL } from "../model";

/**
 * Phase 21 §25. The property under test throughout: every link reported is a
 * stored one, and every missing link is reported as missing rather than
 * inferred.
 */
function construct(over: Record<string, unknown> = {}) {
  return {
    id: "con-a",
    project_id: "p1",
    name: "Teacher motivation",
    role: "independent",
    conceptual_definition: "Willingness to invest effort.",
    operational_definition: "Mean of motivation items.",
    notes: null,
    provenance: "user",
    confirmed: true,
    created_at: "",
    updated_at: "",
    ...over,
  } as never;
}

function input(over: Partial<ConstructTraceInput> = {}): ConstructTraceInput {
  return {
    methodology: { ...EMPTY_MODEL, constructs: [construct()] },
    nodes: [],
    relationships: [],
    claims: [],
    claimLinks: [],
    ...over,
  };
}

describe("construct traceability", () => {
  it("returns null for a construct that does not exist", () => {
    expect(traceConstruct("nope", input())).toBeNull();
  });

  it("reports an item that names the construct and one that reaches it through an indicator", () => {
    const trace = traceConstruct(
      "con-a",
      input({
        methodology: {
          ...EMPTY_MODEL,
          constructs: [construct()],
          indicators: [
            { id: "ind-1", project_id: "p1", construct_id: "con-a", name: "Effort", dimension: null } as never,
          ],
          items: [
            { id: "q1", question_text: "I try hard.", construct_id: "con-a", indicator_id: null } as never,
            { id: "q2", question_text: "I persist.", construct_id: null, indicator_id: "ind-1" } as never,
            // Belongs to a different construct entirely and must not appear.
            { id: "q3", question_text: "Unrelated.", construct_id: "con-z", indicator_id: null } as never,
          ],
        },
      }),
    )!;

    expect(trace.items.map((i) => [i.id, i.via])).toEqual([
      ["q1", "construct"],
      ["q2", "indicator"],
    ]);
  });

  it("carries the position a construct holds in each hypothesis, not a single role", () => {
    // The same concept is the predictor in one hypothesis and the outcome in
    // another. Reading the role off the construct would report one of them
    // for both.
    const trace = traceConstruct(
      "con-a",
      input({
        methodology: {
          ...EMPTY_MODEL,
          constructs: [construct()],
          hypotheses: [
            { id: "h1", label: "H1", statement: "A predicts B." } as never,
            { id: "h2", label: "H2", statement: "C predicts A." } as never,
          ],
          hypothesisVariables: [
            { id: "v1", hypothesis_id: "h1", construct_id: "con-a", position: "independent" } as never,
            { id: "v2", hypothesis_id: "h2", construct_id: "con-a", position: "dependent" } as never,
          ],
        },
      }),
    )!;

    expect(trace.hypotheses.map((h) => [h.id, h.position])).toEqual([
      ["h1", "independent"],
      ["h2", "dependent"],
    ]);
  });

  it("reports framework edges in both directions with the other end named", () => {
    const trace = traceConstruct(
      "con-a",
      input({
        methodology: {
          ...EMPTY_MODEL,
          constructs: [construct(), construct({ id: "con-b", name: "Student performance" })],
        },
        nodes: [
          { id: "n-a", project_id: "p1", construct_id: "con-a", label: null } as never,
          { id: "n-b", project_id: "p1", construct_id: "con-b", label: null } as never,
          { id: "n-c", project_id: "p1", construct_id: null, label: "School climate" } as never,
        ],
        relationships: [
          { id: "r1", from_node_id: "n-a", to_node_id: "n-b", relation_type: "predicts", hypothesis_id: null } as never,
          { id: "r2", from_node_id: "n-c", to_node_id: "n-a", relation_type: "influences", hypothesis_id: null } as never,
        ],
      }),
    )!;

    expect(trace.relationships).toEqual([
      { id: "r1", relationType: "predicts", direction: "from", otherName: "Student performance", hypothesisId: null },
      // An unmapped endpoint shows its own label; there is no construct to
      // take a canonical name from.
      { id: "r2", relationType: "influences", direction: "to", otherName: "School climate", hypothesisId: null },
    ]);
  });

  it("links a claim only through a stored link, never by matching the construct's name", () => {
    const claims = [
      { id: "c1", claim_text: "Teacher motivation predicts performance.", section_type: "results" } as never,
      // Names the construct verbatim, and is deliberately NOT linked. A word
      // match is a coincidence of wording, not traceability.
      { id: "c2", claim_text: "Teacher motivation is hard to measure.", section_type: "discussion" } as never,
    ];

    const trace = traceConstruct(
      "con-a",
      input({
        claims,
        claimLinks: [{ id: "l1", claim_id: "c1", construct_id: "con-a" } as never],
      }),
    )!;

    expect(trace.claims.map((c) => c.id)).toEqual(["c1"]);
  });

  it("names every gap for a construct nothing points at", () => {
    const trace = traceConstruct(
      "con-a",
      input({
        methodology: {
          ...EMPTY_MODEL,
          constructs: [construct({ operational_definition: null })],
        },
      }),
    )!;

    expect(trace.gaps).toEqual([
      "No operational definition — nothing says how this concept is measured.",
      "No indicators — this concept has no observable parts a questionnaire item could ask about.",
      "No questionnaire item asks about this concept.",
      "No hypothesis involves this concept.",
      "This concept is not in your conceptual framework.",
      "No claim in your manuscript is linked to this concept.",
    ]);
  });

  it("distinguishes a concept missing from the framework from one that is in it alone", () => {
    const trace = traceConstruct(
      "con-a",
      input({ nodes: [{ id: "n-a", project_id: "p1", construct_id: "con-a", label: null } as never] }),
    )!;

    expect(trace.gaps).toContain("It is in the framework but not related to anything in it.");
    expect(trace.gaps).not.toContain("This concept is not in your conceptual framework.");
  });

  it("reports no gaps when every link exists", () => {
    const trace = traceConstruct(
      "con-a",
      input({
        methodology: {
          ...EMPTY_MODEL,
          constructs: [construct(), construct({ id: "con-b", name: "Performance" })],
          indicators: [{ id: "ind-1", construct_id: "con-a", name: "Effort", dimension: null } as never],
          items: [{ id: "q1", question_text: "I try hard.", construct_id: "con-a", indicator_id: null } as never],
          hypotheses: [{ id: "h1", label: "H1", statement: "A predicts B." } as never],
          hypothesisVariables: [
            { id: "v1", hypothesis_id: "h1", construct_id: "con-a", position: "independent" } as never,
          ],
        },
        nodes: [
          { id: "n-a", construct_id: "con-a", label: null } as never,
          { id: "n-b", construct_id: "con-b", label: null } as never,
        ],
        relationships: [
          { id: "r1", from_node_id: "n-a", to_node_id: "n-b", relation_type: "predicts", hypothesis_id: "h1" } as never,
        ],
        claims: [{ id: "c1", claim_text: "...", section_type: "results" } as never],
        claimLinks: [{ id: "l1", claim_id: "c1", construct_id: "con-a" } as never],
      }),
    )!;

    expect(trace.gaps).toEqual([]);
  });
});
