"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialogOverlay } from "@/lib/ui/use-dialog-overlay";
import { resolveNodes } from "@/lib/framework/model";
import { runFrameworkChecks } from "@/lib/framework/validation";
import { EMPTY_MODEL, type MethodologyModel } from "@/lib/methodology/model";
import {
  CONSTRUCT_ROLE_LABELS,
  FRAMEWORK_RELATION_LABELS,
  PROVENANCE_LABELS,
  type FrameworkRelationType,
  type ResearchFrameworkNodeRow,
  type ResearchFrameworkRelationshipRow,
} from "@/lib/db/types";

/**
 * The conceptual framework workspace (§10, §33, §34).
 *
 * A list, not a canvas — and that is the design, not a shortcut.
 *
 * §33 forbids a graph that only works with a mouse, and §34 forbids forcing a
 * desktop diagram into a phone. A box-and-arrow canvas satisfies neither
 * without building a second, keyboard-driven representation beside it — two
 * interfaces over one model, which drift. So the list *is* the interface at
 * every width: every node and relationship is a real focusable row, readable
 * by a screen reader in the order the study is structured.
 *
 * Coordinates are stored, and since Phase 21 (§13) they are editable from
 * here: "Move up" / "Move down" reorders the concepts and the order persists.
 * Buttons rather than drag-and-drop, deliberately — a drag handle is the
 * mouse-only interaction §33 rules out, and reordering is the one layout
 * operation a list can express honestly.
 *
 * The whole order goes in one PUT, not one PATCH per moved node: a reorder
 * that half-applies leaves the framework in an order the researcher never
 * chose (§36, §50).
 *
 * Coordinates remain presentation data. Nothing here reads them to decide
 * anything, and the checks below never see them — moving a concept up the
 * list cannot change what the study claims (§15).
 */
const RELATION_TYPES = Object.keys(FRAMEWORK_RELATION_LABELS) as FrameworkRelationType[];

interface FrameworkData {
  nodes: ResearchFrameworkNodeRow[];
  relationships: ResearchFrameworkRelationshipRow[];
  methodology: MethodologyModel;
}

