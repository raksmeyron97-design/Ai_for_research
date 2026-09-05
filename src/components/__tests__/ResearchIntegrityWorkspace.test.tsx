// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResearchIntegrityWorkspace from "../ResearchIntegrityWorkspace";

/**
 * §31/§33: the Research Integrity workspace is one overlay with nine tabs,
 * all reading from the one deterministic review — the same "reuse the
 * WorkspacePanes/overlay pattern" discipline LiteratureWorkspace and
 * MethodologyWorkspace already follow.
 */
const CITATIONS = [
  { id: "cit1", project_id: "p1", citation_key: "smith2024", title: "A study of motivation", authors: ["Smith, J."], year: 2024, journal: null, doi: null, pmid: null, isbn: null, url: null, source_type: "article", tier: 2, status: "verified", created_at: "" },
];

const CLAIMS = [
  {
    id: "claim1", project_id: "p1", section_type: "results",
    claim_text: "Motivation predicts performance.", claim_type: "factual",
    needs_evidence: true, evidence_status: "NEEDS_VERIFICATION",
    source_offset_start: 0, source_offset_end: 10, created_at: "", updated_at: "",
  },
];

const BASE_REVIEW = {
  projectId: "p1",
  metrics: [
    { id: "citation_coverage", label: "Citation coverage", value: 0.5, status: "attention", reason: "Half of claims are cited." },
    { id: "reference_integrity", label: "Reference integrity", value: null, status: "not_computable", reason: "No references yet." },
  ],
  findings: [
    {
      id: "citation:missing-citation:claim1",
      category: "citation",
      severity: "info",
      title: "No citation present",
      explanation: "This claim requires evidence but names no citation and has no linked evidence.",
      targetType: "claim",
      targetId: "claim1",
      provenance: "deterministic",
      remediation: "Add a citation for this claim.",
    },
  ],
  coverage: {
    citation: { requiringEvidence: 2, cited: 1, linkedToEvidence: 1, linkedToResolvableSource: 1 },
    evidence: { requiring: 2, supported: 1, partiallySupported: 0, unsupported: 0, needsVerification: 1, coverage: 0.5, explanation: "2 claim(s) require evidence: 1 supported." },
  },
  decisions: {},
  generatedAt: "2026-01-01T00:00:00Z",
};

function stub(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/integrity/review")) return { ok: true, json: async () => ({ review: overrides.review ?? BASE_REVIEW }) };
    if (url.includes("/integrity/decisions")) {
      return { ok: true, json: async () => ({ decision: { id: "d1", finding_id: JSON.parse(String(init?.body)).findingId, status: JSON.parse(String(init?.body)).status, note: null } }) };
    }
    if (url.includes("/integrity/conflicts")) return { ok: true, json: async () => ({ conflicts: overrides.conflicts ?? [] }) };
    if (url.includes("/sources/")) {
      return {
        ok: true,
        json: async () =>
          overrides.source ?? { citation: CITATIONS[0], profile: null, documents: [], evidence: [], claims: [], links: [], sections: [], themes: [] },
      };
    }
    if (url.includes("/integrity/suggest")) {
      if (overrides.suggestFails) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => overrides.suggestBody ?? { proposals: [], provenance: "ai_suggested", contextTruncated: false, notes: [] } };
    }
    if (url.endsWith("/claims")) return { ok: true, json: async () => ({ claims: overrides.claims ?? CLAIMS }) };
    if (url.endsWith("/citations")) return { ok: true, json: async () => ({ citations: overrides.citations ?? CITATIONS }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  stub();
});
afterEach(() => vi.unstubAllGlobals());

const tab = (name: string) => within(screen.getByRole("tablist", { name: "Research integrity workspace" })).getByRole("tab", { name });

