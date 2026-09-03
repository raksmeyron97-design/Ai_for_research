import { chromium, type FullConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FIXTURE, seedBrowserFixture } from "./seed";

/**
 * Seeds the fixture project and signs in once, saving the session for every
 * test to reuse.
 *
 * Signing in through the real form rather than by writing a cookie: the login
 * path is part of what "the app works in a browser" means, and a suite that
 * fabricates its own session would keep passing after auth broke.
 */
function loadDotEnvLocal() {
  // Playwright does not read .env.local the way Next.js does, and the seed
  // needs the service-role key. Parsed here rather than pulled in as a
  // dependency: it is a handful of KEY=value lines.
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // Absent .env.local is not fatal here: the seed reports the specific
    // variable it needs, which is a better message than "file not found".
  }
}

export default async function globalSetup(config: FullConfig) {
  loadDotEnvLocal();

  const { projectId } = await seedBrowserFixture();
  process.env.PLAYWRIGHT_FIXTURE_PROJECT_ID = projectId;

  const baseURL = config.projects[0].use.baseURL ?? "http://127.0.0.1:3100";
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();

  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(FIXTURE.email);
  await page.getByLabel("Password").fill(FIXTURE.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  await page.context().storageState({ path: "tests/browser/.auth/state.json" });
  await browser.close();
}
