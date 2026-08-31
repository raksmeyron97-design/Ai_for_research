import type { ProviderName } from "./types";

export class AIProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(public readonly attempts: AIProviderError[]) {
    super(
      `All AI providers failed: ${attempts.map((a) => `${a.provider}: ${a.message}`).join("; ")}`,
    );
    this.name = "AllProvidersFailedError";
  }
}

interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

/** Wraps a provider call with a timeout, then retries with exponential backoff on retryable failures only. */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { retries = 2, baseDelayMs = 500, timeoutMs = 30_000 }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (err) {
      lastError = err;
      clearTimeout(timeout);
      const retryable = err instanceof AIProviderError ? err.retryable : true;
      if (!retryable || attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
