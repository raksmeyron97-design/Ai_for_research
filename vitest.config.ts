import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Node by default: the vast majority of this suite is pure logic and db
    // code, and a DOM per file would slow it down for no benefit. Component
    // tests opt in with `// @vitest-environment jsdom` at the top of the file.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    // Phase 21: the suite was flaky, and the flakiness was the timeout, not
    // the code.
    //
    // Repeated full runs failed a different component test each time —
    // SectionReviewPane, then ConstructPanel, then EvidencePanel — each at
    // 5.1-6.2s against vitest's 5s default. Every one of them is a
    // `findBy*` over an already-resolved mock: there is no race to lose, no
    // real request, and nothing that legitimately takes five seconds. What
    // varies is how much CPU a jsdom file gets when eight workers share eight
    // cores with a Next build or a database container.
    //
    // A gate that fails on an unrelated busy machine is worse than a slow
    // one: it trains people to re-run until green, which is how a real
    // failure gets waved through. These are correctness assertions, not
    // performance budgets — a test that needs 6s to be right is still right —
    // so the ceiling is raised to where only a genuine hang reaches it.
    // Nothing here gets slower: a timeout costs time only when it fires.
    //
    // Real timing assertions belong in the browser suite, which measures a
    // built app rather than a mocked component.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  // tsconfig sets jsx: "preserve" for Next's own compiler, so the test
  // transform has to be told how to handle JSX itself. Vitest 4 transforms
  // with oxc (via rolldown), not esbuild, so this is the oxc option.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
