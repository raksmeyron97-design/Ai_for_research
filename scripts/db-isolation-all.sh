#!/usr/bin/env bash
#
# Every real-Postgres isolation suite, in phase order, with one summary at the
# end (Phase 21 §6).
#
# The reason this exists rather than `npm run a && npm run b && ...`: `&&`
# stops at the first failure, so a run that fails in Phase 17 says nothing
# about 18, 19, 20 or 21. When the question is "is the database sound after a
# clean reset", the useful answer is the whole column, not the first red cell.
#
# It also keeps §62 honest at the suite level. A suite that could not run here
# is reported NOT RUN and is never counted as a pass, and the exit code
# distinguishes the three outcomes: 0 all passed, 1 something failed, 2
# nothing failed but something could not be run.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SUITES=(
  "17:phase17_project_isolation.sql"
  "17B:phase17b_project_isolation.sql"
  "18:phase18_project_isolation.sql"
  "19:phase19_project_isolation.sql"
  "20:phase20_project_isolation.sql"
  "21:phase21_project_isolation.sql"
)

declare -a RESULTS=()
FAILED=0
SKIPPED=0

for entry in "${SUITES[@]}"; do
  phase="${entry%%:*}"
  file="${entry#*:}"
  printf '\n===== Phase %s isolation =====\n' "$phase"

  if bash "$ROOT/scripts/db-isolation.sh" "supabase/tests/$file"; then
    RESULTS+=("Phase $phase: PASS")
  else
    code=$?
    if [ "$code" -eq 2 ]; then
      RESULTS+=("Phase $phase: NOT RUN")
      SKIPPED=1
    else
      RESULTS+=("Phase $phase: FAIL")
      FAILED=1
    fi
  fi
done

printf '\n===== isolation summary =====\n'
printf '%s\n' "${RESULTS[@]}"

if [ "$FAILED" -eq 1 ]; then exit 1; fi
if [ "$SKIPPED" -eq 1 ]; then exit 2; fi
