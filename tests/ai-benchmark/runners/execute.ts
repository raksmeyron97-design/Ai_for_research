import { randomUUID } from "node:crypto";
import type { BenchmarkConfig } from "../config";

/**
 * Thrown by the budget to refuse a provider call. It is raised inside the
 * adapter wrapper, before the network, so a refused call is free.
 *
 * It deliberately does not extend any provider error type: the orchestrator's
 * retry and fallback machinery is allowed to see it and react to it exactly
 * as it would to any other failure. Each of those recovery attempts is
 * refused in turn, at no cost, and the scenario ends UNAVAILABLE.
 */
export class BenchmarkBudgetExceededError extends Error {
  readonly budgetRefusal = true;

  constructor(reason: string) {
    super(`benchmark budget: ${reason}`);
    this.name = "BenchmarkBudgetExceededError";
  }
}

/**
 * Budget and safety rails for a live run (Step 28, Phase 22 §22E). This is a
 * hard stop, not advice: once `requestsUsed` reaches `maxRequests`, or
 * measured spend reaches `maxCostUsd`, or SIGINT is received, every remaining
 * unit is skipped rather than executed. The counters are shared across the
 * whole run so a nested loop over providers x models x scenarios x
 * repetitions cannot escape them.
 *
 * Two things the Phase 22 audit found and this now fixes:
 *
 *   * `costUsed` was never incremented by anything except a unit test that
 *     assigned to it directly. `AI_BENCH_MAX_COST_USD` was documented in
 *     `docs/ROADMAP.md` as the way to cap a live compare at 15 USD and
 *     recorded as `PASS` in the Phase 16A table, and it could not stop a run
 *     at any price. `recordSpend` is now called after every execution.
 *   * `exhausted` was consulted only between scenarios. A scenario that had
 *     already started could make a retry, a cross-provider fallback and a
 *     reviewer call with no ceiling in sight, so the "hard stop" could be
 *     overrun by roughly concurrency x calls-per-scenario. `gate()` is now
 *     called at the adapter boundary, which is below all of that.
 *
 * The limit of the cost ceiling, stated rather than glossed: it can only
 * count spend it can price. A model that neither the operator rate file nor
 * `src/lib/ai/pricing.ts` covers contributes 0 to `costUsed`, because the
 * alternative is inventing a rate. Such a run is bounded by `maxRequests`
 * alone, and `unpricedCalls` records how much of the run was invisible to the
 * cost ceiling so a reader can see it rather than assume full coverage.
 */
export class RunBudget {
  requestsUsed = 0;
  costUsed = 0;
  cancelled = false;
  /** Calls refused at the adapter boundary. These reached no network and cost nothing. */
  refusedCalls = 0;
  /** Executions whose cost could not be priced, and so could not be charged against `maxCostUsd`. */
  unpricedCalls = 0;

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

  /**
   * Charge measured spend against the cost ceiling.
   *
   * Only a verified figure is accepted. `null` means the model was not
   * priced by the operator rate file or by the app's verified rates, and
   * guessing there would be worse than not counting: it would produce a
   * dollar total the report is forbidden to print.
   */
  recordSpend(estimatedCostUsd: number | null | undefined): void {
    if (typeof estimatedCostUsd === "number" && Number.isFinite(estimatedCostUsd)) {
      this.costUsed += estimatedCostUsd;
    } else {
      this.unpricedCalls += 1;
    }
  }

  /**
   * The hard stop, called before every provider call. Throws rather than
   * returning a flag so that it cannot be called and then ignored.
   */
  gate(): void {
    if (this.exhausted) {
      this.refusedCalls += 1;
      throw new BenchmarkBudgetExceededError(this.reason());
    }
    this.requestsUsed += 1;
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
