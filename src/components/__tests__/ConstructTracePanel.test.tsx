// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ConstructTracePanel from "../ConstructTracePanel";

/** Phase 21 §25 — the interface half. The chain assembly itself is tested in
 *  src/lib/methodology/__tests__/construct-trace.test.ts. */
const FULL = {
  constructId: "con-a",
  name: "Teacher motivation",
  indicators: [{ id: "i1", name: "Effort", dimension: "behavioural" }],
  items: [
    { id: "q1", text: "I try hard.", via: "construct", indicatorId: null },
    { id: "q2", text: "I persist.", via: "indicator", indicatorId: "i1" },
  ],
  hypotheses: [{ id: "h1", label: "H1", statement: "A predicts B.", position: "predictor" }],
  relationships: [
    { id: "r1", relationType: "predicts", direction: "from", otherName: "Student performance", hypothesisId: "h1" },
  ],
  claims: [{ id: "c1", text: "Motivation matters.", sectionType: "results" }],
  gaps: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stub(trace: unknown, ok = true) {
  const mock = vi.fn(async () => ({ ok, json: async () => (ok ? { trace } : {}) }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("construct traceability panel", () => {
  it("fetches one scoped trace rather than the whole methodology", async () => {
    const mock = stub(FULL);
    render(<ConstructTracePanel projectId="p1" constructId="con-a" />);

    await screen.findByText(/I try hard/);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String(mock.mock.calls[0][0])).toBe(
      "/api/research/projects/p1/methodology/constructs/con-a/trace",
    );
  });

  it("shows every leg of the chain, and how an item reaches the concept", async () => {
    stub(FULL);
    render(<ConstructTracePanel projectId="p1" constructId="con-a" />);

    expect(await screen.findByText("I try hard.")).toBeInTheDocument();
    // An item that reaches the construct via an indicator says so: it is a
    // weaker statement than one that names the construct.
    expect(screen.getByText(/I persist\. \(through an indicator\)/)).toBeInTheDocument();
    expect(screen.getByText(/Effort · behavioural/)).toBeInTheDocument();
    expect(screen.getByText(/H1: A predicts B\./)).toBeInTheDocument();
    expect(screen.getByText(/Student performance/)).toBeInTheDocument();
    expect(screen.getByText(/Motivation matters/)).toBeInTheDocument();
  });

  it("names each missing link and refuses to turn them into a score", async () => {
    stub({
      ...FULL,
      items: [],
      hypotheses: [],
      gaps: ["No questionnaire item asks about this concept.", "No hypothesis involves this concept."],
    });
    render(<ConstructTracePanel projectId="p1" constructId="con-a" />);

    expect(await screen.findByText("What is missing")).toBeInTheDocument();
    expect(screen.getAllByText(/No questionnaire item asks about this concept/).length).toBeGreaterThan(0);
    expect(screen.getByText(/not a judgement about the concept/i)).toBeInTheDocument();
    // §48: no invented percentage anywhere.
    expect(document.body.textContent).not.toMatch(/\d+%/);
  });

  it("explains a failure without exposing the database", async () => {
    stub(null, false);
    render(<ConstructTracePanel projectId="p1" constructId="con-a" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);
    expect(alert.textContent).not.toMatch(/postgres|relation|column|constraint/i);
  });

  it("a slow trace for one concept cannot paint over another (§51)", async () => {
    const resolvers: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: unknown) =>
          new Promise((resolve) => {
            const first = String(input).includes("con-a");
            resolvers.push(() =>
              resolve({
                ok: true,
                json: async () => ({
                  trace: { ...FULL, claims: [{ id: "x", text: first ? "STALE" : "NEWER", sectionType: "results" }] },
                }),
              }),
            );
          }),
      ),
    );

    const { rerender } = render(<ConstructTracePanel projectId="p1" constructId="con-a" />);
    await waitFor(() => expect(resolvers.length).toBe(1));

    rerender(<ConstructTracePanel projectId="p1" constructId="con-b" />);
    await waitFor(() => expect(resolvers.length).toBe(2));

    // The newer request resolves first, then the stale one arrives late.
    resolvers[1]();
    await screen.findByText(/NEWER/);
    resolvers[0]();

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/STALE/)).not.toBeInTheDocument();
    expect(screen.getByText(/NEWER/)).toBeInTheDocument();
  });
});
