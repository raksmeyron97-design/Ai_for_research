import { describe, expect, it } from "vitest";
import { runBenchmark } from "./run";

/**
 * Vitest is the entry point rather than a standalone Node script because it
 * is already this project's test runner and resolves TypeScript and the `@/`
 * alias that `src/lib/ai/**` uses — running the production AI code from a
 * plain `node` script would mean either a new build dependency or a
 * duplicate copy of the provider adapters, and the whole point is to
 * benchmark the code that ships.
 *
 * Configuration is by environment variable (see `config.ts`); the npm
 * scripts in package.json are the supported surface.
 */
describe("AI benchmark", () => {
  it(
    "executes the configured suite and writes reports",
    async () => {
      const outcome = await runBenchmark();

      // The run itself must complete and produce a report. A NOT READY
      // status is a legitimate, expected outcome (e.g. no credentials) and
      // is never treated as a harness failure.
      expect(outcome.markdown.length).toBeGreaterThan(0);
      console.log(`\n${outcome.markdown}\n`);
    },
    60 * 60 * 1000,
  );
});
