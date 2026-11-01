#!/usr/bin/env bash
# Mixed storm on ONE fresh shared data dir (first start included): N processes at once —
#   kl CLI workers: put (5 shared slugs) / get --actor / orient --cursor / pending / pulse
#   sl CLI workers: create / next --wait / claim --wait / heartbeat / release --all / board
#   sl MCP workers (sl-worker.mjs): sea_next(wait_seconds) → update → transition → finish, lapsed-lease
#                                   stale writes, shared-idempotency-key sea_create / sea_apply
# Afterwards: unexpected stderr / exit codes, kl verify-chain --full + doctor, sea-lite verify +
# doctor, claim invariants from the chain, idempotent creates landed once.
# usage: KLBIN=<kl>/dist/cli.js SLBIN=<sl>/dist/cli.js stress/chaos/storm.sh [N=40] [ITER=6]
set -uo pipefail
KLBIN=${KLBIN:?}; SLBIN=${SLBIN:?}; N=${1:-40}; ITER=${2:-6}; HERE=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d); trap 'pkill -P $$ 2>/dev/null; rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/repo" "$W/log"; git -C "$W/repo" init -q; cd "$W/repo"
unset SEA_LITE_ACTOR SEA_LITE_SESSION CLAUDE_CODE_SESSION_ID KRONICLE_LITE_DATA_DIR
D=$W/data
run() { # label cmd… ; logs "rc label" and stderr
  local label=$1; shift; "$@" >"$W/log/out.$BASHPID" 2>"$W/log/err.$BASHPID"; local rc=$?
  echo "$rc $label" >> "$W/log/rc.$WID"; [ -s "$W/log/err.$BASHPID" ] && { printf '%s %s ' "$rc" "$label"; head -c 300 "$W/log/err.$BASHPID" | tr '\n' ' '; echo; } >> "$W/log/stderr.$WID"
  return $rc
}
klw() { WID=k$1; local C=""
  for j in $(seq 1 "$ITER"); do
    case $((RANDOM % 5)) in
      0) printf '# Doc\n\n## Deploy\n\nDeploy to host h%s port %s.\n' "$RANDOM" "$RANDOM" > "$W/k$1.md"; run put node "$KLBIN" put "doc-$((RANDOM % 5))" "$W/k$1.md" --data-dir "$D" --actor "k$1" ;;
      1) run get node "$KLBIN" get "doc-$((RANDOM % 5))" --actor "k$1" --data-dir "$D" ;;
      2) run orient node "$KLBIN" orient --actor "k$1" ${C:+--cursor "$C"} --focus retractions --json --data-dir "$D"; c2=$(jq -r '.cursor // empty' "$W/log/out.$BASHPID" 2>/dev/null); C=${c2:-$C} ;;
      3) run pending node "$KLBIN" pending --actor "k$1" --json --data-dir "$D" ;;
      4) run pulse node "$KLBIN" pulse ${C:+--cursor "$C"} --json --data-dir "$D" ;;
    esac
  done; }
slw() { WID=s$1; export SEA_LITE_ACTOR="c$1" SEA_LITE_SESSION="cs$1"
  for j in $(seq 1 "$ITER"); do
    case $((RANDOM % 6)) in
      0) run create node "$SLBIN" create "cli t$1.$j" --triaged --json --data-dir "$D" ;;
      1) run next node "$SLBIN" next --lease 3 --wait 2 --paths "src/p$((RANDOM % 6)).ts" --json --data-dir "$D" ;;
      2) id=$(node "$SLBIN" list --json --data-dir "$D" 2>/dev/null | jq -r '[.. | objects | select(has("id") and has("status")) | .id] | .[]' 2>/dev/null | shuf -n1); [ -n "$id" ] && run claim node "$SLBIN" claim "$id" --lease 3 --wait 2 --json --data-dir "$D" ;;
      3) run heartbeat node "$SLBIN" heartbeat --json --data-dir "$D" ;;
      4) run release node "$SLBIN" release --all --json --data-dir "$D" ;;
      5) run board node "$SLBIN" board --json --data-dir "$D" ;;
    esac
  done; }
