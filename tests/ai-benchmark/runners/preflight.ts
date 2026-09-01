import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getModelConfig } from "@/lib/ai/model-config";
import type { ProviderName } from "@/lib/ai/types";
import type { ProviderStatus } from "../types";

const require_ = createRequire(import.meta.url);

/**
 * Reads the installed SDK version. `require("<pkg>/package.json")` is not
 * usable here — @google/genai's `exports` map does not expose its own
 * package.json — so the entry point is resolved and the nearest
 * package.json above it is read instead. Every benchmark record carries
 * this version (Step 2), so "unknown" would quietly make a run
 * unreproducible.
 */
export function sdkVersion(provider: ProviderName): string {
  const pkg = provider === "gemini" ? "@google/genai" : "openai";
  try {
    let dir = path.dirname(require_.resolve(pkg));
    for (let depth = 0; depth < 8; depth += 1) {
      const manifest = path.join(dir, "package.json");
      if (fs.existsSync(manifest)) {
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string; version?: string };
        if (parsed.name === pkg && parsed.version) return parsed.version;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function apiMode(provider: ProviderName): string {
  // Both are fixed by the production adapters in src/lib/ai/providers/.
  return provider === "gemini"
    ? "google-genai models.generateContent (Gemini Developer API)"
    : "openai responses.create (Responses API)";
}

function credentialPresent(provider: ProviderName): boolean {
  const key = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

/**
 * Asks each provider what models it will actually serve this key, rather
 * than trusting the ids in `.env` — those are configuration written by a
 * human and can name a model that no longer exists. Every benchmark record
 * stores the model id that was executed, and this is where the candidate
 * list comes from when the operator does not pin one.
 */
async function discoverModels(provider: ProviderName): Promise<string[] | null> {
  try {
    if (provider === "gemini") {
      const { getGeminiClient } = await import("@/lib/ai/gemini-client");
      const pager = await getGeminiClient().models.list();
      const ids: string[] = [];
      for await (const model of pager) {
        if (model.name) ids.push(model.name.replace(/^models\//, ""));
        if (ids.length >= 200) break;
      }
      return ids.sort();
    }

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const page = await client.models.list();
    const ids: string[] = [];
    for await (const model of page) {
      ids.push(model.id);
      if (ids.length >= 200) break;
    }
    return ids.sort();
  } catch {
    return null;
  }
}

/**
 * Establishes, per provider, which of the four execution modes the run is
 * actually in. UNAVAILABLE is reported honestly and never substituted with
 * synthetic data (Step 27) — a benchmark that invents a result for a
 * provider it could not reach is worse than no benchmark.
 */
export async function preflight(providers: ProviderName[]): Promise<ProviderStatus[]> {
  const statuses: ProviderStatus[] = [];

  for (const provider of providers) {
    const hasKey = credentialPresent(provider);
    const base = {
      provider,
      credentialPresent: hasKey,
      sdkVersion: sdkVersion(provider),
      apiMode: apiMode(provider),
    };

    if (!hasKey) {
      statuses.push({
        ...base,
        reachable: null,
        status: "UNAVAILABLE",
        discoveredModels: null,
        reason: `${provider.toUpperCase()}_API_KEY is not set. No live call was attempted and no result was synthesised.`,
      });
      continue;
    }

    const models = await discoverModels(provider);
    statuses.push({
      ...base,
      reachable: models !== null,
      status: models !== null ? "LIVE" : "UNAVAILABLE",
      discoveredModels: models,
      reason:
        models !== null
          ? `Credential accepted; ${models.length} models listed.`
          : "Credential present but the provider could not be reached or rejected it (see provider error on the first scenario).",
    });
  }

  return statuses;
}

/** The models the app itself would use, as configured — the default benchmark candidates. */
export function configuredModels(provider: ProviderName): string[] {
  const config = getModelConfig();
  const ids = Object.values(config)
    .filter((tier) => tier.provider === provider)
    .map((tier) => tier.model);
  return [...new Set(ids)];
}
