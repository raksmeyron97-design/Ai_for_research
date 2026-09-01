import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AdminAnalyticsError, compileAdminAnalytics, MAX_USAGE_ROWS } from "../analytics";

interface UsageRowInput {
  id: string;
  task_type: string;
  provider: string;
  model: string;
  estimated_cost_usd: number;
  latency_ms: number | null;
  success: boolean;
  fallback: boolean;
  created_at: string;
}

function createAdminMock(config: {
  totalProjects: number;
  statusCounts: Record<string, number>;
  projectUserIds: string[];
  usageRows: UsageRowInput[];
  errorOn?: "research_projects" | "ai_usage";
}): SupabaseClient {
  const from = (table: string) => {
    let selectArgs: unknown[] = [];
    let eqArgs: unknown[] = [];
    const builder = {
      select(...args: unknown[]) {
        selectArgs = args;
        return builder;
      },
      eq(...args: unknown[]) {
        eqArgs = args;
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
        let result: unknown;
        if (table === config.errorOn) {
          result = { data: null, count: null, error: { message: `permission denied for table ${table}` } };
        } else if (table === "research_projects") {
          const opts = selectArgs[1] as { count?: string } | undefined;
          const isCount = opts?.count === "exact";
          if (isCount && eqArgs.length > 0) {
            const status = eqArgs[1] as string;
            result = { count: config.statusCounts[status] ?? 0, error: null };
          } else if (isCount) {
            result = { count: config.totalProjects, error: null };
          } else {
            result = { data: config.projectUserIds.map((user_id) => ({ user_id })), error: null };
          }
        } else if (table === "ai_usage") {
          result = { data: config.usageRows, error: null };
        } else {
          result = { data: null, error: null };
        }
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

const baseConfig = {
  totalProjects: 3,
  statusCounts: { draft: 1, active: 1, completed: 1, archived: 0 },
  projectUserIds: ["u1", "u1", "u2"],
};

describe("compileAdminAnalytics", () => {
  it("counts distinct researchers, not raw project rows", async () => {
    const admin = createAdminMock({ ...baseConfig, usageRows: [] });
    const summary = await compileAdminAnalytics(admin);
    expect(summary.totals.totalResearchers).toBe(2);
    expect(summary.totals.totalProjects).toBe(3);
    expect(summary.projectsByStatus).toEqual({ draft: 1, active: 1, completed: 1, archived: 0 });
  });

  it("aggregates cost, success rate, and fallback rate across all usage rows", async () => {
    const usageRows: UsageRowInput[] = [
      { id: "1", task_type: "chat", provider: "gemini", model: "gemini-3.6-flash", estimated_cost_usd: 0.01, latency_ms: 100, success: true, fallback: false, created_at: "2026-08-01T00:00:00Z" },
      { id: "2", task_type: "chat", provider: "gemini", model: "gemini-3.6-flash", estimated_cost_usd: 0.02, latency_ms: 200, success: false, fallback: false, created_at: "2026-08-01T01:00:00Z" },
      { id: "3", task_type: "results", provider: "openai", model: "gpt-5.6", estimated_cost_usd: 0.5, latency_ms: 1000, success: true, fallback: true, created_at: "2026-08-02T00:00:00Z" },
    ];
    const admin = createAdminMock({ ...baseConfig, usageRows });
    const summary = await compileAdminAnalytics(admin);

    expect(summary.totals.totalCalls).toBe(3);
    expect(summary.totals.totalCostUsd).toBeCloseTo(0.53);
    expect(summary.totals.successRate).toBeCloseTo(2 / 3);
    expect(summary.totals.fallbackRate).toBeCloseTo(1 / 3);
  });

  it("breaks usage down by provider with average latency and per-provider success rate", async () => {
    const usageRows: UsageRowInput[] = [
      { id: "1", task_type: "chat", provider: "gemini", model: "m", estimated_cost_usd: 0, latency_ms: 100, success: true, fallback: false, created_at: "2026-08-01T00:00:00Z" },
      { id: "2", task_type: "chat", provider: "gemini", model: "m", estimated_cost_usd: 0, latency_ms: 300, success: false, fallback: false, created_at: "2026-08-01T00:00:00Z" },
    ];
    const admin = createAdminMock({ ...baseConfig, usageRows });
    const summary = await compileAdminAnalytics(admin);

    expect(summary.byProvider).toEqual([
      { provider: "gemini", calls: 2, totalCostUsd: 0, avgLatencyMs: 200, successRate: 0.5 },
    ]);
  });

  it("breaks usage down by task type", async () => {
    const usageRows: UsageRowInput[] = [
      { id: "1", task_type: "chat", provider: "gemini", model: "m", estimated_cost_usd: 0.1, latency_ms: 1, success: true, fallback: false, created_at: "2026-08-01T00:00:00Z" },
      { id: "2", task_type: "discussion", provider: "gemini", model: "m", estimated_cost_usd: 0.2, latency_ms: 1, success: true, fallback: false, created_at: "2026-08-01T00:00:00Z" },
    ];
    const admin = createAdminMock({ ...baseConfig, usageRows });
    const summary = await compileAdminAnalytics(admin);

    expect(summary.byTaskType).toEqual(
      expect.arrayContaining([
        { taskType: "chat", calls: 1, totalCostUsd: 0.1 },
        { taskType: "discussion", calls: 1, totalCostUsd: 0.2 },
      ]),
    );
  });

  it("buckets usage into daily totals by the created_at date, sorted ascending", async () => {
    const usageRows: UsageRowInput[] = [
      { id: "1", task_type: "chat", provider: "gemini", model: "m", estimated_cost_usd: 0.1, latency_ms: 1, success: true, fallback: false, created_at: "2026-08-02T23:59:00Z" },
      { id: "2", task_type: "chat", provider: "gemini", model: "m", estimated_cost_usd: 0.1, latency_ms: 1, success: true, fallback: false, created_at: "2026-08-01T00:00:00Z" },
      { id: "3", task_type: "chat", provider: "gemini", model: "m", estimated_cost_usd: 0.1, latency_ms: 1, success: true, fallback: false, created_at: "2026-08-01T05:00:00Z" },
    ];
    const admin = createAdminMock({ ...baseConfig, usageRows });
    const summary = await compileAdminAnalytics(admin);

    expect(summary.dailyUsage).toEqual([
      { date: "2026-08-01", calls: 2, totalCostUsd: 0.2 },
      { date: "2026-08-02", calls: 1, totalCostUsd: 0.1 },
    ]);
  });

  it("surfaces only failed calls as recent failures, capped at 10", async () => {
    const usageRows: UsageRowInput[] = Array.from({ length: 15 }, (_, i) => ({
      id: `fail-${i}`,
      task_type: "chat",
      provider: "gemini",
      model: "m",
      estimated_cost_usd: 0,
      latency_ms: 1,
      success: false,
      fallback: false,
      created_at: "2026-08-01T00:00:00Z",
    }));
    usageRows.push({
      id: "ok",
      task_type: "chat",
      provider: "gemini",
      model: "m",
      estimated_cost_usd: 0,
      latency_ms: 1,
      success: true,
      fallback: false,
      created_at: "2026-08-01T00:00:00Z",
    });
    const admin = createAdminMock({ ...baseConfig, usageRows });
    const summary = await compileAdminAnalytics(admin);

    expect(summary.recentFailures).toHaveLength(10);
    expect(summary.recentFailures.every((f) => f.id.startsWith("fail-"))).toBe(true);
  });

  it("flags usageRowsCapped only when the fetch actually hit MAX_USAGE_ROWS", async () => {
    const admin = createAdminMock({ ...baseConfig, usageRows: [] });
    const summary = await compileAdminAnalytics(admin);
    expect(summary.usageRowsCapped).toBe(false);

    const fullRows: UsageRowInput[] = Array.from({ length: MAX_USAGE_ROWS }, (_, i) => ({
      id: `${i}`,
      task_type: "chat",
      provider: "gemini",
      model: "m",
      estimated_cost_usd: 0,
      latency_ms: 1,
      success: true,
      fallback: false,
      created_at: "2026-08-01T00:00:00Z",
    }));
    const fullAdmin = createAdminMock({ ...baseConfig, usageRows: fullRows });
    const fullSummary = await compileAdminAnalytics(fullAdmin);
    expect(fullSummary.usageRowsCapped).toBe(true);
  });

  it("returns zero rates rather than NaN when there is no usage yet", async () => {
    const admin = createAdminMock({ ...baseConfig, usageRows: [] });
    const summary = await compileAdminAnalytics(admin);
    expect(summary.totals.successRate).toBe(0);
    expect(summary.totals.fallbackRate).toBe(0);
    expect(summary.byProvider).toEqual([]);
  });

  it("throws AdminAnalyticsError instead of silently reporting zero activity when research_projects is unreadable", async () => {
    // Regression test: a real GRANT gap on the service_role Postgres role
    // made every one of these queries fail with "permission denied", but
    // the first version of this function never checked `.error` — it
    // rendered a healthy-looking dashboard with everything at 0 instead of
    // surfacing the failure. Found only by running the real admin page
    // against a real local Supabase instance, not by any mocked test.
    const admin = createAdminMock({ ...baseConfig, usageRows: [], errorOn: "research_projects" });
    await expect(compileAdminAnalytics(admin)).rejects.toThrow(AdminAnalyticsError);
  });

  it("throws AdminAnalyticsError instead of silently reporting zero activity when ai_usage is unreadable", async () => {
    const admin = createAdminMock({ ...baseConfig, usageRows: [], errorOn: "ai_usage" });
    await expect(compileAdminAnalytics(admin)).rejects.toThrow(AdminAnalyticsError);
  });
});
