# AI Thesis & Research Assistant

A structured research workflow system (not a generic chatbot) that helps
students and researchers design, write, organize, analyze, verify, and
export academic research documents — keeping Title → Problem → Objectives →
Methodology → ... → References aligned as the project evolves.

Stack: Next.js (App Router, TypeScript) + Supabase (auth/DB/storage) +
Gemini & OpenAI (multi-provider AI).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + AI provider keys
```

Then apply the database schema — see
[`docs/AI_DATABASE_SCHEMA.md`](./docs/AI_DATABASE_SCHEMA.md) for the
Supabase CLI and manual (dashboard SQL Editor) options. If you have
Docker, `supabase start` (then `supabase db reset` after adding new
migrations) runs the whole stack locally for free (no hosted project
needed) — see the same doc's "RLS verification" section for how that was
used to catch several real bugs during development. Then:

```bash
npm run dev
```

## Documentation

See [`docs/`](./docs) — start with
[`AI_THESIS_ARCHITECTURE_AUDIT.md`](./docs/AI_THESIS_ARCHITECTURE_AUDIT.md)
for the current state of the project and what's implemented vs. planned.

## Status

Phase 0 (architecture), Phase 1 (AI provider foundation), Phase 2
(Supabase schema, RLS, data access layer), Phase 3 (document upload,
extraction, chunking, embeddings, pgvector retrieval — see
[`docs/AI_RAG_ARCHITECTURE.md`](./docs/AI_RAG_ARCHITECTURE.md)), Phase 4
(auth, project dashboard, the three-pane AI Copilot workspace — see
[`docs/AI_UI_ARCHITECTURE.md`](./docs/AI_UI_ARCHITECTURE.md)), Phase 5
(alignment engine, quality checker, structured AI output, a
code-enforced integrity guard — see
[`docs/AI_RESEARCH_INTELLIGENCE.md`](./docs/AI_RESEARCH_INTELLIGENCE.md)),
Phase 6 (AI-generated questionnaires with enforced validated-
instrument safety — see
[`docs/AI_QUESTIONNAIRE_BUILDER.md`](./docs/AI_QUESTIONNAIRE_BUILDER.md)),
Phase 7 (dataset upload/parsing, real computed statistics the model
never touches, a statistical-test guard — see
[`docs/AI_DATA_ANALYSIS.md`](./docs/AI_DATA_ANALYSIS.md)), Phase 8
(Discussion/Conclusion generators with hard guards against discussing or
concluding from findings that don't exist yet — see
[`docs/AI_DISCUSSION_CONCLUSION.md`](./docs/AI_DISCUSSION_CONCLUSION.md)),
Phase 9 (DOCX/PDF/Markdown export of the full research chain, with a
reference list built from real saved citations and a full questionnaire-
instrument appendix — see
[`docs/AI_DOCUMENT_EXPORT.md`](./docs/AI_DOCUMENT_EXPORT.md)), and
Phase 10 (an admin analytics dashboard at `/admin` covering AI usage,
cost, and project activity across every researcher — see
[`docs/AI_ADMIN_ANALYTICS.md`](./docs/AI_ADMIN_ANALYTICS.md)) implement
every phase in the original spec sequence. Phase 15 (production
security/reliability hardening — rate limiting, idempotency,
prompt-injection defense, and two real bugs found and fixed by loading
real pages against a real local Supabase instance — see
[`docs/PHASE_15_PRODUCTION_READINESS.md`](./docs/PHASE_15_PRODUCTION_READINESS.md)
for a full PASS/WARN/FAIL breakdown) hardens all of the above without
adding new researcher-facing features. The auth/dashboard/editor golden
path, RLS and storage isolation across every table, every phase's
data-integrity constraints, every export format, rate limiting,
idempotency, and secure project deletion have all been verified against
a real local Supabase instance (Docker) and a real running server; the
AI provider calls themselves have not, since no real Gemini/OpenAI keys
are available in this build environment — see the readiness report's
"Final Gate" section for what that means and doesn't mean for
production use.
