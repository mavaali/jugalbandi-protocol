#!/usr/bin/env bash
# Behavioral smoke test for the Jugalbandi plugin.
#
# Runs the real two-round protocol against a throwaway fixture repo and asserts the
# invariants the protocol depends on. This costs a live model run (five subagents),
# needs an authenticated `claude`, and takes several minutes — so it is not a
# per-commit check. Run it before a release, or after touching any SKILL.md or agent
# prompt.
#
# Usage: scripts/smoke-plugin.sh [workdir]

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/jugalbandi"
WORK="${1:-$(mktemp -d)}"

failures=0
check() {
  local label="$1"; shift
  if "$@"; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label"
    failures=$((failures + 1))
  fi
}

# Count occurrences of a pattern in a file, then compare against a minimum.
count_at_least() {
  local file="$1" pattern="$2" min="$3"
  local n
  n=$(grep -oE "$pattern" "$file" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -ge "$min" ]
}

echo "Fixture: $WORK"
mkdir -p "$WORK"
cat > "$WORK/server.js" <<'EOF'
export function handler(req) {
  return { status: 200, body: "ok" };
}
EOF

echo "Running the protocol (two rounds, this takes a few minutes)…"
(
  cd "$WORK" && claude -p \
    "/jugalbandi:plan Add per-user rate limiting to server.js --rounds 2" \
    --plugin-dir "$PLUGIN_DIR" \
    --permission-mode acceptEdits
) >"$WORK/run.log" 2>&1
run_status=$?

if [ $run_status -ne 0 ]; then
  echo "✗ the run itself failed (exit $run_status); see $WORK/run.log"
  exit 1
fi

# Resolve the proposal first and guard on it. `dirname ""` prints `.`, which is a real
# directory, so wrapping the find in dirname before testing lets a missing run silently
# pass the guard and fail later as a pile of confusing assertion errors.
PROPOSAL="$(find "$WORK/.jugalbandi" -maxdepth 2 -name proposal.md -not -path '*/round-2/*' 2>/dev/null | head -1)"
if [ -z "$PROPOSAL" ]; then
  echo "✗ no run directory under $WORK/.jugalbandi; see $WORK/run.log"
  exit 1
fi
RUN_DIR="$(dirname "$PROPOSAL")"
echo "Artifacts: $RUN_DIR"

echo
echo "Round 1"
check "proposal written"            test -s "$RUN_DIR/proposal.md"
check "proposal has ## Assumptions" grep -qE '^##+ *Assumptions' "$RUN_DIR/proposal.md"
check "proposal lists ≥5 assumptions" \
  count_at_least "$RUN_DIR/proposal.md" '^[[:space:]]*[-*][[:space:]]' 5
check "challenges written"          test -s "$RUN_DIR/challenges.md"
check "≥3 tagged challenges" \
  count_at_least "$RUN_DIR/challenges.md" '\[(STRUCTURAL|ASSUMPTION|MISSING)\]' 3
check "final plan written"          test -s "$RUN_DIR/final-plan.md"
check "final plan has a revised plan" \
  grep -qiE '^##+ *Revised Plan' "$RUN_DIR/final-plan.md"
check "every challenge dispositioned" \
  count_at_least "$RUN_DIR/final-plan.md" '\*\*(Accepted|Rejected|Escalated)\*\*' \
  "$(grep -oE '\[(STRUCTURAL|ASSUMPTION|MISSING)\]' "$RUN_DIR/challenges.md" | wc -l | tr -d ' ')"

echo
echo "Round 2"
R2="$RUN_DIR/round-2"
check "round-2 proposal written"    test -s "$R2/proposal.md"

# The strip invariant. A round-2 proposal carrying dispositions means the Challenger
# can see what was already argued, and will re-litigate rejections instead of
# attacking the plan. This is the assertion most worth having.
check "round-2 proposal carries no dispositions" \
  bash -c '! grep -qE "\*\*(Accepted|Rejected|Escalated)\*\*" "$0"' "$R2/proposal.md"
check "round-2 proposal carries no disposition heading" \
  bash -c '! grep -qiE "^##+ *Dispositions" "$0"' "$R2/proposal.md"
check "round-2 proposal carries no round-1 challenge tags" \
  bash -c '! grep -qE "\[(STRUCTURAL|ASSUMPTION|MISSING)\]" "$0"' "$R2/proposal.md"

check "round-2 challenges written"  test -s "$R2/challenges.md"
check "≥3 tagged round-2 challenges" \
  count_at_least "$R2/challenges.md" '\[(STRUCTURAL|ASSUMPTION|MISSING)\]' 3
check "round-2 final plan written"  test -s "$R2/final-plan.md"

echo
if [ "$failures" -gt 0 ]; then
  echo "✗ $failures assertion(s) failed. Artifacts kept at $RUN_DIR"
  exit 1
fi
echo "✓ all assertions passed"
