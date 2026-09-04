import { describe, expect, it, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveOutDir } from "../config";

/**
 * The dry run must not be able to destroy the live record (Phase 21 §9, §11).
 *
 * This is a unit-level guard on the decision — `scripts/verify-benchmark-isolation.sh`
 * proves the behaviour end to end by hashing the real artifacts around a real
 * `npm run ai:benchmark:dry`. Both exist on purpose: the script is the honest
 * proof but costs a full suite run, and this catches the regression in the
 * fast suite, where someone editing `loadConfig` will actually see it.
 */
describe("benchmark artifact isolation", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["AI_BENCH_DRY_RUN", "AI_BENCH_OUT_DIR", "AI_BENCH_SUITE"];

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it("sends a dry run to a dry/ subdirectory and a live run to the base", () => {
    expect(resolveOutDir("/reports/ai-benchmark", true)).toBe(path.join("/reports/ai-benchmark", "dry"));
    expect(resolveOutDir("/reports/ai-benchmark", false)).toBe("/reports/ai-benchmark");
  });

  it("redirects a dry run even when the operator set AI_BENCH_OUT_DIR", () => {
    // The safety must not be conditional on having configured nothing: an
    // operator who points the harness at their own directory has exactly the
    // same live record to lose.
    process.env.AI_BENCH_DRY_RUN = "true";
    process.env.AI_BENCH_OUT_DIR = "/tmp/somewhere-else";

    const config = loadConfig();
    expect(config.dryRun).toBe(true);
    expect(config.outDirBase).toBe("/tmp/somewhere-else");
    expect(config.outDir).toBe(path.join("/tmp/somewhere-else", "dry"));
  });

  it("leaves the live path exactly where it has always been", () => {
    delete process.env.AI_BENCH_DRY_RUN;
    process.env.AI_BENCH_OUT_DIR = "/tmp/live-base";

    const config = loadConfig();
    expect(config.dryRun).toBe(false);
    expect(config.outDir).toBe("/tmp/live-base");
  });

  it("a dry run cannot write to the live artifact paths", () => {
    // Written as a filesystem assertion rather than a string comparison,
    // because the failure being guarded against is a file being overwritten,
    // not a path being computed wrongly.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "bench-iso-"));
    try {
      fs.writeFileSync(path.join(base, "latest.json"), '{"mode":"live","precious":true}\n');
      fs.writeFileSync(path.join(base, "latest.md"), "# live\n");
      const before = [
        fs.readFileSync(path.join(base, "latest.json"), "utf8"),
        fs.readFileSync(path.join(base, "latest.md"), "utf8"),
      ];

      process.env.AI_BENCH_DRY_RUN = "true";
      process.env.AI_BENCH_OUT_DIR = base;
      const outDir = loadConfig().outDir;

      // Stand in for the reporters, which write exactly these two names.
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "latest.json"), '{"mode":"dry"}\n');
      fs.writeFileSync(path.join(outDir, "latest.md"), "# dry\n");

      expect(fs.readFileSync(path.join(base, "latest.json"), "utf8")).toBe(before[0]);
      expect(fs.readFileSync(path.join(base, "latest.md"), "utf8")).toBe(before[1]);
      expect(fs.existsSync(path.join(base, "dry", "latest.json"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
