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

/**
 * Refuse to test a server that is not this application (Phase 22 §22B).
 *
 * `reuseExistingServer` is genuinely useful — it turns a re-run from six
 * minutes into four — but it reuses whatever answers on the port, and it has
 * no idea whose server that is. On this machine an unrelated project's
 * `next dev -p 3100` was already listening, and the gate spent five minutes
 * timing out against it with a message that mentioned neither the port nor
 * the other app.
 *
 * The failure worth preventing is not that one, though. It is the silent
 * one: a foreign server that answers 200 on `/login` would have had the whole
 * suite run green or red against the wrong application.
 *
 * The marker is the document title from `src/app/layout.tsx`, which Next
 * renders into the served HTML. Not the sign-in form: `/login` is a client
 * component, so its markup is not in the response at all — an identity check
 * that looked for the email field would reject this application, which is
 * exactly what the first version of this function did.
 */
/** From `src/app/layout.tsx`. Server-rendered into every page, including `/login`. */
const APP_TITLE = "AI Thesis & Research Assistant";
/** As it appears in HTML, where `&` is escaped. */
const APP_TITLE_MARKER = APP_TITLE.replace("&", "&amp;");

async function assertServerIsThisApp(baseURL: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseURL}/login`, { redirect: "follow" });
  } catch (err) {
    throw new Error(
      `The browser gate could not reach ${baseURL}/login (${(err as Error).message}).\n` +
        `Start it, or point the gate elsewhere with PLAYWRIGHT_PORT.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${baseURL}/login answered ${response.status}, so the server on this port is not this application.\n` +
        `Something else is very likely holding the port. Find it with:  lsof -ti:${new URL(baseURL).port}\n` +
        `Then either free the port, or run the gate on another one:  PLAYWRIGHT_PORT=3101 npm run test:browser`,
    );
  }

  const body = await response.text();
  if (!body.includes(APP_TITLE_MARKER)) {
    throw new Error(
      `${baseURL}/login answered 200, but the page it served is not this application.\n` +
        `Expected its title to contain "${APP_TITLE}"; something else is holding the port.\n` +
        `Refusing to run the browser suite against another server — its results would describe the wrong app.\n` +
        `Find the squatter with:  lsof -ti:${new URL(baseURL).port}\n` +
        `Or run the gate on a free port:  PLAYWRIGHT_PORT=3101 npm run test:browser`,
    );
  }
}

export default async function globalSetup(config: FullConfig) {
  loadDotEnvLocal();

  const baseURL = config.projects[0].use.baseURL ?? "http://127.0.0.1:3100";
  // Before the seed, so a squatted port costs seconds rather than a full
  // fixture build followed by an unexplained timeout.
  await assertServerIsThisApp(baseURL);

  const { projectId } = await seedBrowserFixture();
  process.env.PLAYWRIGHT_FIXTURE_PROJECT_ID = projectId;

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
