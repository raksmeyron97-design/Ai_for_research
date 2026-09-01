# UI Architecture (Phase 4)

## Pages

```
/                                   → redirects to /dashboard (middleware gates it if unauthenticated)
/login, /signup                     → Supabase email/password auth (client components)
/auth/callback                      → email-confirmation redirect handler
/dashboard                          → project list + progress bars, "New Project"
/dashboard/new                      → create-project form
/projects/[projectId]               → the three-pane workspace
```

## Auth

Email/password via Supabase, not magic links — magic links need email
delivery configured on the Supabase project before anything is testable
locally; password auth works the moment a project exists. `middleware.ts`
+ `src/lib/supabase/middleware.ts`'s `updateSession()` refresh the
session cookie on every request (the standard `@supabase/ssr` pattern)
and redirect unauthenticated requests to `/login`, authenticated
requests away from `/login`/`/signup`.

### Real bugs, found only by hitting the app in a browser (and, later, a real database)

All passed `tsc`, `eslint`, and `next build` — worth remembering that a
clean build is not proof a page works, especially for anything touching
Supabase client construction or React effect timing.

Found without any backend configured (Phase 4, first pass):

1. **Middleware crashed on every single request**, including `/login`
   itself, when Supabase env vars are unset —
   `createServerClient(undefined!, undefined!, ...)` throws
   synchronously, and the original `updateSession()` didn't catch it.
   Since middleware runs before any route handler, this took down the
   *entire app*, not just Supabase-dependent pages. Fixed by wrapping
   client construction and `getUser()` each in their own try/catch,
   failing open (pass the request through unmodified) rather than 500ing
   — consistent with how every API route already handles a missing
   session gracefully.
2. **The login/signup forms hung on "Signing in…" forever** under the
   same missing-config condition. `createClient()` (browser variant)
   also throws synchronously, but the form's `handleSubmit` awaited
   `supabase.auth.signInWithPassword(...)` without a try/catch around
   the whole flow, so the thrown error became an unhandled promise
   rejection instead of reaching `setError()`/`setSubmitting(false)`.
   Fixed by wrapping the Supabase calls in try/catch in both forms. (A
   library-internal console warning about the same missing config still
   appears after the fix — cosmetic, unrelated to this app's own error
   handling, which now behaves correctly: error shown, button re-enabled.)

Found once a real local Supabase (Docker) became available and the
actual golden path — sign in as a real user, open a real project — was
run for the first time:

3. **`SectionEditor` fired an unnecessary (harmless but real) autosave
   on every mount**, confirmed by watching `research_sections.updated_at`
   change in the database on page load with no user edit. The guard was
   a `useRef(true)` "is this the first effect run" flag — which breaks
   under React Strict Mode's dev-only double-invocation of effects: the
   first invocation flips the ref to `false`, so the second invocation
   (still logically the same initial mount) reads `false` and schedules
   a save. Fixed by comparing `content`/`status` against the values
   captured at mount (`initialContentRef`/`initialStatusRef`) instead of
   counting effect invocations — correct regardless of how many times
   Strict Mode calls the effect, because it's a value comparison, not an
   execution-count flag. This class of bug specifically needs Strict
   Mode's double-invocation to surface; it would not show up under a
   naive "does the effect run once" mental model, which is exactly why
   watching a real database's `updated_at` column caught it and manual
   code review hadn't.

None of these four were visible from `npm run typecheck`/`lint`/`build`.
The first two needed a browser with no backend configured; the third
needed a real database to notice a write that "shouldn't" have happened.

## The three-pane workspace (`/projects/[projectId]`)

```
┌──────────────┬───────────────────────┬─────────────────────┐
│ Research     │ Section Editor        │ AI Copilot           │
│ Navigator    │                       │                      │
│              │ [section title]       │ [chat transcript]    │
│ ✓ Title      │ [status ▾] [Saved]    │                      │
│ ✓ Problem    │                       │ "Insert into X" per  │
│ ● Lit Review │ [textarea, autosave]  │ assistant message    │
│ ○ Methods    │                       │                      │
│ ...          │                       │ [message input]      │
└──────────────┴───────────────────────┴─────────────────────┘
```

- **`ResearchNavigator`** — the 18-section chain (`SECTION_CHAIN`,
  `src/lib/db/types.ts`) with ✓/●/○ status, click to switch section.
- **`SectionEditor`** — remounted (`key={sectionType}`) on every section
  switch rather than prop-synced, so its local editing state always
  starts clean from that section's saved content. Autosaves 800ms after
  the last keystroke via `PUT /api/research/projects/[id]/sections/[type]`.
