import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser verification (§27, §47).
 *
 * `channel: "chrome"` rather than Playwright's bundled Chromium, which has no
 * build for macOS 13 — the platform this repository is developed on. Driving
 * the system Chrome is still a real engine running real layout, which is the
 * whole point: jsdom does not evaluate Tailwind breakpoints, so every
 * responsive claim made in Phases 17B-19 was verified by reading class names
 * rather than by measuring anything.
 *
 * Deliberately outside `npm test`. Vitest and Playwright both export `test`,
 * and a browser run needs a built server, so mixing them would make the fast
 * suite slow and its failures ambiguous. `npm run test:browser` is the gate.
 *
 * The viewports come from §27 and are not a rounded-off sample: 320 is the
 * narrowest phone still in use, 375 and 414 are the two common iPhone widths,
 * 768 is the tablet breakpoint and 1280 is where the editor-plus-aside layout
 * is supposed to hold.
 */
export const VIEWPORTS = {
  mobile320: { width: 320, height: 640 },
  mobile375: { width: 375, height: 812 },
  mobile414: { width: 414, height: 896 },
  tablet768: { width: 768, height: 1024 },
  desktop1280: { width: 1280, height: 900 },
} as const;

export default defineConfig({
  testDir: "./tests/browser",
  // A build plus a seed is slow enough that a 30s default turns an ordinary
  // cold start into a spurious failure.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"]],
  globalSetup: "./tests/browser/global-setup.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    storageState: "tests/browser/.auth/state.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    // `next start` on the production build, not `next dev`: dev-mode layout
    // shifts and overlays are not what ships, and a responsive gate that
    // passes only in dev is worth nothing.
    command: "npm run build && npx next start --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
