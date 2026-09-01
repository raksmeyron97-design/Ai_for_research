import { AIProviderError } from "../errors";
import { getGeminiClient } from "../gemini-client";
import { toGeminiSchema } from "../json-schema";
import type {
  AIChunk,
  AIProvider,
  AIResponse,
  ProviderGenerateRequest,
  TokenCountRequest,
  TokenUsage,
} from "../types";

function toUsage(usageMetadata: unknown): TokenUsage | undefined {
  if (!usageMetadata || typeof usageMetadata !== "object") return undefined;
  const meta = usageMetadata as Record<string, number | undefined>;
  return {
    inputTokens: meta.promptTokenCount,
    outputTokens: meta.candidatesTokenCount,
    totalTokens: meta.totalTokenCount,
    reasoningTokens: meta.thoughtsTokenCount,
    cachedInputTokens: meta.cachedContentTokenCount,
  };
}

export const GeminiProvider: AIProvider = {
  name: "gemini",

  async generate(request: ProviderGenerateRequest): Promise<AIResponse> {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: request.model,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          ...(request.responseSchema && {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(request.responseSchema),
          }),
        },
      });

      return {
        content: response.text ?? "",
        provider: "gemini",
        model: request.model,
        usage: toUsage(response.usageMetadata),
      };
    } catch (err) {
      throw new AIProviderError("gemini", `Gemini generate failed: ${(err as Error).message}`, true, err);
    }
  },

  async *stream(request: ProviderGenerateRequest): AsyncIterable<AIChunk> {
    try {
      const stream = await getGeminiClient().models.generateContentStream({
        model: request.model,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
        },
      });

      for await (const chunk of stream) {
        yield { delta: chunk.text ?? "", done: false };
      }
      yield { delta: "", done: true };
    } catch (err) {
      throw new AIProviderError("gemini", `Gemini stream failed: ${(err as Error).message}`, true, err);
    }
  },

  async countTokens(request: TokenCountRequest): Promise<TokenUsage> {
    try {
      const result = await getGeminiClient().models.countTokens({
        model: request.model,
        contents: request.text,
      });
      return { totalTokens: result.totalTokens };
    } catch (err) {
      throw new AIProviderError("gemini", `Gemini countTokens failed: ${(err as Error).message}`, false, err);
    }
  },
};
