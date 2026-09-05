"use client";

import { useCallback, useEffect, useState } from "react";
import VersionHistory from "@/components/VersionHistory";
import type { SectionVersionRow } from "@/lib/db/section-versions";
import type { ResearchSectionRow, SectionType } from "@/lib/db/types";

/**
 * Fetching container for version history (§6-§8).
 *
 * Restore goes through the API, which appends a new version rather than
 * rewinding — so the list this component re-reads afterwards is longer, never
 * shorter. That is the visible proof of §7, and the reason the list is
 * refetched rather than patched locally.
 */
export default function SectionHistoryPane({
  projectId,
  sectionType,
  refreshToken,
  onRestored,
}: {
  projectId: string;
  sectionType: SectionType;
  refreshToken: number;
  onRestored: (section: ResearchSectionRow) => void;
}) {
  const [versions, setVersions] = useState<SectionVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/sections/${sectionType}/versions`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The version history could not be loaded.");
      setVersions(body.versions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, sectionType]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function restore(version: SectionVersionRow) {
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/sections/${sectionType}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That version could not be restored.");
      onRestored(body.section);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="p-3">
      {error && (
        <p role="alert" className="mb-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}
      <VersionHistory versions={versions} loading={loading} onRestore={restore} />
    </div>
  );
}
