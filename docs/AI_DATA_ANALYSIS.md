# Data Analysis (Phase 7)

## What this phase adds

```
Schema        supabase/migrations/*_phase7_datasets.sql — research_datasets
Parsing       src/lib/data/parse-dataset.ts     CSV (csv-parse) / XLSX (exceljs)
Statistics    src/lib/data/descriptive-stats.ts  real computation, no AI
Generator     src/lib/ai/results-generator.ts    generateResultsAnalysis()
Data access   src/lib/db/datasets.ts
Routes        POST/GET  /api/research/projects/[id]/datasets
              GET/DELETE .../datasets/[datasetId]
              POST .../datasets/[datasetId]/analyze
UI            DataAnalysisPanel.tsx — the "Data Analysis" section
```

## The core design decision: the model never produces a number

Section 27/29's hardest requirement is "AI must never invent analysis
output" / "every generated result must be traceable to the dataset."
The design choice that makes this actually true, not just prompted-for:

**`summarizeDataset()` computes every statistic in plain TypeScript —
mean, median, sample standard deviation, min/max, frequency tables — and
the model never sees this step or is asked to reproduce it.**
`generateResultsAnalysis()` calls the model *only* to write a narrative
paragraph interpreting numbers that are already computed, and the API
response returns the real `summary` object and the model's
`interpretation` text as two separate fields — the UI renders the
summary directly from computed data, never from anything the model
wrote.

This is stronger than "tell the model not to fabricate and hope it
listens": even a model that's given the correct numbers as context can
subtly alter one when asked to restate it in a table (a known LLM
failure mode). Verified for real: a test mocks the model returning an
obviously fabricated number in its prose (`"the mean age was actually
9999"`), and confirms `result.summary.age.mean` is still the real
computed `30` — the hallucination has no path to corrupt the number the
researcher actually sees rendered as data.

## Parsing (`parse-dataset.ts`)

CSV via `csv-parse` (chosen over hand-rolling — quoted fields, embedded
commas/newlines are exactly the kind of edge case a hand-written parser
gets subtly wrong), XLSX via `exceljs` (already in use since Phase 3,
not a new dependency — same ambient-`Buffer`-type workaround as
`extract.ts`). Column type inference (`numeric`/`categorical`/`text`/
`date`) is a bounded heuristic: numeric requires *every* non-missing
value to match a strict numeric pattern (one non-numeric value falls
back to text/categorical, not a partially-numeric column silently
treated as numeric), categorical is decided by cardinality (≤20 unique
values or ≤20% of row count), date requires both a date-shaped pattern
and a successful `Date.parse`.

Capped at `MAX_DATASET_ROWS` (5000) and a 10MB upload — this stores
parsed rows as `jsonb` directly on the `research_datasets` row (see the
migration's comment for why: academic-scale datasets, not big data;
analysis runs in application code, not SQL, so there's no query benefit
to a separate per-row table).

## Descriptive statistics (`descriptive-stats.ts`)

Hand-written, not a stats library — these are simple, well-known
formulas (arithmetic mean, median, **sample** standard deviation with
the n-1 denominator — the correct convention for survey/study data,
which is always a sample) that are easy to verify against a textbook
example, which the tests do directly (a known dataset with a published
SD of 2.13809, matched to 4 decimal places). Also includes Pearson
correlation (tested against perfect positive/negative/uncorrelated
cases) for the one bivariate statistic implemented so far.

## Statistical Guard (`recommendTest`, spec §28)

Recommends which test would be appropriate for a pair of variables based
on their types (correlation for numeric-numeric, t-test/ANOVA for
numeric-categorical depending on group count, chi-square for
categorical-categorical) — **and never computes a p-value or runs
anything**. Every recommendation includes `assumptionsToCheck`
(normality, variance homogeneity, expected cell counts, etc.) that this
function has no way to verify itself — Section 28 is explicit that the
final method depends on distribution/sample size/assumptions, and this
function's job is to name the candidate test and what still needs
checking, not to decide for the researcher. A test asserts the
recommendation object never carries a `pValue`/`statistic` field, to
keep this boundary from drifting later.

