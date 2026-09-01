import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAdminEmail } from "../auth";

const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;

beforeEach(() => {
  process.env.ADMIN_EMAILS = "admin@example.com, Second.Admin@Example.com";
});

afterEach(() => {
  process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
});

describe("isAdminEmail", () => {
  it("allows an email in the allowlist", () => {
    expect(isAdminEmail("admin@example.com")).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    expect(isAdminEmail("ADMIN@EXAMPLE.COM")).toBe(true);
    expect(isAdminEmail("second.admin@example.com")).toBe(true);
  });

  it("tolerates whitespace around entries in the env var", () => {
    expect(isAdminEmail("second.admin@example.com")).toBe(true);
  });

  it("rejects an email not in the allowlist", () => {
    expect(isAdminEmail("researcher@example.com")).toBe(false);
  });

  it("rejects null/undefined without throwing", () => {
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("denies everyone when ADMIN_EMAILS is unset", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail("admin@example.com")).toBe(false);
  });
});
