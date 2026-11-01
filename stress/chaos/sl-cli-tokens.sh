#!/usr/bin/env bash
# N agents (distinct actor+session) claim N distinct tickets from the CLI at the same moment, then
# each releases its own ticket. The CLI keeps claim tokens in ONE shared <data dir>/cli-claims.json
# (read-modify-write, no lock): count tokens that survive and releases that fail.
# usage: SLBIN=<sea-lite>/dist/cli.js stress/chaos/sl-cli-tokens.sh [N]
set -uo pipefail
SLBIN=${SLBIN:?}; N=${1:-20}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/repo"; git -C "$W/repo" init -q; cd "$W/repo"
unset SEA_LITE_ACTOR SEA_LITE_SESSION CLAUDE_CODE_SESSION_ID KRONICLE_LITE_DATA_DIR
D=$W/data; s() { node "$SLBIN" "$@" --data-dir "$D"; }
for i in $(seq 1 "$N"); do s create "t$i" --triaged --json | jq -r .ticket.id > "$W/id$i"; done
for i in $(seq 1 "$N"); do SEA_LITE_ACTOR="a$i" SEA_LITE_SESSION="s$i" s claim "$(cat "$W/id$i")" --paths "src/f$i.ts" --lease 600 --json >"$W/c$i" 2>"$W/ce$i" & done; wait
ok=0; for i in $(seq 1 "$N"); do jq -e '.claims | length > 0' "$W/c$i" >/dev/null 2>&1 && ok=$((ok+1)); done
kept=$(jq '.claims | length' "$D/cli-claims.json")
echo "claims granted=$ok/$N  tokens in cli-claims.json=$kept/$N"
for i in $(seq 1 "$N"); do SEA_LITE_ACTOR="a$i" SEA_LITE_SESSION="s$i" s release "$(cat "$W/id$i")" --json >"$W/r$i" 2>"$W/re$i"; echo $? > "$W/rc$i"; done
bad=0; for i in $(seq 1 "$N"); do [ "$(cat "$W/rc$i")" != 0 ] && { bad=$((bad+1)); [ $bad = 1 ] && echo "  e.g. a$i release: $(head -c 200 "$W/re$i")"; }; done
held=$(s board --json | jq '[.. | objects | select(has("claim")) | select(.claim != null)] | length')
echo "sequential releases failed=$bad/$N  tickets still claimed afterwards=$held"
