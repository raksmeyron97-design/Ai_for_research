// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConceptualFrameworkWorkspace from "../ConceptualFrameworkWorkspace";
import { EMPTY_MODEL } from "@/lib/methodology/model";

/**
 * §10/§33: the framework is edited as a list, at every width. These assert
 * the two properties that follow from that decision — every action is a real
 * control a keyboard can reach, and a node's identity comes from its
 * construct rather than from text stored beside it.
 */
const CONSTRUCTS = [
  {
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
  },
  {
    id: "con-b",
    project_id: "p1",
    name: "Student performance",
    role: "dependent",
    conceptual_definition: "Attainment.",
    operational_definition: null,
    notes: null,
    provenance: "user",
    confirmed: true,
    created_at: "",
    updated_at: "",
  },
];

const HYPOTHESES = [
  {
    id: "hyp-a",
    project_id: "p1",
    objective_id: null,
    question_id: null,
    label: "H1",
    statement: "Motivation predicts performance.",
    hypothesis_form: "association",
    direction: "positive",
    analysis_method: "Pearson",
    provenance: "user",
    confirmed: true,
    order_index: 0,
    created_at: "",
    updated_at: "",
  },
];

function node(over: Record<string, unknown> = {}) {
  return {
    id: "fn-a",
    project_id: "p1",
    construct_id: "con-a",
    label: null,
    position_x: 0,
    position_y: 0,
    provenance: "user",
    confirmed: true,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function relationship(over: Record<string, unknown> = {}) {
  return {
    id: "fr-a",
    project_id: "p1",
    from_node_id: "fn-a",
    to_node_id: "fn-b",
    relation_type: "predicts",
    hypothesis_id: null,
    rationale: null,
    provenance: "user",
    confirmed: true,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

let nodes: ReturnType<typeof node>[];
let relationships: ReturnType<typeof relationship>[];
let constructs: typeof CONSTRUCTS;

/** The concepts section. Scoped because a construct's name legitimately
 *  appears in the findings text too, and an unscoped query would match both. */
async function conceptsRegion() {
  return screen.findByRole("region", { name: /concepts in the framework/i });
}

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") return { ok: true, json: async () => ({}) };
      if (url.includes("/framework/nodes")) return { ok: true, json: async () => ({ nodes }) };
      if (url.includes("/framework/relationships")) {
        return { ok: true, json: async () => ({ relationships }) };
      }
      if (url.includes("/methodology")) {
        return {
          ok: true,
          json: async () => ({ model: { ...EMPTY_MODEL, constructs, hypotheses: HYPOTHESES } }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

beforeEach(() => {
  nodes = [node(), node({ id: "fn-b", construct_id: "con-b" })];
  relationships = [relationship()];
  constructs = [...CONSTRUCTS];
  stub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("concepts", () => {
  it("names a node by its construct, not by stored text", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const concepts = await conceptsRegion();
    expect(within(concepts).getByText("Teacher motivation")).toBeInTheDocument();
    expect(within(concepts).getByText("Independent variable")).toBeInTheDocument();
  });

  it("prefers the construct's name over a stale label", async () => {
    // A node mapped to a construct keeps its old wording in `label`, and that
    // wording must never win — otherwise renaming a construct leaves the
    // framework showing the old name.
    nodes = [node({ label: "old wording" })];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const concepts = await conceptsRegion();
    expect(within(concepts).getByText("Teacher motivation")).toBeInTheDocument();
    expect(screen.queryByText("old wording")).not.toBeInTheDocument();
  });

  it("marks an unmapped node and says what it costs", async () => {
    nodes = [node({ construct_id: null, label: "School climate" })];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const concepts = await conceptsRegion();
    expect(within(concepts).getByText("School climate")).toBeInTheDocument();
    expect(within(concepts).getByText(/nothing checks this against your methodology/i)).toBeInTheDocument();
  });

  it("offers to link an unmapped node rather than guessing the construct", async () => {
    // §40: a label identical to a construct name is still unmapped. The fix
    // is offered to the researcher, never applied for them.
    nodes = [node({ construct_id: null, label: "Teacher motivation" })];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const select = await screen.findByLabelText(/link teacher motivation to a construct/i);
    expect(select).toBeInTheDocument();

    await userEvent.selectOptions(select, "con-a");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ constructId: "con-a" });
  });

  it("surfaces a missing operational definition where the concept is positioned", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const concepts = await conceptsRegion();
    expect(within(concepts).getByText(/no operational definition yet/i)).toBeInTheDocument();
  });

  it("does not offer a construct that is already in the framework", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const concepts = await conceptsRegion();
    expect(
      within(concepts).getByText(/every construct you have defined is already in the framework/i),
    ).toBeInTheDocument();
  });
});

describe("relationships", () => {
  it("reads as a sentence about two concepts", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const rels = await screen.findByRole("region", { name: /^relationships/i });
    // The listed relationship, not the <option>s in the add form below it.
    const line = within(rels).getByText(/Teacher motivation/, { selector: "p" });
    expect(line).toHaveTextContent("Teacher motivation predicts Student performance");
  });

  it("says when a relationship lost the hypothesis that justified it", async () => {
    relationships = [relationship({ hypothesis_id: "hyp-gone" })];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(
      await screen.findByText(/hypothesis that justified this has been removed/i),
    ).toBeInTheDocument();
  });

  it("lets the hypothesis be attached to the relationship, not to a concept", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const select = await screen.findByLabelText(/hypothesis for this relationship/i);
    await userEvent.selectOptions(select, "hyp-a");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ hypothesisId: "hyp-a" });
  });

  it("clears the hypothesis with an explicit null rather than an empty string", async () => {
    relationships = [relationship({ hypothesis_id: "hyp-a" })];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    const select = await screen.findByLabelText(/hypothesis for this relationship/i);
    await userEvent.selectOptions(select, "");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ hypothesisId: null });
  });

  it("will not offer a relationship from a concept to itself", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    await conceptsRegion();

    const from = screen.getByLabelText("From");
    await userEvent.selectOptions(from, "fn-a");

    const to = screen.getByLabelText("To") as HTMLSelectElement;
    expect([...to.options].map((o) => o.value)).not.toContain("fn-a");
  });
});

describe("consistency", () => {
  it("reports a construct the framework does not show", async () => {
    nodes = [node()];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(
      await screen.findByText(/construct is not in the conceptual framework/i),
    ).toBeInTheDocument();
  });

  it("does not claim the theory is correct when the structure is clean", async () => {
    // A framework can be perfectly connected and still model the wrong thing.
    // The empty state has to say what was actually checked.
    constructs = [];
    nodes = [];
    relationships = [];
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText(/not whether the theory is right/i)).toBeInTheDocument();
  });
});

describe("keyboard and structure (§33)", () => {
  it("gives every action a real control with an accessible name", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    await conceptsRegion();

    for (const name of [/close/i, /remove/i, /unlink construct/i, /add concept/i]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
  });

  it("labels every select, so a screen reader does not read a bare combobox", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    await conceptsRegion();

    for (const select of screen.getAllByRole("combobox")) {
      // `||`, not `??`: an absent id is the empty string, which `??` would
      // happily accept as the accessible name.
      const name =
        select.getAttribute("aria-label") ||
        (select.id ? document.querySelector(`label[for="${select.id}"]`)?.textContent : "") ||
        select.closest("label")?.textContent ||
        "";
      expect(name.trim()).toBeTruthy();
    }
  });

  it("renders no duplicate element ids", async () => {
    render(<ConceptualFrameworkWorkspace projectId="p1" onClose={vi.fn()} />);
    await conceptsRegion();

    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
