#!/usr/bin/env bash
# Hand-edit one chained event's payload to non-JSON (what a stray sqlite3 UPDATE or a torn
# page leaves). PUSH.md promises the hook sees integrity.ok=false; instead orient exits 1
# ("treat as nothing to push") and the agent is told nothing. usage: KLBIN=... KL=<kl checkout> tamper-json.sh
set -uo pipefail
KLBIN=${KLBIN:?}; KL=${KL:?}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT; D=$W/data
printf '# Runbook\n\n## Deploy\n\nDeploy to stg-west-2.\n' > "$W/r.md"; node "$KLBIN" put runbook "$W/r.md" --data-dir "$D" --cwd "$W" >/dev/null
C=$(node "$KLBIN" orient --data-dir "$D" --cwd "$W" --actor push-hook --json --focus pulse | jq -r .cursor)
printf '# Runbook\n\n## Deploy\n\nDeploy to stg-east-1.\n' > "$W/r.md"; node "$KLBIN" put runbook "$W/r.md" --data-dir "$D" --cwd "$W" >/dev/null
mode=${MODE:-badjson}
NODE_PATH=$KL/node_modules node "$(dirname "$0")/tamper-event.cjs" "$D" "$mode"
for f in retractions pulse orientation; do
  node "$KLBIN" orient --data-dir "$D" --cwd "$W" --actor push-hook --json --cursor "$C" --focus $f >"$W/o" 2>"$W/e"; ec=$?
  echo "focus=$f exit=$ec integrity.ok=$(jq -r '.integrity.ok' "$W/o" 2>/dev/null) retractions=$(jq -r '.retractions|length' "$W/o" 2>/dev/null) stderr=$(head -c 140 "$W/e")"
done
node "$KLBIN" verify-chain --data-dir "$D" >"$W/v" 2>&1; echo "verify-chain exit=$? $(grep -m1 -o 'error.*' "$W/v" | head -c 140)"
