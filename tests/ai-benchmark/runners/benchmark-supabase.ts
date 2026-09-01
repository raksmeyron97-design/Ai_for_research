import { allKnownCitationKeys } from "../fixtures/corpus";

/**
 * A stand-in for the request-scoped Supabase client that `AIOrchestrator`
 * expects, so the benchmark can drive the production path end to end without
 * a database.
 *
 * It is not a mock in the "make the test pass" sense — it is a fixture data
 * source. Two production behaviours depend on this client, and both are
 * things Phase 16B needs to measure rather than skip:
 *
 *  1. `integrity-guard.ts:verifyCitationsInText` looks up
 *     `research_citations` to decide which keys a response invented. Backing
 *     it with the benchmark corpus means the REAL verification code — F11's
 *     two-stage grammar included — runs against real model output.
 *  2. `token-manager.ts:recordUsage` writes to `ai_usage`. Capturing that row
 *     gives the benchmark the production-computed token counts, cost and
 *     `cost_confidence` rather than a parallel calculation that could quietly
 *     disagree with what the app would have billed.
 */
export interface CapturedUsageRow {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  tokens_measured: boolean;
  cost_confidence: string;
  latency_ms: number;
  success: boolean;
  fallback: boolean;
}

export interface BenchmarkSupabase {
  client: unknown;
  /** Every ai_usage row the orchestrator wrote during this scenario, in order. */
  usageRows: CapturedUsageRow[];
}

/**
 * `citationKeys` is the set of sources the fixture "project" owns. A response
 * citing anything outside it is, by construction, citing something that does
 * not exist — which is exactly what the citation evaluator needs to know.
 */
export function createBenchmarkSupabase(citationKeys?: Set<string>): BenchmarkSupabase {
  const known = citationKeys ?? allKnownCitationKeys();
  const usageRows: CapturedUsageRow[] = [];

  const client = {
    from(table: string) {
      if (table === "ai_usage") {
        return {
          insert: async (row: CapturedUsageRow) => {
            usageRows.push(row);
            return { error: null };
          },
        };
      }

      if (table === "research_citations") {
        return {
          select: () => ({
            eq: () => ({
              in: async (_column: string, keys: string[]) => ({
                data: keys.filter((k) => known.has(k)).map((citation_key) => ({ citation_key })),
                error: null,
              }),
            }),
          }),
        };
      }

      // Any other table would mean the orchestrator grew a dependency this
      // harness does not model. Fail loudly rather than returning empty data
      // that would look like a legitimate "nothing found".
      throw new Error(`BenchmarkSupabase: unexpected table "${table}" — update the harness stub`);
    },
  };

  return { client, usageRows };
}
