"use client";

import { useCallback, useEffect, useState } from "react";
import SectionReviewPanel from "@/components/SectionReviewPanel";
import type { ReviewIssue, SectionReview } from "@/lib/evidence/section-review-service";
import type { SectionType } from "@/lib/db/types";

/**
 * Fetching container for the section review (§3-§5).
 *
 * Kept separate from `SectionReviewPanel` so the panel stays prop-only and
 * testable without a network, and so there is exactly one place that knows the
 * review endpoint. `refreshToken` is how the rest of the workspace asks for a
 * recheck — after an evidence insertion, coverage should move, and it moves
 * because the rows changed, not because anything was told what the new number
 * is (§28).
 */
export default function SectionReviewPane({
  projectId,
  sectionType,
  refreshToken,
  onIssueAction,
}: {
  projectId: string;
  sectionType: SectionType;
  /** Bumped by the parent to force a recheck. */
  refreshToken: number;
  onIssueAction?: (issue: ReviewIssue) => void;
}) {
  const [review, setReview] = useState<SectionReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/research/projects/${projectId}/sections/${sectionType}/review`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The section check could not run.");
      setReview(body.review);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, sectionType]);

  // Re-runs on a section switch and whenever the parent bumps the token. Not
  // on every keystroke: the review counts saved rows, so running it against
  // unsaved text would report a section that does not exist yet.
  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  return (
    <div className="p-3">
      <SectionReviewPanel
        review={review}
        loading={loading}
        error={error}
        onRefresh={refresh}
        onAction={onIssueAction}
      />
    </div>
  );
}
