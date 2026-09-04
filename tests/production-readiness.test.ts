import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 21 §55-§56: a deterministic production-readiness check, run as part
 * of `npm test` rather than as a document someone is meant to remember.
 *
 * Every assertion here is about the repository, not about a deployment: it
 * needs no secret values, contacts nothing, and never prints a secret. The
 * question it answers is the one a new engineer or a deploy has: *is what
 * this needs written down, and is anything in here that should not be?*
 */
const ROOT = path.resolve(import.meta.dirname, "..");

function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

/** Every `process.env.X` the application source reads. */
function envVarsUsedInSource(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      for (const match of fs.readFileSync(full, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        found.add(match[1]);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return [...found].sort();
}

describe("environment configuration is documented, not tribal knowledge (§55)", () => {
  it("names every variable the application reads in .env.example", () => {
    // The failure this prevents: a feature ships reading a new variable, the
    // author has it in their .env.local, and the next person to clone finds
    // out by watching it not work.
    const example = read(".env.example");
    // NODE_ENV and Next's own build-time variables are set by the runtime, not
    // by an operator, so they are not configuration anyone has to supply.
    const runtimeProvided = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV", "CI"]);

    const missing = envVarsUsedInSource().filter(
      (name) => !runtimeProvided.has(name) && !new RegExp(`^\\s*#?\\s*${name}=`, "m").test(example),
    );

    expect(missing, `.env.example does not mention: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps server-only secrets out of the NEXT_PUBLIC_ namespace", () => {
    // Anything prefixed NEXT_PUBLIC_ is inlined into the browser bundle. A
    // service-role key or a provider key there is not a leak waiting to
    // happen, it is a leak.
    const secretish = envVarsUsedInSource().filter((n) =>
      /(_KEY|_SECRET|_TOKEN|SERVICE_ROLE)$/.test(n),
    );
    const exposed = secretish.filter(
      (n) => n.startsWith("NEXT_PUBLIC_") && !n.includes("ANON"),
    );

    // The anon key is the one key that is *designed* to be public: it carries
    // no privileges beyond what RLS grants the caller.
    expect(exposed, `server secrets exposed to the browser: ${exposed.join(", ")}`).toEqual([]);
  });

  it("does not track an env file or anything key-shaped", () => {
    const files = tracked();

    const envFiles = files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && f !== ".env.example");
    expect(envFiles, `env files are tracked: ${envFiles.join(", ")}`).toEqual([]);

    const keyFiles = files.filter((f) => /\.(pem|p12|pfx)$/.test(f) || /(^|\/)id_(rsa|ed25519)$/.test(f));
    expect(keyFiles, `key material is tracked: ${keyFiles.join(", ")}`).toEqual([]);
  });

  it("has no real secret values committed anywhere", () => {
    // Deliberately run over tracked files rather than the working tree, since
    // an untracked .env.local is exactly where these belong.
    //
    // The redaction tests carry deliberately fake provider keys — that is what
    // they exist to prove gets redacted — so they are the one allowed home for
    // a key-shaped string, and only under tests/.
    const suspicious: string[] = [];
    for (const file of tracked()) {
      if (/^package-lock\.json$/.test(file)) continue;
      if (!/\.(ts|tsx|js|mjs|json|md|sql|sh|yml|yaml)$/.test(file)) continue;

      const content = read(file);
      for (const pattern of [
        /sk-[A-Za-z0-9]{32,}/,
        /AIza[A-Za-z0-9_-]{35,}/,
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
        // A signed JWT: three base64url segments. The service-role key is one.
        /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
      ]) {
        if (pattern.test(content)) suspicious.push(file);
      }
    }

    const unexpected = suspicious.filter((f) => !f.startsWith("tests/"));
    // Named, not printed: the assertion message must not become the leak.
    expect(unexpected, `secret-shaped strings in: ${unexpected.join(", ")}`).toEqual([]);
  });

  it("keeps .env.example free of filled-in values", () => {
    // A template with someone's real key in it is worse than no template.
    const filled = read(".env.example")
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=.+/.test(line))
      // Model ids and boolean flags are configuration to copy, not secrets.
      .filter((line) => /(_KEY|_SECRET|_TOKEN|SERVICE_ROLE|_URL)=/.test(line));

    expect(filled, "'.env.example' contains a filled-in secret").toEqual([]);
  });
});

describe("the database bootstrap is reproducible from the repository (§7, §8)", () => {
  const migrationsDir = path.join(ROOT, "supabase", "migrations");
  const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  it("has strictly increasing, unique migration timestamps", () => {
    // Two migrations sharing a timestamp apply in an order the filesystem
    // decides, which is a different schema on a different machine — the exact
    // failure this phase exists to rule out.
    const versions = migrations.map((f) => f.split("_")[0]);
    expect(new Set(versions).size, "duplicate migration timestamps").toBe(versions.length);

    const sorted = [...versions].sort();
    expect(sorted).toEqual(versions.sort());
  });

  it("declares a seed file that exists", () => {
    // config.toml named ./seed.sql for eighteen migrations before the file
    // existed, so every reset ended with a warning a newcomer could not
    // distinguish from a failure.
    const config = read("supabase/config.toml");
    for (const match of config.matchAll(/sql_paths\s*=\s*\[([^\]]*)\]/g)) {
      for (const raw of match[1].split(",")) {
        const declared = raw.trim().replace(/^["']|["']$/g, "");
        if (!declared || declared.includes("*")) continue;
        expect(
          fs.existsSync(path.join(ROOT, "supabase", declared)),
          `supabase/config.toml declares a seed file that does not exist: ${declared}`,
        ).toBe(true);
      }
    }
  });

  it("has an isolation suite for every phase the scripts claim to verify", () => {
    // §62: a gate that cannot run must say so. A script pointing at a suite
    // that does not exist reports NOT RUN, which is honest but is not the
    // same as coverage — so the two are kept in step here.
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (!name.startsWith("db:verify:isolation")) continue;
      const match = /supabase\/tests\/(\S+\.sql)/.exec(command);
      if (!match) continue;
      expect(
        fs.existsSync(path.join(ROOT, "supabase", "tests", match[1])),
        `${name} points at a suite that does not exist: ${match[1]}`,
      ).toBe(true);
    }
  });
});

describe("AI is optional (§44)", () => {
  it("declares both provider keys as optional configuration, not requirements", () => {
    const example = read(".env.example");
    // Present in the template so an operator knows they exist, and empty so
    // the app is expected to run without them.
    expect(example).toMatch(/^GEMINI_API_KEY=\s*$/m);
    expect(example).toMatch(/^OPENAI_API_KEY=\s*$/m);
  });

  it("has no module that throws at import time when a provider key is absent", () => {
    // A top-level `throw` in a provider module takes the whole app down
    // without credentials, which would make every deterministic feature
    // depend on AI availability — the thing §43 forbids.
    const providersDir = path.join(ROOT, "src", "lib", "ai", "providers");
    for (const file of fs.readdirSync(providersDir).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      const topLevelThrow = /^throw /m.test(source);
      expect(topLevelThrow, `${file} throws at module scope`).toBe(false);
    }
  });
});

describe("the benchmark's live record is protected (§11, §54)", () => {
  it("keeps dry-run output out of the repository", () => {
    const dryArtifacts = tracked().filter((f) => f.startsWith("reports/ai-benchmark/dry/"));
    expect(dryArtifacts, "mocked benchmark output is committed").toEqual([]);
  });

  it("does not describe the committed record as a completed live benchmark", () => {
    // §12/§61: the artifact is a successful credential probe plus a smoke run
    // whose every call came back UNAVAILABLE. Documentation must not imply
    // otherwise, and the README has to keep saying so.
    const readme = read("reports/ai-benchmark/README.md");
    expect(readme).toMatch(/LIVE BENCHMARK = DEFERRED/);

    const report = JSON.parse(read("reports/ai-benchmark/latest.json")) as {
      execution_modes: Record<string, number>;
    };
    const scored = Object.entries(report.execution_modes).filter(
      ([mode]) => mode !== "UNAVAILABLE" && mode !== "MOCKED",
    );
    expect(
      scored,
      "the committed report now contains real scored executions — update the README's claim",
    ).toEqual([]);
  });
});
