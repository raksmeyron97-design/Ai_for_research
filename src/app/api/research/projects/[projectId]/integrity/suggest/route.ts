import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { listCitations } from "@/lib/db/citations";
import { getClaim, getEvidenceByIds, listClaimEvidenceForClaim } from "@/lib/db/evidence";
import { listHypotheses } from "@/lib/db/methodology";
import {
  classifyClaim,
  compareWordingToResult,
  explainCandidateEvidence,
  IntegritySuggestionError,
  suggestCitationPlacement,
  suggestDuplicateReferences,
  suggestMethodologyLanguageFix,
  summarizeSourceConflict,
} from "@/lib/integrity/suggestions";

/**
 * Every research-integrity AI proposal, behind one rate-limited route
 * (§20-§21, mirrors methodology/suggest/route.ts exactly).
 *
 * The part that must not drift is the preamble: authenticate, resolve the
 * project, apply the AI rate limit, and build every candidate list from the
 * database — never from the request. A caller names *what* it's working on
 * (a claim id, a hypothesis id); it never supplies what the model may choose
 * among, which is what makes a cross-project id impossible here rather than
 * merely filtered afterward.
 */
const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("claim_classification"), claimId: z.string().uuid() }),
  z.object({ kind: z.literal("evidence_explanation"), claimId: z.string().uuid(), evidenceId: z.string().uuid() }),
  z.object({ kind: z.literal("conflict_summary"), claimId: z.string().uuid() }),
  z.object({ kind: z.literal("duplicate_references") }),
  z.object({ kind: z.literal("language_fix"), claimId: z.string().uuid(), concern: z.string().trim().min(1).max(300) }),
  z.object({ kind: z.literal("citation_placement"), claimId: z.string().uuid() }),
  z.object({ kind: z.literal("wording_comparison"), claimId: z.string().uuid(), hypothesisId: z.string().uuid() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId, { rateLimit: "ai" });
  if (!auth.ok) return auth.response;

  const { supabase, userId } = auth.auth;
  const request = parsed.data;

  try {
    switch (request.kind) {
      case "claim_classification": {
        const claim = await getClaim(supabase, projectId, request.claimId);
        if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });
        return NextResponse.json(
          await classifyClaim(supabase, { projectId, userId, claimText: claim.claim_text, currentType: claim.claim_type }),
        );
      }

      case "evidence_explanation": {
        const claim = await getClaim(supabase, projectId, request.claimId);
        if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });
        const [evidence] = await getEvidenceByIds(supabase, projectId, [request.evidenceId]);
        if (!evidence) return NextResponse.json({ error: "That evidence was not found." }, { status: 404 });
        return NextResponse.json(
          await explainCandidateEvidence(supabase, { projectId, userId, claimText: claim.claim_text, evidenceExcerpt: evidence.excerpt }),
        );
      }

      case "conflict_summary": {
        const claim = await getClaim(supabase, projectId, request.claimId);
        if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });

        const [links, citations] = await Promise.all([
          listClaimEvidenceForClaim(supabase, projectId, request.claimId),
          listCitations(supabase, projectId),
        ]);
        const evidence = await getEvidenceByIds(supabase, projectId, links.map((l) => l.evidence_id));
        const evidenceById = new Map(evidence.map((e) => [e.id, e]));
        const citationById = new Map(citations.map((c) => [c.id, c]));

        const sources = links
          .map((link) => {
            const ev = evidenceById.get(link.evidence_id);
            const citation = ev ? citationById.get(ev.citation_id) : undefined;
            if (!ev || !citation) return null;
            return { citationKey: citation.citation_key, excerpt: ev.excerpt, support: link.support };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        if (sources.length < 2) {
          return NextResponse.json({ error: "This claim needs at least two linked sources to summarize a conflict." }, { status: 400 });
        }

        return NextResponse.json(
          await summarizeSourceConflict(supabase, { projectId, userId, claimText: claim.claim_text, sources }),
        );
      }

      case "duplicate_references": {
        const citations = await listCitations(supabase, projectId);
        return NextResponse.json(
          await suggestDuplicateReferences(supabase, {
            projectId,
            userId,
            candidates: citations.map((c) => ({
              id: c.id,
              label: `${c.citation_key} — ${c.title ?? "(no title)"}`,
              detail: [c.year, c.authors[0]].filter(Boolean).join(", "),
            })),
          }),
        );
      }

      case "language_fix": {
        const claim = await getClaim(supabase, projectId, request.claimId);
        if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });
        return NextResponse.json(
          await suggestMethodologyLanguageFix(supabase, { projectId, userId, claimText: claim.claim_text, concern: request.concern }),
        );
      }

      case "citation_placement": {
        const claim = await getClaim(supabase, projectId, request.claimId);
        if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });
        const citations = await listCitations(supabase, projectId);
        return NextResponse.json(
          await suggestCitationPlacement(supabase, {
            projectId,
            userId,
            claimText: claim.claim_text,
            candidates: citations.map((c) => ({ id: c.id, label: `${c.citation_key} — ${c.title ?? "(no title)"}` })),
          }),
        );
      }

      case "wording_comparison": {
        const claim = await getClaim(supabase, projectId, request.claimId);
        if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });
        const hypothesis = (await listHypotheses(supabase, projectId)).find((h) => h.id === request.hypothesisId);
        if (!hypothesis) return NextResponse.json({ error: "That hypothesis was not found." }, { status: 404 });

        return NextResponse.json(
          await compareWordingToResult(supabase, {
            projectId,
            userId,
            claimText: claim.claim_text,
            hypothesisStatement: hypothesis.statement,
            hypothesisDirection: hypothesis.direction,
          }),
        );
      }
    }
  } catch (error) {
    if (error instanceof IntegritySuggestionError) {
      return NextResponse.json({ error: error.userMessage }, { status: 502 });
    }
    return dbErrorResponse("Generating that suggestion");
  }
}