describe("loading and structure", () => {
  it("shows a loading state before the review arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(screen.getByText(/Loading the research integrity review/)).toBeInTheDocument();
  });

  it("presents nine tabs as one navigation surface", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText(/Citation coverage/);
    const tabs = screen.getByRole("tablist", { name: "Research integrity workspace" });
    expect(Array.from(tabs.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual([
      "Overview", "Claims", "Citations", "Evidence", "Sources", "References", "Methodology", "Conflicts", "Review Findings",
    ]);
  });

  it("supports left/right arrow-key navigation between tabs", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText(/Citation coverage/);
    tab("Overview").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tab("Claims")).toHaveFocus();
    expect(tab("Claims")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the tablist horizontally scrollable rather than wrapping — structural responsive behavior verified, real-browser visual verification pending", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText(/Citation coverage/);
    expect(screen.getByRole("tablist", { name: "Research integrity workspace" })).toHaveClass("overflow-x-auto");
  });

  it("closes back to writing rather than navigating away", async () => {
    const onClose = vi.fn();
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to writing" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("overview and findings — display, navigation, provenance", () => {
  it("shows metrics with a not_computable dash rather than 0%", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    const referenceMetric = await screen.findByRole("button", { name: /Reference integrity/ });
    expect(within(referenceMetric).getByText("—")).toBeInTheDocument();
  });

  it("navigates from a metric tile to Review Findings", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    const metric = await screen.findByRole("button", { name: /Citation coverage/ });
    await userEvent.click(metric);
    expect(screen.getByRole("tabpanel", { name: "Review Findings" })).toBeVisible();
    expect(within(screen.getByRole("tabpanel", { name: "Review Findings" })).getByText("No citation present")).toBeInTheDocument();
  });

  it("labels a deterministic finding distinctly from an ai_suggested one (provenance)", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /finding.*review them/i }));
    expect(within(screen.getByRole("tabpanel", { name: "Review Findings" })).getByText("Deterministic")).toBeInTheDocument();
  });

  it("says nothing was found rather than an empty list when there are no findings", async () => {
    stub({ review: { ...BASE_REVIEW, findings: [] } });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Review Findings" }));
    expect(await screen.findByText(/No findings/)).toBeInTheDocument();
  });
});

describe("researcher decisions", () => {
  it("records a decision and reflects it without re-fetching the whole review", async () => {
    const fetchMock = stub();
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Review Findings" }));

    const findingsPanel = screen.getByRole("tabpanel", { name: "Review Findings" });
    await userEvent.click(within(findingsPanel).getByRole("button", { name: "Dismiss" }));
    expect(await within(findingsPanel).findByText("Dismissed")).toBeInTheDocument();

    const reviewCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/integrity/review"));
    expect(reviewCalls).toHaveLength(1); // only the initial load — the decision call updated state locally.
  });

  it("visually distinguishes a dismissed finding", async () => {
    stub({
      review: {
        ...BASE_REVIEW,
        decisions: { "citation:missing-citation:claim1": { id: "d1", finding_id: "citation:missing-citation:claim1", status: "dismissed", note: null } },
      },
    });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Review Findings" }));
    const findingsPanel = screen.getByRole("tabpanel", { name: "Review Findings" });
    const finding = within(findingsPanel).getByText("No citation present").closest("li");
    expect(finding).toHaveClass("opacity-60");
    expect(within(finding as HTMLElement).getByText("Dismissed")).toBeInTheDocument();
  });
});

describe("claims tab — evidence state, citation mismatch, navigation", () => {
  it("shows loading then a claim's type and evidence status", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="claims" />);
    // The outer review load gates everything, including the claims tab's own
    // "Loading claims…" text — so only the review-level loading state is
    // guaranteed visible synchronously; the claim content is awaited below.
    const claimsPanel = await screen.findByRole("tabpanel", { name: "Claims" });
    expect(await within(claimsPanel).findByText(/Motivation predicts performance/)).toBeInTheDocument();
    expect(within(claimsPanel).getByText(/factual · NEEDS_VERIFICATION/)).toBeInTheDocument();
  });

  it("says no claims recorded, rather than an empty list", async () => {
    stub({ claims: [] });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="claims" />);
    expect(await screen.findByText(/No claims recorded/)).toBeInTheDocument();
  });

  it("shows the citation-mismatch finding attached to a claim", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="claims" />);
    const claimsPanel = await screen.findByRole("tabpanel", { name: "Claims" });
    await within(claimsPanel).findByText(/Motivation predicts performance/);
    expect(within(claimsPanel).getByText("No citation present")).toBeInTheDocument();
  });

  it("sends the claim as well as the section, so the editor can find the sentence", async () => {
    // Phase 19 could only name the section. §13 wants the sentence, which
    // means the claim has to travel with the request — the editor cannot
    // locate what it was not given.
    const onGoToSection = vi.fn();
    const onClose = vi.fn();
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={onClose} onGoToSection={onGoToSection} initialTab="claims" />);
    await userEvent.click(await screen.findByRole("button", { name: "Show in manuscript" }));
    expect(onGoToSection).toHaveBeenCalledWith(
      "results",
      expect.objectContaining({ claim_text: expect.any(String) }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("only offers Find evidence / Edit citation when the caller wires them", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="claims" />);
    await screen.findByText(/Motivation predicts performance/);
    expect(screen.queryByRole("button", { name: "Find evidence" })).not.toBeInTheDocument();

    stub();
    const onFindEvidence = vi.fn();
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="claims" onFindEvidence={onFindEvidence} />);
    const btn = await screen.findAllByRole("button", { name: "Find evidence" });
    await userEvent.click(btn[btn.length - 1]);
    expect(onFindEvidence).toHaveBeenCalledWith(CLAIMS[0]);
  });
});

