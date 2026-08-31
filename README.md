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
npm run dev
```

## Documentation

See [`docs/`](./docs) — start with
[`AI_THESIS_ARCHITECTURE_AUDIT.md`](./docs/AI_THESIS_ARCHITECTURE_AUDIT.md)
for the current state of the project and what's implemented vs. planned.

## Status

Phase 0 (architecture) and Phase 1 (AI provider foundation: Gemini +
OpenAI abstraction, routing, task classification, token tracking, error
handling/fallback) are implemented. Later phases (research project data
model, document/RAG pipeline, questionnaire builder, data analysis,
export, admin analytics) are not yet built — see the audit doc for the
recommended sequence.
