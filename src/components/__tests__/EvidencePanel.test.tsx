// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EvidencePanel from "../EvidencePanel";

/**
 * The claim → evidence → insert workflow as a researcher performs it (§31).
 *
 * The server is scripted rather than mocked per-call so the assertions are
 * about what the researcher sees and what the panel sends, not about internal
 * call order.
 */
const CLAIM = {
  id: "claim-1",
  project_id: "p1",
  section_type: "research_problem",
  claim_text: "Postpartum depression can affect maternal wellbeing.",
  claim_type: "factual",
  needs_evidence: true,
  evidence_status: "NEEDS_VERIFICATION",
  source_offset_start: null,
  source_offset_end: null,
  created_at: "",
  updated_at: "",
};

const CANDIDATE = {
  chunk: {
    id: "chunk-1",
    document_id: "doc-1",
    chunk_index: 0,
    content: "Depressive symptoms were reported by 21% of postpartum women.",
    page: 14,
    section: "Results",
    citation_key: "sok2024",
    similarity: 0.86,
  },
  citation: {
    id: "cit1", project_id: "p1", citation_key: "sok2024", title: "Antenatal depressive symptoms",
    authors: ["Sok, D."], year: 2024, journal: null, doi: null, url: null, source_type: "article",
    tier: 2, status: "user_provided", created_at: "",
  },
  topicalRelevance: 0.8, semantic: 0.86, lexical: 0.6, quality: 0.7, contextBonus: 0,
  score: 0.9, belowRelevanceFloor: false,
  explanation: "86% semantic match · covers 60% of the claim's key terms",
  alreadySaved: false, injectionWarning: null,
};

interface Script {
  claims?: unknown[];
  extract?: unknown[];
  search?: { outcome: string; candidates: unknown[] };
  searchOk?: boolean;
  insert?: unknown;
}

