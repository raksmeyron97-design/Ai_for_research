import { beforeEach, describe, expect, it } from "vitest";
import { classifyTask, needsVerification } from "../task-classifier";
import type { AIRequest } from "../types";

function makeRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    taskType: "chat",
    ...overrides,
  };
}

describe("classifyTask", () => {
  beforeEach(() => {
    delete process.env.AI_ENABLE_GEMINI;
    delete process.env.AI_ENABLE_OPENAI;
    delete process.env.AI_ENABLE_WEB_GROUNDING;
  });

  it("routes cheap tasks to the simple tier on gemini", () => {
    const result = classifyTask(makeRequest({ taskType: "rewrite" }));
    expect(result.complexity).toBe("simple");
    expect(result.provider).toBe("gemini");
  });

  it("routes high-risk tasks to the advanced tier on openai", () => {
    const result = classifyTask(makeRequest({ taskType: "methodology_audit" }));
    expect(result.complexity).toBe("advanced");
    expect(result.provider).toBe("openai");
  });

  it("does not request document context when no documentIds are given", () => {
    const result = classifyTask(makeRequest({ taskType: "literature_review" }));
    expect(result.needsDocuments).toBe(false);
  });

  it("requests document context when documentIds are given", () => {
    const result = classifyTask(makeRequest({ taskType: "literature_review", documentIds: ["doc1"] }));
    expect(result.needsDocuments).toBe(true);
  });

  it("falls back to gemini for advanced tasks when openai is disabled", () => {
    process.env.AI_ENABLE_OPENAI = "false";
    const result = classifyTask(makeRequest({ taskType: "quality_check" }));
    expect(result.provider).toBe("gemini");
  });

  it("only signals needsWeb when the feature flag is explicitly enabled", () => {
    process.env.AI_ENABLE_WEB_GROUNDING = "true";
    expect(classifyTask(makeRequest({ taskType: "literature_review" })).needsWeb).toBe(true);

    process.env.AI_ENABLE_WEB_GROUNDING = "false";
    expect(classifyTask(makeRequest({ taskType: "literature_review" })).needsWeb).toBe(false);
  });
});

describe("needsVerification", () => {
  it("is false for ordinary standard-tier tasks", () => {
    const request = makeRequest({ taskType: "objective_generation" });
    const classification = classifyTask(request);
    expect(needsVerification(request, classification)).toBe(false);
  });

  it("is true for methodology_audit at the advanced tier", () => {
    const request = makeRequest({ taskType: "methodology_audit" });
    const classification = classifyTask(request);
    expect(needsVerification(request, classification)).toBe(true);
  });

  it("is true whenever explicitly requested, regardless of task", () => {
    const request = makeRequest({ taskType: "rewrite", requireVerification: true });
    const classification = classifyTask(request);
    expect(needsVerification(request, classification)).toBe(true);
  });
});
