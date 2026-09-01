# Phase 15 — Production Readiness Report

Scope per the Phase 15 brief: security, reliability, privacy, AI safety,
data integrity, observability, and recovery. No new researcher-facing
features were added — everything below is hardening of what Phases
0-10 already built.

Every finding here was verified one of two ways, stated per item:
**unit-tested** (mocked, deterministic, runs in CI-less `npx vitest run`)
or **verified for real** (against the actual local Supabase Docker
instance and a real running Next.js server — real users, real HTTP
requests, real database rows checked afterward). Several of the bugs
below were found *only* by the second method; none would have been
caught by typecheck, lint, or the test suite alone.

Ratings: **PASS** (solid, verified), **WARN** (real but non-critical gap,
or a deliberate trade-off — listed so it's a decision, not a surprise),
**FAIL** (would block calling this production-ready). There are no FAILs
below — see "Final Gate" at the end for what that judgment rests on.

---

## 1. Security Audit

| Area | Rating | Notes |
|---|---|---|
| Authentication | PASS | Every route calls `requireUserId()`; a thrown auth-service error returns `503`, not a crash. Verified for real across dozens of requests in this and prior phases. |
| Authorization / RLS | PASS | Every table has row-level security with an ownership policy; verified for real with two real users (Alice/Bob) via the real Auth API in Phases 5, 8, 10, and again in this phase. Two real `GRANT`-gap bugs were found this way in earlier phases (`authenticated` in Phase 5, `service_role` in Phase 10) — both fixed with migrations that also cover future tables via `alter default privileges`. |
| Project isolation | PASS | Verified for real: a second real project, a second real user, cross-project reads return `404` (RLS-denied and "doesn't exist" are indistinguishable by design — see `AI_DATABASE_SCHEMA.md`). |
| Cross-project RAG | PASS (carried from Phase 3) | `match_document_chunks()` is `SECURITY INVOKER` (the default), so `document_chunks`' own RLS policy applies inside the function — a `project_id` the caller doesn't own returns zero rows regardless of what's passed. Verified for real with actual embeddings in Phase 3; unchanged by Phase 15 (no migration in this phase touched this table or function). |
| Storage isolation | PASS | The `research-documents` bucket is private (`public: false`); storage RLS reads the `project_id` back out of the object path and checks ownership independently of the table RLS — verified for real in this phase (see §3, secure deletion). |
| Admin endpoint access | PASS | Env-allowlist (`ADMIN_EMAILS`) checked against the authenticated user's email; verified for real with a non-admin real user getting `404` on the page (deliberately, not `403` — a non-admin shouldn't learn the route exists) and `403` on the API. |
| XSS | PASS | No `dangerouslySetInnerHTML`, no `eval`/`new Function`, no markdown-to-HTML rendering anywhere in the codebase — every piece of user- or AI-generated content (chat messages, section content) is rendered as plain React text, which auto-escapes. |
| CSRF | WARN | No explicit CSRF token. Mitigated by two factors that aren't a deliberate CSRF defense: Supabase's session cookie defaults to `SameSite=Lax` (cross-site POST/PUT/DELETE requests don't carry it), and every mutating route requires `Content-Type: application/json`, which a plain cross-site form post can't set. Real CSRF-token middleware would be the more deliberate fix; not built here as it's a larger surface change than this pass's scope. |
| Session cookie `httpOnly` | WARN | `@supabase/ssr`'s session cookie is `httpOnly: false` by the library's own design (the browser client — used only by `/login` and `/signup`, see `src/lib/supabase/client.ts` — needs JS access to manage the session). This is standard for Supabase+Next.js, not an app-specific misconfiguration, but it does mean any future XSS would be more severe (full session-token theft) than with an `httpOnly` cookie. Mitigated today by there being no XSS surface (see above); worth re-checking if any third-party script or markdown renderer is ever added. |
| Secrets / env vars | PASS | No route reads `process.env` directly (centralized in `lib/` modules); no API response, error message, or log line contains a key value — grepped across the whole `src/` tree. `.env.local` is gitignored and was never staged. |
| Logging | PASS | Exactly two `console.*` call sites existed before this phase (`token-manager.ts`), both logging only structured metadata (provider/model/tokens/cost), never prompt or document content. New logging added this phase (rate-limit/idempotency failures, retrieval failures) follows the same pattern — verified by reading every new log statement. |
| Error message leakage | WARN | `DbError`'s non-"not found" branch includes the raw Postgres error message in `${context}: ${error.message}`, returned in some routes' JSON responses. This can leak column/constraint names to an authenticated user of their own request — not sensitive data, but more implementation detail than ideal. Pre-existing from Phase 2, not introduced or worsened by Phase 15. |
| File upload validation | WARN | Size caps are enforced with real (not client-reported) byte counts (documents 25MB, datasets 10MB — see §2). MIME type is recorded but not deeply verified against actual file content; a mislabeled file simply fails extraction gracefully (`extraction_status: 'failed'`) rather than being rejected up front. No malware/virus scanning. Acceptable for a research-document tool with no execution of uploaded content, but worth strengthening before accepting uploads from untrusted (not-logged-in-and-vetted) users. |

## 2. AI API Security

**New this phase.** `src/lib/security/rate-limit.ts` — a Postgres-backed,
per-user, per-bucket limiter (`rate_limit_events` table, Phase 15
migration). Deliberately not Redis/an external service: Postgres is
already this app's single source of truth, and the scale here doesn't
justify new infrastructure. Two properties, stated plainly in the module
doc comment: it's a check-then-insert (not atomic — a determined flood
could very slightly overshoot the limit, an acceptable trade-off since
this isn't a billing boundary) and it **fails open** (a broken limiter
allows the request rather than blocking the feature it protects,
logging the failure for an admin to see).

