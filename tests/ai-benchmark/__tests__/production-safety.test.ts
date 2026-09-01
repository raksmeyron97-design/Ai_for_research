import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redact } from "../runners/execute";

/**
 * Phase 16 Step 22. These are static assertions about the shipped code, run
 * as tests so a future change that reintroduces one of these problems fails
 * CI rather than being caught by the next audit.
 */
const ROOT = process.cwd();

function readAll(dir: string, ext = ".ts"): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(ext) || entry.name.endsWith(".tsx")) {
        out.push({ file: path.relative(ROOT, full), content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(dir);
  return out;
}

describe("provider secrets stay server-side", () => {
  const sources = readAll(path.join(ROOT, "src"));

  it("never reads a provider key from a NEXT_PUBLIC_ variable", () => {
    for (const { file, content } of sources) {
      expect(content, `${file} exposes a provider key to the browser`).not.toMatch(
        /NEXT_PUBLIC_[A-Z_]*(GEMINI|OPENAI|API_KEY)/,
      );
    }
  });

  it("keeps provider key reads out of client components", () => {
    for (const { file, content } of sources) {
      if (!content.includes('"use client"')) continue;
      expect(content, `${file} is a client component that reads process.env`).not.toMatch(/process\.env\./);
    }
  });

  it("reads provider keys in exactly one server-side place", () => {
    const readers = sources.filter(({ content }) => /process\.env\.(GEMINI|OPENAI)_API_KEY/.test(content));
    expect(readers.map((r) => r.file)).toEqual(["src/lib/ai/model-config.ts"]);
  });

  it("never returns a key in an API response", () => {
    for (const { file, content } of readAll(path.join(ROOT, "src", "app", "api"))) {
      expect(content, `${file} may echo a key`).not.toMatch(/API_KEY/);
    }
  });
});

describe("logging does not leak prompt or user content", () => {
  it("logs usage as structured metrics without prompt or output text", () => {
    const tokenManager = fs.readFileSync(path.join(ROOT, "src/lib/ai/token-manager.ts"), "utf8");
    const logged = tokenManager.match(/console\.(log|error)\([^)]*\)/g) ?? [];
    for (const line of logged) {
      expect(line).not.toContain("promptText");
      expect(line).not.toContain("outputText");
    }
  });

  it("does not log retrieved document content when retrieval fails", () => {
    const contextManager = fs.readFileSync(path.join(ROOT, "src/lib/ai/context-manager.ts"), "utf8");
    const start = contextManager.indexOf("context_retrieval_failed");
    // Just the logged object literal, not the code that follows it.
    const logged = contextManager.slice(start, contextManager.indexOf("}),", start));
    expect(logged).not.toContain("chunk");
    expect(logged).not.toContain("params.query");
    expect(logged).not.toContain("content");
  });
});

describe("the benchmark adds no production attack surface", () => {
  it("adds no API route", () => {
    const routes = readAll(path.join(ROOT, "src", "app", "api"));
    for (const { file, content } of routes) {
      expect(content, `${file} references the benchmark harness`).not.toContain("ai-benchmark");
    }
  });

  it("is not imported by any shipped source file", () => {
    for (const { file, content } of readAll(path.join(ROOT, "src"))) {
      expect(content, `${file} imports the benchmark harness`).not.toMatch(/from ["'].*tests\/ai-benchmark/);
    }
  });

  it("keeps benchmark fixtures out of the app bundle", () => {
    expect(fs.existsSync(path.join(ROOT, "tests", "ai-benchmark"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "src", "ai-benchmark"))).toBe(false);
  });
});

describe("RAG context is scoped to one project", () => {
  it("always filters chunk search by project id", () => {
    const chunks = fs.readFileSync(path.join(ROOT, "src/lib/db/chunks.ts"), "utf8");
    expect(chunks).toContain("match_project_id: projectId");
  });

  it("keeps the vector search function SECURITY INVOKER so RLS still applies", () => {
    const migration = fs.readFileSync(
      path.join(ROOT, "supabase/migrations/20260901000000_phase3_document_chunks.sql"),
      "utf8",
    );
    // Strip SQL comments first: the migration *discusses* security definer
    // in a comment explaining why it does not use one.
    const sql = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .toLowerCase();
    expect(sql).toContain("create function match_document_chunks");
    expect(sql).not.toContain("security definer");
  });
});

describe("benchmark output is safe to commit", () => {
  it("redacts credentials out of provider errors before they reach a report", () => {
    expect(redact("key=AIzaSyTESTTESTTESTTESTTESTTEST0123")).toContain("<redacted>");
  });

  it("stores no credential in any fixture", () => {
    // Excludes __tests__, which deliberately contains key-shaped strings to
    // prove `redact()` removes them.
    const scanned = readAll(path.join(ROOT, "tests", "ai-benchmark")).filter(
      ({ file }) => !file.includes("__tests__"),
    );
    for (const { file, content } of scanned) {
      expect(content, `${file} contains something shaped like a live key`).not.toMatch(
        /\b(AIzaSy[A-Za-z0-9_\-]{20,}|sk-(proj-)?[A-Za-z0-9]{20,})\b/,
      );
    }
  });
});
