#!/usr/bin/env bash
#
# Run one real-Postgres isolation suite against the local Supabase database.
#
# The suites used to be five `docker exec -i supabase_db_AI_for_research psql`
# lines in package.json. Three things were wrong with that, and all three are
# reproducibility problems rather than style ones (Phase 21 §4, §62):
#
#   * `docker` is frequently not on PATH even when Docker is installed and
#     running — Docker Desktop puts it in ~/.docker/bin, which a non-login
#     shell does not pick up. The suite then failed with "command not found",
#     which reads like a broken test rather than a missing tool.
#   * the container name was hard-coded to this machine's project id. A clone
#     into a differently named directory gets a differently named container.
#   * a suite that cannot run said so in the words of whatever failed first.
#     §62 requires "NOT RUN — <specific reason>", never a silent pass and
#     never a failure that looks like the database rejecting the test.
#
# Exit codes are the point of the last one: 0 pass, 1 the suite actually
# failed, 2 the suite could not be run here. A caller — CI included — can
# tell "isolation is broken" from "there is no database on this machine".
set -euo pipefail

SUITE="${1:?usage: db-isolation.sh <suite-sql-path>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$ROOT/$SUITE" ]; then
  echo "NOT RUN — suite file not found: $SUITE" >&2
  exit 2
fi

# Docker Desktop's binary, wherever it actually is.
if ! command -v docker >/dev/null 2>&1; then
  for candidate in "$HOME/.docker/bin" /usr/local/bin /opt/homebrew/bin \
                   /Applications/Docker.app/Contents/Resources/bin; do
    if [ -x "$candidate/docker" ]; then PATH="$candidate:$PATH"; break; fi
  done
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "NOT RUN — Docker CLI unavailable; the local Supabase database runs in Docker." >&2
  echo "          Install Docker Desktop, then: supabase start" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "NOT RUN — Docker is installed but the daemon is not running." >&2
  exit 2
fi

# The container is named from `project_id` in supabase/config.toml, which
# defaults to the directory name — so it differs per clone. Read it rather
# than assume it, and fall back to discovery if the file has been changed.
PROJECT_ID="$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' \
  "$ROOT/supabase/config.toml" | head -1)"
CONTAINER="supabase_db_${PROJECT_ID}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  FOUND="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1 || true)"
  if [ -n "$FOUND" ] && [ -z "$PROJECT_ID" ]; then
    CONTAINER="$FOUND"
  else
    echo "NOT RUN — local Supabase database container '$CONTAINER' is not running." >&2
    echo "          Start it with: supabase start" >&2
    exit 2
  fi
fi

# ON_ERROR_STOP so a suite that cannot even set itself up fails loudly instead
# of running its remaining checks against a half-built fixture.
OUTPUT="$(docker exec -i "$CONTAINER" psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < "$ROOT/$SUITE" 2>&1)" || {
  echo "$OUTPUT"
  echo "FAIL — $SUITE did not complete." >&2
  exit 1
}

echo "$OUTPUT"

# The suites assert with `raise exception`, so psql's exit code already covers
# a hard failure. This catches the other shape: a suite that ran to the end
# but printed a FAIL notice.
if echo "$OUTPUT" | grep -q 'FAIL'; then
  echo "FAIL — $SUITE reported a failing check." >&2
  exit 1
fi
