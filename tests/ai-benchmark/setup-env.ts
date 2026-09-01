/**
 * Vitest does not load `.env.local` the way `next dev` does, so the
 * benchmark loads it explicitly. Values already present in the real
 * environment win, which is what lets CI inject a key without editing a
 * file. Nothing here ever prints a value.
 */
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) continue;
  try {
    // Node >= 20.12 / 21.7. Existing process.env entries take precedence.
    const before = { ...process.env };
    process.loadEnvFile(full);
    for (const [key, value] of Object.entries(before)) {
      if (value !== undefined) process.env[key] = value;
    }
  } catch {
    // A malformed env file must not take the benchmark down; preflight will
    // report the provider as UNAVAILABLE for a missing credential anyway.
  }
}
