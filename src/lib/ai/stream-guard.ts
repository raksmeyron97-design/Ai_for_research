import { AIProviderError } from "./errors";
import type { AIChunk, ProviderName } from "./types";

export class AIStreamIdleTimeoutError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly idleMs: number,
    public readonly chunksReceived: number,
  ) {
    super(
      `Provider stream stalled: no chunk from ${provider} for ${idleMs}ms (after ${chunksReceived} chunk(s))`,
    );
    this.name = "AIStreamIdleTimeoutError";
  }
}

/** Default idle gap. See `getStreamIdleTimeoutMs` for why this is not a total-duration budget. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

export function getStreamIdleTimeoutMs(): number {
  const raw = process.env.AI_STREAM_IDLE_TIMEOUT_MS;
  if (!raw) return DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
}

/**
 * Wraps a provider stream with an IDLE-GAP timeout: the clock measures the
 * time since the last chunk and resets on every one, so a genuinely long
 * answer that keeps producing tokens never trips it. A total-duration budget
 * would be the wrong shape — it would kill exactly the long, expensive
 * generations users care most about, while still allowing a stalled
 * connection to hold a request handler for the whole budget.
 *
 * The default gap is deliberately generous (60s) because the riskiest window
 * is before the *first* chunk: a reasoning model can think for a long time
 * with nothing on the wire. Tighten it with AI_STREAM_IDLE_TIMEOUT_MS if your
 * models are all fast.
 *
 * On timeout the supplied AbortController is aborted, so the adapter's
 * forwarded signal cancels the underlying HTTP request rather than leaving it
 * in flight (the same mechanism the Phase 16 F1 fix added to `generate()`).
 */
export async function* withIdleTimeout(
  source: AsyncIterable<AIChunk>,
  options: { idleMs: number; provider: ProviderName; controller: AbortController },
): AsyncIterable<AIChunk> {
  const { idleMs, provider, controller } = options;
  const iterator = source[Symbol.asyncIterator]();

  let chunksReceived = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const armed = () =>
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AIStreamIdleTimeoutError(provider, idleMs, chunksReceived));
      }, idleMs);
    });

  try {
    for (;;) {
      let result: IteratorResult<AIChunk>;
      try {
        // Race each pull, not the stream as a whole: this is what makes the
        // budget per-gap rather than per-stream.
        result = await Promise.race([iterator.next(), armed()]);
      } finally {
        clearTimeout(timer);
      }

      if (result.done) return;
      chunksReceived += 1;
      yield result.value;
    }
  } finally {
    clearTimeout(timer);
    // Signal cleanup to the upstream iterator, but deliberately do NOT await
    // it. On a stalled generator, return() does not settle until the
    // generator's own pending await resolves — awaiting it here would block
    // the caller for exactly as long as the stall we just timed out on,
    // defeating the guard. The abort above is what actually cancels the
    // request; this is a best-effort release of the reader.
    void iterator.return?.().catch(() => {});
  }
}

/** Classifies a stalled stream the same way a request timeout is classified. */
export function isStreamTimeout(err: unknown): boolean {
  return err instanceof AIStreamIdleTimeoutError;
}

export function toProviderError(provider: ProviderName, err: unknown): AIProviderError {
  if (err instanceof AIProviderError) return err;
  return new AIProviderError(provider, (err as Error)?.message ?? "unknown stream error", true, err);
}
