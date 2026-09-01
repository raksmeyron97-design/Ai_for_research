import OpenAI from "openai";
import { AIProviderError } from "../errors";
import { requireApiKey } from "../model-config";
import type {
  AIChunk,
  AIProvider,
  AIResponse,
  ProviderGenerateRequest,
  TokenCountRequest,
  TokenUsage,
} from "../types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: requireApiKey("openai") });
  }
  return client;
}

/** Responses API usage uses input_tokens/output_tokens, not Chat Completions' prompt/completion naming. */
function toUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, number | undefined>;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    totalTokens: u.total_tokens,
  };
}

export const OpenAIProvider: AIProvider = {
  name: "openai",

  async generate(request: ProviderGenerateRequest): Promise<AIResponse> {
    try {
      const response = await getClient().responses.create({
        model: request.model,
        instructions: request.systemInstruction,
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        ...(request.responseSchema && {
          text: {
            format: {
              type: "json_schema",
              name: "response",
              schema: request.responseSchema,
              strict: true,
            },
          },
        }),
      });

      return {
        content: response.output_text ?? "",
        provider: "openai",
        model: request.model,
        usage: toUsage(response.usage),
      };
    } catch (err) {
      throw new AIProviderError("openai", `OpenAI generate failed: ${(err as Error).message}`, true, err);
    }
  },

  async *stream(request: ProviderGenerateRequest): AsyncIterable<AIChunk> {
    try {
      const stream = await getClient().responses.create({
        model: request.model,
        instructions: request.systemInstruction,
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { delta: event.delta ?? "", done: false };
        } else if (event.type === "response.completed") {
          yield { delta: "", done: true };
        }
      }
    } catch (err) {
      throw new AIProviderError("openai", `OpenAI stream failed: ${(err as Error).message}`, true, err);
    }
  },

  async countTokens(_request: TokenCountRequest): Promise<TokenUsage> {
    // OpenAI does not expose a server-side token counting endpoint; the
    // TokenManager falls back to a local estimate for this provider.
    throw new AIProviderError("openai", "OpenAI provider does not support countTokens", false);
  },
};
