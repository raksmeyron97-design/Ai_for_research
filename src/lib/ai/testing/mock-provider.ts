import { AIProviderError } from "../errors";
import type { AIChunk, AIProvider, AIResponse, ProviderGenerateRequest, TokenUsage } from "../types";

/**
 * A deterministic provider for feature tests (§21).
 *
 * This exists so the whole researcher workflow — generators, guards,
 * versioning, change control, export — can be tested against the *real*
 * application wiring with no API credits and no network. Before it, every
 * test file mocked `AIOrchestrator` itself, which meant each one re-invented
 * a fake and none of them exercised the orchestrator, router, guards or usage
 * accounting at all.
 *
 * It is a scripted fake, not a model. It never approximates quality; it
 * produces exactly the response a test asks for so that the code paths
 * *around* the model can be asserted on.
 */
export type MockBehavior =
  /** A well-formed response — JSON when a schema was requested, prose otherwise. */
  | { kind: "valid"; content?: string; json?: unknown; usage?: TokenUsage }
  /** Syntactically broken JSON, for the parse-failure path. */
  | { kind: "invalid_json" }
  /** Valid JSON that violates the requested schema. */
  | { kind: "schema_mismatch"; json?: unknown }
  /** Never settles, so a caller's timeout is what ends it. */
  | { kind: "timeout" }
  /** A retryable provider error. */
  | { kind: "provider_failure"; message?: string; retryable?: boolean }
  /** Prose citing the given keys — for citation verification tests. */
  | { kind: "citation"; keys: string[]; content?: string };

export interface MockProviderOptions {
  /** Behaviour per call, consumed in order. The last entry repeats once exhausted. */
  script?: MockBehavior[];
  /** Applied when `script` is absent. */
  fallback?: MockBehavior;
  /** Provider identity to report; affects routing assertions only. */
  name?: "gemini" | "openai";
}

export interface MockProvider extends AIProvider {
  /** Every request the mock received, for asserting on prompts and context. */
  readonly calls: ProviderGenerateRequest[];
  reset(): void;
}

const DEFAULT_USAGE: TokenUsage = { inputTokens: 120, outputTokens: 40, totalTokens: 160 };

function contentFor(behavior: MockBehavior, request: ProviderGenerateRequest): string {
  switch (behavior.kind) {
    case "valid":
      if (behavior.json !== undefined) return JSON.stringify(behavior.json);
      if (behavior.content !== undefined) return behavior.content;
      // A schema was requested but the test did not supply a body: return an
      // empty object rather than prose, so the failure a test sees is a
      // schema mismatch it can read, not a JSON parse error it cannot.
      return request.responseSchema ? "{}" : "Mock response.";
    case "invalid_json":
      return "{ this is not valid json";
    case "schema_mismatch":
      return JSON.stringify(behavior.json ?? { unexpected: "shape" });
    case "citation":
      return behavior.content ?? `Supported by ${behavior.keys.map((k) => `[${k}]`).join(" and ")}.`;
    default:
      return "";
  }
}

export function createMockProvider(options: MockProviderOptions = {}): MockProvider {
  const calls: ProviderGenerateRequest[] = [];
  let index = 0;

  const next = (): MockBehavior => {
    const script = options.script ?? [];
    if (script.length === 0) return options.fallback ?? { kind: "valid" };
    // The last scripted behaviour repeats: a retry or fallback should not
    // silently fall off the end of the script into a different behaviour.
    const behavior = script[Math.min(index, script.length - 1)];
    index += 1;
    return behavior;
  };

  const provider: MockProvider = {
    name: options.name ?? "gemini",
    calls,

    reset() {
      calls.length = 0;
      index = 0;
    },

    async generate(request: ProviderGenerateRequest): Promise<AIResponse> {
      calls.push(request);
      const behavior = next();

      if (behavior.kind === "timeout") {
        // Deliberately never resolves. Whatever timeout the caller wraps this
        // in is the thing under test.
        return new Promise<AIResponse>(() => {});
      }

      if (behavior.kind === "provider_failure") {
        throw new AIProviderError(
          provider.name,
          behavior.message ?? "mock provider failure",
          behavior.retryable ?? true,
        );
      }

      return {
        content: contentFor(behavior, request),
        provider: provider.name,
        model: request.model,
        usage: behavior.kind === "valid" ? (behavior.usage ?? DEFAULT_USAGE) : DEFAULT_USAGE,
      };
    },

    async *stream(request: ProviderGenerateRequest): AsyncIterable<AIChunk> {
      calls.push(request);
      const behavior = next();

      if (behavior.kind === "timeout") {
        await new Promise(() => {});
      }
      if (behavior.kind === "provider_failure") {
        throw new AIProviderError(
          provider.name,
          behavior.message ?? "mock provider failure",
          behavior.retryable ?? true,
        );
      }

      const content = contentFor(behavior, request);
      // Chunked rather than emitted whole, so streaming consumers and the
      // idle-gap guard see a realistic shape. Sliced manually because the
      // `s` regex flag needs a newer target than this project compiles to.
      for (let i = 0; i < content.length; i += 24) {
        yield { delta: content.slice(i, i + 24), done: false };
      }
      yield { delta: "", done: true, usage: DEFAULT_USAGE };
    },
  };

  return provider;
}

/**
 * Installs a mock in place of both real adapters for the duration of a test.
 * Patching the exported objects in place means the router and orchestrator
 * reach the mock without knowing anything changed — the production path stays
 * intact, only the network call is replaced.
 */
export async function withMockProvider<T>(
  mock: MockProvider,
  fn: () => Promise<T>,
): Promise<T> {
  const { GeminiProvider } = await import("../providers/gemini");
  const { OpenAIProvider } = await import("../providers/openai");

  const originals = [
    [GeminiProvider, GeminiProvider.generate, GeminiProvider.stream] as const,
    [OpenAIProvider, OpenAIProvider.generate, OpenAIProvider.stream] as const,
  ];

  for (const [provider] of originals) {
    provider.generate = mock.generate.bind(mock);
    provider.stream = mock.stream?.bind(mock);
  }

  try {
    return await fn();
  } finally {
    for (const [provider, generate, stream] of originals) {
      provider.generate = generate;
      provider.stream = stream;
    }
  }
}
