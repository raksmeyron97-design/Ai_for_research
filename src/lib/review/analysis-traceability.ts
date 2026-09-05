import { traceClaimNumbers } from "../integrity/numerical-traceability";
import type { ParsedDataset } from "../data/parse-dataset";
import type { ResearchClaimMethodologyLinkRow, ResearchClaimRow } from "../db/types";
import type { MethodologyModel } from "../methodology/model";
import type { ReviewFinding, ReviewMetric } from "./types";

/**
 * Analysis and result traceability (§24, §25).
 *
 * §24 asks whether structured result objects exist, and says plainly: if they
 * do not, do not fabricate them. They do not.
 *
 * What the project stores is `research_datasets` — parsed rows and columns —
 * plus `analysis_method` as free text on each hypothesis. Descriptive
 * statistics are computed on demand by `descriptive-stats.ts` and never
 * persisted. There is no row anywhere that says "H1 was tested with a Pearson
 * correlation and the result was r = .42, p = .003".
 *
 * So the chain §24 describes —
 *
 *     Hypothesis -> Analysis -> Result -> Claim
 *
 * — has no Result link to walk, and this module does not invent one. It
 * reports `not_computable` for that dimension and says exactly why, which is
 * the honest answer and is also §44's requirement that a metric explain what
 * is missing rather than show a bare score.
 *
 * Two things it *can* check deterministically, and does:
 *
 *   * a number in the manuscript that names no column in any uploaded dataset
 *   * a hypothesis that no claim anywhere reports on
 *
 * Neither invents a p-value, an effect size, a sample size, a confidence
 * interval, or a significance verdict.
 */

/** Sections where a claim is reporting this study's own findings rather than
 *  describing someone else's. Same set the cross-system checks use. */
const OWN_STUDY_SECTIONS = new Set(["results", "discussion", "conclusion"]);

/**
 * A number that could have been checked and could not be matched.
 *
 * Phase 19's review only raises a finding for `inconsistent` — a number that
 * matched a column and disagreed with it. `untraceable` is the quieter case
 * and produced nothing at all: a claim stating `M = 4.2` while no column in
 * any uploaded dataset resembles what the sentence is about.
 *
 * `info`, and deliberately so. The column match is a word-boundary name
 * heuristic (Phase 19's own documented limitation), so "untraceable" means
 * "this tool could not find the column", not "this number is wrong". Raising
 * it higher would put a heuristic's failure in front of a researcher as if it
 * were a defect in their thesis.
 *
 * Note this can only fire when a dataset exists: with none linked, every
 * mention is `not_computable` instead, which is not reported at all.
 */
function untraceableNumberFindings(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type">[],
  datasets: ParsedDataset[],
): ReviewFinding[] {
  return claims.flatMap((claim) =>
    traceClaimNumbers(claim as ResearchClaimRow, datasets)
      .filter((trace) => trace.state === "untraceable")
      .map((trace) => ({
        id: `analysis:number-untraceable:${claim.id}:${trace.mention.statistic}:${trace.mention.value}`,
        category: "analysis" as const,
        severity: "info" as const,
        title: "Number could not be matched to your data",
        explanation:
          `This claim states ${trace.mention.statistic} = ${trace.mention.value}, but no column in your ` +
          `uploaded datasets could be matched to what the sentence is about. That may simply mean the ` +
          `column is named differently from the wording here.`,
        targetType: "claim" as const,
        targetId: claim.id,
        provenance: "deterministic" as const,
        remediation:
          "Check the number against the dataset yourself, or name the variable in the sentence as it appears in your data.",
      })),
  );
}

/**
 * A hypothesis the manuscript never reports on.
 *
 * This is the reverse traversal §16 asks for, and neither existing engine
 * walks it. Phase 18 checks a hypothesis has an analysis method; Phase 19
 * checks a claim is linked to methodology. Nobody asks whether a hypothesis
 * that was stated ever got answered — which is one of the more consequential
 * omissions a thesis can contain, and is invisible from either end: the
 * hypothesis list looks complete and the claim list looks traceable.
 *
 * Only counted once the manuscript has started reporting results. A project
 * that has written its hypotheses and not yet its results chapter is in
 * order, not incomplete.
 */
