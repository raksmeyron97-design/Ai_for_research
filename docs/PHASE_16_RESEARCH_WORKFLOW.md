# Phase 16 — Research Workflow & Section Generators

**Status: PARTIAL** — the architecture and the backend are complete for all 18
sections; three researcher-facing surfaces named in the brief were not built.
See §9.

**Live AI benchmark: DEFERRED.** No paid provider call was made in this phase.
Every AI path is exercised by a deterministic mock. Reason: feature-completion
priority and credit conservation.

Base commit `5d48aa4` · 689 tests (was 628) · lint, typecheck, build and the
offline dry benchmark all pass.

---

## 1. What changed, in one line

The AI went from "generic chat that happens to sit in a thesis workspace" to a
section-aware assistant: it now knows which section you are in, what that
section is allowed to see, which actions make sense there, and it never
touches your text without you deciding first.

---

## 2. Section context policy (§5, §20)

`src/lib/ai/sections/context-policy.ts` — one policy per section, declaring
`required` / `optional` / `excluded` context layers, which earlier sections
feed in, and whether retrieval runs at all.

The audit's finding was that `buildContext` assembled the same five layers for
every request, so a `title` request and a `discussion` request received
structurally identical context. That is a quality problem before it is a cost
one: a model drafting objectives does not benefit from retrieved literature,
it benefits from the problem statement the objectives must follow from.

Worked examples, matching the brief:

| Section | Sees | Never sees |
| --- | --- | --- |
| `objectives` | profile, current, title/problem/rationale/questions | literature, dataset |
| `methodology` | profile, current, objectives/questions/variables | literature, dataset |
| `results` | profile, objectives/questions/analysis, **computed statistics (required)** | literature, citations |
| `discussion` | profile, objectives/results, **citations (required)**, retrieval | dataset |
| `conclusion` | profile, objectives/results/discussion | literature, citations, dataset |

Two design choices worth stating:

- `excluded` is explicit rather than "everything not required". Naming what
  must never be sent makes an accidental widening visible in a diff, and gives
  the tests something to assert.
- `retrieval` is a separate flag from allowing the `retrievedSources` layer,
  because retrieval costs an embedding call *before* it costs context tokens.
  A section that cannot use sources does not pay for one.

Conversation history is excluded from **every** section: a section action is
not a chat turn, and prior chat is the layer most likely to smuggle in
irrelevant context.

`section-context.ts` builds context by consulting the policy. The generic
`context-manager.ts` is untouched and still serves free-form chat, where "what
might be relevant" is genuinely open.

---

## 3. Section actions (§4, §25)

`src/lib/ai/sections/actions.ts` — a per-section allowlist of the ten actions,
each mapped to the production `TaskType` that decides tier, prompt and
provider.

The rule is that an action which cannot work for a section is worse than no
action: it invites a request the pipeline will refuse, and the researcher has
no way to know that in advance. So `add_evidence` does not appear on
`appendices`, and `generate` does not appear on `results`, `discussion`,
`conclusion` or `questionnaire` — those have dedicated generators with their
own guards, and a second path to the same content would route around them.

Progressive disclosure: at most three primary actions per section (enforced by
a test), everything else behind **More**. Actions needing existing content
render disabled with the reason stated, rather than disappearing.

## 4. Generators and prompts (§6, §7)

Rather than 18 near-identical generator files, section behaviour is resolved
from three registries — actions, context policy, schemas — and executed by one
runner, `sections/run-action.ts`. Adding a section means adding data, not
another branch. The five existing generators (results, discussion, conclusion,
questionnaire, quality/alignment) are **reused, never reimplemented** (§32).

Six new prompt builders were added and registered: title, problem statement,
rationale, research questions, variables, conceptual framework. Research
questions previously shared the objectives prompt — which asks for objectives
(audit finding D7).

Structured output, validated with Zod via the shared safe parser, for:
objectives (§8, with per-objective measurability), research questions (§9,
each mapped to objective and variable, plus duplicate/orphan detection),
variables (§10), methodology review (§11, PASS/WARN/NEEDS_CLARIFICATION/
INCONSISTENT per aspect with issue, reason, affected section and
recommendation), sampling plan (§12, with `missingInputs` as a first-class
value so no population count is ever invented), and conceptual framework
(§13).

