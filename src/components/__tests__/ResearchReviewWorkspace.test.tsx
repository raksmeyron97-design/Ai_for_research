// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResearchReviewWorkspace from "../ResearchReviewWorkspace";

/**
 * §44 is what these tests are mostly about: the panel must not turn the
 * review into a grade, and a metric that cannot be computed must not be
 * rendered as zero.
 */
let review: Record<string, unknown>;

function metric(over: Record<string, unknown> = {}) {
  return {
    id: "framework_coverage",
    label: "Framework coverage",
    category: "framework",
    value: 0.74,
    status: "attention",
    reason: "Constructs with a role that appear in the framework.",
    evidence: { covered: 3, total: 4 },
    ...over,
  };
}

function finding(over: Record<string, unknown> = {}) {
  return {
    id: "framework:construct-not-in-framework:con-a",
    category: "framework",
    severity: "warning",
    title: "Construct is not in the conceptual framework",
    explanation: '"Class size" is declared as a control variable but no framework node represents it.',
    targetType: "construct",
    targetId: "con-a",
    provenance: "deterministic",
    remediation: "Add a framework node for this construct.",
    ...over,
  };
}

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ review }) })),
  );
}

beforeEach(() => {
  review = {
    projectId: "p1",
    metrics: [metric()],
    findings: [finding()],
    generatedAt: "2026-09-03T00:00:00Z",
  };
  stub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("no composite score (§44)", () => {
  it("never renders an overall quality score", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: /framework/i });
    // The specific anti-pattern §44 names: one number a researcher would
    // remember, mixing a broken citation with an unwritten definition.
    expect(screen.queryByText(/academic quality/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/\s*100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/overall score/i)).not.toBeInTheDocument();
  });

  it("counts what needs attention instead of grading", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText(/1 thing to look at/i)).toBeInTheDocument();
  });

  it("groups metrics and findings by category", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    const section = await screen.findByRole("region", { name: "Framework" });
    expect(within(section).getByText("Framework coverage")).toBeInTheDocument();
    expect(within(section).getByText(/construct is not in the conceptual framework/i)).toBeInTheDocument();
  });
});

describe("a metric that cannot be computed (§21)", () => {
  it("says so rather than showing 0%", async () => {
    review = {
      ...review,
      metrics: [metric({ value: null, status: "not_computable", evidence: undefined, reason: "No constructs yet." })],
    };
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText("Not computable")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("draws no bar for it, because an empty bar reads as zero", async () => {
    review = {
      ...review,
      metrics: [metric({ value: null, status: "not_computable", evidence: undefined })],
    };
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText("Not computable");
    expect(document.body.textContent).not.toContain("░");
  });

  it("still explains what is missing", async () => {
    review = {
      ...review,
      metrics: [
        metric({
          value: null,
          status: "not_computable",
          evidence: undefined,
          reason: "Nothing records the outcome of an analysis per hypothesis.",
        }),
      ],
    };
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(
      await screen.findByText(/nothing records the outcome of an analysis per hypothesis/i),
    ).toBeInTheDocument();
  });

  it("shows the counts behind a computable ratio", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText("3 of 4")).toBeInTheDocument();
    expect(screen.getByText("74%")).toBeInTheDocument();
  });
});

describe("provenance (§23)", () => {
  it("marks an AI-suggested finding as a proposal", async () => {
    review = { ...review, findings: [finding({ provenance: "ai_suggested", severity: "info" })] };
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText(/ai suggested — not checked against your data/i)).toBeInTheDocument();
  });

  it("does not mark a deterministic finding as a proposal", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText(/construct is not in the conceptual framework/i);
    expect(screen.queryByText(/ai suggested/i)).not.toBeInTheDocument();
  });
});

describe("findings lead somewhere (§20)", () => {
  it("opens the framework for a framework finding, whatever it targets", async () => {
    // The finding targets a *construct*, but its category is framework and
    // the work it asks for is drawing a node — so the framework is where it
    // should land.
    review = { ...review, findings: [finding({ category: "framework", targetType: "construct" })] };
    const onOpenFramework = vi.fn();
    render(
      <ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} onOpenFramework={onOpenFramework} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /take me there/i }));
    expect(onOpenFramework).toHaveBeenCalled();
  });

  it("opens the manuscript for a claim finding", async () => {
    review = { ...review, findings: [finding({ targetType: "claim", targetId: "claim-a" })] };
    const onGoToSection = vi.fn();
    const onClose = vi.fn();
    render(
      <ResearchReviewWorkspace projectId="p1" onClose={onClose} onGoToSection={onGoToSection} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /take me there/i }));
    expect(onGoToSection).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("offers no button when the caller wired nowhere to go", async () => {
    // Better than a button that does nothing.
    review = { ...review, findings: [finding({ category: "framework", targetType: "framework_node" })] };
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText(/construct is not in the conceptual framework/i);
    expect(screen.queryByRole("button", { name: /take me there/i })).not.toBeInTheDocument();
  });
});

describe("a clean study", () => {
  it("does not claim the research is correct", async () => {
    review = { ...review, findings: [] };
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText(/not whether the research is right/i)).toBeInTheDocument();
  });
});

describe("recomputed, never cached (§21, §32)", () => {
  it("re-fetches when the researcher rechecks", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    await screen.findByText("Framework coverage");
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: /recheck/i }));
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before);
  });
});

describe("dialog semantics (§33)", () => {
  it("is a modal dialog with an accessible name", async () => {
    render(<ResearchReviewWorkspace projectId="p1" onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: /research review/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ResearchReviewWorkspace projectId="p1" onClose={onClose} />);
    await screen.findByText("Framework coverage");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
