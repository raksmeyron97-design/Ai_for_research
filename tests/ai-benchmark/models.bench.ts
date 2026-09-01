import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { preflight } from "./runners/preflight";

/**
 * Model discovery (Step 2). Asks each provider which models this key can
 * actually call, so benchmark candidates come from the live lineup instead
 * of from model ids someone typed into `.env` months ago.
 */
describe("provider preflight", () => {
  it(
    "reports provider availability and discoverable models",
    async () => {
      const config = loadConfig();
      const statuses = await preflight(config.providers);

      fs.mkdirSync(config.outDir, { recursive: true });
      fs.writeFileSync(
        path.join(config.outDir, "providers.json"),
        `${JSON.stringify({ timestamp: new Date().toISOString(), statuses }, null, 2)}\n`,
      );

      for (const status of statuses) {
        console.log(
          `${status.provider}: ${status.status} — sdk ${status.sdkVersion}, ${status.apiMode}\n  ${status.reason}`,
        );
        if (status.discoveredModels?.length) {
          console.log(`  models (${status.discoveredModels.length}): ${status.discoveredModels.join(", ")}`);
        }
      }

      expect(statuses.length).toBe(config.providers.length);
    },
    120_000,
  );
});
