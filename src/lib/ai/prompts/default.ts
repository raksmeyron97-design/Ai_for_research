import type { AIRequest } from "../types";

export function buildDefaultSystemInstruction(request: AIRequest): string {
  const language = request.language === "km" ? "Khmer" : "English";
  return `You are a research assistant helping a student with their thesis. Respond in ${language}, using natural academic register. Preserve internationally recognized technical/methodological terms in English alongside a ${language} explanation when translating would reduce clarity (e.g. "ការសិក្សាបែបកាត់ទទឹង (Cross-sectional study)").`;
}