let script: Script;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(next: Script) {
  script = next;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/claims/extract")) {
      return { ok: true, json: async () => ({ claims: script.extract ?? [] }) };
    }
    if (url.includes("/evidence-search")) {
      return {
        ok: script.searchOk !== false,
        json: async () => script.search ?? { outcome: "ok", candidates: [] },
      };
    }
    if (url.includes("/evidence/insert")) {
      return { ok: true, json: async () => script.insert };
    }
    if (url.includes("/claims") && init?.method === "POST") {
      return { ok: true, json: async () => ({ claims: [CLAIM] }) };
    }
    return { ok: true, json: async () => ({ claims: script.claims ?? [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => stub({}));
afterEach(() => vi.unstubAllGlobals());

const props = {
  projectId: "p1",
  sectionType: "research_problem" as const,
  onInserted: vi.fn(),
};

describe("claims", () => {
  it("asks for a selection before it can extract anything", async () => {
    render(<EvidencePanel {...props} request={null} />);
    expect(await screen.findByText(/Select a paragraph in the editor/)).toBeInTheDocument();
  });

  it("extracts claims from the selected passage and lets them be edited before saving", async () => {
    stub({
      extract: [
        {
          text: "Postpartum depression can affect maternal wellbeing.",
          type: "factual",
          reason: "",
          sourceSentence: "",
          needsEvidence: true,
          offsetStart: null,
          offsetEnd: null,
        },
      ],
    });

    render(
      <EvidencePanel
        {...props}
        request={{ passage: "Postpartum depression can affect maternal wellbeing.", nonce: 1 }}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Extract claims" }));

    const draft = await screen.findByLabelText("Claim 1");
    expect(draft).toHaveValue("Postpartum depression can affect maternal wellbeing.");

    await userEvent.clear(draft);
    await userEvent.type(draft, "Postpartum depression is associated with maternal wellbeing.");
    await userEvent.click(screen.getByRole("button", { name: "Save 1 claim" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/research/projects/p1/claims" && (init as RequestInit)?.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(String((post![1] as RequestInit).body)).toContain("is associated with maternal wellbeing");
    });
  });

  it("says the type is advisory, not a verdict on the claim", async () => {
    stub({
      extract: [{ text: "A claim.", type: "factual", reason: "", sourceSentence: "", needsEvidence: true, offsetStart: null, offsetEnd: null }],
    });
    render(<EvidencePanel {...props} request={{ passage: "A claim.", nonce: 1 }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Extract claims" }));

    expect(await screen.findByText(/not whether it is true/)).toBeInTheDocument();
  });
});

describe("evidence search", () => {
  it("shows ranked cards for a claim's evidence", async () => {
    stub({ claims: [CLAIM], search: { outcome: "ok", candidates: [CANDIDATE] } });
    render(<EvidencePanel {...props} request={null} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));

    expect(await screen.findByText("Antenatal depressive symptoms")).toBeInTheDocument();
    expect(screen.getByText(/86% semantic match/)).toBeInTheDocument();
  });

  it("distinguishes finding nothing from failing to look", async () => {
    stub({ claims: [CLAIM], search: { outcome: "no_evidence_found", candidates: [] } });
    render(<EvidencePanel {...props} request={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));

    expect(await screen.findByText(/No evidence found in your sources/)).toBeInTheDocument();

    stub({
      claims: [CLAIM],
      searchOk: false,
      search: { outcome: "retrieval_failed", candidates: [] },
    });
    render(<EvidencePanel {...props} request={null} />);
    const buttons = await screen.findAllByRole("button", { name: "Find evidence" });
    await userEvent.click(buttons[buttons.length - 1]);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("does not send the claim text — the server reads it from the row it owns", async () => {
    stub({ claims: [CLAIM], search: { outcome: "ok", candidates: [CANDIDATE] } });
    render(<EvidencePanel {...props} request={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/evidence-search"));
      expect(call).toBeTruthy();
      expect(String((call![1] as RequestInit).body)).not.toContain("Postpartum depression");
    });
  });
});

describe("insertion", () => {
  it("previews, inserts, and reports what was checked afterwards", async () => {
    const onInserted = vi.fn();
    stub({
      claims: [CLAIM],
      search: { outcome: "ok", candidates: [CANDIDATE] },
      insert: {
        claim: { ...CLAIM, evidence_status: "SUPPORTED" },
        sectionContent: "Postpartum depression can affect maternal wellbeing [sok2024].",
        validation: { ok: true, notes: [] },
      },
    });

    render(<EvidencePanel {...props} onInserted={onInserted} request={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use evidence" }));

    expect(await screen.findByText("Before you insert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /^Supported/ }));
    await userEvent.click(screen.getByRole("button", { name: "Insert evidence" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Evidence linked successfully.");
    expect(onInserted).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Postpartum depression can affect maternal wellbeing [sok2024]." }),
    );
  });

  it("reports an insertion that linked but could not place the citation", async () => {
    stub({
      claims: [CLAIM],
      search: { outcome: "ok", candidates: [CANDIDATE] },
      insert: {
        claim: CLAIM,
        sectionContent: "Unchanged text.",
        validation: {
          ok: true,
          notes: ["The claim's wording has changed since it was extracted, so the citation was linked but not written into the text."],
        },
      },
    });

    render(<EvidencePanel {...props} request={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use evidence" }));
    await userEvent.click(screen.getByRole("button", { name: "Insert evidence" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/linked but not written into the text/);
  });

  it("offers no Use evidence for an excerpt whose document has no source", async () => {
    stub({
      claims: [CLAIM],
      search: {
        outcome: "ok",
        candidates: [{ ...CANDIDATE, citation: undefined, chunk: { ...CANDIDATE.chunk, citation_key: null } }],
      },
    });

    render(<EvidencePanel {...props} request={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find evidence" }));

    expect(await screen.findByText(/cannot be cited/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use evidence" })).not.toBeInTheDocument();
  });
});