describe("sources tab — long source text, view source", () => {
  it("renders a long title in full without truncating it", async () => {
    const longTitle = "A".repeat(400);
    stub({ citations: [{ ...CITATIONS[0], title: longTitle }] });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="sources" />);
    expect(await screen.findByText(longTitle)).toBeInTheDocument();
  });

  it("opens a source's detail panel", async () => {
    stub({ source: { citation: CITATIONS[0], profile: null, documents: [], evidence: [], claims: [], links: [], sections: [], themes: [] } });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="sources" />);
    await userEvent.click(await screen.findByRole("button", { name: /A study of motivation/ }));
    expect(await screen.findByRole("button", { name: "Back to writing" })).toBeInTheDocument();
  });
});

describe("conflicts tab", () => {
  it("shows no-conflict empty state", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="conflicts" />);
    expect(await screen.findByText(/No conflicting sources/)).toBeInTheDocument();
  });

  it("shows each source's own support label with its excerpt, no consensus score", async () => {
    stub({
      conflicts: [
        {
          claimId: "claim1",
          hasConflict: true,
          entries: [
            { citationId: "cit1", citationKey: "smith2024", evidenceId: "ev1", support: "SUPPORTED", excerpt: "We found a strong effect." },
            { citationId: "cit2", citationKey: "lee2023", evidenceId: "ev2", support: "UNSUPPORTED", excerpt: "No effect was found." },
          ],
        },
      ],
    });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="conflicts" />);
    expect(await screen.findByText("SUPPORTED")).toBeInTheDocument();
    expect(screen.getByText("UNSUPPORTED")).toBeInTheDocument();
    expect(screen.queryByText(/consensus/i)).not.toBeInTheDocument();
  });
});

describe("references tab — unresolved source, malformed AI proposal", () => {
  it("shows an unresolved-citation finding", async () => {
    stub({
      review: {
        ...BASE_REVIEW,
        findings: [
          {
            id: "citation:unresolved-citation:claim1",
            category: "citation",
            severity: "warning",
            title: "Citation present but does not resolve",
            explanation: 'Cites "ghost2099", which does not match any saved source for this project.',
            targetType: "claim",
            targetId: "claim1",
            provenance: "deterministic",
          },
        ],
      },
    });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="citations" />);
    const citationsPanel = await screen.findByRole("tabpanel", { name: "Citations" });
    expect(await within(citationsPanel).findByText("Citation present but does not resolve")).toBeInTheDocument();
  });

  it("shows a graceful message rather than crashing when the AI suggestion request fails", async () => {
    stub({ suggestFails: true });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="references" />);
    await userEvent.click(await screen.findByRole("button", { name: "Suggest possible duplicates (AI)" }));
    expect(await screen.findByText(/could not be generated/)).toBeInTheDocument();
  });

  it("shows a graceful message when the AI response has an unexpected shape", async () => {
    stub({ suggestBody: { unexpected: true } });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="references" />);
    await userEvent.click(await screen.findByRole("button", { name: "Suggest possible duplicates (AI)" }));
    expect(await screen.findByText(/No likely duplicates found/)).toBeInTheDocument();
  });

  it("labels an AI-suggested duplicate distinctly and never auto-merges it", async () => {
    stub({ suggestBody: { proposals: [{ aId: "cit1", bId: "cit2", rationale: "Same title and year." }], notes: [] } });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="references" />);
    await userEvent.click(await screen.findByRole("button", { name: "Suggest possible duplicates (AI)" }));
    expect(await screen.findByText("AI Suggested")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Merge$/ })).not.toBeInTheDocument();
  });
});

describe("methodology tab", () => {
  it("shows a methodology-category finding", async () => {
    stub({
      review: {
        ...BASE_REVIEW,
        findings: [
          {
            id: "methodology:causal-language:claim1",
            category: "methodology",
            severity: "warning",
            title: "Potential causal-language inconsistency",
            explanation: "This claim uses causal language, but the methodology model does not currently describe a causal design.",
            targetType: "claim",
            targetId: "claim1",
            provenance: "deterministic",
          },
        ],
      },
    });
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="methodology" />);
    const methodologyPanel = await screen.findByRole("tabpanel", { name: "Methodology" });
    expect(await within(methodologyPanel).findByText("Potential causal-language inconsistency")).toBeInTheDocument();
  });
});

describe("evidence tab", () => {
  it("shows the evidence coverage breakdown", async () => {
    render(<ResearchIntegrityWorkspace projectId="p1" onClose={vi.fn()} initialTab="evidence" />);
    expect(await screen.findByText(/1 supported/i)).toBeInTheDocument();
    expect(screen.getByText("Supported: 1")).toBeInTheDocument();
  });
});
