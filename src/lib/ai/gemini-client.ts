import { GoogleGenAI } from "@google/genai";
import { requireApiKey } from "./model-config";

let client: GoogleGenAI | null = null;

/** Shared singleton so providers/gemini.ts and embeddings.ts don't each construct their own client. */
export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: requireApiKey("gemini") });
  }
  return client;
}
