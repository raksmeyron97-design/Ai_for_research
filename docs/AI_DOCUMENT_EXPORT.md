# Document Export (Phase 9)

## What this phase adds

```
Compiler   src/lib/export/document-model.ts   compileDocumentModel()
Renderers  src/lib/export/to-markdown.ts       renderMarkdown()
           src/lib/export/to-docx.ts           renderDocx()
           src/lib/export/to-pdf.ts            renderPdf()
Route      GET /api/research/projects/[id]/export?format=docx|pdf|md
UI         ProjectWorkspace.tsx — an "Export" button in the header with
           a three-item format menu, next to Quality Check / Documents
```

No new schema or AI calls — export reads only what already exists
(`research_sections`, `research_citations`, `research_instruments`,
`questionnaire_questions`) and formats it. Nothing here can fabricate
content: it either shows real saved data or an honest placeholder.

## One compiler, three renderers

`compileDocumentModel()` builds a small provider-agnostic intermediate
representation — a flat list of `heading` / `paragraph` / `table` /
`pagebreak` blocks — from the database. Each renderer only has to
understand that block set, not the research-project schema. This was
worth the extra indirection specifically because there are three real
output formats to support (spec §52's "at minimum DOCX, PDF, Markdown");
a single format wouldn't have justified it.

## Chapter structure: the 18-section chain, grouped

The full front-matter structure in spec §21 (Cover, Evaluation,
Declaration, Acknowledgement, Abstract, List of Tables/Figures, etc.)
isn't built — none of that exists as data in this schema, and adding it
would mean inventing several new section types and editor UI beyond what
this phase is about. What's exported is the 18-section chain the rest of
the app already manages (`SECTION_CHAIN`), grouped into six numbered
chapters the way spec §21 groups them:

```
Chapter 1  Introduction                    research_problem, rationale, research_gap
Chapter 2  Objectives & Conceptual         objectives, research_questions,
           Framework                       variables, conceptual_framework
Chapter 3  Methodology                     methodology, questionnaire, data_collection,
                                            data_analysis
Chapter 4  Results                         results
Chapter 5  Discussion                      discussion
Chapter 6  Conclusion & Recommendations    conclusion, recommendations
           References                     (see below — not the "references" section)
           Appendices                      appendices, + full instrument table(s)
```

A section with no content yet renders as `[Not yet completed]` rather
than being silently skipped or invented — the export is a snapshot of
real project state, including its gaps, not a finished-looking draft
that hides how much work remains.

**Title**: the exported title/filename comes from the Title *section's*
drafted content when it exists, not `research_projects.title`. This was
a real bug caught in browser verification, not a judgment call made up
front — the project's `title` column is just the label chosen at
creation (spec's project-creation form), while the Title *section* is
the one that goes through the app's own alignment/quality checks as the
actual thesis title. Exporting the creation-time label once a real title
had been drafted would have shipped a wrong cover page. `project.title`
remains the fallback for a project where the Title section is still
empty.

## References: built from `research_citations`, never from prose

The exported bibliography is generated from the real, verified
citation rows — not from whatever the free-text "References" section
happens to contain. This mirrors why Phase 8's discussion generator
checks citations against the same table (`AI_DISCUSSION_CONCLUSION.md`):
the References section is prose a model or the researcher wrote, and it
can drift from the DB; the citations table is the source of record. Each
entry is sorted by citation key and formatted as
`[key] Authors (Year). Title. Journal. DOI-or-URL.` so it visibly ties
back to the `[key]` markers used in-text by the AI generators. Zero
saved citations renders the same `[Not yet completed]` placeholder as
any other empty section, not an empty References heading with nothing
under it.

## The full questionnaire goes in Appendices, not just Methodology

The Methodology chapter's Questionnaire section shows whatever overview
prose the researcher/AI wrote there, plus which instrument(s) exist and
their validation status. The actual question-by-question instrument
(every question, its response type, its options, whether it's required)
is appended as a full table under Appendices — this is where a real
thesis puts the complete instrument, and it's also the one place in this
export where fidelity really matters: a truncated question or missing
answer option in an appendix isn't just untidy, it misrepresents the
actual instrument. See the PDF section below for a real bug this caused.

## Format notes

- **Markdown**: plain block-to-text mapping, tables as GFM pipe tables,
  chapter breaks as `---`. No library — the format is a direct rendering
  of the intermediate model.
- **DOCX**: built with the `docx` package (`Document`/`Paragraph`/
  `Table`/`HeadingLevel`), packed via `Packer.toBuffer`. Multi-line
  paragraph content (a section can contain literal newlines) is split
  into `TextRun`s with explicit `break: 1` rather than relying on `docx`
  to interpret raw `\n` characters, since it doesn't.
- **PDF**: built with `pdfkit`, added to `next.config.ts`'s
  `serverExternalPackages` for the same reason `pdf-parse` was in Phase
  3 — it loads its `.afm` font-metrics files from disk at runtime, and
  webpack's bundling of the route breaks that resolution.

## A real bug found only by generating an actual PDF: table columns

The first version of the PDF table renderer divided the page width
equally across columns and drew each cell in a fixed-height box with
`ellipsis: true`. That's fine for short cells, but the appendix
instrument table has a `Question` column and an `Options` column that
are routinely much longer than `#` or `Required` — running the real
export against a seeded test instrument produced
`"How difficult is…"` and `"Very easy; Easy;…"` in the output PDF,
silently dropping the rest of the question and half the answer options.
Neither `npm run typecheck`, `lint`, `vitest`, nor `next build` catch
this class of bug — it only shows up in the rendered output. Fixed by:

- Sizing each column proportionally to the average content length in
  that column (across the header and every row) instead of splitting
  evenly, so a long free-text column gets real room.
- Computing each row's height from `doc.heightOfString()` per cell and
  using the max across the row, instead of a fixed 20pt row, so wrapped
  text has space to actually appear.
- Removing `ellipsis: true` entirely — cells now wrap instead of
  truncating.

Re-running the same real export afterward (extracted with `pdf-parse`)
confirmed the full question text and the complete option list both
appear, wrapped across lines, with nothing cut off.

## Verification

18 new unit tests (255 total): the compiler's chapter ordering, the
Title-section-over-project.title precedence (including the regression
case where the title section doesn't exist yet), the honest-placeholder
behavior for empty sections, reference-list formatting and sorting
(including the zero-citations case), and the appendix instrument table.
Each renderer has its own tests asserting real output shape — DOCX and
PDF are checked by real magic bytes (`PK\x03\x04`, `%PDF-`) and a
non-trivial byte length, not just "did it not throw."

**Verified for real, against the local Supabase instance and a real
running Next.js server** (not just mocks): logged in as an existing
real test user, used the actual authenticated session to fetch a real
project's real section content (a mix of drafted and empty sections),
seeded a real citation and a real two-question instrument directly via
the database for a case the mocked tests can't reach on their own, then
called the real `/export` route for all three formats through that
authenticated session. Confirmed: correct `Content-Type` and
`Content-Disposition` per format, correct magic bytes, and — after
extracting text back out of the real generated PDF and DOCX with
`pdf-parse` and `unzip`+`document.xml` respectively — that the content,
order, real citation, and real instrument table all came through
correctly. This is also how the title-precedence bug and the PDF
table-truncation bug above were actually found; neither was visible from
the unit tests alone. The UI's "Export" button and its three-item
dropdown menu were also clicked in a real browser session and confirmed
to render with the correct labels and hrefs.

**Not verified**: the actual visual layout/pagination quality of the PDF
beyond text-extraction fidelity (no PDF rasterizer was available in this
environment to screenshot rendered pages) — page breaks, heading sizes,
and non-truncation were confirmed via extracted text and the renderer's
own logic, not a pixel-level render.

## What's not built in Phase 9

- Front-matter pages (Cover, Declaration, Acknowledgement, Abstract,
  Table of Contents, List of Tables/Figures) — spec §21 lists these, but
  none of them exist as data in the current schema; adding them would
  mean new section types and editor UI, which is out of scope for an
  export feature built on top of the existing chain.
- Page numbers, running headers, or a generated table of contents in the
  DOCX/PDF output.
- Selecting which sections to include, or exporting a single
  chapter/section on its own — export is always the whole project.
