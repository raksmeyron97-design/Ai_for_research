import { vi } from "vitest";

/**
 * Minimal fake of the chainable supabase-js query builder, just enough to
 * drive the query shapes used in projects.ts/documents.ts (.select/.eq/
 * .order/.insert/.update/.delete, terminated by .single()/.maybeSingle()
 * or awaited directly). Not a Supabase reimplementation — just enough to
 * unit test our data-access code's own logic (payload construction, error
 * wrapping, rollback-on-failure) without a live database.
 */
export interface MockResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export class MockQueryBuilder implements PromiseLike<MockResult> {
  public calls: { method: string; args: unknown[] }[] = [];

  constructor(private result: MockResult) {}

  select(...args: unknown[]) {
    this.calls.push({ method: "select", args });
    return this;
  }
  eq(...args: unknown[]) {
    this.calls.push({ method: "eq", args });
    return this;
  }
  in(...args: unknown[]) {
    this.calls.push({ method: "in", args });
    return this;
  }
  order(...args: unknown[]) {
    this.calls.push({ method: "order", args });
    return this;
  }
  limit(...args: unknown[]) {
    this.calls.push({ method: "limit", args });
    return this;
  }
  insert(...args: unknown[]) {
    this.calls.push({ method: "insert", args });
    return this;
  }
  upsert(...args: unknown[]) {
    this.calls.push({ method: "upsert", args });
    return this;
  }
  update(...args: unknown[]) {
    this.calls.push({ method: "update", args });
    return this;
  }
  delete(...args: unknown[]) {
    this.calls.push({ method: "delete", args });
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then<TResult1 = MockResult, TResult2 = never>(
    onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

export function createSupabaseMock(options: {
  tableResults?: Record<string, MockResult>;
  rpcResult?: MockResult;
  storage?: {
    upload?: MockResult["error"];
    remove?: MockResult["error"];
    signedUrl?: { url?: string; error?: MockResult["error"] };
  };
}) {
  const fromCalls: { table: string; builder: MockQueryBuilder }[] = [];

  const from = vi.fn((table: string) => {
    const builder = new MockQueryBuilder(
      options.tableResults?.[table] ?? { data: null, error: null },
    );
    fromCalls.push({ table, builder });
    return builder;
  });

  const rpc = vi.fn((_fn: string, _args?: Record<string, unknown>) =>
    Promise.resolve(options.rpcResult ?? { data: null, error: null }),
  );

  const storageUpload = vi.fn(async (_path: string, _file: unknown, _opts?: unknown) => ({
    error: options.storage?.upload ?? null,
  }));
  const storageRemove = vi.fn(async (_paths: string[]) => ({ error: options.storage?.remove ?? null }));
  const storageSignedUrl = vi.fn(async (_path: string, _expiresIn: number) => ({
    data: options.storage?.signedUrl?.url ? { signedUrl: options.storage.signedUrl.url } : null,
    error: options.storage?.signedUrl?.error ?? null,
  }));

  const storage = {
    from: vi.fn(() => ({
      upload: storageUpload,
      remove: storageRemove,
      createSignedUrl: storageSignedUrl,
    })),
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from, storage, rpc } as any,
    fromCalls,
    rpc,
    storageUpload,
    storageRemove,
    storageSignedUrl,
  };
}
