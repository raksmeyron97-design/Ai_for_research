import { describe, expect, it, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveOutDir } from "../config";
import { archiveExistingLiveReport, writeReport } from "../reporters/json-report";
import type { BenchmarkReport } from "../reporters/json-report";

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

/**
 * Phase 22 §22D: a live run must not destroy the live run before it.
 *
 * Phase 21 proved a *dry* run cannot damage the live record. It left the
 * other half open: `writeReport` writes `latest.json` in place, and the
 * per-run copy beside it lands in `raw/`, which `.gitignore` excludes — so
 * the only committed trace of a live run was `latest.json`, and the next live
 * run overwrote it.
 *
 * The evidence this protects is real and unrepeatable:
 * `reports/ai-benchmark/latest.json` records the Phase 16B attempt, the
 * README describes it, and it cannot be regenerated because it describes a
 * provider state that no longer obtains.
 */
describe("historical live evidence survives a new live run", () => {
  const report = (runId: string, mode: "live" | "dry"): BenchmarkReport =>
    ({ run_id: runId, mode, status: "NOT READY" }) as unknown as BenchmarkReport;

  it("archives the report a live run replaces, under the run id it holds", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-archive-"));

    const historical = report("run_2026-09-01_the-only-copy", "live");
    fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(historical, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "latest.md"), "# the only copy\n");
    const before = fs.readFileSync(path.join(dir, "latest.json"), "utf8");

    writeReport(dir, "run_2026-09-05_new", report("run_2026-09-05_new", "live"), []);

    // The new run is in place...
    expect(JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8")).run_id).toBe("run_2026-09-05_new");
    // ...and the one it replaced is preserved byte-for-byte, named for itself.
    const archived = path.join(dir, "archive", "run_2026-09-01_the-only-copy.json");
    expect(fs.existsSync(archived), "the previous live report was not archived").toBe(true);
    expect(fs.readFileSync(archived, "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(dir, "archive", "run_2026-09-01_the-only-copy.md"), "utf8")).toBe(
      "# the only copy\n",
    );
  });

  it("does not archive a dry run, whose output is gitignored and regenerable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-archive-dry-"));
    fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(report("run_old", "dry"), null, 2)}\n`);

    writeReport(dir, "run_new", report("run_new", "dry"), []);

    expect(fs.existsSync(path.join(dir, "archive"))).toBe(false);
  });

  it("preserves a report too malformed to parse, rather than losing it", () => {
    // Losing evidence because it will not parse is the worst version of this
    // bug: the file is still the only record of whatever happened.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-archive-bad-"));
    fs.writeFileSync(path.join(dir, "latest.json"), "{ this is not json");

    archiveExistingLiveReport(dir);

    expect(fs.readFileSync(path.join(dir, "archive", "unparseable.json"), "utf8")).toBe("{ this is not json");
  });

  it("is idempotent, so re-archiving never overwrites an archived report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-archive-idem-"));
    fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(report("run_a", "live"), null, 2)}\n`);

    archiveExistingLiveReport(dir);
    const first = fs.readFileSync(path.join(dir, "archive", "run_a.json"), "utf8");

    // A second live run whose predecessor shares a run id must not clobber
    // the copy already held.
    fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify({ run_id: "run_a", tampered: true }, null, 2)}\n`);
    archiveExistingLiveReport(dir);

    expect(fs.readFileSync(path.join(dir, "archive", "run_a.json"), "utf8")).toBe(first);
  });
});