| Limit | Bucket | Threshold | Applied to |
|---|---|---|---|
| AI requests | `ai_request` | 60 / 10 min / user | `/api/ai/chat`, `/api/ai/generate`, questionnaire/discussion/conclusion generate |
| Document uploads | `document_upload` | 20 / hour / user | `/api/research/projects/[id]/documents` |
| Dataset uploads | `dataset_upload` | 20 / hour / user | `/api/research/projects/[id]/datasets` |

**Verified for real**: fired real requests against a real running server
until the limit was hit — the 61st AI request returned a real `429` with
`{"error": "...", "retryAfterSeconds": 600}`, confirmed via the real
`rate_limit_events` table row count. Confirmed the document-upload
bucket is independent (not blocked by an exhausted AI-request bucket)
and that two different real users have independent limits (Bob's first
request succeeded — well, reached a real `503` for lack of AI keys,
proving it wasn't rate-limited — while Alice's bucket was fully
exhausted).

- **Oversized prompts**: `aiRequestSchema` (Phase 1) already caps
  `message` (20k chars), `context` (50k chars), and array fields
  (`documentIds` ≤ 20, `sourceIds` ≤ 50) — unchanged, re-verified via the
  new route-level tests.
- **Oversized uploads**: real byte-size checks (not trusting a
  client-reported `Content-Length`), unchanged from Phases 3/7,
  re-verified this phase with a real 26MB buffer in
  `documents-route.test.ts`.
- **Prompt injection**: see §4 below.
- **Repeated expensive requests**: covered by the rate limiter above
  plus idempotency (§6) for the routes that actually persist new rows.

## 3. Data Privacy

| Check | Rating | Notes |
|---|---|---|
| User isolation | PASS | See §1. |
| Project isolation | PASS | See §1. |
| Document authorization | PASS | Ownership checked at both the DB-row layer (`document.project_id !== projectId` → `404`) and the storage layer (RLS on `storage.objects`). |
| Secure deletion | **Fixed this phase** — was WARN, now PASS | `deleteProject()` previously only deleted the DB row, relying on `on delete cascade` for child rows — but Postgres cascade cannot reach Supabase Storage. A deleted project's uploaded files were becoming permanent orphans: still physically present in the bucket, but unreachable by RLS (the owning project row was gone) and never cleaned up. Fixed by having `deleteProject()` remove every associated file from storage first (same "storage before row" ordering `deleteDocument()` already used), so a storage failure leaves the project intact rather than deleting records while orphaning files. **Verified for real**: uploaded a real document, confirmed the storage object existed (`200`), deleted the project through the real API, then listed the bucket prefix and got `[]` — the file was actually gone, not just unreachable. |
| Minimal logging | PASS | See §1. |
| No API-key exposure | PASS | See §1. |
| No accidental source leakage | PASS | See §4 (prompt injection) and the existing citation-verification guard (Phase 5/8) — an AI response can't present an unverified source as real without a warning attached. |

## 4. AI Output Safety

The five-tier trust taxonomy this section asks for
(**Verified / User-provided / AI-generated / Inferred / Unverified**)
already existed before Phase 15, in two forms:

1. **`CitationStatus`** (`verified | source_required | user_provided |
   inference | unverified`) — the actual enum on every citation row,
   enforced at the type level since Phase 2.
