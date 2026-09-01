/**
 * Pure text logic, kept out of the component so it can be tested without a
 * JSX transform and reused anywhere a before/after view is needed.
 */
/**
 * A word-level diff, good enough to show a researcher what a replacement
 * changes. Not a Myers diff: this is a longest-common-subsequence walk over
 * whitespace-split tokens, which reads well for prose paragraphs and costs
 * nothing to maintain. It is a review aid, not a merge tool — the researcher
 * is deciding whether to accept whole text, not resolving hunks.
 */
export function diffWords(before: string, after: string): { type: "same" | "removed" | "added"; text: string }[] {
  const a = before.split(/(\s+)/).filter((t) => t.length > 0);
  const b = after.split(/(\s+)/).filter((t) => t.length > 0);

  // Guard against the quadratic table on very large sections: above this,
  // show a whole-block replacement rather than freezing the browser.
  if (a.length * b.length > 400_000) {
    return [
      { type: "removed", text: before },
      { type: "added", text: after },
    ];
  }

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: { type: "same" | "removed" | "added"; text: string }[] = [];
  const push = (type: "same" | "removed" | "added", text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("removed", a[i]);
      i += 1;
    } else {
      push("added", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);

  return out;
}
