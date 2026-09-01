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