function unreportedHypothesisFindings(
  claims: Pick<ResearchClaimRow, "id" | "section_type">[],
  methodologyLinks: Pick<ResearchClaimMethodologyLinkRow, "claim_id" | "hypothesis_id">[],
  methodology: MethodologyModel,
): ReviewFinding[] {
  const ownStudyClaimIds = new Set(
    claims.filter((c) => OWN_STUDY_SECTIONS.has(c.section_type)).map((c) => c.id),
  );
  if (ownStudyClaimIds.size === 0) return [];

  const reported = new Set(
    methodologyLinks
      .filter((link) => link.hypothesis_id && ownStudyClaimIds.has(link.claim_id))
      .map((link) => link.hypothesis_id as string),
  );

  return methodology.hypotheses
    .filter((h) => !reported.has(h.id))
    .map((h) => ({
      id: `analysis:hypothesis-not-reported:${h.id}`,
      category: "analysis" as const,
      severity: "warning" as const,
      title: "Hypothesis is not reported on",
      explanation:
        `${h.label ?? "This hypothesis"} was stated, but no claim in your results, discussion or ` +
        `conclusion is linked to it. A hypothesis a thesis does not answer is easy to lose track of.`,
      targetType: "hypothesis" as const,
      targetId: h.id,
      provenance: "deterministic" as const,
      remediation:
        "Link the claim that reports this hypothesis's outcome to it, or remove the hypothesis if the study no longer tests it.",
    }));
}

export function runAnalysisChecks(input: {
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type" | "claim_type">[];
  methodologyLinks: Pick<ResearchClaimMethodologyLinkRow, "claim_id" | "hypothesis_id">[];
  methodology: MethodologyModel;
  datasets: ParsedDataset[];
}): { findings: ReviewFinding[]; metrics: ReviewMetric[] } {
  const findings = [
    ...untraceableNumberFindings(input.claims, input.datasets),
    ...unreportedHypothesisFindings(input.claims, input.methodologyLinks, input.methodology),
  ];

  const ownStudyClaimIds = new Set(
    input.claims.filter((c) => OWN_STUDY_SECTIONS.has(c.section_type)).map((c) => c.id),
  );
  const reportedHypotheses = new Set(
    input.methodologyLinks
      .filter((l) => l.hypothesis_id && ownStudyClaimIds.has(l.claim_id))
      .map((l) => l.hypothesis_id as string),
  );

  const metrics: ReviewMetric[] = [
    // Reporting coverage is computable: it reads stored links, not results.
    input.methodology.hypotheses.length === 0 || ownStudyClaimIds.size === 0
      ? {
          id: "hypothesis_reporting",
          label: "Hypotheses reported on",
          category: "analysis",
          value: null,
          status: "not_computable",
          reason:
            input.methodology.hypotheses.length === 0
              ? "This study has no hypotheses, so there is nothing the results have to report on."
              : "No claims have been extracted from the results, discussion or conclusion yet.",
        }
      : {
          id: "hypothesis_reporting",
          label: "Hypotheses reported on",
          category: "analysis",
          value: reportedHypotheses.size / input.methodology.hypotheses.length,
          status:
            reportedHypotheses.size === input.methodology.hypotheses.length
              ? "ok"
              : reportedHypotheses.size / input.methodology.hypotheses.length >= 0.5
                ? "attention"
                : "incomplete",
          reason: "Hypotheses with a linked claim in the results, discussion or conclusion.",
          evidence: {
            covered: reportedHypotheses.size,
            total: input.methodology.hypotheses.length,
          },
        },

    // §24's central answer, stated rather than hidden. This metric is null in
    // every project and will stay null until a per-hypothesis result is
    // stored — which is a schema change, not a calculation. Showing it as 0%
    // would read as "none of your results are traceable"; omitting it would
    // hide that the check does not exist.
    {
      id: "result_traceability",
      label: "Results traced to a stored analysis",
      category: "analysis",
      value: null,
      status: "not_computable",
      reason:
        "Nothing records the outcome of an analysis per hypothesis, so a claim cannot be traced to a stored " +
        "result. Numbers are checked against uploaded datasets instead, which is a weaker check — see " +
        "\"Number could not be matched to your data\".",
    },
  ];

  return { findings, metrics };
}
