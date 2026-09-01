import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Separate from vitest.config.ts on purpose: `npm test` must stay fast,
 * hermetic and network-free, while the benchmark makes real, billable
 * provider calls. Nothing here runs unless an `ai:benchmark*` script is
 * invoked explicitly.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/ai-benchmark/**/*.bench.ts"],
    setupFiles: ["tests/ai-benchmark/setup-env.ts"],
    // One file at a time: parallel benchmark files would contend for the
    // same provider rate limit and distort every latency measurement.
    fileParallelism: false,
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
