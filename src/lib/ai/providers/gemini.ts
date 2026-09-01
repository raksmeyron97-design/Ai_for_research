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
          // Client-side cancellation: this frees the socket and unblocks the
          // caller. Google's docs are explicit that it does not cancel the
          // operation server-side, so an aborted request may still be
          // billed — the point is that we stop waiting, not that we stop
          // paying.
          abortSignal: request.signal,
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
          abortSignal: request.signal,
        },
      });

      // Gemini reports usage on the final chunk, and sometimes a running
      // count on earlier ones. Each report is passed straight through rather
      // than held back until `done`: if the stream dies mid-flight, the
      // orchestrator still has the provider's own last figure to record
      // instead of falling back to a text-length estimate for a call that
      // was really billed.
      let usage: TokenUsage | undefined;

      for await (const chunk of stream) {
        const chunkUsage = toUsage(chunk.usageMetadata);
        if (chunkUsage) usage = chunkUsage;
        yield { delta: chunk.text ?? "", done: false, usage: chunkUsage };
      }
      yield { delta: "", done: true, usage };
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
