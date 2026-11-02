#!/usr/bin/env bash
# Clock skew vs sea-lite leases (libfaketime). A: alice claims src/a.ts for 600 s with a clock that is
# SKEW behind; B: bob (real clock) then tries claim / scope-check. B: alice real, bob's clock ahead.
# Also checks whether the chain accepts occurred_at going backwards.
# usage: SLBIN=… KLBIN=… stress/chaos/sl-skew-lease.sh
set -uo pipefail
SLBIN=${SLBIN:?}; KLBIN=${KLBIN:?}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/r"; cd "$W/r"; git init -q; unset SEA_LITE_ACTOR SEA_LITE_SESSION CLAUDE_CODE_SESSION_ID
D=$W/d; sl() { node "$SLBIN" "$@" --data-dir "$D"; }
for case in "alice:-15m bob:0" "alice:0 bob:+15m"; do
  a=${case%% *}; b=${case##* }; as=${a#alice:}; bs=${b#bob:}
  T=$(sl create "t $case" --triaged --json | jq -r .ticket.id)
  ft() { local s=$1; shift; if [ "$s" = 0 ]; then "$@"; else faketime -f "$s" "$@"; fi; }
  SEA_LITE_ACTOR=alice SEA_LITE_SESSION=sa ft "$as" node "$SLBIN" claim "$T" --paths "src/$T.ts" --lease 600 --json --data-dir "$D" > "$W/a" 2>&1; echo "[$case] alice claim exit=$? expires=$(jq -r '.claims[0].expires_at // .claims[0].claim.expires_at // empty' "$W/a")"
  SEA_LITE_ACTOR=bob SEA_LITE_SESSION=sb ft "$bs" node "$SLBIN" scope-check --paths "src/$T.ts" --data-dir "$D" >/dev/null 2>&1; echo "[$case] bob scope-check exit=$? (1 = blocked)"
  SEA_LITE_ACTOR=bob SEA_LITE_SESSION=sb ft "$bs" node "$SLBIN" claim "$T" --paths "src/$T.ts" --json --data-dir "$D" > "$W/b" 2>&1; echo "[$case] bob claim exit=$? (want 1: alice's lease has ~600 s left in real time) $(head -c 120 "$W/b" | tr '\n' ' ')"
done
node "$KLBIN" export --data-dir "$D" | jq -r 'select(.seq) | "\(.seq) \(.occurred_at) \(.event_type)"' | awk 'prev > $2 {print "  occurred_at goes BACKWARDS at seq " $1 ": " $2 " < " prev} {prev=$2}'
node "$KLBIN" verify-chain --full --data-dir "$D" >/dev/null 2>&1; echo "verify-chain --full exit=$?"; node "$SLBIN" verify --json --data-dir "$D" | jq -c '{ok}'
