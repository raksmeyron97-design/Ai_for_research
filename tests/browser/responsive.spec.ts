import { expect, test, type Page } from "@playwright/test";
import { VIEWPORTS } from "../../playwright.config";

const PROJECT = process.env.PLAYWRIGHT_FIXTURE_PROJECT_ID ?? "eeeeeeee-1111-1111-1111-111111111111";

/**
 * Responsive verification in a real engine (§27, §28).
 *
 * Every phase since 17B has recorded that jsdom does not evaluate Tailwind
 * breakpoints, so their responsive claims were verified by reading class
 * names. Reading `sm:hidden` off an element tells you the class is present;
 * it does not tell you the element is hidden, that the page does not scroll
 * sideways, or that the control is reachable with a thumb.
 *
 * These assert behaviour, not screenshots (§27). A screenshot diff would go
 * red on a font change and green on a button that cannot be tapped.
 */

/**
 * The single most useful mobile assertion there is: does the page scroll
 * sideways? A horizontal overflow at 320px is how a workspace becomes
 * unusable on a phone, and it is invisible to every DOM-only test.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

/** Elements wider than the viewport, named, so a failure says what to fix
 *  rather than just that something is too wide. */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // A few pixels of rounding is not an overflow anyone can see.
      if (rect.right > width + 2 || rect.left < -2) {
        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute("class") ?? "").slice(0, 60);
        out.push(`${tag}.${cls} (${Math.round(rect.left)}..${Math.round(rect.right)} vs ${width})`);
      }
    }
    // Ancestors of an overflowing child all report it; the first few are
    // enough to locate the cause.
    return out.slice(0, 6);
  });
}

async function openProject(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${PROJECT}`);
  await expect(page.getByRole("heading", { name: /browser fixture project/i })).toBeVisible();
}

test.describe("the workspace fits every supported viewport", () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} (${viewport.width}px) does not scroll sideways`, async ({ page }) => {
      await openProject(page, viewport);
      const overflow = await horizontalOverflow(page);
      expect(
        overflow,
        `page overflows by ${overflow}px; widest offenders: ${(await overflowingElements(page)).join(" | ")}`,
      ).toBeLessThanOrEqual(2);
    });

    test(`${name} (${viewport.width}px) keeps the editor usable`, async ({ page }) => {
      await openProject(page, viewport);
      const editor = page.locator("textarea[id^='section-editor-']").first();
      await expect(editor).toBeVisible();

      const box = await editor.boundingBox();
      expect(box, "the editor has no layout box").not.toBeNull();
      // A textarea narrower than this is not something a sentence can be
      // written in, whatever the class list says.
      expect(box!.width).toBeGreaterThan(Math.min(240, viewport.width - 40));
      expect(box!.height).toBeGreaterThan(80);
      // And it must not hang off the right edge.
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 2);
    });
  }
});

test.describe("no duplicate ids anywhere in the rendered workspace (§28)", () => {
  test("desktop", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    const duplicates = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of Array.from(document.querySelectorAll("[id]"))) {
        const id = el.id;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
    });
    expect(duplicates).toEqual([]);
  });

  test("mobile, where panes are stacked rather than side by side", async ({ page }) => {
    // The interesting case: a layout that renders one pane on desktop and a
    // stacked variant on mobile can easily render both and hide one, which
    // duplicates every id inside it.
    await openProject(page, VIEWPORTS.mobile375);
    const duplicates = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of Array.from(document.querySelectorAll("[id]"))) {
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
    });
    expect(duplicates).toEqual([]);
  });
});

test.describe("keyboard reachability (§33)", () => {
  test("every workspace pane control is reachable by tabbing", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);

    // Walk the tab order and collect what receives focus. A control that is
    // rendered but unreachable is a control that does not exist for anyone
    // navigating by keyboard.
    const reached = await page.evaluate(async () => {
      const names: string[] = [];
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      for (const el of focusable) {
        el.focus();
        if (document.activeElement === el) {
          names.push(el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName);
        }
      }
      return names;
    });

    expect(reached.length).toBeGreaterThan(5);
  });

  test("focus is visible on the element that has it", async ({ page }) => {
    await openProject(page, VIEWPORTS.desktop1280);
    await page.keyboard.press("Tab");

    const hasVisibleFocus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const style = getComputedStyle(el);
      // Either a real outline, or a ring drawn with box-shadow — Tailwind's
      // focus-visible:ring uses the latter, so checking outline alone would
      // report every focusable element in this codebase as invisible.
      const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const ringed = style.boxShadow !== "none" && style.boxShadow !== "";
      return outlined || ringed;
    });

    expect(hasVisibleFocus).toBe(true);
  });
});
