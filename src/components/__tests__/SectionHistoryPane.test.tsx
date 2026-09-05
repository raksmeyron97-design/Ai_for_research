// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionHistoryPane from "../SectionHistoryPane";
import type { SectionVersionRow } from "@/lib/db/section-versions";

/**
 * §7's rule made visible: restoring appends. The list after a restore is
 * longer than the list before it, and every version that was there is still
 * there.
 */
function version(over: Partial<SectionVersionRow> = {}): SectionVersionRow {
  return {
    id: "v1",
    project_id: "p1",
    section_id: "s1",
    section_type: "research_problem",
    previous_content: "First draft.",
    new_content: "Second draft.",
    action: "manual",
    provider: null,
    model: null,
    section_action: null,
    restored_from_version_id: null,
    created_by: "u1",
    created_at: new Date().toISOString(),
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("version history pane", () => {
  it("loads the section's history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ versions: [version()] }) })),
    );

    render(
      <SectionHistoryPane projectId="p1" sectionType="research_problem" refreshToken={0} onRestored={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("restores through the API and keeps every earlier version", async () => {
    const onRestored = vi.fn();
    const before = [version({ id: "v2", new_content: "Third draft." }), version({ id: "v1" })];
    const after = [
      version({ id: "v3", action: "restore", restored_from_version_id: "v1", new_content: "Second draft." }),
      ...before,
    ];

    let restored = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        restored = true;
        return {
          ok: true,
          json: async () => ({ section: { section_type: "research_problem", content: "Second draft." }, version: after[0] }),
        };
      }
      return { ok: true, json: async () => ({ versions: restored ? after : before }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SectionHistoryPane projectId="p1" sectionType="research_problem" refreshToken={0} onRestored={onRestored} />,
    );

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    expect(restoreButtons).toHaveLength(2);

    await userEvent.click(restoreButtons[1]);

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    // Three entries now, not one: the restore added a version rather than
    // rewinding to one.
    await waitFor(async () => expect(await screen.findAllByRole("button", { name: "Restore" })).toHaveLength(3));
    expect(screen.getByText(/Restored/)).toBeInTheDocument();
  });

  it("says what went wrong instead of silently showing an empty history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "The version history could not be loaded." }) })),
    );

    render(
      <SectionHistoryPane projectId="p1" sectionType="research_problem" refreshToken={0} onRestored={vi.fn()} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The version history could not be loaded.");
  });

  it("explains that a restore keeps what came after it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ versions: [version()] }) })),
    );

    render(
      <SectionHistoryPane projectId="p1" sectionType="research_problem" refreshToken={0} onRestored={vi.fn()} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Compare" }));
    expect(screen.getByText(/Nothing after it is deleted/)).toBeInTheDocument();
  });
});
