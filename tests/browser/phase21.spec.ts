import { expect, test, type Page } from "@playwright/test";
import { VIEWPORTS } from "../../playwright.config";

const PROJECT = process.env.PLAYWRIGHT_FIXTURE_PROJECT_ID ?? "eeeeeeee-1111-1111-1111-111111111111";

/**
 * Phase 21's new surfaces, in a real browser (§26-§29).
 *
 * The rule these follow is §28's: assert that a control is *usable*, not that
 * an element exists. A reorder button that renders and does nothing, a search
 * field that filters an array it already had, and a filter panel clipped off
 * the right edge of a phone all pass an existence check.
 */
async function openProject(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${PROJECT}`);
  await expect(page.getByRole("heading", { name: /browser fixture project/i })).toBeVisible();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openFramework(page: Page) {
  await page.getByRole("button", { name: /^framework$/i }).first().click();
  await expect(page.getByRole("heading", { name: /conceptual framework/i })).toBeVisible();
}

async function openLiterature(page: Page) {
  await page.getByRole("button", { name: /^literature$/i }).first().click();
  await expect(page.getByRole("tablist", { name: /literature workspace/i })).toBeVisible();
}

/**
 * The concept names, in rendered order, read from the reorder controls'
 * accessible names.
 *
 * Deliberately not a CSS selector over the markup: §28 is explicit that these
 * tests must not rest on class-name assertions, and "Move Teacher motivation
 * up" is the contract a screen reader relies on. If the accessible name stops
 * naming the concept, that is a real accessibility regression and this should
 * fail.
 */
async function conceptOrder(page: Page): Promise<string[]> {
  const region = page.getByRole("region", { name: /concepts in the framework/i });
  const buttons = region.getByRole("button", { name: /^move .+ up$/i });
  await expect.poll(async () => buttons.count()).toBeGreaterThan(0);

  // textContent includes the aria-hidden arrow glyph that sits beside the
  // sr-only label, so the leading non-letters are stripped: the rendered
  // button reads "↑Move Teacher motivation up" and the concept is the middle.
  return buttons.evaluateAll((els) =>
    els.map((el) =>
      (el.textContent ?? "")
        .replace(/^[^A-Za-z]*move\s+/i, "")
        .replace(/\s+up$/i, "")
        .trim(),
    ),
  );
}

test.describe("framework layout is editable and persists (§13, §16)", () => {
  // Serial, and it has to be: these tests reorder the ONE fixture project's
  // framework. Run in parallel they interleave writes to the same rows, so a
  // test asserting the order it just set reads an order another test set
  // half a second later. That is a defect in the tests, not in the feature —
  // the feature's own protection against concurrent reorders is the
  // all-or-nothing statement in `reorder_framework_nodes` — but a suite that
  // fails at random is worthless either way.
  test.describe.configure({ mode: "serial" });

  test("moving a concept reorders it, and the order survives a reload", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await openFramework(page);

    const before = await conceptOrder(page);
    expect(before.length).toBeGreaterThan(1);

    // Move the second concept up. Named by concept, which is what the
    // accessible name says, so the test breaks if the label stops matching.
    const second = before[1];
    await page.getByRole("button", { name: new RegExp(`move ${second} up`, "i") }).click();

    await expect.poll(async () => (await conceptOrder(page))[0]).toBe(second);

    // The real assertion: it is stored, not just re-rendered.
    await page.reload();
    await openFramework(page);
    expect((await conceptOrder(page))[0]).toBe(second);

    // Put it back, so the fixture is not order-dependent for other specs.
    await page.getByRole("button", { name: new RegExp(`move ${second} down`, "i") }).click();
    await expect.poll(async () => (await conceptOrder(page))[1]).toBe(second);
  });

  test("the ends of the list cannot be moved past", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await openFramework(page);

    const names = await conceptOrder(page);
    await expect(page.getByRole("button", { name: new RegExp(`move ${names[0]} up`, "i") })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: new RegExp(`move ${names[names.length - 1]} down`, "i") }),
    ).toBeDisabled();
  });

  test("reordering is operable from the keyboard alone", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await openFramework(page);

    const before = (await conceptOrder(page))[1];
    const move = page.getByRole("button", { name: new RegExp(`move ${before} up`, "i") });

    // Focused and activated with the keyboard, never clicked. §33 forbids a
    // layout control that only works with a pointer, and a <button> that is
    // focusable but positioned under something else fails this.
    await move.focus();
    await expect(move).toBeFocused();
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await conceptOrder(page))[0]).toBe(before);
    await page.getByRole("button", { name: new RegExp(`move ${before} down`, "i") }).press("Enter");
  });

  test("Escape in the rename field cancels the rename, not the whole workspace", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await openFramework(page);

    // The fixture carries an unmapped legacy node, which is the only kind
    // that can be renamed — a mapped node takes its name from its construct.
    //
    // Waited for rather than skipped-if-absent: the concept list loads after
    // the heading appears, so a bare count() here is a count of an empty list
    // and the test would quietly skip itself while the feature was broken
    // (§62 — a gate that skips is not a gate that passed).
    const rename = page.getByRole("button", { name: /^rename$/i }).first();
    await expect(rename).toBeVisible();
    await rename.click();

    const field = page.getByLabel(/rename this concept/i);
    await expect(field).toBeVisible();
    await field.press("Escape");

    await expect(field).toBeHidden();
    // The overlay is still open: Escape was claimed by the field.
    await expect(page.getByRole("heading", { name: /conceptual framework/i })).toBeVisible();

    // ...and Escape outside the field still closes it, so the fix did not
    // cost the overlay its keyboard exit.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: /conceptual framework/i })).toBeHidden();
  });
});

test.describe("source search is served by the database (§17-§20)", () => {
  test("typing narrows the list through a real request", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);

    const searches: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/sources/search")) searches.push(req.url());
    });

    await openLiterature(page);
    const box = page.getByLabel(/search your sources/i);
    await expect(box).toBeVisible();

    // The list arrives from the server now, so it has to be waited for —
    // counting immediately after the tab renders counts an empty list.
    const results = page.locator('[id="lit-panel-sources"] li');
    await expect.poll(async () => results.count()).toBeGreaterThan(0);

    await box.fill("motivation");
    await expect.poll(() => searches.some((u) => u.includes("q=motivation"))).toBe(true);

    // Bounded: the request asks for a page, not the library.
    expect(searches[searches.length - 1]).toContain("limit=");
  });

  test("a search that matches nothing says it searched this library", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await openLiterature(page);

    await page.getByLabel(/search your sources/i).fill("zzzz-no-such-source-zzzz");

    await expect(page.getByText(/No sources in this library match the current search/i)).toBeVisible();
    await expect(page.getByText(/not the published literature/i)).toBeVisible();
  });

  test("a filter becomes a query parameter, not a browser-side array scan", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);

    const searches: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/sources/search")) searches.push(req.url());
    });

    await openLiterature(page);
    await page.getByText("Filters", { exact: true }).click();
    await page.getByLabel("Cited").selectOption("false");

    await expect.poll(() => searches.some((u) => u.includes("isCited=false"))).toBe(true);
  });
});

test.describe("the new surfaces fit every supported width (§26, §28, §52)", () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`the framework's layout controls stay on screen at ${name}`, async ({ page }) => {
      await openProject(page, viewport);
      await openFramework(page);

      const overflow = await horizontalOverflow(page);
      expect(overflow, `framework overflows by ${overflow}px at ${viewport.width}px`).toBeLessThanOrEqual(2);

      // A move button clipped off the right edge is present, focusable, and
      // unusable — which is exactly the failure a class-name assertion misses.
      const move = page.getByRole("button", { name: /move .* up/i }).last();
      await expect(move).toBeVisible();
      const box = await move.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `move button is cut off at ${viewport.width}px`).toBeLessThanOrEqual(
        viewport.width + 2,
      );
      // Big enough to hit with a finger at phone widths.
      expect(box!.height).toBeGreaterThanOrEqual(16);
    });

    test(`source search and its filters fit at ${name}`, async ({ page }) => {
      await openProject(page, viewport);
      await openLiterature(page);

      const box = page.getByLabel(/search your sources/i);
      await expect(box).toBeVisible();
      const searchBox = await box.boundingBox();
      expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(viewport.width + 2);

      // Opening the filter disclosure must not push the page sideways: seven
      // controls in a wrapping row is where that goes wrong at 320px.
      await page.getByText("Filters", { exact: true }).click();
      await expect(page.getByLabel("Cited")).toBeVisible();

      const overflow = await horizontalOverflow(page);
      expect(overflow, `filters overflow by ${overflow}px at ${viewport.width}px`).toBeLessThanOrEqual(2);
    });
  }
});

test.describe("the 1024px pane boundary (§26)", () => {
  // Tailwind's `lg` breakpoint is 1024px, and it is where WorkspacePanes
  // switches from a stacked tab row to a three-column grid. A layout can be
  // right on both sides of a boundary and wrong exactly on it, and 1024 was
  // the one width the suite never measured.
  test("panes are side by side at 1024 and stacked at 1023", async ({ page }) => {
    await openProject(page, VIEWPORTS.laptop1024);

    const mobileTabs = page.locator(".lg\\:hidden[role='tablist']").first();
    await expect(mobileTabs).toBeHidden();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1023, height: 768 });
    await expect(mobileTabs).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });
});
