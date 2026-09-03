import { expect, test, type Page } from "@playwright/test";
import { VIEWPORTS } from "../../playwright.config";
import { TRACED_CLAIM_TEXT } from "./seed";

const PROJECT = process.env.PLAYWRIGHT_FIXTURE_PROJECT_ID ?? "eeeeeeee-1111-1111-1111-111111111111";

/**
 * The overlay workspaces, in a real browser (§27, §28, §34).
 *
 * Each of these is a full-screen overlay over the editor. The properties that
 * matter are the ones a DOM test cannot see: that the overlay actually fits
 * the viewport, that its tab row is reachable when it overflows, that closing
 * it puts focus somewhere sensible, and that the framework is usable on a
 * phone without a canvas.
 */
async function openProject(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${PROJECT}`);
  await expect(page.getByRole("heading", { name: /browser fixture project/i })).toBeVisible();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

const OVERLAYS = [
  { button: /^framework$/i, heading: /conceptual framework/i, close: /^close$/i },
  { button: /^methodology$/i, heading: /^methodology$/i, close: /^close$/i },
  // The integrity overlay's dismiss control is worded differently. Asserting
  // a generic "Close" here would have been asserting the test's own
  // assumption rather than the interface.
  { button: /^research integrity$/i, heading: /research integrity/i, close: /back to writing/i },
];

test.describe("overlay workspaces fit and behave at every width (§28)", () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    for (const overlay of OVERLAYS) {
      test(`${overlay.button.source} at ${name} opens without overflow`, async ({ page }) => {
        await openProject(page, viewport);

        const trigger = page.getByRole("button", { name: overlay.button }).first();
        if ((await trigger.count()) === 0) test.skip(true, "workspace not reachable at this width");
        await trigger.click();

        await expect(page.getByRole("heading", { name: overlay.heading })).toBeVisible();

        const overflow = await horizontalOverflow(page);
        expect(overflow, `overlay overflows by ${overflow}px at ${viewport.width}px`).toBeLessThanOrEqual(2);

        // The close control has to be on screen, not pushed off the edge by a
        // long title — which is exactly what happens at 320px if the header
        // does not allow the heading to shrink.
        const close = page.getByRole("button", { name: overlay.close }).first();
        await expect(close).toBeVisible();
        const box = await close.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 2);
        expect(box!.y).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

test.describe("the conceptual framework is usable without a mouse or a canvas (§33, §34)", () => {
  test("renders concepts and relationships as text at 320px", async ({ page }) => {
    await openProject(page, VIEWPORTS.mobile320);
    await page.getByRole("button", { name: /^framework$/i }).click();

    const concepts = page.getByRole("region", { name: /concepts in the framework/i });
    await expect(concepts).toBeVisible();
    // The seeded framework: two mapped constructs and one legacy free-text
    // node, all readable as list rows rather than as positioned boxes.
    // `p` only: the "Link to construct" selects carry the same names as
    // <option>s, which is a strict-mode ambiguity rather than a real one.
    await expect(concepts.getByText("Teacher motivation", { exact: true }).locator("xpath=self::p")).toBeVisible();
    await expect(concepts.getByText("School climate", { exact: true }).locator("xpath=self::p")).toBeVisible();

    const relationships = page.getByRole("region", { name: /^relationships/i });
    await expect(relationships.getByText(/Teacher motivation predicts Student performance/)).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });

  test("behaves as a dialog: focus enters, is trapped, and returns (§33)", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);

    const opener = page.getByRole("button", { name: /^framework$/i });
    await opener.click();

    const dialog = page.getByRole("dialog", { name: /conceptual framework/i });
    await expect(dialog).toBeVisible();

    // Focus is already inside. Before this was a dialog, reaching the first
    // control here took more than twenty-five Tab presses through the page
    // behind it — which is what a keyboard user actually experienced.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // Tabbing stays inside, however far it goes.
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // Shift+Tab from the first control wraps to the last rather than escaping.
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // Escape closes, and focus goes back to what opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await opener.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  test("its actions are operable from the keyboard alone", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await page.getByRole("button", { name: /^framework$/i }).click();
    await expect(page.getByRole("region", { name: /concepts in the framework/i })).toBeVisible();

    const names: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      names.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40) : "";
        }),
      );
      await page.keyboard.press("Tab");
    }
    expect(names.some((n) => /remove|unlink|add concept|add relationship/i.test(n))).toBe(true);
  });

  test("reports the unmapped legacy node rather than guessing its construct (§40)", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await page.getByRole("button", { name: /^framework$/i }).click();

    const consistency = page.getByRole("region", { name: /^consistency/i });
    await expect(consistency).toBeVisible();
    await expect(consistency.getByText(/not linked to a construct/i).first()).toBeVisible();
    // And the construct the framework does not show.
    await expect(consistency.getByText(/is not in the conceptual framework/i).first()).toBeVisible();
  });

  test("adding a relationship persists and survives a reload", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await page.getByRole("button", { name: /^framework$/i }).click();
    await expect(page.getByRole("region", { name: /concepts in the framework/i })).toBeVisible();

    const relationships = page.getByRole("region", { name: /^relationships/i });
    await relationships.getByLabel("From").selectOption({ label: "School climate" });
    await relationships.getByLabel("Relationship", { exact: true }).selectOption("influences");
    await relationships.getByLabel("To").selectOption({ label: "Student performance" });
    await relationships.getByRole("button", { name: /add relationship/i }).click();

    await expect(
      relationships.getByText(/School climate is associated with Student performance|School climate influences Student performance/),
    ).toBeVisible();

    // The real check: it is in the database, not just in React state.
    await page.reload();
    await page.getByRole("button", { name: /^framework$/i }).click();
    await expect(
      page.getByRole("region", { name: /^relationships/i }).getByText(/School climate influences Student performance/),
    ).toBeVisible();
  });
});

test.describe("finding to sentence (§13)", () => {
  test("a claim opens its section and selects the sentence", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);

    await page.getByRole("button", { name: /^research integrity$/i }).click();
    await expect(page.getByRole("heading", { name: /research integrity/i })).toBeVisible();

    // The Claims tab, then the traced claim's "Show in manuscript".
    await page.getByRole("tab", { name: /^claims$/i }).click();
    const show = page.getByRole("button", { name: /show in manuscript/i }).first();
    await expect(show).toBeVisible();
    await show.click();

    // The overlay closes and the editor now holds the section's text with the
    // claim selected — the selection is what a DOM test cannot verify,
    // because an unfocused textarea has no visible selection at all.
    const editor = page.locator("textarea[id^='section-editor-']").first();
    await expect(editor).toBeVisible();

    const selected = await editor.evaluate(
      (el) => (el as HTMLTextAreaElement).value.slice(
        (el as HTMLTextAreaElement).selectionStart,
        (el as HTMLTextAreaElement).selectionEnd,
      ),
    );
    expect(selected).toBe(TRACED_CLAIM_TEXT);
  });

  test("says so when the sentence has been edited away, rather than doing nothing", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);

    // Rewrite the results section so the claim can no longer be found.
    // The navigator button's accessible name carries its status glyph
    // ("● Results"), so this cannot be anchored at the start.
    await page.getByRole("button", { name: /Results$/ }).first().click();
    const editor = page.locator("textarea[id^='section-editor-results']");
    await expect(editor).toBeVisible();
    await editor.fill("Everything in this section has been rewritten since the claims were extracted.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /^research integrity$/i }).click();
    await page.getByRole("tab", { name: /^claims$/i }).click();
    await page.getByRole("button", { name: /show in manuscript/i }).first().click();

    // §13: `claim_not_located` is shown, not swallowed. A button that
    // silently does nothing reads as broken.
    await expect(page.getByText(/could not highlight that sentence/i)).toBeVisible();
  });
});
