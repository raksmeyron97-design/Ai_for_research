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

// File-level, not per-describe: a test that disables a provider used to leak
// that setting into the next describe block, which only stayed hidden because
// of the order tests happened to run in.
beforeEach(() => {
  delete process.env.AI_ENABLE_GEMINI;
  delete process.env.AI_ENABLE_OPENAI;
});

describe("classifyTask", () => {
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

  // Phase 16A / F4: classifyTask used to return needsWeb / needsDocuments /
  // needsData / needsCitations, which nothing read. They are gone; the
  // classifier's contract is now tier + provider only.
  it("returns only the routing decision it is actually consulted for", () => {
    const result = classifyTask(makeRequest({ taskType: "literature_review", documentIds: ["doc1"] }));
    expect(Object.keys(result).sort()).toEqual(["complexity", "provider", "taskType"]);
  });

  it("falls back to gemini for advanced tasks when openai is disabled", () => {
    process.env.AI_ENABLE_OPENAI = "false";
    const result = classifyTask(makeRequest({ taskType: "quality_check" }));
    expect(result.provider).toBe("gemini");
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
