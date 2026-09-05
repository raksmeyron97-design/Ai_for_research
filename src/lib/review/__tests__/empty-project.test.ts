import { describe, expect, it } from "vitest";
import { runCrossSystemChecks } from "../cross-system";
import { runAnalysisChecks } from "../analysis-traceability";
import { runFrameworkChecks } from "@/lib/framework/validation";
import { runConsistencyChecks, buildMetrics } from "@/lib/methodology/consistency";
import { buildCoverageMatrix } from "@/lib/methodology/coverage";
import { buildIntegrityFindings, buildIntegrityMetrics } from "@/lib/integrity/review-service";
import { traceConstruct } from "@/lib/methodology/construct-trace";
import { EMPTY_MODEL } from "@/lib/methodology/model";
import type { ReviewMetric } from "../types";

/**
 * A brand-new project, through every engine at once (Phase 21 §48).
 *
 * This is the first state every researcher sees and the last one anybody
 * tests. The failure mode is specific and nastier than a crash: a review over
 * nothing computes 0/0, renders "0%", and tells someone on their first day
 * that their research scores zero — a fabricated verdict about work that does
 * not exist yet. Phase 20 built `not_computable` precisely so that could not
 * happen; this pins it down for every engine rather than for the two that had
 * tests.
 *
 * Written as one table over all of them deliberately. Each engine having its
 * own empty-input assertion is how one gets added later without one.
 */
const EMPTY = {
  claims: [],
  evidence: [],
  claimEvidence: [],
  methodologyLinks: [],
  methodology: EMPTY_MODEL,
  datasets: [],
  sections: [],
  citations: [],
  nodes: [],
  relationships: [],
};

/** Every engine that produces findings and metrics, run over nothing. */
const ENGINES: { name: string; run: () => { findings: unknown[]; metrics: ReviewMetric[] } }[] = [
  {
    name: "cross-system review",
    run: () => runCrossSystemChecks(EMPTY),
  },
  {
    name: "analysis traceability",
    run: () => runAnalysisChecks(EMPTY),
  },
  {
    name: "conceptual framework",
    run: () => runFrameworkChecks({ nodes: [], relationships: [], methodology: EMPTY_MODEL }),
  },
  {
    name: "methodology consistency",
    run: () => {
      const result = runConsistencyChecks(EMPTY_MODEL);
      return {
        findings: result.findings,
        metrics: buildMetrics(EMPTY_MODEL, buildCoverageMatrix(EMPTY_MODEL)) as unknown as ReviewMetric[],
      };
    },
  },
  {
    name: "research integrity",
    run: () => {
      const model = {
        claims: [],
        citations: [],
        evidence: [],
        claimEvidence: [],
        methodologyLinks: [],
        sections: [],
        datasets: [],
      };
      const findings = buildIntegrityFindings(model, EMPTY_MODEL);
      return { findings, metrics: buildIntegrityMetrics(model, findings) as unknown as ReviewMetric[] };
    },
  },
];

describe("an empty project (§48)", () => {
  for (const engine of ENGINES) {
    describe(engine.name, () => {
      it("does not throw on a project with nothing in it", () => {
        expect(() => engine.run()).not.toThrow();
      });

      it("reports no findings, rather than inventing one about absent work", () => {
        // A finding is "something is wrong with what you wrote". Nothing has
        // been written, so there is nothing to be wrong.
        expect(engine.run().findings).toEqual([]);
      });

      it("never reports a computed value over an empty denominator", () => {
        // The heart of §48. Any metric that would be 0/0 must say it cannot be
        // computed — not 0, and not 0%.
        for (const metric of engine.run().metrics) {
          const status = (metric as { status?: string }).status;
          const value = (metric as { value?: number | null }).value;

          if (status === "not_computable" || status === "incomplete") {
            // Allowed to carry no value at all; must not carry a real one.
            expect(value ?? null, `${engine.name}/${metric.id} reports a value it cannot compute`)
              .toBeNull();
          } else {
            expect(
              status,
              `${engine.name}/${metric.id} claims status "${status}" over an empty project`,
            ).toBe("not_computable");
          }
        }
      });

      it("emits no percentage anywhere in its output", () => {
        // The user-visible symptom, asserted as the user would see it: a
        // rendered "0%" in front of a researcher who has written nothing.
        const serialised = JSON.stringify(engine.run());
        expect(serialised, `${engine.name} rendered a percentage over no data`).not.toMatch(/\d+(\.\d+)?%/);
      });
    });
  }

  it("returns no duplicate finding ids across engines", () => {
    // Two engines both reporting "no constructs" would show the same problem
    // twice on one screen — the duplication Phase 20 already had to fix once.
    const ids = ENGINES.flatMap((e) => e.run().findings.map((f) => (f as { id?: string }).id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no construct to trace, and says so without failing", () => {
    expect(
      traceConstruct("does-not-exist", {
        methodology: EMPTY_MODEL,
        nodes: [],
        relationships: [],
        claims: [],
        claimLinks: [],
      }),
    ).toBeNull();
  });

  it("builds an empty coverage matrix rather than a zero-coverage one", () => {
    // "0% coverage" and "nothing to cover" are different statements, and only
    // the second is true here.
    const matrix = buildCoverageMatrix(EMPTY_MODEL);
    expect(matrix.constructs).toEqual([]);
    expect(JSON.stringify(matrix)).not.toMatch(/\d+(\.\d+)?%/);
  });
});
