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
}

const callContext = new AsyncLocalStorage<ProviderCall[]>();

export interface InstallOptions {
  /** Called before every provider call, for budget accounting. */
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
      options.onCall?.();
      const startedAt = Date.now();
      const record = (ok: boolean, errorMessage: string | null) => {
        callContext.getStore()?.push({
          provider: provider.name,
          model: request.model,
          latencyMs: Date.now() - startedAt,
          ok,
          errorMessage,
        });
      };

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
