import { AsyncLocalStorage } from "node:async_hooks";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import type { AIProvider, AIResponse, ProviderGenerateRequest } from "@/lib/ai/types";

/**
 * Counts and attributes every provider call made during a run, at the adapter
 * boundary.
 *
 * Needed because driving the production path means the orchestrator can make
 * calls the harness never asked for: a retry, a cross-provider fallback after
 * a failure, and the dual-model verification pass on high-risk advanced
 * tasks. Counting only harness-initiated calls would let a run make several
 * times the budgeted number of paid requests while the cap reported itself
 * satisfied.
 *
 * The adapters are plain exported objects and the router holds references to
 * the same instances, so patching the method in place is observed by
 * production code without changing it.
 *
 * Installed ONCE per run, not per scenario. Patching per scenario looked
 * simpler but is broken under concurrency: two scenarios in flight both
 * capture the other's wrapper as "the original", so calls get counted twice
 * and restore() puts back the wrong function. Attribution instead uses
 * AsyncLocalStorage, which follows each scenario across its awaits including
 * the ones inside the orchestrator.
 */
export interface ProviderCall {
  provider: "gemini" | "openai";
  model: string;
  latencyMs: number;
  ok: boolean;
  errorMessage: string | null;
  /**
   * The budget refused this call before it reached the network, so it cost
   * nothing and must never be counted as a provider call. It is still
   * recorded, because "the ceiling stopped the run here" is the single most
   * important thing to be able to read off a truncated run (Phase 22 §22E).
   */
  refused?: boolean;
}

const callContext = new AsyncLocalStorage<ProviderCall[]>();

export interface InstallOptions {
  /**
   * Called before every provider call, for budget accounting.
   *
   * It is a GATE, not a notification: it may throw to refuse the call, and
   * the throw happens before the network is touched, so a refused call is
   * free. This is the only place a ceiling can actually bite mid-scenario —
   * the orchestrator's retry, cross-provider fallback and reviewer pass all
   * originate below the harness, so a check that only runs between scenarios
   * cannot see them (Phase 22 §22E).
   */
  onCall?: () => void;
  /**
   * Replaces the network call while leaving every other stage of the
   * production path intact, so an offline dry run rehearses the same code
   * the live run measures rather than a separate path.
   */
  stub?: AIProvider["generate"];
}

export interface ProviderInstrumentation {
  restore: () => void;
}

export function installProviderInstrumentation(options: InstallOptions = {}): ProviderInstrumentation {
  const originals = new Map<AIProvider, AIProvider["generate"]>();

  for (const provider of [GeminiProvider, OpenAIProvider] as AIProvider[]) {
    const original = provider.generate.bind(provider);
    originals.set(provider, provider.generate);

    provider.generate = async (request: ProviderGenerateRequest): Promise<AIResponse> => {
      const startedAt = Date.now();
      const record = (ok: boolean, errorMessage: string | null, refused = false) => {
        callContext.getStore()?.push({
          provider: provider.name,
          model: request.model,
          latencyMs: Date.now() - startedAt,
          ok,
          errorMessage,
          ...(refused ? { refused: true } : {}),
        });
      };

      // The gate runs inside the try/record path so that a refusal is visible
      // in the scenario's call list rather than vanishing into whatever the
      // orchestrator does with a thrown provider error.
      try {
        options.onCall?.();
      } catch (err) {
        record(false, (err as Error)?.message ?? "budget refused the call", true);
        throw err;
      }

      try {
        const response = await (options.stub ?? original)(request);
        record(true, null);
        return response;
      } catch (err) {
        record(false, (err as Error)?.message ?? "unknown");
        throw err;
      }
    };
  }

  return {
    restore() {
      for (const [provider, original] of originals) provider.generate = original;
    },
  };
}

/** Runs `fn` with its own call-attribution scope. Safe to nest and to run concurrently. */
export async function withCallCapture<T>(fn: () => Promise<T>): Promise<{ result: T; calls: ProviderCall[] }> {
  const calls: ProviderCall[] = [];
  const result = await callContext.run(calls, fn);
  return { result, calls };
}

/** Same scope, but for a `fn` that may throw — the calls made before the throw are still returned. */
export async function withCallCaptureSettled<T>(
  fn: () => Promise<T>,
): Promise<{ result?: T; error?: unknown; calls: ProviderCall[] }> {
  const calls: ProviderCall[] = [];
  return callContext.run(calls, async () => {
    try {
      return { result: await fn(), calls };
    } catch (error) {
      return { error, calls };
    }
  });
}
