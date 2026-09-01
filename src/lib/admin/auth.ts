function readAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Minimal allowlist-based admin check: a comma-separated `ADMIN_EMAILS` env
 * var, checked against the authenticated user's email. No roles table or
 * RLS changes — the schema/policy surface a real roles system would need
 * isn't worth it for the single admin-only surface (the analytics
 * dashboard) that exists so far. Revisit if a second admin-gated feature
 * shows up.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return readAdminEmails().has(email.toLowerCase());
}