- **`AICopilot`** — free-form chat, always `taskType: "chat"` in this
  pass (structured per-task actions like "Generate objectives" as
  dedicated buttons are not built yet — everything goes through the chat
  box). Streams `POST /api/ai/chat` via `res.body.getReader()`, appending
  decoded chunks to the last message. Each assistant reply gets an
  "Insert into [section]" link.
- **`DocumentsPanel`** — a slide-over (not a fourth pane, to stay
  faithful to the spec's three-pane design), upload form +
  extraction-status list, reusing Phase 3's upload endpoint as-is.

### Insert-into-editor, across a remounting component

`AICopilot`'s "Insert" button can't just reach into `SectionEditor`'s
local state — they're siblings, and `SectionEditor` remounts per
section. `ProjectWorkspace` holds one piece of bridge state,
`insertRequest: string | null`: `AICopilot.onInsert` sets it,
`SectionEditor` consumes it in a `useEffect` (appending to its local
content and triggering the same autosave path) and clears it via a
callback. This is the one place in the workspace where state is lifted
above the naturally-siblings component tree — everything else stays
local to whichever component owns it.

## Closing the Phase 3 gap: `buildContext()` is now actually called

`src/lib/ai/prepare-request.ts`'s `resolveRequestContext()` is the
missing piece flagged at the end of Phase 3: if a caller doesn't supply
`context` directly, it builds one via `ContextManager`, using
`sectionId` (validated against `SECTION_CHAIN` — an arbitrary string
doesn't silently become a section) as Layer 2, `message` as the Layer 3
retrieval query, and `documentIds`/`sourceIds`/`conversationId`
straight through. Both `/api/ai/chat` and `/api/ai/generate` call this
now, and both also gained an **explicit project-ownership check**
(`getProject()` returning `null` → 404) — the gap flagged since Phase 1
("RLS would stop it, but the route didn't check, so errors were
confusing rather than actually insecure").

## Conversation persistence

`/api/ai/chat` creates or reuses an `ai_conversations` row (client sends
`conversationId` once it has one, from the `X-Conversation-Id` response
header — a streaming `text/plain` body can't also carry JSON metadata,
so the id rides in a header instead), inserts the user's message before
streaming, and inserts the accumulated assistant message after the
stream closes. The assistant-message insert is best-effort (wrapped in
`.catch()` and swallowed) — losing the persisted transcript shouldn't
turn into a failure for a caller who already received the streamed
answer in full.

`conversationIdRef` lives only in the `AICopilot` component's state —
reloading the page starts a fresh conversation client-side even though
the old one is still in the database. Resuming a past conversation on
reload isn't built; `getRecentMessages()` (Phase 3) exists and could back
a "load history" feature, but nothing calls it from the UI yet.

## What's not built in Phase 4

- Structured per-task actions (Improve / Explain / Generate / Cite /
  Shorten / Expand from spec §23) — only free-form chat exists. Each
  would be a button that sets `taskType` to something other than
  `"chat"` and pre-fills a prompt.
- Resuming a previous conversation on page reload.
- Version history / undo for AI-inserted content (spec §42/§43) — Insert
  appends into the (still-autosaving) textarea; there's no separate
  "review before accepting" step or diff view.
- Citation insertion UI, evidence markers, comments (spec §41/§42).
- Any UI for `research_citations`, quality checks, questionnaire
  builder, data analysis — later phases.
- A proper 404/error page for `/projects/[projectId]` beyond Next's
  default `not-found` — `notFound()` is called correctly, just not
  themed.
- Component tests. This phase's new logic is almost entirely UI
  (React components) and was verified by running the dev server and
  interacting with it in a browser rather than by adding a
  testing-library/react setup — the one piece of new non-UI logic
  (`resolveRequestContext`) does have unit tests. Setting up component
  testing (jsdom environment, Testing Library) is a reasonable follow-up
  if the component layer grows much further, not done here to keep this
  phase's tooling footprint from ballooning.
- **Update**: a real local Supabase (Docker, via `supabase start`) became
  available after this phase's initial pass, and the golden path *was*
  then run for real: sign up → log in → land on the dashboard → open a
  real project → the three-pane workspace loads real section content →
  edit → autosave persists to the database (confirmed via direct SQL,
  which is also how the Strict Mode autosave bug above was caught). Two
  real bugs came out of that pass (see above) and are fixed. **Still not
  run**: the AI chat path itself (no real Gemini/OpenAI keys available in
  this environment, so `/api/ai/chat` still 503s), document upload
  end-to-end (extraction/embedding needs a real Gemini key too), and the
  email-confirmation signup flow (local dev auto-confirms, so that branch
  of `signup/page.tsx` — the "check your email" state — is unexercised).
  If real AI provider keys become available, that's the next gap to
  close, not a repeat of the auth/dashboard/editor path already verified.
