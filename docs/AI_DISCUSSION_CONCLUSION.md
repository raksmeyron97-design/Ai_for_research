# Discussion & Conclusion Engines (Phase 8)

## What this phase adds

```
Discussion    src/lib/ai/discussion-generator.ts   generateDiscussion()
Conclusion    src/lib/ai/conclusion-generator.ts    generateConclusion()
Prompts       src/lib/ai/prompts/discussion.ts, conclusion.ts
Routes        POST /api/research/projects/[id]/discussion/generate
              POST /api/research/projects/[id]/conclusion/generate
UI            AICopilot.tsx — a "Generate ... draft" button, shown only
              on the Discussion/Conclusion sections, reusing the
              existing chat-message + "Insert into section" flow
```

No new schema — this phase is entirely AI-generation logic built on
tables that already existed (`research_sections`, `research_citations`).

## Both generators have a hard guard before calling a model

Same shape as Phase 5's dataset guard, applied one section later in the
chain:

- **`generateDiscussion`** refuses (throws `DiscussionGenerationError`,
  no model ever called) if the Results section has no content. Spec §30
  is explicit that discussion interprets *real* findings — there's
  nothing to interpret if Results is empty, and generating one anyway
  would be exactly the fabrication risk Section 19 targets, just at the
  Discussion step instead of the Results step.
- **`generateConclusion`** refuses if Objectives is empty, or if neither
  Results nor Discussion has content. Spec §31: "conclusion must derive
  from objectives and actual findings" — both are load-bearing
  prerequisites, not just nice-to-have context.

Verified for real against the local Supabase instance: both guards
return a clean `422` with the exact missing-section message when content
is absent, and — the more important direction to check — both correctly
*pass through* to a real (missing-credentials, `503`) provider call once
real content exists, confirming the guard doesn't over-block a
legitimate request.

## Discussion: literature comparison can't invent sources

Spec §30's "if supporting literature is unavailable, mark 'Additional
evidence required'" is enforced two ways:

1. **The prompt** (`prompts/discussion.ts`) instructs the model to only
   compare against sources actually given in context, using their exact
   `[citation_key]`, and to write "Additional evidence required" when
   nothing relevant was provided.
2. **After generation**, the response is run through
   `verifyCitationsInText()` — the same function Phase 5's quality
   checker and integrity guard use — which extracts every `[key]`
   reference and checks it against real `research_citations` rows. An
   invented or unverified key comes back as a warning, not silently.
   This is the same bracket-convention scan with the same stated limit
   as Phase 5: a citation mentioned in plain prose without brackets
   isn't caught.

A project with zero saved citations gets an extra check: if the model's
response doesn't contain the phrase "Additional evidence required"
*anywhere*, a warning is added noting the discussion should be reviewed
for unbacked comparisons. This is a blunt heuristic (it can't tell if
the model correctly avoided any literature comparison at all vs.
incorrectly compared without saying so), but it costs nothing to check
and catches an obvious case.

## Conclusion: `detectUnsourcedNumbers` — a real check, explicitly bounded

Spec §31's "never introduce new results" is the hardest of these
requirements to verify at a code level — there's no schema that captures
"is this claim actually derivable from the given text." What's
implemented is a bounded, honest heuristic: extract every number
(`\d+(\.\d+)?%?`) from the generated conclusion, extract every number
from the objectives/results/discussion content it was generated from,
and flag any conclusion number that doesn't appear in the source set.
Four-digit numbers in a plausible publication-year range (1900-2099)
are excluded to cut an obvious source of false positives (a citation
year isn't a "new statistic").

**What this does and doesn't catch, stated plainly** (also in the code
comment, since this is the kind of check that's easy to over-trust):

- Catches: a genuinely fabricated number that appears nowhere in the
  source content (tested: `"62%"` in source, model writes `"99%"` in
  conclusion → flagged).
- Does not catch: the same number restated with different formatting in
  a way that still string-matches by coincidence, or a new claim that
  happens not to involve a number at all ("most participants improved"
  with no fabricated finding behind it — not every fabrication is
  numeric).
- False-positive risk: a real number from the source, reformatted
  slightly (e.g. "50" vs "50.0"), would currently be flagged as
  "unsourced" even though it's the same figure — this is a warning to
  *review*, not a rejection, specifically because of that risk.

This is a real, tested tripwire for the clearest fabrication case (a
number with no basis anywhere in the input), not a claim to catch every
way a conclusion could introduce something new.

## The workspace UI: a third integration pattern

Phases 6/7 gave `questionnaire`/`data_analysis` their own dedicated
panel components, replacing the section's textarea entirely. Discussion
and Conclusion are still ordinary prose sections — swapping out
`SectionEditor` wouldn't make sense here. Instead, `AICopilot` grew a
`SPECIAL_GENERATORS` map: when the active section is `discussion` or
`conclusion`, a "Generate ... draft" button appears above the chat input,
calls the dedicated endpoint instead of `/api/ai/chat`, and the result
lands in the same message list with the same "Insert into section"
button every other AI response already has — plus any warnings rendered
inline in an amber callout. No new UI primitives were needed; the
existing review-before-insert flow from Phase 4 covers this case too.

## What's not built in Phase 8

- Per-finding structured output (spec's discussion chain — Result →
  Interpretation → Comparison → Agreement/disagreement → Explanation →
  Implication — is asked for in the prompt as free text, not enforced as
  a JSON schema per finding the way Phase 5/6's structured outputs are).
  Free text was chosen deliberately here since discussion/conclusion are
  meant to read as prose in the final thesis, not as data to render —
  unlike alignment issues or questionnaire questions, which *are* data.
- Automatically inserting the generated draft into the section (it still
  requires a manual "Insert into section" click) — this is intentional,
  not a gap: spec §59/§42 requires the researcher to approve before
  anything is written, and the existing Insert flow already does that
  for every other AI response.
- Real inferential-statistic awareness in the discussion (Phase 7 only
  computes descriptive stats + correlation; the discussion generator
  can only discuss what's actually in the Results section's text).

## Verification

23 new unit tests (237 total): both hard guards (present/absent
Objectives/Results/Discussion, in every combination that matters),
citation-verification integration (including the "citations exist but
verification failed" and "no citations exist" branches, kept separate so
one test isolates one behavior), and `detectUnsourcedNumbers` tested
directly — the year-exclusion, de-duplication, and "no numbers at all"
cases, plus an explicit assertion that a legitimate matching number is
never flagged.

**Verified for real against the local Supabase instance**: both guards'
block paths (`422` with the exact message) and — importantly — both
guards' *allow* paths, confirmed by writing real content into a real
project's Objectives/Results sections through the actual running app and
watching the request correctly reach a real (missing-credentials) `503`
instead of being blocked. The "Generate Discussion draft" button was
also clicked in a real browser session and confirmed to show the clean
error state rather than crashing.

**Not verified**: actual discussion/conclusion quality — no real
Gemini/OpenAI keys exist in this environment, so neither generator's
model call has produced real output, only mocked responses plus the real
(intentionally failing) requests above.