**Not implemented**: actually running any inferential test (computing a
real t-statistic, chi-square statistic, ANOVA F-statistic, or p-value).
Only descriptive statistics (mean/median/SD/frequencies) and the
correlation coefficient are real computed numbers in this phase —
inferential testing is a real feature gap, not a hidden AI-generated
approximation standing in for it.

## Results generation (`generateResultsAnalysis`)

Ties into the Phase 5 dataset guard directly: `taskType:
"results_generation"` with a real `dataSetId` now means the request
*passes* the guard (verified — before Phase 7, only the "blocked without
a dataset" side of the guard had been tested; this phase confirmed the
"allowed through with a real dataset" side for the first time, through a
real authenticated request against real data). Context sent to the model
includes the project title, the objectives section's content (if any),
and every computed statistic — the model is explicitly instructed to use
only the given numbers and say a missing statistic "would need to be
computed" rather than estimate one.

## The workspace UI

The existing "Data Analysis" section renders `DataAnalysisPanel` instead
of the generic textarea (the second section-specific editor, after
Phase 6's questionnaire builder) — upload, browse datasets, view the
real computed summary per column, and trigger the AI interpretation.

**A real bug found via this session's browser testing**: the panel's
error state (e.g. "AI providers are currently unavailable" from a failed
interpretation attempt) persisted after navigating back to the dataset
list and even after deleting the dataset — fixed by clearing it on the
"← All datasets" navigation.

## What's not built in Phase 7

- Actually running inferential statistical tests (t-test, chi-square,
  ANOVA, regression) — only descriptive stats and correlation are real
  computed numbers; `recommendTest` only names a candidate.
- The Discussion Engine (spec §30) and Conclusion Engine (§31) — these
  consume results the way this phase's output could feed them, but
  neither is built. Natural next phase-adjacent work, not attempted here
  to keep this phase's scope to upload → real computation → grounded
  interpretation.
- Persisting a versioned `AnalysisResult`/table record (spec §29's
  `{tableId, datasetId, analysisId, sourceColumns, generatedAt,
  verified}`) — the summary is recomputed live from the stored dataset
  on every request rather than snapshotted, which is simpler and can't
  drift out of sync with the source data, but doesn't produce a
  citable "this exact table was generated at this exact time" record.
- Charts/visualizations — spec §27 mentions them; only the numeric/
  frequency-table summary exists.
- Data quality checks beyond missing-value counts (spec §27's "data
  quality checks" step) — no outlier detection, no consistency checks
  across columns.

## Verification

49 new unit tests (214 total) — the heaviest-tested phase yet, because
this is the one where a subtly wrong formula could produce a real,
wrong number a student puts in their actual thesis. `sampleStandardDeviation`
is checked against a published textbook value, not just internal
consistency; `pearsonCorrelation` against perfect-correlation edge
cases; `recommendTest` against every type-pair branch, plus an explicit
assertion that it never returns a computed statistic.

**Verified for real against the local Supabase instance**: the Phase 7
migration applied cleanly as the 10th migration in the chain; a real CSV
was uploaded through the actual running app (via a constructed
`fetch()`/`FormData` call, since this sandbox's browser tooling can't
drive a native file picker) and correctly parsed and type-inferred; the
computed summary matched hand-calculated values exactly (mean=30,
SD=7.745966..., frequency percentages); the results-generation request
correctly passed the dataset guard (a `503` from the real, absent AI
credentials — not a `200` with the "Missing: Dataset" guard message,
confirming the guard's "allow" path works, not just its "block" path);
and the full UI (upload, view summary, trigger interpretation, delete)
was exercised in a real browser session end to end.

**Not verified**: actual interpretation quality — no real Gemini/OpenAI
keys exist in this environment, so `generateResultsAnalysis`'s model
call was only exercised through mocks plus one real (intentionally
failing, due to missing credentials) request.
