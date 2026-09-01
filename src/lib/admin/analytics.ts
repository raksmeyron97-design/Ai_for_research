import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Totals/breakdowns below are computed over the most recent MAX_USAGE_ROWS
 * `ai_usage` rows, not the table's full lifetime history. Once a deployment
 * has logged more calls than this, older activity drops out of the
 * aggregates — acceptable for a dashboard meant to answer "what's
 * happening lately," not a billing-grade ledger. `usageRowsCapped` on the
 * result tells the caller whether this limit was actually hit.
 */
export const MAX_USAGE_ROWS = 5000;

const PROJECT_STATUSES = ["draft", "active", "completed", "archived"] as const;

/** Thrown when a query fails — never swallowed into a misleading "0 activity" result. */
export class AdminAnalyticsError extends Error {}

interface UsageRow {
  id: string;
  task_type: string;
  provider: string;
  model: string;
  estimated_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  success: boolean;
  fallback: boolean;
  tokens_measured: boolean;
  created_at: string;
}

export interface ProviderBreakdown {
  provider: string;
  calls: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ExpensiveRequest {
  id: string;
  taskType: string;
  provider: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface TaskTypeBreakdown {
  taskType: string;
  calls: number;
  totalCostUsd: number;
}

export interface DailyUsage {
  date: string;
  calls: number;
  totalCostUsd: number;
}

export interface RecentFailure {
  id: string;
  taskType: string;
  provider: string;
  model: string;
  fallback: boolean;
  createdAt: string;
}

export interface AdminAnalyticsSummary {
  usageRowsAnalyzed: number;
  usageRowsCapped: boolean;
  totals: {
    totalProjects: number;
    totalResearchers: number;
    totalCalls: number;
    totalCostUsd: number;
    successRate: number;
    fallbackRate: number;
    /**
     * Share of analyzed calls whose token counts came from the provider
     * rather than a local estimate. A cost total built from mostly
     * estimated rows is an order-of-magnitude indication, not a bill, and
     * the dashboard says so rather than leaving the reader to assume
     * (finding F6).
     */
    measuredTokenRate: number;
  };
  projectsByStatus: Record<string, number>;
  byProvider: ProviderBreakdown[];
  byTaskType: TaskTypeBreakdown[];
  dailyUsage: DailyUsage[];
  recentFailures: RecentFailure[];
  /** The 5 costliest individual calls in the analyzed window — surfaces a runaway single request that per-provider averages would dilute away. */
  topExpensiveRequests: ExpensiveRequest[];
}

/** Aggregates across every user's projects/usage — must only ever be called with an admin (service-role) client, after the caller has verified admin access. */
export async function compileAdminAnalytics(admin: SupabaseClient): Promise<AdminAnalyticsSummary> {
  const [totalProjectsResult, statusCounts, projectUsers, usageResult] = await Promise.all([
    admin.from("research_projects").select("id", { count: "exact", head: true }),
    Promise.all(
      PROJECT_STATUSES.map(async (status) => {
        const { count, error } = await admin
          .from("research_projects")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        if (error) throw new AdminAnalyticsError(`Failed to count "${status}" projects: ${error.message}`);
        return [status, count ?? 0] as const;
      }),
    ),
    admin.from("research_projects").select("user_id"),
    admin
      .from("ai_usage")
      .select(
        "id, task_type, provider, model, estimated_cost_usd, input_tokens, output_tokens, latency_ms, success, fallback, tokens_measured, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(MAX_USAGE_ROWS),
  ]);

  // Every query above must succeed — a permission or connectivity failure
  // must surface as an error, not silently render as "0 activity" (the
  // GRANT gap this uncovered locally would have looked like a healthy,
  // idle system otherwise).
  if (totalProjectsResult.error) {
    throw new AdminAnalyticsError(`Failed to count projects: ${totalProjectsResult.error.message}`);
  }
  if (projectUsers.error) {
    throw new AdminAnalyticsError(`Failed to load project owners: ${projectUsers.error.message}`);
  }
  if (usageResult.error) {
    throw new AdminAnalyticsError(`Failed to load ai_usage: ${usageResult.error.message}`);
  }

  const totalProjects = totalProjectsResult.count ?? 0;
  const projectsByStatus = Object.fromEntries(statusCounts) as Record<string, number>;
  const totalResearchers = new Set(
    ((projectUsers.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ).size;

  const rows = (usageResult.data ?? []) as UsageRow[];
  const totalCalls = rows.length;
  const totalCostUsd = rows.reduce((sum, r) => sum + r.estimated_cost_usd, 0);
  const successCount = rows.filter((r) => r.success).length;
  const fallbackCount = rows.filter((r) => r.fallback).length;
  const measuredCount = rows.filter((r) => r.tokens_measured).length;

  const byProviderMap = new Map<
    string,
    {
      calls: number;
      cost: number;
      latencySum: number;
      latencyCount: number;
      success: number;
      inputTokens: number;
      outputTokens: number;
    }
  >();
  const byTaskTypeMap = new Map<string, { calls: number; cost: number }>();
  const dailyMap = new Map<string, { calls: number; cost: number }>();

  for (const row of rows) {
    const p = byProviderMap.get(row.provider) ?? {
      calls: 0,
      cost: 0,
      latencySum: 0,
      latencyCount: 0,
      success: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    p.calls += 1;
    p.cost += row.estimated_cost_usd;
    if (row.latency_ms != null) {
      p.latencySum += row.latency_ms;
      p.latencyCount += 1;
    }
    if (row.success) p.success += 1;
    p.inputTokens += row.input_tokens ?? 0;
    p.outputTokens += row.output_tokens ?? 0;
    byProviderMap.set(row.provider, p);

    const t = byTaskTypeMap.get(row.task_type) ?? { calls: 0, cost: 0 };
    t.calls += 1;
    t.cost += row.estimated_cost_usd;
    byTaskTypeMap.set(row.task_type, t);

    const day = row.created_at.slice(0, 10);
    const d = dailyMap.get(day) ?? { calls: 0, cost: 0 };
    d.calls += 1;
    d.cost += row.estimated_cost_usd;
    dailyMap.set(day, d);
  }

  const byProvider: ProviderBreakdown[] = [...byProviderMap.entries()]
    .map(([provider, v]) => ({
      provider,
      calls: v.calls,
      totalCostUsd: v.cost,
      avgLatencyMs: v.latencyCount > 0 ? v.latencySum / v.latencyCount : 0,
      successRate: v.calls > 0 ? v.success / v.calls : 0,
      totalInputTokens: v.inputTokens,
      totalOutputTokens: v.outputTokens,
    }))
    .sort((a, b) => b.calls - a.calls);

  const byTaskType: TaskTypeBreakdown[] = [...byTaskTypeMap.entries()]
    .map(([taskType, v]) => ({ taskType, calls: v.calls, totalCostUsd: v.cost }))
    .sort((a, b) => b.calls - a.calls);

  const dailyUsage: DailyUsage[] = [...dailyMap.entries()]
    .map(([date, v]) => ({ date, calls: v.calls, totalCostUsd: v.cost }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const recentFailures: RecentFailure[] = rows
    .filter((r) => !r.success)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      taskType: r.task_type,
      provider: r.provider,
      model: r.model,
      fallback: r.fallback,
      createdAt: r.created_at,
    }));

  const topExpensiveRequests: ExpensiveRequest[] = [...rows]
    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      taskType: r.task_type,
      provider: r.provider,
      model: r.model,
      costUsd: r.estimated_cost_usd,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      createdAt: r.created_at,
    }));

  return {
    usageRowsAnalyzed: totalCalls,
    usageRowsCapped: totalCalls === MAX_USAGE_ROWS,
    totals: {
      totalProjects,
      totalResearchers,
      totalCalls,
      totalCostUsd,
      successRate: totalCalls > 0 ? successCount / totalCalls : 0,
      fallbackRate: totalCalls > 0 ? fallbackCount / totalCalls : 0,
      measuredTokenRate: totalCalls > 0 ? measuredCount / totalCalls : 0,
    },
    projectsByStatus,
    byProvider,
    byTaskType,
    dailyUsage,
    recentFailures,
    topExpensiveRequests,
  };
}
