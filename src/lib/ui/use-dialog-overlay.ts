"use client";

import { useEffect, useRef } from "react";

/**
 * Dialog semantics for the full-screen workspace overlays (§33).
 *
 * The overlays were `fixed inset-0` divs. Visually that covers the workspace;
 * for a keyboard it does not exist. Tab order still ran through the whole
 * page underneath — navigator, editor, every aside control — so reaching the
 * first button inside an open overlay took more than twenty-five presses, and
 * Tab from the last one landed silently behind it. Found by counting the
 * presses in a real browser; jsdom has no tab order to count.
 *
 * Three things, which is what makes a dialog a dialog:
 *
 *   * focus moves into the overlay when it opens, so the next Tab is inside it
 *   * focus is trapped, so Tab and Shift+Tab cycle within it
 *   * focus returns to whatever opened it when it closes, so the researcher's
 *     place is not lost
 *
 * Escape closes, because a full-screen overlay with no keyboard exit is a trap
 * in the other sense — but it closes on the *bubble* phase, so a control
 * inside the overlay can claim Escape for itself. See below.
 *
 * `aria-modal` is set by the caller alongside `role="dialog"`; this hook does
 * not inject attributes, so the markup stays readable where it is written.
 */
export function useDialogOverlay(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Remembered before focus moves, so it can be handed back on close. This
    // is the element the researcher was on when they opened the overlay.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

    // The first control, not the container: focusing a non-interactive
    // wrapper announces nothing useful and the next Tab would leave anyway.
    const first = focusable()[0];
    first?.focus();

    // Captured into a const so the closure below does not have to re-narrow
    // `ref.current`, which TypeScript cannot prove is still non-null.
    const root = container;

    /**
     * Escape, on the bubble phase (Phase 21).
     *
     * This used to live in the capture listener below, and that was wrong in a
     * way nothing could work around: a capture listener on `document` runs
     * *before* the element the researcher is actually typing in, so pressing
     * Escape in any control inside the overlay closed the whole overlay, and
     * the control's own `onKeyDown` never ran to prevent it. Checking
     * `defaultPrevented` would not have helped either — at capture time
     * nothing has had the chance to set it.
     *
     * Found by the framework rename field, where Escape has to mean "cancel
     * this rename". It applies to every nested editor these overlays will
     * grow, and getting it wrong loses whatever the researcher had open.
     *
     * On bubble, an inner handler's `stopPropagation()` means exactly what it
     * reads as: this control handled Escape, the dialog should not also act on
     * it. Escape pressed anywhere else still reaches document and still
     * closes.
     */
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
      // Tab stays on capture: focus trapping has to win against anything else
      // listening, and no inner control legitimately wants Tab to escape the
      // overlay.
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Wrap at both ends. Also catches focus that has somehow escaped the
      // container — a click on the page behind, say — and pulls it back.
      if (event.shiftKey && (active === firstItem || !root.contains(active))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (active === lastItem || !root.contains(active))) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onEscape);
      // Only if it is still in the document: the element that opened the
      // overlay may itself have been re-rendered away.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // `onClose` is a fresh function on most renders; re-running the effect for
    // that would move focus back to the first control mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
