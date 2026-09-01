"use client";

import { useState } from "react";
import type { AdminAnalyticsSummary } from "@/lib/admin/analytics";

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-neutral-200 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

function DailyUsageChart({ dailyUsage }: { dailyUsage: AdminAnalyticsSummary["dailyUsage"] }) {
  if (dailyUsage.length === 0) {
    return <p className="text-sm text-neutral-500">No AI usage recorded yet.</p>;
  }
  const maxCalls = Math.max(...dailyUsage.map((d) => d.calls));
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {dailyUsage.map((d) => (
        <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.calls} calls, ${formatUsd(d.totalCostUsd)}`}>
          <div
            className="w-full rounded-t bg-neutral-800"
            style={{ height: `${Math.max(2, (d.calls / maxCalls) * 100)}px` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard({ initialSummary }: { initialSummary: AdminAnalyticsSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/analytics");
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? "Failed to refresh");
        return;
      }
      setSummary(await res.json());
    } catch {
      setError("Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Based on the {summary.usageRowsAnalyzed.toLocaleString()} most recent AI calls
          {summary.usageRowsCapped ? " (older activity not included — see docs)" : ""}.
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <SummaryCard label="Researchers" value={String(summary.totals.totalResearchers)} />
        <SummaryCard label="Projects" value={String(summary.totals.totalProjects)} />
        <SummaryCard label="AI Calls" value={summary.totals.totalCalls.toLocaleString()} />
        <SummaryCard
          label="Total Cost"
          value={formatUsd(summary.totals.authoritativeCostUsd)}
          hint={
            summary.totals.measuredTokenRate >= 0.99 && summary.totals.verifiedCostRate >= 0.99
              ? "Provider-reported tokens at verified rates, not billed"
              : `Covers only the ${formatPercent(
                  Math.min(summary.totals.measuredTokenRate, summary.totals.verifiedCostRate),
                )} of calls that are both measured and verifiably priced`
          }
        />
        <SummaryCard label="Success Rate" value={formatPercent(summary.totals.successRate)} />
        <SummaryCard label="Fallback Rate" value={formatPercent(summary.totals.fallbackRate)} />
      </section>

      {summary.totals.totalCalls > 0 &&
        (summary.totals.measuredTokenRate < 0.99 || summary.totals.verifiedCostRate < 0.99) && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            The cost total covers only calls that are both measured and verifiably priced.{" "}
            {formatPercent(1 - summary.totals.measuredTokenRate)} of analyzed calls have token counts estimated
            from text length rather than reported by the provider, and{" "}
            {formatPercent(1 - summary.totals.verifiedCostRate)} used a model with no verified rate on file, so
            they contribute nothing to the figure above rather than contributing a guess. Calls logged before
            Phase 16 are all in both categories.
          </p>
        )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Daily AI usage</h2>
        <DailyUsageChart dailyUsage={summary.dailyUsage} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Projects by status</h2>
        <div className="flex gap-4 text-sm">
          {Object.entries(summary.projectsByStatus).map(([status, count]) => (
            <div key={status} className="rounded border border-neutral-200 px-3 py-1.5">
              <span className="capitalize text-neutral-600">{status}</span>{" "}
              <span className="font-medium">{count}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">By provider</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
              <th className="py-1 pr-4">Provider</th>
              <th className="py-1 pr-4">Calls</th>
              <th className="py-1 pr-4">Cost</th>
              <th className="py-1 pr-4">Avg latency</th>
              <th className="py-1 pr-4">Success rate</th>
              <th className="py-1 pr-4">Input tokens</th>
              <th className="py-1 pr-4">Output tokens</th>
            </tr>
          </thead>
          <tbody>
            {summary.byProvider.map((p) => (
              <tr key={p.provider} className="border-b border-neutral-100">
                <td className="py-1.5 pr-4 capitalize">{p.provider}</td>
                <td className="py-1.5 pr-4">{p.calls}</td>
                <td className="py-1.5 pr-4">{formatUsd(p.totalCostUsd)}</td>
                <td className="py-1.5 pr-4">{Math.round(p.avgLatencyMs)}ms</td>
                <td className="py-1.5 pr-4">{formatPercent(p.successRate)}</td>
                <td className="py-1.5 pr-4">{p.totalInputTokens.toLocaleString()}</td>
                <td className="py-1.5 pr-4">{p.totalOutputTokens.toLocaleString()}</td>
              </tr>
            ))}
            {summary.byProvider.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-neutral-500">
                  No AI usage recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Most expensive individual requests</h2>
        {summary.topExpensiveRequests.length === 0 ? (
          <p className="text-sm text-neutral-500">No AI usage recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                <th className="py-1 pr-4">When</th>
                <th className="py-1 pr-4">Task</th>
                <th className="py-1 pr-4">Provider / Model</th>
                <th className="py-1 pr-4">Cost</th>
                <th className="py-1 pr-4">Tokens (in / out)</th>
              </tr>
            </thead>
            <tbody>
              {summary.topExpensiveRequests.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-4">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="py-1.5 pr-4">{r.taskType}</td>
                  <td className="py-1.5 pr-4">
                    {r.provider} / {r.model}
                  </td>
                  <td className="py-1.5 pr-4">{formatUsd(r.costUsd)}</td>
                  <td className="py-1.5 pr-4">
                    {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">By task type</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
              <th className="py-1 pr-4">Task</th>
              <th className="py-1 pr-4">Calls</th>
              <th className="py-1 pr-4">Cost</th>
            </tr>
          </thead>
          <tbody>
            {summary.byTaskType.map((t) => (
              <tr key={t.taskType} className="border-b border-neutral-100">
                <td className="py-1.5 pr-4">{t.taskType}</td>
                <td className="py-1.5 pr-4">{t.calls}</td>
                <td className="py-1.5 pr-4">{formatUsd(t.totalCostUsd)}</td>
              </tr>
            ))}
            {summary.byTaskType.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-neutral-500">
                  No AI usage recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Recent failures</h2>
        {summary.recentFailures.length === 0 ? (
          <p className="text-sm text-neutral-500">No failed AI calls in the analyzed window.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                <th className="py-1 pr-4">When</th>
                <th className="py-1 pr-4">Task</th>
                <th className="py-1 pr-4">Provider / Model</th>
                <th className="py-1 pr-4">Fallback attempted?</th>
              </tr>
            </thead>
            <tbody>
              {summary.recentFailures.map((f) => (
                <tr key={f.id} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-4">{new Date(f.createdAt).toLocaleString()}</td>
                  <td className="py-1.5 pr-4">{f.taskType}</td>
                  <td className="py-1.5 pr-4">
                    {f.provider} / {f.model}
                  </td>
                  <td className="py-1.5 pr-4">{f.fallback ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