export default function ConceptualFrameworkWorkspace({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FrameworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frameworkBase = `/api/research/projects/${projectId}/framework`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The framework and the methodology together: a node's name comes from
      // its construct, so rendering them from separate fetches would show a
      // node labelled with a construct that had since been renamed.
      const [nodesRes, relsRes, methodologyRes] = await Promise.all([
        fetch(`${frameworkBase}/nodes`),
        fetch(`${frameworkBase}/relationships`),
        fetch(`/api/research/projects/${projectId}/methodology`),
      ]);
      if (!nodesRes.ok || !relsRes.ok || !methodologyRes.ok) {
        throw new Error("Your conceptual framework could not be loaded.");
      }
      setData({
        nodes: (await nodesRes.json()).nodes,
        relationships: (await relsRes.json()).relationships,
        methodology: (await methodologyRes.json()).model ?? EMPTY_MODEL,
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [frameworkBase, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(path: string, init: RequestInit, failure: string) {
    setBusy(true);
    try {
      const res = await fetch(`${frameworkBase}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      if (!res.ok) {
        throw new Error(((await res.json().catch(() => ({}))).error as string) ?? failure);
      }
      await load();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The same pure checks the cross-system review runs. Running them here as
  // well rather than fetching the review keeps the panel responsive to an
  // edit the researcher just made, and cannot disagree with the review —
  // it is literally the same function over the same rows.
  const { resolved, findings } = useMemo(() => {
    if (!data) return { resolved: [], findings: [] };
    const model = {
      nodes: data.nodes,
      relationships: data.relationships,
      methodology: data.methodology,
    };
    return { resolved: resolveNodes(model), findings: runFrameworkChecks(model).findings };
  }, [data]);

  const nodeById = useMemo(
    () => new Map(resolved.map((r) => [r.node.id, r])),
    [resolved],
  );

  const constructs = data?.methodology.constructs ?? [];
  const hypotheses = data?.methodology.hypotheses ?? [];
  const mappedConstructIds = new Set(
    resolved.filter((r) => r.construct).map((r) => r.construct!.id),
  );
  const availableConstructs = constructs.filter((c) => !mappedConstructIds.has(c.id));

  // §33: dialog semantics — focus moves in, is trapped, and returns to
  // whatever opened this when it closes. Escape closes.
  const overlayRef = useDialogOverlay(onClose);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Conceptual framework"
      className="fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-medium">Conceptual framework</h2>
          <p className="text-[11px] text-neutral-500">
            Which concepts your study relates, and how — checked against your methodology.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        )}

        {loading && (
          <p role="status" aria-live="polite" className="text-xs text-neutral-500">
            Loading your framework…
          </p>
        )}

        {data && !loading && (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <FindingsList findings={findings} />

            <NodesSection
              resolved={resolved}
              availableConstructs={availableConstructs}
              constructs={constructs}
              busy={busy}
              onAdd={(body) =>
                mutate("/nodes", { method: "POST", body: JSON.stringify(body) }, "That node could not be added.")
              }
              onPatch={(id, body) =>
                mutate(`/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) }, "That node could not be updated.")
              }
              onRemove={(id) =>
                mutate(`/nodes/${id}`, { method: "DELETE" }, "That node could not be removed.")
              }
              onReorder={(nodeIds) =>
                mutate(
                  "/nodes/order",
                  { method: "PUT", body: JSON.stringify({ nodeIds }) },
                  "That reordering could not be saved.",
                )
              }
            />

            <RelationshipsSection
              relationships={data.relationships}
              nodeById={nodeById}
              resolved={resolved}
              hypotheses={hypotheses}
              busy={busy}
              onAdd={(body) =>
                mutate(
                  "/relationships",
                  { method: "POST", body: JSON.stringify(body) },
                  "That relationship could not be added.",
                )
              }
              onPatch={(id, body) =>
                mutate(
                  `/relationships/${id}`,
                  { method: "PATCH", body: JSON.stringify(body) },
                  "That relationship could not be updated.",
                )
              }
              onRemove={(id) =>
                mutate(`/relationships/${id}`, { method: "DELETE" }, "That relationship could not be removed.")
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function FindingsList({ findings }: { findings: ReturnType<typeof runFrameworkChecks>["findings"] }) {
  if (findings.length === 0) {
    return (
      <section aria-labelledby="fw-findings-heading" className="rounded border border-neutral-200 p-3">
        <h3 id="fw-findings-heading" className="text-sm font-medium">
          Consistency
        </h3>
        {/* Not "your framework is correct". These checks are structural: a
            perfectly connected framework can still model the wrong thing. */}
        <p className="mt-1 text-xs text-neutral-600">
          Nothing inconsistent between your framework, your constructs and your hypotheses. This checks
          how the pieces connect, not whether the theory is right.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="fw-findings-heading" className="rounded border border-neutral-200 p-3">
      <h3 id="fw-findings-heading" className="text-sm font-medium">
        Consistency ({findings.length})
      </h3>
      <ul className="mt-2 space-y-2">
        {findings.map((f) => (
          <li key={f.id} className="rounded border border-neutral-200 p-2 text-xs">
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  f.severity === "error"
                    ? "bg-red-100 text-red-800"
                    : f.severity === "warning"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-neutral-100 text-neutral-700"
                }`}
              >
                {f.severity}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{f.title}</p>
                <p className="mt-0.5 text-neutral-600">{f.explanation}</p>
                {f.remediation && <p className="mt-0.5 text-neutral-500">{f.remediation}</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NodesSection({
  resolved,
  availableConstructs,
  constructs,
  busy,
  onAdd,
  onPatch,
  onRemove,
  onReorder,
}: {
  resolved: ReturnType<typeof resolveNodes>;
  availableConstructs: MethodologyModel["constructs"];
  constructs: MethodologyModel["constructs"];
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onReorder: (nodeIds: string[]) => void;
}) {
  const [constructId, setConstructId] = useState("");
  const [label, setLabel] = useState("");
  /** Which unmapped node is being renamed, and the text so far. Only one at a
   *  time: two open editors over one list is a way to lose an edit. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  // Send the whole order, computed from the list as rendered. Deriving it here
  // rather than sending "move node X up" means the server is told the order
  // the researcher actually saw, so a list that changed underneath is rejected
  // rather than silently reordered around a stale assumption.
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= resolved.length) return;
    const ids = resolved.map((r) => r.node.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  }

  return (
    <section aria-labelledby="fw-nodes-heading" className="rounded border border-neutral-200 p-3">
      <h3 id="fw-nodes-heading" className="text-sm font-medium">
        Concepts in the framework ({resolved.length})
      </h3>

      {resolved.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-600">
          No concepts yet. Add the constructs your study relates to each other.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {resolved.map((r, index) => (
            <li key={r.node.id} className="rounded border border-neutral-200 p-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {/* The position is announced, not just implied by the
                        order — a screen reader reading one row out of context
                        otherwise has no way to know a reorder did anything. */}
                    <span className="mr-1 text-neutral-400">{index + 1}.</span>
                    {r.displayName}
                  </p>
                  {r.construct ? (
                    <>
                      <p className="text-neutral-600">
                        {CONSTRUCT_ROLE_LABELS[r.construct.role]}
                      </p>
                      {r.construct.conceptual_definition && (
                        <p className="mt-0.5 text-neutral-500">{r.construct.conceptual_definition}</p>
                      )}
                      {/* §9's most common measurement gap, visible where the
                          concept is being positioned rather than only in the
                          methodology workspace. */}
                      {!r.construct.operational_definition && (
                        <p className="mt-0.5 text-amber-800">No operational definition yet.</p>
                      )}
                    </>
                  ) : (
                    <p className="mt-0.5 text-amber-800">
                      Not linked to a construct — nothing checks this against your methodology.
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-neutral-400">
                    {PROVENANCE_LABELS[r.node.provenance]}
                    {!r.node.confirmed && " · awaiting your confirmation"}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {/* Layout, §13. Buttons rather than a drag handle: dragging
                      is the mouse-only interaction §33 rules out, and these
                      work identically with a keyboard, a screen reader and a
                      320px touch target. Disabled at the ends rather than
                      hidden, so the control does not move between rows. */}
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    <span aria-hidden="true">↑</span>
                    <span className="sr-only">Move {r.displayName} up</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === resolved.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    <span aria-hidden="true">↓</span>
                    <span className="sr-only">Move {r.displayName} down</span>
                  </button>

                  {/* Renaming is offered only for an unmapped node. A mapped
                      node's name comes from its construct, and editing the
                      label here would create the second source of truth the
                      canonical binding exists to remove — rename the
                      construct in the methodology workspace instead. */}
                  {r.unmapped && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenaming({ id: r.node.id, value: r.node.label ?? "" })}
                      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      Rename
                    </button>
                  )}
                  {r.unmapped && constructs.length > 0 && (
                    <label className="flex items-center gap-1">
                      <span className="sr-only">Link {r.displayName} to a construct</span>
                      <select
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => e.target.value && onPatch(r.node.id, { constructId: e.target.value })}
                        className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                      >
                        <option value="">Link to construct…</option>
                        {constructs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!r.unmapped && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onPatch(r.node.id, { constructId: null })}
                      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      Unlink construct
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemove(r.node.id)}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {renaming?.id === r.node.id && (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = renaming.value.trim();
                    // An empty rename is a no-op, not a delete. The database
                    // would refuse it anyway — a node with neither a construct
                    // nor a label fails `research_framework_nodes_identifiable`
                    // — and failing here says so in words rather than as a 500.
                    if (!next) return;
                    if (next !== (r.node.label ?? "")) onPatch(r.node.id, { label: next });
                    setRenaming(null);
                  }}
                >
                  <label className="flex flex-1 flex-col gap-1 text-[11px]">
                    Rename this concept
                    <input
                      type="text"
                      autoFocus
                      value={renaming.value}
                      maxLength={200}
                      onChange={(e) => setRenaming({ id: r.node.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        // Escape cancels the rename without closing the
                        // workspace behind it. Without this the dialog's own
                        // Escape handler fires and the researcher loses the
                        // whole panel for pressing cancel.
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !renaming.value.trim()}
                    className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                  >
                    Save name
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(null)}
                    className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (constructId) onAdd({ constructId });
          else if (label.trim()) onAdd({ label: label.trim() });
          setConstructId("");
          setLabel("");
        }}
      >
        {/* Explicit htmlFor rather than a wrapping label. A <label> that wraps
            a <select> folds the selected option's text into the control's
            accessible name, so a screen reader announces "Relationship
            predicts" instead of "Relationship". */}
        <label htmlFor="fw-add-construct" className="flex flex-col gap-1 text-[11px]">
          Add a construct
        </label>
        <div className="flex flex-col gap-1">
          <select
            id="fw-add-construct"
            value={constructId}
            onChange={(e) => setConstructId(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="">Choose a construct…</option>
            {availableConstructs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex flex-col gap-1 text-[11px]">
          Or name a concept you have not defined yet
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. School climate"
            className="rounded border border-neutral-300 px-2 py-1 text-xs"
          />
        </label>

        <button
          type="submit"
          disabled={busy || (!constructId && !label.trim())}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Add concept
        </button>
      </form>
      {availableConstructs.length === 0 && constructs.length > 0 && (
        <p className="mt-1 text-[11px] text-neutral-500">
          Every construct you have defined is already in the framework.
        </p>
      )}
    </section>
  );
}

function RelationshipsSection({
  relationships,
  nodeById,
  resolved,
  hypotheses,
  busy,
  onAdd,
  onPatch,
  onRemove,
}: {
  relationships: ResearchFrameworkRelationshipRow[];
  nodeById: Map<string, ReturnType<typeof resolveNodes>[number]>;
  resolved: ReturnType<typeof resolveNodes>;
  hypotheses: MethodologyModel["hypotheses"];
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
}) {
  const [fromNodeId, setFrom] = useState("");
  const [toNodeId, setTo] = useState("");
  const [relationType, setType] = useState<FrameworkRelationType>("associated_with");
  const [hypothesisId, setHypothesis] = useState("");

  return (
    <section aria-labelledby="fw-rels-heading" className="rounded border border-neutral-200 p-3">
      <h3 id="fw-rels-heading" className="text-sm font-medium">
        Relationships ({relationships.length})
      </h3>

      {relationships.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-600">
          No relationships yet. A framework with concepts but no relationships does not yet say anything
          about how they connect.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {relationships.map((rel) => {
            const from = nodeById.get(rel.from_node_id);
            const to = nodeById.get(rel.to_node_id);
            const hypothesis = hypotheses.find((h) => h.id === rel.hypothesis_id);
            return (
              <li key={rel.id} className="rounded border border-neutral-200 p-2 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {from?.displayName ?? "(missing)"}{" "}
                      <span className="font-normal text-neutral-600">
                        {FRAMEWORK_RELATION_LABELS[rel.relation_type]}
                      </span>{" "}
                      {to?.displayName ?? "(missing)"}
                    </p>
                    {hypothesis ? (
                      <p className="mt-0.5 text-neutral-600">
                        {hypothesis.label ? `${hypothesis.label}: ` : ""}
                        {hypothesis.statement}
                      </p>
                    ) : rel.hypothesis_id ? (
                      <p className="mt-0.5 text-amber-800">
                        The hypothesis that justified this has been removed.
                      </p>
                    ) : (
                      <p className="mt-0.5 text-neutral-500">Not tied to a hypothesis.</p>
                    )}
                    <p className="mt-0.5 text-[10px] text-neutral-400">
                      {PROVENANCE_LABELS[rel.provenance]}
                      {!rel.confirmed && " · awaiting your confirmation"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <label className="flex items-center gap-1">
                      <span className="sr-only">Relationship type</span>
                      <select
                        value={rel.relation_type}
                        disabled={busy}
                        onChange={(e) => onPatch(rel.id, { relationType: e.target.value })}
                        className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                      >
                        {RELATION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {FRAMEWORK_RELATION_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <span className="sr-only">Hypothesis for this relationship</span>
                      <select
                        value={rel.hypothesis_id ?? ""}
                        disabled={busy}
                        onChange={(e) => onPatch(rel.id, { hypothesisId: e.target.value || null })}
                        className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                      >
                        <option value="">No hypothesis</option>
                        {hypotheses.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label ?? h.statement.slice(0, 40)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemove(rel.id)}
                      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {resolved.length >= 2 && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
            onAdd({
              fromNodeId,
              toNodeId,
              relationType,
              hypothesisId: hypothesisId || null,
            });
            setFrom("");
            setTo("");
            setHypothesis("");
          }}
        >
          {/* Explicit htmlFor throughout: a <label> wrapping a <select> folds
              the selected option's text into the accessible name, so this row
              would announce as "Relationship predicts" rather than
              "Relationship". */}
          <div className="flex flex-col gap-1">
            <label htmlFor="fw-rel-from" className="text-[11px]">
              From
            </label>
            <select
              id="fw-rel-from"
              value={fromNodeId}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="">Choose…</option>
              {resolved.map((r) => (
                <option key={r.node.id} value={r.node.id}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="fw-rel-type" className="text-[11px]">
              Relationship
            </label>
            <select
              id="fw-rel-type"
              value={relationType}
              onChange={(e) => setType(e.target.value as FrameworkRelationType)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FRAMEWORK_RELATION_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="fw-rel-to" className="text-[11px]">
              To
            </label>
            <select
              id="fw-rel-to"
              value={toNodeId}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="">Choose…</option>
              {resolved
                .filter((r) => r.node.id !== fromNodeId)
                .map((r) => (
                  <option key={r.node.id} value={r.node.id}>
                    {r.displayName}
                  </option>
                ))}
            </select>
          </div>

          {hypotheses.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="fw-rel-hypothesis" className="text-[11px]">
                Hypothesis (optional)
              </label>
              <select
                id="fw-rel-hypothesis"
                value={hypothesisId}
                onChange={(e) => setHypothesis(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                <option value="">None</option>
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label ?? h.statement.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !fromNodeId || !toNodeId || fromNodeId === toNodeId}
            className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Add relationship
          </button>
        </form>
      )}
    </section>
  );
}