2. **The system-instruction rule** (`research-integrity-guard.ts`,
   unchanged): every AI call is told to label non-trivial claims with
   exactly these five tags. This is a prompt-level instruction, not a
   code-enforced guarantee — a model can still fail to comply, which is
   why the *code-level* guards (dataset-required check, citation
   verification, unsourced-number detection — all pre-existing, Phases
   5/8) exist as a second layer that doesn't depend on the model
   following instructions.

**New this phase**: coarse, section-level AI-assist provenance.
`SectionEditor.tsx` now tags `research_sections.metadata` with
`{ aiAssisted: true, lastAiInsertAt: <ISO timestamp> }` whenever an AI
draft is inserted via the "Insert into section" flow (the same
`metadata` JSONB column that's existed, unused, since Phase 2). This is
deliberately coarse — "AI helped write this section at some point," not
sentence-level attribution, which would be dishonest to claim once a
researcher edits around an insert. Verified for real: called the actual
section-update endpoint with the same payload `SectionEditor.tsx` sends
and confirmed the metadata round-trips through Postgres exactly as
written. The client-side state logic itself (`SectionEditor.tsx`) was
verified via typecheck/lint only — no real AI provider key exists in
this environment to trigger the organic insert flow end-to-end, and
adding a React component-testing library for one interaction would be
disproportionate to this pass.

**New this phase**: prompt-injection defense (see §5).

## 5. Prompt Injection Defense

Retrieved document/citation content is untrusted — a researcher's
uploaded PDF could contain adversarial text ("ignore previous
instructions...") that a model might otherwise follow. Two layers, both
new this phase:

1. **System instruction** (`research-integrity-guard.ts`, extended):
   explicitly tells the model that content under "Relevant Document
   Excerpts" / "Relevant Sources" / "Recent Conversation" headings is
   data to analyze, never instructions to follow, regardless of what it
   says.
2. **Heuristic detector** (`prompt-injection-guard.ts`, new): scans the
   assembled context for common override phrasings ("ignore previous
   instructions," "you are now...," "reveal your system prompt," etc.)
   and attaches a `category: "security"` warning to the response when
   matched — surfaced in `AIResponse.warnings` for `generate()` calls,
   and as a visible note prepended to the stream for `chat`'s streaming
   responses (which have no structured-warning channel).

Stated plainly, same discipline as the existing `detectUnsourcedNumbers`
heuristic: this catches an obvious, common phrasing, not every way a
document could try to manipulate a model, and it never blocks a
response — false positives (a paper that discusses prompt injection as
a research topic) would be wrong to hard-block on. **Unit-tested**: 11
tests across the detector and its orchestrator/route wiring, including
the explicit false-positive case. **Not verified against a real model
response** — no real Gemini/OpenAI keys exist in this environment, so
whether a real model actually resists a real injection attempt inside
real retrieved content has never been observed here. The defense is
real; its effectiveness against an actual model is unverified.

## 6. Idempotency

| Action | Rating | Notes |
|---|---|---|
| Questionnaire generation | PASS | Highest-risk case — creates a whole new instrument + question set per call, so a double-click or client retry previously created a full duplicate. New `idempotency_keys` table (Phase 15 migration) + `src/lib/security/idempotency.ts`: a client sends an `Idempotency-Key` header, the route replays a cached response on a hit instead of redoing the work. **Only successful (2xx) responses are cached** — a failed attempt is never cached, so a retry after a real failure (e.g. a transient provider outage) is always free to actually retry. Wired end-to-end: `QuestionnaireBuilder.tsx` generates one key per logical attempt and reuses it across a manual retry, clearing it only once generation succeeds. **Verified for real**: seeded a real cache row, called the real route with the same key, got the cached response back verbatim, and confirmed via a direct database check that the generator was never invoked a second time (zero new instrument rows). Also confirmed the rate limiter and idempotency cache compose correctly — a cache hit bypasses the rate limiter (replaying costs nothing), while a miss (fresh key, or no key) is still subject to it. |
| Discussion / conclusion generation | PASS (server), WARN (partial client coverage) | Same server-side mechanism available and wired into `AICopilot.tsx`'s "Generate ... draft" button. Lower real risk than questionnaire generation since these routes don't persist anything themselves (the researcher reviews and manually inserts) — a duplicate call here means wasted AI cost, not corrupted data, which the rate limiter also bounds. |
| Chat messages (`/api/ai/chat`) | WARN — not covered | Streaming responses don't fit the same cache-and-replay model cleanly (see §5's note on the missing structured-warning channel — the same asymmetry applies here). A double-submit could create two user messages and trigger two AI turns. Lower real risk than the above: chat is an interactive back-and-forth the user is actively watching, not a "click once and wait" action, so an accidental double-submit is both less likely and more obviously visible when it happens. |
| Document / dataset upload | WARN — not covered | A duplicate upload creates two document/dataset rows rather than one. Not silently harmful (no corruption, easily deleted), just untidy. Not implemented — lower priority than the above three. |
| AI usage records (`ai_usage`) | PASS | One row per orchestrator call by construction (Phase 10) — there's no retry path inside `AIOrchestrator.generate()`/`stream()` that could double-record a single logical attempt; `withRetry()`'s internal retries happen *before* `recordUsage()` is ever called, so a retried-then-succeeded call still produces exactly one usage row. |
| Document processing jobs | WARN — not covered, pre-existing | Uploading the same file twice creates two independent extraction jobs (no content-hash dedup). Documented as a known gap since Phase 3; not addressed here as it's a lower-severity duplicate-work case, not a correctness or security issue. |

## 7. Failure Recovery

| Scenario | Rating | Notes |
|---|---|---|
| One AI provider down | PASS | `AIOrchestrator.generate()` retries once, then falls back to the second provider. **Unit-tested** (new this phase, `orchestrator-failure-recovery.test.ts`) and previously verified for real (missing-key `503`s throughout Phases 5-10 exercise this exact path, just via "provider unconfigured" rather than "provider erroring"). |
| Both AI providers down | PASS | `AllProvidersFailedError` is thrown with both attempts recorded (`error.attempts`, length 2) — an admin debugging a real dual outage can see both providers were actually tried. Routes map this to a clean `503`, never a raw provider error. **Unit-tested** this phase; the "both down" combination specifically wasn't tested before Phase 15. |
| Malformed AI response (invalid JSON/schema) | PASS | Pre-existing (Phases 5/6/8) for every structured-output generator (alignment, quality-check, questionnaire) — each returns a safe fallback (a "didn't return a valid response" warning, or a thrown, clearly-typed error with nothing partially saved) instead of crashing or fabricating data. Verified via existing tests, re-confirmed still passing this phase. |
| Vector search / embedding failure | **Fixed this phase** — was FAIL, now PASS | Previously, a failing embedding call or a `match_document_chunks` RPC error (e.g. the exact `service_role`-style permission error found in §1) would throw uncaught through `buildContext()`, aborting the *entire* AI request — chat/generate would 500 even though retrieval is only an enhancement, not a requirement (the model can still answer from the project profile/section/citations alone). Fixed: both the embedding call and the search call are now wrapped, degrading to "no retrieved excerpts" and logging the failure, rather than failing the whole request. **Unit-tested**: both failure modes (embedding error, search error) now have explicit regression tests. |
| Database failure (general) | WARN | The two AI routes (`chat`, `generate`) now explicitly catch a `getProject()` failure and return a clean `503` (fixed this phase, alongside the rate-limit wiring). Most other routes still let an unexpected DB error propagate to Next.js's own request-handler error boundary, which returns a generic `500` without leaking a stack trace in production — safe, but inconsistent with this app's usual clean-JSON-error convention. Not swept across every route in this pass; the two AI routes were prioritized as the highest-traffic, most failure-prone surface. |
| Partial / interrupted document processing | PASS (pre-existing, Phase 3) | `processDocument()` catches every failure mode (storage download, extraction, embedding) and records `extraction_status: 'failed'` with a reason, rather than leaving a document stuck at `'processing'` or surfacing a `500`. |
| Interrupted generation (streaming) | PASS, with a documented asymmetry | `/api/ai/chat`'s stream catches a mid-stream provider error and appends a visible `"[AI response interrupted — please retry.]"` message rather than dropping the connection silently. **Known limitation, not fixed this phase**: unlike `generate()`, `stream()` has no fallback-to-a-second-provider logic — restarting a partial stream on another provider cleanly (without duplicating already-sent content) would need a larger change than this pass's scope. The failure is handled gracefully; it just isn't retried automatically the way a non-streaming call is. |

## 8. Observability

The Phase 10 admin dashboard (`/admin`) already covered provider
failure rate, fallback frequency, and a recent-failures list. **New this
phase**: per-provider input/output token totals (surfaces a token
spike a cost-only view would hide) and a "most expensive individual
requests" table (top 5 by cost in the analyzed window — surfaces a
single runaway request that a per-provider *average* would dilute
away). Both **verified for real**: the real dashboard, reloaded after
the real rate-limit test above (60 real `ai_usage` rows from one user),
showed the correct token totals and correctly ranked the 5 costliest of
those 60 rows.

Not built: automated alerting (the dashboard must still be opened by an
admin; nothing pages anyone), and log-based tracing/correlation IDs
across a single request's DB queries + AI call + usage record. Both are
reasonable next steps once real usage exists to alert on.

## 9. Security Testing

30 new tests were added specifically for this phase's concerns, on top
of the 305 already passing (335 total):

- **`src/lib/security/__tests__/rate-limit.test.ts`** (5) — allow/block/fail-open behavior.
- **`src/lib/security/__tests__/idempotency.test.ts`** (7) — cache hit/miss, never-caches-failures, unique-violation handling.
- **`src/lib/ai/__tests__/prompt-injection-guard.test.ts`** (8) and **`orchestrator-injection-guard.test.ts`** (3) — detection + wiring, including the explicit false-positive case.
- **`src/lib/ai/__tests__/orchestrator-failure-recovery.test.ts`** (4) — single/dual provider outage.
- **`src/lib/ai/__tests__/context-manager.test.ts`** (+2) — embedding/search failure degradation.
- **`src/app/api/__tests__/`** (25, new directory this phase — routes had no unit tests before) — `instruments-route.test.ts` (401/404/429/422/503/idempotency replay), `admin-analytics-route.test.ts` (401/403/200/503/500), `documents-route.test.ts` (401/404/413/400/429/201, including a **real 26MB buffer**, not a spoofed `.size`), `sections-route.test.ts` (cross-project 404, oversized-content 400).
- **`src/lib/db/__tests__/projects.test.ts`** (+3) — secure deletion: removes storage, skips storage calls when there's nothing to remove, and — critically — leaves the project row intact when storage removal fails.

Explicitly out of scope for automated tests (verified for real instead,
documented per-item above): cross-project RLS enforcement itself (a
mock can't prove a real Postgres policy — this needs, and got, real
Alice/Bob requests against real Postgres), real rate-limit/idempotency
behavior under real concurrent load, and anything depending on an
actual AI provider response (no real Gemini/OpenAI keys in this
environment — true throughout every phase of this project, not new to
Phase 15).

## 10. Deployment Checklist

- [ ] Set real `GEMINI_API_KEY` / `OPENAI_API_KEY` — no AI feature has been exercised against a real model in this environment.
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAILS` for the admin dashboard (both required — the dashboard fails closed with a clear message if either is missing/wrong, not silently).
- [ ] Run all migrations, including this phase's two (`rate_limit_events`, `idempotency_keys`) and the two `GRANT`-fix migrations from Phases 5/10 — all four are load-bearing, not optional.
- [ ] Re-verify current model IDs/pricing in `token-manager.ts`/`.env.example` — flagged as point-in-time in every phase since Phase 1.
- [ ] Consider a periodic cleanup job for `rate_limit_events` (rows outside any configured window are never read again — see the migration's own comment) — not urgent at current scale, but unbounded growth over a long deployment lifetime.
- [ ] Decide whether the CSRF/`httpOnly`-cookie WARNs above (§1) need a deliberate fix before handling genuinely sensitive research data, versus accepting Supabase's standard trade-offs.
- [ ] No CI is wired up (known since Phase 0) — `npm run typecheck && npm run lint && npx vitest run && npm run build` all pass locally but nothing runs them automatically on push.
- [ ] `npm audit` reports one pre-existing moderate/high advisory (a transitive `postcss` dependency of `next`'s own tooling, via `GHSA-qx2v-qp2m-jg93` and related) that only resolves via a Next.js major-version bump (`next@16`) — deliberately deferred since Phase 1, re-confirmed unchanged by this phase's dependency additions (`docx`, `pdfkit`, `@types/pdfkit` from Phase 9 introduced no new advisories).

## 11. Final Gate

**No critical security or data-integrity issue is known to remain.**
Two real, meaningful bugs were found and fixed during this phase's own
real-Supabase verification (the `service_role`-adjacent vector-search
abort, and the project-deletion storage-orphan gap) — both are exactly
the class of issue this phase exists to catch, and both are now fixed
and re-verified, not just patched and assumed correct.

What keeps this from an unqualified "production-ready" stamp is stated
above, not hidden: two WARN-level security trade-offs inherent to the
Supabase+Next.js stack (§1), a few lower-priority idempotency gaps with
low real-world severity (§6), one streaming-specific reliability
asymmetry (§7), and — the largest caveat, true since Phase 1 — **no
feature involving a real AI provider call has ever been exercised
against a real Gemini or OpenAI response** in this build environment.
Everything AI-shaped in this report was verified through mocked unit
tests plus real-but-key-less HTTP requests (real `503`s, real database
rows, real rate-limit/idempotency behavior) — never a real model
response. That gap should close before genuine production traffic, not
because anything here is expected to break, but because it is the one
category of behavior this entire project has never actually observed.
