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

export class AITimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Provider call timed out after ${timeoutMs}ms`);
    this.name = "AITimeoutError";
  }
}

/**
 * Wraps a provider call with a timeout, then retries with exponential
 * backoff on retryable failures only.
 *
 * The timeout is enforced two ways, deliberately. The `AbortSignal` is the
 * real mechanism: both adapters forward it to their SDK, so the in-flight
 * HTTP request is actually cancelled and the socket released. The
 * `Promise.race` is a backstop for the case the signal is dropped somewhere
 * — an adapter that forgets to forward it, or an SDK path that ignores it.
 * Without the race, that case degrades silently back into the Phase 16 F1
 * bug: a timer fires, nothing listens, and the caller waits forever. With
 * it, the worst case is a leaked in-flight request rather than a hung
 * request handler.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { retries = 2, baseDelayMs = 500, timeoutMs = 30_000 }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AITimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(controller.signal), timedOut]);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof AIProviderError ? err.retryable : true;
      if (!retryable || attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeout);
      // Release the socket on the success path too: if fn() resolved, the
      // controller is unused; if the race rejected, the abort above already
      // fired. Aborting a settled request is a no-op.
      controller.abort();
    }
  }

  throw lastError;
}
