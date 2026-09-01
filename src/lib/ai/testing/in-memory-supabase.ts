import { randomUUID } from "node:crypto";

/**
 * A small stateful stand-in for the Supabase client, for offline workflow
 * tests (§22).
 *
 * `src/lib/db/__tests__/supabase-mock.ts` returns a scripted result per query
 * and is right for unit-testing one data-access function. It cannot back an
 * end-to-end workflow, where a section written in step three must be readable
 * in step seven. This keeps rows in memory instead, so the real db layer, the
 * real generators and the real guards run against data they themselves wrote.
 *
 * It models only the query shapes this codebase actually uses — select/eq/in/
 * order/limit/maybeSingle/single, insert, upsert — and throws on anything
 * else rather than returning empty data that would look like a legitimate
 * "nothing found" and quietly change what the code under test does.
 */
type Row = Record<string, unknown>;

interface Filter {
  column: string;
  kind: "eq" | "in";
  value: unknown;
}

export interface InMemorySupabase {
  client: unknown;
  tables: Record<string, Row[]>;
  seed(table: string, rows: Row[]): void;
  rows(table: string): Row[];
}

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private pending: Row[] | null = null;

  constructor(
    private readonly store: Record<string, Row[]>,
    private readonly table: string,
    private readonly onConflictKeys: string[] = [],
  ) {}

  private ensure(): Row[] {
    if (!this.store[this.table]) this.store[this.table] = [];
    return this.store[this.table];
  }

  private matching(): Row[] {
    let rows = [...this.ensure()];
    for (const f of this.filters) {
      rows = rows.filter((r) =>
        f.kind === "eq" ? r[f.column] === f.value : (f.value as unknown[]).includes(r[f.column]),
      );
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows.sort((a, b) => {
        const av = String(a[column] ?? "");
        const bv = String(b[column] ?? "");
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, kind: "eq", value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, kind: "in", value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  insert(input: Row | Row[]) {
    const rows = (Array.isArray(input) ? input : [input]).map((r) => this.stamp(r));
    this.ensure().push(...rows);
    this.pending = rows;
    return this;
  }

  upsert(input: Row) {
    const table = this.ensure();
    const existing = this.onConflictKeys.length
      ? table.find((r) => this.onConflictKeys.every((k) => r[k] === input[k]))
      : undefined;

    if (existing) {
      Object.assign(existing, input, { updated_at: new Date().toISOString() });
      this.pending = [existing];
    } else {
      const row = this.stamp(input);
      table.push(row);
      this.pending = [row];
    }
    return this;
  }

  update(patch: Row) {
    const rows = this.matching();
    for (const row of rows) Object.assign(row, patch, { updated_at: new Date().toISOString() });
    this.pending = rows;
    return this;
  }

  private stamp(row: Row): Row {
    const now = new Date().toISOString();
    return {
      id: row.id ?? randomUUID(),
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
      ...row,
    };
  }

  async maybeSingle() {
    const rows = this.pending ?? this.matching();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.pending ?? this.matching();
    if (rows.length === 0) {
      return { data: null, error: { message: "no rows returned", code: "PGRST116" } };
    }
    return { data: rows[0], error: null };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.pending ?? this.matching();
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

const UPSERT_KEYS: Record<string, string[]> = {
  research_sections: ["project_id", "section_type"],
  research_citations: ["project_id", "citation_key"],
};

export function createInMemorySupabase(seed: Record<string, Row[]> = {}): InMemorySupabase {
  const tables: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(seed)) tables[table] = rows.map((r) => ({ ...r }));

  const client = {
    from(table: string) {
      return new QueryBuilder(tables, table, UPSERT_KEYS[table] ?? []);
    },
    // Vector search is not modelled: a test needing retrieval should seed the
    // context directly rather than pretend to run an embedding search.
    rpc(name: string) {
      throw new Error(`InMemorySupabase: rpc("${name}") is not modelled — seed context explicitly instead`);
    },
  };

  return {
    client,
    tables,
    seed(table, rows) {
      tables[table] = [...(tables[table] ?? []), ...rows.map((r) => ({ ...r }))];
    },
    rows(table) {
      return tables[table] ?? [];
    },
  };
}
