import { AIProviderError } from "./errors";
import { getGeminiClient } from "./gemini-client";
import { getEmbeddingDimensions, getEmbeddingModel } from "./model-config";

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/**
 * Batch-embeds text via Gemini's embedContent. Not routed through
 * AIOrchestrator/TaskClassifier — embeddings aren't a chat/generation task
 * with a complexity tier, they're a single fixed operation, so a separate
 * small module is simpler than forcing them through the tiered-routing
 * abstraction built for generate()/stream().
 */
export async function embedTexts(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    const response = await getGeminiClient().models.embedContent({
      model: getEmbeddingModel(),
      contents: texts,
      config: {
        taskType,
        outputDimensionality: getEmbeddingDimensions(),
      },
    });

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new AIProviderError(
        "gemini",
        `Embedding count mismatch: sent ${texts.length} texts, got ${embeddings.length} embeddings back`,
        false,
      );
    }

    return embeddings.map((e, i) => {
      if (!e.values) {
        throw new AIProviderError("gemini", `Embedding ${i} has no values`, false);
      }
      return e.values;
    });
  } catch (err) {
    if (err instanceof AIProviderError) throw err;
    throw new AIProviderError("gemini", `Embedding request failed: ${(err as Error).message}`, true, err);
  }
}

export async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await embedTexts([query], "RETRIEVAL_QUERY");
  return embedding;
}