t0=$(date +%s)
nk=$((N * 2 / 5)); ns=$((N * 2 / 5)); nm=$((N - nk - ns))
for i in $(seq 1 "$nk"); do klw "$i" & done
for i in $(seq 1 "$ns"); do slw "$i" & done
for i in $(seq 1 "$nm"); do node "$HERE/sl-worker.mjs" "$SLBIN" "$D" "m$i" "$ITER" > "$W/log/mcp.$i" 2>&1 & done
wait
echo "== storm N=$N (kl-cli $nk, sl-cli $ns, sl-mcp $nm) x $ITER ops: $(( $(date +%s) - t0 )) s"
cat "$W"/log/rc.* | awk '{c[$2" rc="$1]++} END{for(k in c) printf "%s:%d  ", k, c[k]; print ""}' | tr -s ' ' | fold -w 200
echo "-- unexpected stderr (kl rc!=0 except pulse 77; any stack/SQLITE/locked):"
cat "$W"/log/stderr.* 2>/dev/null | grep -E 'SQLITE|locked|Error|    at |EPIPE|^[1-9][0-9]* (put|get|orient|pending) |^[2-9] (create|next|claim|heartbeat|release|board) ' | sed -E 's/[0-9a-f]{8}-[0-9a-f-]{27}/<id>/g' | cut -c1-220 | sort | uniq -c | sort -rn | head -12
echo "-- mcp workers:"; cat "$W"/log/mcp.* | node -e 'const L=require("fs").readFileSync(0,"utf8").trim().split("\n");const c={};let s=0,e=[];for(const l of L){try{const j=JSON.parse(l);for(const[k,v]of Object.entries(j.codes))c[k]=(c[k]||0)+v;s+=j.stale_write_accepted;e.push(...j.errors)}catch{e.push("unparsable:"+l.slice(0,200))}}console.log(JSON.stringify({codes:c,stale_write_accepted:s,errors:e.length,sample:e.slice(0,4)}));for(const l of L){try{for(const f of (JSON.parse(l).fenced_fresh||[]).slice(0,2))console.log("fenced right after next:",JSON.stringify(f))}catch{}}'
echo "-- integrity:"
node "$KLBIN" verify-chain --full --data-dir "$D" >"$W/vc" 2>&1; echo "kl verify-chain --full exit=$?"
node "$KLBIN" doctor --no-network --data-dir "$D" --json >"$W/dr" 2>&1; echo "kl doctor exit=$? $(jq -c '[.checks[]?|select(.status=="fail")|{id,detail}]' "$W/dr" 2>/dev/null | head -c 300)"
node "$SLBIN" verify --json --data-dir "$D" >"$W/sv" 2>&1; echo "sl verify exit=$? $(jq -c '{ok}' "$W/sv" 2>/dev/null)"
node "$SLBIN" doctor --json --data-dir "$D" >"$W/sd" 2>&1; echo "sl doctor exit=$? $(jq -c '[.checks[]?|select(.status=="fail")|{id,detail}]' "$W/sd" 2>/dev/null | head -c 300)"
node "$KLBIN" export --data-dir "$D" --out "$W/ev.jsonl" >/dev/null 2>&1; [ -n "${KEEP:-}" ] && cp "$W/ev.jsonl" "$KEEP"
node "$HERE/sl-claim-invariant.mjs" < "$W/ev.jsonl"; echo "claim invariant exit=$?"
echo "idempotent sea_create 'idem k' tickets (want <=1 each): $(jq -r 'select(.event_type=="sea_ticket.created") | .payload.title' "$W/ev.jsonl" | grep -E '^idem [0-9]$' | sort | uniq -c | tr '\n' ' ')"
echo "idempotent sea_apply batches (want <=1 each): $(jq -r 'select(.event_type=="sea_ticket.created") | .payload.title' "$W/ev.jsonl" | grep -E '^apply batch [0-9]$' | sort | uniq -c | tr '\n' ' ')"
echo "signing keys: $(node "$KLBIN" keys --data-dir "$D" 2>/dev/null | grep -ci 'key id')  events=$(wc -l < "$W/ev.jsonl")"
