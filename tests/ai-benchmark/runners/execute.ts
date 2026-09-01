import { randomUUID } from "node:crypto";
import type { BenchmarkConfig } from "../config";

/**
 * Budget and safety rails for a live run (Step 28). This is a hard stop,
 * not advice: once `requestsUsed` reaches `maxRequests`, or SIGINT is
 * received, every remaining unit is skipped rather than executed. The
 * counters are shared across the whole run so a nested loop over
 * providers x models x scenarios x repetitions cannot escape them.
 */
export class RunBudget {
  requestsUsed = 0;
  costUsed = 0;
  cancelled = false;

  constructor(private readonly config: BenchmarkConfig) {}

  get exhausted(): boolean {
    if (this.cancelled) return true;
    if (this.requestsUsed >= this.config.maxRequests) return true;
    if (this.config.maxCostUsd !== null && this.costUsed >= this.config.maxCostUsd) return true;
    return false;
  }

  reason(): string {
    if (this.cancelled) return "run cancelled";
    if (this.requestsUsed >= this.config.maxRequests) return `request ceiling reached (${this.config.maxRequests})`;
    if (this.config.maxCostUsd !== null && this.costUsed >= this.config.maxCostUsd) {
      return `cost ceiling reached (${this.config.maxCostUsd} USD)`;
    }
    return "";
  }

  cancel() {
    this.cancelled = true;
  }
}

/**
 * The harness enforces its own timeout with Promise.race, deliberately not
 * relying on `withRetry` from src/lib/ai/errors.ts: that helper creates an
 * AbortController and passes the signal to its callback, but neither
 * provider adapter forwards the signal to its SDK, so its `timeoutMs` never
 * actually cancels anything. A benchmark that inherited that behaviour
 * could hang indefinitely on one scenario.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`benchmark timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Provider errors can echo request headers or URLs. Nothing that could
 * carry a key is allowed into a report or a log line.
 */
export function redact(message: string): string {
  return message
    .replace(/(AIza|sk-)[A-Za-z0-9_\-]{8,}/g, "$1<redacted>")
    .replace(/(key=)[^&\s"']+/gi, "$1<redacted>")
    .replace(/(authorization["':\s]+)(bearer\s+)?[^\s"',}]+/gi, "$1<redacted>");
}

/** Bounded-concurrency map. Keeps a live run from opening 50 sockets at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export function newRunId(): string {
  return `run_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
}
