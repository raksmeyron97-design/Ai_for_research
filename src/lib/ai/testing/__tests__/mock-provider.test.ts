import { describe, expect, it } from "vitest";
import { createMockProvider, withMockProvider } from "../mock-provider";
import { AIProviderError } from "../../errors";

const request = { model: "m", prompt: "p" };

describe("mock provider behaviours", () => {
  it("returns prose by default", async () => {
    const mock = createMockProvider();
    await expect(mock.generate(request)).resolves.toMatchObject({ content: "Mock response." });
  });

  it("returns the supplied JSON when a schema is requested", async () => {
    const mock = createMockProvider({ fallback: { kind: "valid", json: { a: 1 } } });
    const res = await mock.generate({ ...request, responseSchema: { type: "object" } });
    expect(JSON.parse(res.content)).toEqual({ a: 1 });
  });

  it("returns an object rather than prose when a schema was asked for but no body given", async () => {
    // So the failure a test sees is a readable schema mismatch, not a JSON
    // parse error that hides what was actually wrong.
    const mock = createMockProvider();
    const res = await mock.generate({ ...request, responseSchema: { type: "object" } });
    expect(res.content).toBe("{}");
  });

  it("produces genuinely unparseable JSON on request", async () => {
    const mock = createMockProvider({ fallback: { kind: "invalid_json" } });
    const res = await mock.generate(request);
    expect(() => JSON.parse(res.content)).toThrow();
  });

  it("produces valid JSON of the wrong shape on request", async () => {
    const mock = createMockProvider({ fallback: { kind: "schema_mismatch" } });
    const res = await mock.generate(request);
    expect(() => JSON.parse(res.content)).not.toThrow();
  });

  it("throws a retryable provider error on request", async () => {
    const mock = createMockProvider({ fallback: { kind: "provider_failure" } });
    await expect(mock.generate(request)).rejects.toBeInstanceOf(AIProviderError);
  });

  it("can throw a non-retryable error, so fallback behaviour is testable", async () => {
    const mock = createMockProvider({ fallback: { kind: "provider_failure", retryable: false } });
    await expect(mock.generate(request)).rejects.toMatchObject({ retryable: false });
  });

  it("never settles for a timeout, leaving the caller's timeout to end it", async () => {
    const mock = createMockProvider({ fallback: { kind: "timeout" } });
    const raced = await Promise.race([
      mock.generate(request).then(() => "settled"),
      new Promise((r) => setTimeout(() => r("still pending"), 30)),
    ]);
    expect(raced).toBe("still pending");
  });

  it("emits citations in the bracket form the verifier reads", async () => {
    const mock = createMockProvider({ fallback: { kind: "citation", keys: ["sok2024antenatal"] } });
    const res = await mock.generate(request);
    expect(res.content).toContain("[sok2024antenatal]");
  });

  it("reports token usage so cost accounting is exercised", async () => {
    const res = await createMockProvider().generate(request);
    expect(res.usage?.inputTokens).toBeGreaterThan(0);
    expect(res.usage?.outputTokens).toBeGreaterThan(0);
  });
});

describe("scripting", () => {
  it("consumes behaviours in order", async () => {
    const mock = createMockProvider({
      script: [{ kind: "valid", content: "first" }, { kind: "valid", content: "second" }],
    });
    expect((await mock.generate(request)).content).toBe("first");
    expect((await mock.generate(request)).content).toBe("second");
  });

  it("repeats the last behaviour rather than falling off the end", async () => {
    // A retry or fallback must not silently land on a different behaviour
    // than the one the test scripted.
    const mock = createMockProvider({ script: [{ kind: "valid", content: "only" }] });
    await mock.generate(request);
    expect((await mock.generate(request)).content).toBe("only");
  });

  it("records every request for assertions on prompt and context", async () => {
    const mock = createMockProvider();
    await mock.generate({ model: "m", prompt: "p", systemInstruction: "sys" });
    expect(mock.calls[0].systemInstruction).toBe("sys");
  });

  it("resets call history and script position", async () => {
    const mock = createMockProvider({ script: [{ kind: "valid", content: "a" }, { kind: "valid", content: "b" }] });
    await mock.generate(request);
    mock.reset();
    expect(mock.calls).toHaveLength(0);
    expect((await mock.generate(request)).content).toBe("a");
  });
});

describe("streaming", () => {
  it("chunks its output and reports usage on the final chunk", async () => {
    const mock = createMockProvider({ fallback: { kind: "valid", content: "x".repeat(60) } });
    const chunks = [];
    for await (const chunk of mock.stream!(request)) chunks.push(chunk);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.at(-1)?.usage?.inputTokens).toBeGreaterThan(0);
    expect(chunks.map((c) => c.delta).join("")).toBe("x".repeat(60));
  });
});

describe("withMockProvider", () => {
  it("routes production adapter calls to the mock, then restores them", async () => {
    const { GeminiProvider } = await import("../../providers/gemini");
    const original = GeminiProvider.generate;
    const mock = createMockProvider({ fallback: { kind: "valid", content: "from mock" } });

    await withMockProvider(mock, async () => {
      const res = await GeminiProvider.generate(request);
      expect(res.content).toBe("from mock");
    });

    expect(GeminiProvider.generate).toBe(original);
  });

  it("restores the adapters even when the body throws", async () => {
    const { OpenAIProvider } = await import("../../providers/openai");
    const original = OpenAIProvider.generate;

    await expect(
      withMockProvider(createMockProvider(), async () => {
        throw new Error("body failed");
      }),
    ).rejects.toThrow("body failed");

    expect(OpenAIProvider.generate).toBe(original);
  });
});
