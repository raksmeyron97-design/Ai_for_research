# Document & RAG Architecture (Phase 3)

## Pipeline

```
POST /api/research/projects/[projectId]/documents (multipart upload)
  → uploadDocument()          [Phase 2: Storage upload + research_documents row]
  → processDocument()         [src/lib/documents/process.ts]
      → download from Storage
      → extractText()          [src/lib/documents/extract.ts — PDF/DOCX/XLSX/TXT/CSV]
      → chunkText()             [src/lib/documents/chunk.ts]
      → embedTexts()            [src/lib/ai/embeddings.ts — Gemini]
      → insertChunks()          [src/lib/db/chunks.ts → document_chunks, pgvector]
      → research_documents.extraction_status = 'completed' | 'failed'
```

Later, when a research task needs document context:

```
buildContext()                  [src/lib/ai/context-manager.ts]
  → embedQuery()                 [same embeddings.ts, taskType RETRIEVAL_QUERY]
  → searchChunks()                [match_document_chunks() RPC, pgvector cosine search]
  → assembled into AIRequest.context, alongside project profile / section / sources / recent turns
  → AIOrchestrator.generate()     [Phase 1 — unchanged]
```

## Processing is synchronous — a real tradeoff, not an oversight

`processDocument()` runs inline inside the upload route (`POST
/api/research/projects/[projectId]/documents`), not as a background job.
That means:

- A large PDF makes the HTTP response slow (extraction + embedding all
  happen before the route returns), rather than the route returning
  immediately with a "pending" document that finishes later.
- There's no retry queue — if the process crashes mid-request, the
  document is left at `extraction_status = 'processing'` rather than
  cleanly `'failed'`.

This is acceptable for now because there's no background job
infrastructure in the app yet (no queue, no worker process, no webhook
callback target). Building one is real infrastructure work, not a small
addition — it's a reasonable Phase 4+ investment once upload volume
actually demands it, not before. If a document gets stuck at
`'processing'` (e.g. a crashed request), it can be reprocessed by calling
`processDocument()` again — the function deletes old chunks before
inserting new ones, so re-running is always safe. There's no route wired
up for manual reprocessing yet; add one if this comes up in practice.

## Text extraction (`src/lib/documents/extract.ts`)

| Type | Library | Why |
|---|---|---|
| PDF | `pdf-parse` v2 (class-based `PDFParse` API) | Actively maintained; verified against the installed package's own `.d.ts` rather than assumed from memory — its API changed significantly between v1 and v2. |
| DOCX | `mammoth` | `extractRawText()` — long-standing stable API. |
| XLSX | `exceljs` | **Not `xlsx` (SheetJS)** — see below. |
| TXT / CSV / MD | none | Read as UTF-8 directly; CSV is already text, and deep tabular parsing is Phase 7's job (data analysis), not RAG's. |

### Why `exceljs`, not `xlsx`

`xlsx`'s npm-published releases have two long-standing, still-unfixed
advisories (prototype pollution, ReDoS —
[GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)).
SheetJS ships patched builds from their own CDN instead of npm, for
reasons unrelated to this project — but this app parses **arbitrary
user-uploaded spreadsheets**, which is exactly the attack surface those
advisories describe. Pulling a non-npm-registry dependency adds its own
supply-chain complexity, so `exceljs` (no equivalent open advisories) was
used instead. If `xlsx`/SheetJS is ever needed for a feature this doesn't
cover, get the patched build from cdn.sheetjs.com, not `npm install
xlsx`.

