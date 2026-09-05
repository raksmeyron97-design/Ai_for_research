"use client";

import { useState } from "react";
import type { SupportLabel } from "@/lib/db/types";
import type { InsertionMode } from "@/lib/evidence/insertion";
import type { EvidenceCardModel } from "@/components/EvidenceCard";

/**
 * The step between finding evidence and inserting it (§15-§17).
 *
 * Two decisions are forced here, and neither has a default that lets a
 * researcher skip it by clicking through:
 *
 * **Support.** The preselected value is NEEDS_REVIEW, not SUPPORTED. A default
 * of SUPPORTED would make "I attached a source" and "I checked the source says
 * this" the same action, and the whole evidence model exists to keep them
 * apart. Choosing SUPPORTED is a claim the researcher is making, so they make
 * it deliberately.
 *
 * **Mode.** Replace Claim rewrites the researcher's own sentence, so it is
 * never the default and never reachable without typing the replacement (§17).
 */
const SUPPORT_OPTIONS: { value: SupportLabel; label: string; hint: string }[] = [
  { value: "SUPPORTED", label: "Supported", hint: "The excerpt states what the claim asserts." },
  { value: "PARTIAL", label: "Partially supported", hint: "It supports part of the claim, or with caveats." },
  { value: "UNSUPPORTED", label: "Unsupported", hint: "The excerpt does not support the claim." },
  { value: "NEEDS_REVIEW", label: "Needs review", hint: "Attached, but not checked yet." },
];

const MODE_OPTIONS: { value: InsertionMode; label: string; hint: string }[] = [
  { value: "citation_only", label: "Citation only", hint: "Adds the citation to your existing sentence." },
  {
    value: "evidence_citation",
    label: "Evidence + citation",
    hint: "Saves the excerpt as evidence and adds the citation.",
  },
  { value: "replace_claim", label: "Replace claim", hint: "Rewrites your sentence. Only if you ask for it." },
];

export interface InsertRequest {
  mode: InsertionMode;
  support: SupportLabel;
  note: string | null;
  replacementText?: string;
}

export default function EvidenceInsertPreview({
  claimText,
  evidence,
  busy,
  error,
  onInsert,
  onCancel,
}: {
  claimText: string;
  evidence: EvidenceCardModel;
  busy?: boolean;
  error?: string | null;
  onInsert: (request: InsertRequest) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<InsertionMode>("evidence_citation");
  const [support, setSupport] = useState<SupportLabel>("NEEDS_REVIEW");
  const [note, setNote] = useState("");
  const [replacement, setReplacement] = useState("");

  const blocked = mode === "replace_claim" && !replacement.trim();

  return (
    <section
      aria-labelledby="evidence-preview-heading"
      className="rounded border border-neutral-900 bg-white p-3 text-xs"
    >
      <h4 id="evidence-preview-heading" className="mb-2 text-sm font-medium">
        Before you insert
      </h4>

      <dl className="space-y-2">
        <div>
          <dt className="text-[11px] font-medium text-neutral-500">Claim</dt>
          <dd className="text-neutral-900">{claimText}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-neutral-500">Selected evidence</dt>
          <dd className="rounded bg-neutral-50 p-2 leading-relaxed text-neutral-800">“{evidence.excerpt}”</dd>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-[11px] font-medium text-neutral-500">Source</dt>
            <dd className="text-neutral-900">{evidence.sourceTitle ?? evidence.citationKey ?? "Untitled"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-neutral-500">Page</dt>
            <dd className="text-neutral-900">{evidence.page ? `p. ${evidence.page}` : "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-neutral-500">Citation</dt>
            <dd className="font-mono text-neutral-900">
              {evidence.citationKey ? `[${evidence.citationKey}]` : "No citation key"}
            </dd>
          </div>
        </div>
      </dl>

      <fieldset className="mt-3">
        <legend className="text-[11px] font-medium text-neutral-500">Does it support the claim?</legend>
        <div className="mt-1 space-y-1">
          {SUPPORT_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="support"
                value={option.value}
                checked={support === option.value}
                onChange={() => setSupport(option.value)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-[11px] text-neutral-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-[11px] font-medium text-neutral-500">How should it be inserted?</legend>
        <div className="mt-1 space-y-1">
          {MODE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-[11px] text-neutral-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "replace_claim" && (
        <div className="mt-2">
          <label htmlFor="evidence-replacement" className="text-[11px] font-medium text-neutral-500">
            Replacement wording
          </label>
          <textarea
            id="evidence-replacement"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            rows={3}
            placeholder="Write the sentence that should replace your claim."
            className="mt-1 w-full rounded border border-neutral-300 p-2 text-xs focus:border-neutral-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Your sentence is replaced only with wording you write here. Nothing is rewritten for you.
          </p>
        </div>
      )}

      <div className="mt-2">
        <label htmlFor="evidence-note" className="text-[11px] font-medium text-neutral-500">
          Note (optional)
        </label>
        <input
          id="evidence-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this excerpt, in your own words."
          className="mt-1 w-full rounded border border-neutral-300 p-2 text-xs focus:border-neutral-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() =>
            onInsert({
              mode,
              support,
              note: note.trim() || null,
              replacementText: mode === "replace_claim" ? replacement.trim() : undefined,
            })
          }
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {busy ? "Inserting…" : "Insert evidence"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
