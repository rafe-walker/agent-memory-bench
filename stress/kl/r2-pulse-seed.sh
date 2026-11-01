#!/usr/bin/env bash
# Round 2, (d) cursor recovery: the agent read v1, v2 changed it (pending for the agent), then the shim's position is
# missing / unreadable (new project checkout, state dir wiped, cursor of another actor). Does `pulse --pending-actor`
# still refuse a world-changing command while the agent has a pending item?
# usage: KLBIN=<kl>/dist/cli.js stress/kl/r2-pulse-seed.sh      prints one JSON line per variant; exit 1 = allowed with pending
set -uo pipefail
KLBIN=${KLBIN:?set KLBIN}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home" KRONICLE_LITE_DATA_DIR="$T/no-default-store"; mkdir -p "$HOME" "$T/p"; cd "$T/p"
k() { local c=$1; shift; node "$KLBIN" "$c" --data-dir "$T/d" "$@"; }
printf '# Runbook\n\nDeploy with --target staging-a.\n' > "$T/v1.md"; printf '# Runbook\n\nDeploy with --target prod-eu.\n' > "$T/v2.md"
k put runbook "$T/v1.md" --actor w >/dev/null; k get runbook --actor agent >/dev/null
k pulse --cwd . --state "$T/seeded" -- git push >/dev/null 2>&1
k put runbook "$T/v2.md" --actor w >/dev/null
pc=$(k pending --actor agent --json | node -pe 'JSON.parse(require("fs").readFileSync(0)).pending_count')
bad=0
for v in seeded fresh_state_dir; do
  k pulse --cwd . --state "$T/$v" --pending-actor agent --json -- git push >"$T/o.json" 2>/dev/null; rc=$?
  dec=$(node -pe 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));o.decision+"/"+o.reason' "$T/o.json")
  echo "{\"variant\":\"$v\",\"agent_pending\":$pc,\"pulse_exit\":$rc,\"decision\":\"$dec\"}"
  [ "$pc" -gt 0 ] && [ $rc -eq 0 ] && bad=1
done
exit $bad