`exceljs`'s own type definitions declare an ambient global `interface
Buffer extends ArrayBuffer {}` that merges with (and corrupts) the real
Node `Buffer` type against current `@types/node` — a known upstream
typing defect. `extract.ts`'s `workbook.xlsx.load(buffer as any)` works
around it; the runtime value is a real Node `Buffer` regardless of what
the merged type says.

### `serverExternalPackages`

`pdf-parse` (via its `pdfjs-dist` dependency), `mammoth`, and `exceljs`
are all listed in `next.config.ts`'s `serverExternalPackages`. Without
this, `pdf-parse` fails at runtime under Next's RSC webpack bundling with
`TypeError: Object.defineProperty called on non-object` — caught by
actually hitting the route in a browser, not by `tsc`/`eslint`/`next
build`, all of which passed while this was still broken. If a new
Node-native library is added to this pipeline and a route using it
throws a similar bundling error, check this list first.

## Chunking (`src/lib/documents/chunk.ts`)

Paragraph-aware sliding window: pack whole paragraphs up to `maxChars`
(default 2000), with `overlapChars` (default 200) of trailing context
repeated at the start of the next chunk so a fact split across a
boundary is still retrievable from either chunk. A paragraph that alone
exceeds `maxChars` falls back to sentence-boundary splitting, then a hard
character split as a last resort for a "sentence" with no punctuation at
all.

This is the standard baseline RAG chunking strategy — no semantic/
embedding-based splitting, which would be a bigger investment for a
marginal quality gain at this stage.

## Embeddings (`src/lib/ai/embeddings.ts`)

Gemini's `models.embedContent`, model `GEMINI_EMBEDDING_MODEL` (default
`gemini-embedding-001`), truncated to `GEMINI_EMBEDDING_DIMENSIONS`
(default 768, via Matryoshka-style `outputDimensionality` — the model
supports up to 3072, but 768 keeps the pgvector index smaller and faster
for a marginal quality cost). Not routed through `AIOrchestrator`/
`TaskClassifier` — embeddings aren't a chat/generation task with a
complexity tier, so a small dedicated module is simpler than forcing
them through the tiered-routing abstraction built for `generate()`/
`stream()`.

Verified against the actually-installed `@google/genai` package's
`.d.ts` (`contents` is plural/array, response is `{ embeddings:
ContentEmbedding[] }` with `.values`), not assumed from documentation —
search results for this API were inconsistent across sources (older
examples show a different singular `content`/`embedding` shape from an
earlier API generation).

## Storage (`supabase/migrations/*_phase3_document_chunks.sql`)

`document_chunks` — one row per chunk, `embedding vector(768)`, HNSW
index (`vector_cosine_ops`) for approximate nearest-neighbor search.
`project_id` is denormalized onto the row (not just reachable via
`research_documents`) for the same reason as `ai_conversations.user_id`
in Phase 2: RLS and retrieval both filter by project, never need a
second join.

`match_document_chunks(query_embedding, match_project_id, match_count)`
is a `SECURITY INVOKER` (the default — explicitly not `SECURITY
DEFINER`) SQL function, called via `supabase.rpc()` since supabase-js's
fluent query builder has no vector-distance operator. Being `SECURITY
INVOKER` means it runs as the calling user, so `document_chunks`' RLS
policy still applies inside it — a `project_id` the caller doesn't own
returns zero rows, not an error, same as a direct `SELECT` would.

## Retrieval & context assembly (`src/lib/ai/context-manager.ts`)

`buildContext()` implements the layered context from spec §10:

1. **Project profile** (always included, never pruned) — title,
   language, discipline, study design, population, location, sample
   size, sampling method, status.
2. **Current section** — the `research_sections` row for the given
   `sectionType`, if any.
3. **Retrieved document excerpts** — only runs if a `query` is given
   (typically the user's message); embeds it, calls
   `match_document_chunks`, optionally post-filters to specific
   `documentIds`.
4. **Requested sources** — specific `research_citations` rows by id, not
   a search.
5. **Recent conversation** — the last 6 messages from a given
   `ai_conversations` id, formatted as plain turns. This is a pragmatic
   stand-in for the spec's "conversation memory," not true
   summarization — an LLM call to compress older history into a summary
   would cost tokens itself and is a further optimization, not
   implemented here. Revisit if usage patterns show recent-turns alone
   isn't enough.

**Pruning** (`assembleAndPrune`): if the assembled context exceeds
`AI_MAX_CONTEXT_TOKENS`, layers are dropped in this order — recent
conversation first, then retrieved excerpts one at a time (already
similarity-ordered, so the least-relevant chunk goes first, not the
whole layer at once), then sources, then the current section. The
project profile is never dropped. This is a real safeguard against an
unbounded context, not a token-optimal packer — a finer-grained version
would score each chunk's relevance against its token cost individually
rather than pruning by fixed layer priority.

`buildContext()` is a caller-side helper, not something
`AIOrchestrator` calls itself — the orchestrator still has no DB client
(a Phase 1 scoping decision that's still true), so whatever calls
`AIOrchestrator.generate()` builds context first and passes the string
into `AIRequest.context`. No route in this codebase does that wiring yet
— `/api/ai/generate` and `/api/ai/chat` still take a `context` string
directly from the request body; connecting them to `buildContext()` is
Phase 4 (AI Copilot UI) work, once there's a real caller that knows which
`sectionType`/`query`/`conversationId` to pass.

## What's not built in Phase 3

- Background job processing for uploads (see above).
- Reprocessing/re-embedding UI or endpoint (the function is idempotent
  and safe to re-run, but nothing calls it after the initial upload).
- Wiring `/api/ai/*` to `buildContext()` — Phase 4.
- True conversation summarization (vs. the recent-turns stand-in above).
- OCR for scanned/image-only PDFs — `pdf-parse` extracts embedded text
  only; a scanned PDF with no text layer will extract as empty/near-empty
  text and produce zero or near-zero chunks, not an error.
- Citation *validation* — `research_citations` and its CRUD layer exist
  (`src/lib/db/citations.ts`), but nothing yet checks an AI-generated
  citation against stored sources. That's Phase 5 (Research Alignment
  Engine / integrity guard becoming a code-level check, not just a
  prompt instruction).

## Testing

Unit tests mock every external library (`mammoth`, `pdf-parse`,
`exceljs`, the Supabase client, the Gemini embeddings call) — they verify
this codebase's own dispatch/orchestration/pruning logic, not that
`pdf-parse` correctly parses a real PDF or that pgvector's HNSW index
returns correct nearest neighbors. As with Phase 2's RLS, there's no
Postgres/Docker available in this build environment to run a real
end-to-end retrieval test (real embeddings, real pgvector search,
real similarity ranking) — do that against a live Supabase project
before trusting retrieval quality in production, not just this test
suite passing.
