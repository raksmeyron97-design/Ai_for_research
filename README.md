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
and Phase 6 (AI-generated questionnaires with enforced validated-
instrument safety — see
[`docs/AI_QUESTIONNAIRE_BUILDER.md`](./docs/AI_QUESTIONNAIRE_BUILDER.md))
are implemented. The auth/dashboard/editor golden path, RLS across every
table, and the questionnaire's safety constraint have all been verified
against a real local Supabase instance (Docker); the AI provider calls
themselves have not, since no real Gemini/OpenAI keys are available in
this build environment. Later phases (data analysis, export, admin
analytics) are not yet built — see the audit doc for the recommended
sequence.
