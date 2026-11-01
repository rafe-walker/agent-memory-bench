#!/usr/bin/env bash
# Round 2: what every agent-facing surface says about ONE edit, via the published CLI.
# An agent reads v1 (`get`), a hook seeds its cursor, the doc is re-put as v2, then:
#   orient --focus retractions --json   (push contract)  -> retractions / format_only_edits
#   pending --actor agent --json        (version-bound)  -> pending_count
#   pulse --pending-actor agent -- git push               -> exit 0 allow / 77 deny
# usage: KLBIN=<path to dist/cli.js> stress/kl/r2-gate.sh OLD.md NEW.md      (or OLD/NEW as literal strings with -s)
set -euo pipefail
KLBIN=${KLBIN:?set KLBIN=<kronicle-lite checkout>/dist/cli.js}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
if [ "${1:-}" = "-s" ]; then printf '%b' "$2" > "$T/v1.md"; printf '%b' "$3" > "$T/v2.md"; else cp "$1" "$T/v1.md"; cp "$2" "$T/v2.md"; fi
D="$T/data"; P="$T/proj"; mkdir -p "$P"; cd "$P"
# Sandbox: never fall back to the user's default store (~/.kronicle-lite) if an argument slips past `--`.
export HOME="$T/home" KRONICLE_LITE_DATA_DIR="$T/no-default-store"; mkdir -p "$HOME"
k() { local c=$1; shift; node "$KLBIN" "$c" --data-dir "$D" "$@"; }
k put runbook "$T/v1.md" --title Runbook --actor writer >/dev/null
k get runbook --actor agent >/dev/null
k pulse --cwd "$P" --state "$T/st" -- git push >/dev/null 2>&1 || true   # seed the shim position
C=$(k orient --actor push-hook --json --cwd "$P" --focus pulse | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).cursor))')
k put runbook "$T/v2.md" --title Runbook --actor writer >/dev/null
k orient --actor push-hook --json --cwd "$P" --cursor "$C" --focus retractions > "$T/o.json"
k pending --actor agent --json --cwd "$P" > "$T/p.json"
set +e; k pulse --cwd "$P" --state "$T/st" --pending-actor agent -- git push >/dev/null 2>"$T/pulse.err"; rc=$?; set -e
node -e '
const o=require(process.argv[1]), p=require(process.argv[2]);
console.log(JSON.stringify({retractions:o.retractions.length, format_only_edits:(o.format_only_edits||[]).length,
  diff:o.retractions[0]?.diff ?? (o.format_only_edits||[])[0]?.diff ?? null, pending_count:p.pending_count, pulse_exit:Number(process.argv[3])}));' "$T/o.json" "$T/p.json" "$rc"