**§10's rule is enforced by schema shape, not by prompt:** the variables
schema has no field a model could use to mark a variable confirmed.
Confirmation is a researcher action. A model that *could* write "confirmed"
eventually would.

## 5. AI change control and versioning (§17, §18)

AI output lands in a review panel, never in the section. The researcher
chooses **Append**, **Insert**, **Replace all**, **Copy** or **Discard**;
dismissing without choosing is a discard, and nothing is pre-selected.

Replace is the only destructive option, so it is styled as one and sits behind
**Show changes** — a word-level diff (`src/lib/text/diff-words.ts`) showing
exactly what would be lost. The diff degrades to a whole-block before/after on
thesis-length input rather than freezing the browser on a quadratic table.

`research_section_versions` records every content change: previous content,
new content, the action, and provider/model/section-action when the change
came from AI. Manual edits record no provider — recording a model for a change
no model made would be worse than recording nothing. Versions are insert-only
under RLS: a history a user can rewrite is not a history. A version is written
only when the text actually changed, so autosaves and status-only saves do not
pad it.

## 6. Mock provider (§21)

`src/lib/ai/testing/mock-provider.ts` supports valid, invalid-JSON,
schema-mismatch, timeout, provider-failure and citation responses, is
scriptable per call, and records every request for assertions on prompt and
context. `withMockProvider` patches the exported adapters in place, so the
router, orchestrator, guards and usage accounting all run for real and only
the network call is replaced.

`in-memory-supabase.ts` backs the workflow test with actual state, so a
section written in step three is readable in step seven. It throws on an
unmodelled table rather than returning empty data that would look like a
legitimate "nothing found".

## 7. Offline end-to-end (§22)

`offline-workflow.e2e.test.ts` walks the fixture Scenario A project through
problem statement → rationale → objectives → research questions → variables →
methodology review → dataset → computed results → discussion → conclusion →
Markdown export, plus version recording. Every AI step runs the real
pipeline against the mock.

## 8. Integrity guards, verified offline (§24)

| Guard | Verified |
| --- | --- |
| No dataset → results blocked | Yes — and **zero provider calls**, so there is nothing to hallucinate around |
| No results → conclusion blocked | Yes |
| No results → discussion blocked | Yes |
| Unknown citation key → flagged | Yes, through the real verifier |
| Known citation key → not flagged | Yes (guards against a check that flags everything) |
| Invalid AI JSON → safe failure, nothing persisted | Yes |
| Schema mismatch → safe failure | Yes |
| AI-suggested variable → never persisted as confirmed | Yes, by schema shape |
| Provider error → safe message, no secret leaked, "nothing was saved" | Yes |
| Action needing content on an empty section → refused before any call | Yes |

## 9. What was NOT built — remaining gaps

Stated plainly rather than implied by omission:

1. **Evidence insertion workflow (§15).** The `add_evidence` action exists and
   routes correctly, but there is no claim-identification pass, no evidence
   cards, and no citation-relation storage on insert. It currently behaves as
   a source-grounded search.
2. **Section review panel (§16).** Section health — completeness, evidence
   coverage, alignment, quality — is not surfaced as a panel. The underlying
   checks exist (`quality-check.ts`, `alignment-engine.ts`); nothing composes
   them per section.
3. **Conceptual framework editor (§13).** The schema and generator produce the
   population → exposure → mediator → outcome structure with AI-suggested
   relationships, but there is no editable visual representation.
4. **Mobile layout (§26).** The three-pane desktop grid is unchanged and does
   not collapse to a stacked layout on small screens. Existing desktop
   workflow is intact; small screens are not yet addressed.
5. **Version history UI.** Versions are recorded and readable through the db
   layer, but nothing renders them and there is no restore action.
6. **Component-level UI tests.** The diff logic and every registry are tested;
   the React components are covered only indirectly through the build and
   typecheck. There is no DOM testing library in this project.

## 10. Known limitations

- Section actions are fire-and-forget through `generate()`, not streamed. A
  long generation shows a busy state with no partial output.
- `SectionActions` reads the registry directly rather than the `GET .../ai`
  endpoint. The endpoint exists for other clients; the current UI does not
  need a round-trip for static data.
- The mock provider is a scripted fake. It proves wiring, never quality — no
  claim in this document is a claim about model output.
- Sampling and evidence schemas exist but no section action is wired to
  `sampling_plan` yet; it is reachable through the methodology prompt only.
