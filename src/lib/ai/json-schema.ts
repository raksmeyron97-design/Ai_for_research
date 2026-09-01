/**
 * Schemas in this codebase are written once, in standard (lowercase-type)
 * JSON Schema — the dialect OpenAI's Structured Outputs (`json_schema`
 * response format) expects natively. Gemini's `responseSchema` uses its
 * own OpenAPI-derived dialect with uppercase `Type` enum values
 * (`"OBJECT"`, `"STRING"`, ...) instead of JSON Schema's lowercase
 * `"object"`/`"string"`. Rather than maintaining two schema dialects by
 * hand, this recursively uppercases `type` (and walks `properties`/
 * `items`) so one schema definition serves both providers.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };

  if (typeof result.type === "string") {
    result.type = result.type.toUpperCase();
  }

  if (result.properties && typeof result.properties === "object") {
    result.properties = Object.fromEntries(
      Object.entries(result.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        toGeminiSchema(value as Record<string, unknown>),
      ]),
    );
  }

  if (result.items && typeof result.items === "object") {
    result.items = toGeminiSchema(result.items as Record<string, unknown>);
  }

  return result;
}
