#!/usr/bin/env bash
#
# Prove, by hashing real files around a real run, that `ai:benchmark:dry`
# cannot damage the live benchmark record (Phase 21 §11, §54).
#
# The unit tests in tests/ai-benchmark/__tests__/artifact-isolation.test.ts
# check the decision `loadConfig` makes. This checks the outcome: it hashes
# every live artifact, runs the actual dry gate, and hashes them again. If a
# future change routes any writer back at the live directory — a second
# reporter, a hard-coded path, a copy step — this fails and the unit test
# would not.
#
# It also asserts the two things §11 asks of the dry run itself: that it made
# zero provider calls, and that what it produced is labelled as mocked.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DIR="$ROOT/reports/ai-benchmark"
DRY_DIR="$LIVE_DIR/dry"

hash_live() {
  # `raw/` is gitignored regenerated output and `dry/` is this run's own
  # target, so neither belongs in the fingerprint. Everything else in the live
  # directory is committed evidence that must come out byte-identical.
  find "$LIVE_DIR" -maxdepth 2 -type f \
    -not -path "*/raw/*" -not -path "$DRY_DIR/*" \
    | LC_ALL=C sort | xargs shasum -a 256
}

echo "=== live artifacts before ==="
BEFORE="$(hash_live)"
echo "$BEFORE"

echo
echo "=== running npm run ai:benchmark:dry ==="
LOG="$(mktemp)"
if ! (cd "$ROOT" && npm run --silent ai:benchmark:dry) >"$LOG" 2>&1; then
  tail -40 "$LOG"
  echo "FAIL — the dry benchmark did not complete." >&2
  exit 1
fi
tail -6 "$LOG"

echo
echo "=== live artifacts after ==="
AFTER="$(hash_live)"
echo "$AFTER"

FAILED=0

if [ "$BEFORE" != "$AFTER" ]; then
  echo >&2
  echo "FAIL — the dry run modified the live benchmark record:" >&2
  diff <(echo "$BEFORE") <(echo "$AFTER") >&2 || true
  FAILED=1
else
  echo
  echo "PASS — every live artifact is byte-identical."
fi

# The dry run must have produced its own artifacts, or "unchanged" would just
# mean nothing ran at all.
if [ ! -f "$DRY_DIR/latest.json" ]; then
  echo "FAIL — no dry artifact at $DRY_DIR/latest.json; the run wrote nowhere." >&2
  FAILED=1
else
  MODE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mode)' "$DRY_DIR/latest.json")"
  if [ "$MODE" = "dry" ]; then
    echo "PASS — dry artifact is labelled mode=dry."
  else
    echo "FAIL — dry artifact claims mode=$MODE." >&2
    FAILED=1
  fi

  # §11/§12: zero provider calls, read from the artifact's own
  # `provider_calls` — the count the request budget kept, not the flag that
  # was set and not a line scraped out of a log the test runner may swallow.
  CALLS="$(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(typeof r.provider_calls === "number" ? r.provider_calls : "absent");
  ' "$DRY_DIR/latest.json")"
  if [ "$CALLS" = "0" ]; then
    echo "PASS — 0 provider calls."
  else
    echo "FAIL — the dry run recorded provider_calls=$CALLS." >&2
    FAILED=1
  fi

  # Every execution must have come from the stub. A single non-MOCKED mode
  # means something reached the network.
  NON_MOCKED="$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).execution_modes ?? {};
    console.log(Object.keys(m).filter((k) => k !== "MOCKED").join(",") || "none");
  ' "$DRY_DIR/latest.json")"
  if [ "$NON_MOCKED" = "none" ]; then
    echo "PASS — every execution mode is MOCKED."
  else
    echo "FAIL — non-mocked execution modes in a dry run: $NON_MOCKED" >&2
    FAILED=1
  fi
fi

rm -f "$LOG"
exit "$FAILED"
