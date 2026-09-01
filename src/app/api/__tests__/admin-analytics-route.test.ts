import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

const adminAuthMock = vi.hoisted(() => ({ isAdminEmail: vi.fn() }));
vi.mock("@/lib/admin/auth", () => adminAuthMock);

const adminClientMock = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminClientMock);

const analyticsMock = vi.hoisted(() => ({
  compileAdminAnalytics: vi.fn(),
  AdminAnalyticsError: class AdminAnalyticsError extends Error {},
}));
vi.mock("@/lib/admin/analytics", () => analyticsMock);

const { GET } = await import("../admin/analytics/route");

function fakeAuthedSupabase(user: { email: string } | null) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/analytics — security", () => {
  it("returns 401 when there is no authenticated user at all", async () => {
    authMock.createClient.mockResolvedValue(fakeAuthedSupabase(null));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(adminAuthMock.isAdminEmail).not.toHaveBeenCalled();
  });

  it("returns 403 for a real, logged-in, non-admin user — never leaks data to a regular researcher", async () => {
    authMock.createClient.mockResolvedValue(fakeAuthedSupabase({ email: "researcher@example.com" }));
    adminAuthMock.isAdminEmail.mockReturnValue(false);

    const res = await GET();
    expect(res.status).toBe(403);
    expect(adminClientMock.createAdminClient).not.toHaveBeenCalled();
    expect(analyticsMock.compileAdminAnalytics).not.toHaveBeenCalled();
  });

  it("returns 200 with the compiled summary for an allowlisted admin", async () => {
    authMock.createClient.mockResolvedValue(fakeAuthedSupabase({ email: "admin@example.com" }));
    adminAuthMock.isAdminEmail.mockReturnValue(true);
    adminClientMock.createAdminClient.mockReturnValue({});
    analyticsMock.compileAdminAnalytics.mockResolvedValue({ totals: { totalProjects: 3 } });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.totalProjects).toBe(3);
  });

  it("returns 503, not a raw crash, when the service-role key isn't configured", async () => {
    authMock.createClient.mockResolvedValue(fakeAuthedSupabase({ email: "admin@example.com" }));
    adminAuthMock.isAdminEmail.mockReturnValue(true);
    adminClientMock.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
    });

    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns 500 with the AdminAnalyticsError's message, not a raw stack trace, on a query failure", async () => {
    authMock.createClient.mockResolvedValue(fakeAuthedSupabase({ email: "admin@example.com" }));
    adminAuthMock.isAdminEmail.mockReturnValue(true);
    adminClientMock.createAdminClient.mockReturnValue({});
    analyticsMock.compileAdminAnalytics.mockRejectedValue(
      new analyticsMock.AdminAnalyticsError("Failed to count projects: permission denied"),
    );

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("permission denied");
  });
});
