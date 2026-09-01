import { describe, expect, it } from "vitest";
import { SECTION_CHAIN } from "@/lib/db/types";
import {
  SECTION_ACTIONS,
  findSectionAction,
  getSectionActions,
  primaryActions,
  secondaryActions,
} from "../actions";

describe("section action registry", () => {
  it("covers every section in the authoritative chain", () => {
    expect(Object.keys(SECTION_ACTIONS).sort()).toEqual([...SECTION_CHAIN].sort());
  });

  it("gives every section at least one action", () => {
    for (const section of SECTION_CHAIN) {
      expect(getSectionActions(section).length, `${section} offers nothing`).toBeGreaterThan(0);
    }
  });

  it("never lists the same action id twice for a section", () => {
    for (const section of SECTION_CHAIN) {
      const ids = getSectionActions(section).map((a) => a.id);
      expect(new Set(ids).size, `${section} has duplicate actions`).toBe(ids.length);
    }
  });

  it("keeps the primary set small enough to not need a More menu of its own", () => {
    // §25: progressive disclosure. Three primaries is a toolbar; eight is the
    // problem the More menu exists to solve.
    for (const section of SECTION_CHAIN) {
      expect(primaryActions(section).length, `${section} has too many primary actions`).toBeLessThanOrEqual(3);
    }
  });

  it("partitions actions into exactly primary plus secondary", () => {
    for (const section of SECTION_CHAIN) {
      const total = primaryActions(section).length + secondaryActions(section).length;
      expect(total).toBe(getSectionActions(section).length);
    }
  });

  it("marks content-dependent actions so the UI can disable them with a reason", () => {
    for (const section of SECTION_CHAIN) {
      for (const action of getSectionActions(section)) {
        if (["improve", "rewrite", "shorten", "expand", "translate", "review"].includes(action.id)) {
          expect(action.requiresContent, `${section}:${action.id} should require content`).toBe(true);
        }
      }
    }
  });

  it("never requires existing content for generate — that is what generate is for", () => {
    for (const section of SECTION_CHAIN) {
      const generate = findSectionAction(section, "generate");
      if (generate) expect(generate.requiresContent).toBe(false);
    }
  });

  it("does not offer generate for sections owned by a dedicated generator", () => {
    // Those have their own guards (dataset required, results required,
    // schema-validated persistence). A second path to the same content would
    // route around them.
    for (const section of ["results", "discussion", "conclusion", "questionnaire"] as const) {
      expect(findSectionAction(section, "generate"), `${section} exposes a duplicate generate`).toBeUndefined();
    }
  });

  it("gives every action a description a student could act on", () => {
    for (const section of SECTION_CHAIN) {
      for (const action of getSectionActions(section)) {
        expect(action.description.length).toBeGreaterThan(15);
        expect(action.description).not.toBe(action.label);
      }
    }
  });

  it("returns undefined for an action a section does not offer", () => {
    expect(findSectionAction("appendices", "add_evidence")).toBeUndefined();
  });
});
