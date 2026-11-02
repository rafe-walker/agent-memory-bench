#!/usr/bin/env bash
# kill -9 mid-write, both tools on ONE store, ROUNDS times: a kronicle-lite `put` of a 200-block doc,
# a sea-lite MCP server applying a 50-ticket (max) sea_apply batch (all-or-nothing), and sea-lite CLI
# claims, each SIGKILLed after a random 1–5.9 s (node start-up under load eats the first second). Afterwards: verify-chain --full, kl doctor, sl
# verify + doctor, sea projection == rebuild, every applied batch has 0 or 50 tickets, a fresh
# put / claim works.
# usage: KLBIN=… SLBIN=… stress/chaos/kill9-both.sh [ROUNDS=30]
set -uo pipefail
KLBIN=${KLBIN:?}; SLBIN=${SLBIN:?}; ROUNDS=${1:-30}; HERE=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d); trap 'pkill -9 -P $$ 2>/dev/null; rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/r"; cd "$W/r"; git init -q; unset SEA_LITE_ACTOR SEA_LITE_SESSION CLAUDE_CODE_SESSION_ID KRONICLE_LITE_DATA_DIR
D=$W/d
big() { { echo "# Big $1"; for s in $(seq 1 40); do printf '\n## S%s\n\n' $s; for p in 1 2 3 4 5; do printf 'para %s.%s rev %s host-%s\n\n' $s $p "$1" $RANDOM; done; done; } > "$W/big.md"; }
cat > "$W/apply.mjs" <<'JS'
import { Mcp } from 'MCPLIB';
const [cli, dir, tag] = process.argv.slice(2);
const m = new Mcp('node', [cli, 'serve', '--data-dir', dir, '--actor', 'ap', '--session', 'ap'], { timeoutMs: 60000 });
await m.init();
const tickets = Array.from({ length: 50 }, (_, i) => ({ ref: `r${i}`, title: `batch ${tag} #${i}`, status: 'triaged' }));
const links = tickets.slice(1).map((t, i) => ({ from_ref: `r${i}`, to_ref: t.ref, link_type: 'blocks' }));
const r = await m.call('sea_apply', { tickets, links, idempotency_key: `k-${tag}` });
console.log(JSON.stringify({ isError: r.isError, n: r.result?.tickets?.length ?? r.result?.created?.length }));
await m.close();
JS
sed -i "s|MCPLIB|$HERE/../lib/mcp.mjs|" "$W/apply.mjs"
big 0; node "$KLBIN" put big "$W/big.md" --data-dir "$D" >/dev/null
for i in $(seq 1 5); do node "$SLBIN" create "seed $i" --triaged --data-dir "$D" >/dev/null; done
for r in $(seq 1 "$ROUNDS"); do
  big "$r"; node "$KLBIN" put big "$W/big.md" --data-dir "$D" >/dev/null 2>&1 & p1=$!
  node "$W/apply.mjs" "$SLBIN" "$D" "$r" >/dev/null 2>&1 & p2=$!
  SEA_LITE_ACTOR="c$r" SEA_LITE_SESSION="s$r" node "$SLBIN" next --lease 30 --json --data-dir "$D" >/dev/null 2>&1 & p3=$!
  sleep "$(( 1 + RANDOM % 5 )).$((RANDOM % 10))"
  pkill -9 -P $p2 2>/dev/null; kill -9 $p1 $p2 $p3 2>/dev/null; wait 2>/dev/null
done
pkill -9 -f "$W/d" 2>/dev/null; sleep 0.5
echo "== kill -9 x $ROUNDS (kl put + sea_apply server + sl next)"
node "$KLBIN" verify-chain --full --data-dir "$D" >"$W/vc" 2>&1; echo "kl verify-chain --full exit=$? $(grep -m2 -i -E 'mismatch|problem|error' "$W/vc" | head -c 200)"
node "$KLBIN" doctor --no-network --data-dir "$D" --json >"$W/dr" 2>&1; echo "kl doctor exit=$? $(jq -c '[.checks[]?|select(.status=="fail")|{id,detail}]' "$W/dr" | head -c 300)"
node "$SLBIN" verify --json --data-dir "$D" >"$W/sv" 2>&1; echo "sl verify exit=$? $(jq -c '{ok}' "$W/sv")"
node "$SLBIN" doctor --json --data-dir "$D" >"$W/sd" 2>&1; echo "sl doctor exit=$? $(jq -c '[.checks[]?|select(.status=="fail")|{id,detail}]' "$W/sd" | head -c 300)"
node "$KLBIN" export --data-dir "$D" --out "$W/ev.jsonl" >/dev/null 2>&1
echo "batches by size (want only 50s): $(jq -r 'select(.event_type=="sea_ticket.created") | .payload.title | select(startswith("batch ")) | split(" ")[1]' "$W/ev.jsonl" | sort | uniq -c | awk '{print $1}' | sort | uniq -c | tr '\n' ' ')"
cp -r "$D" "$W/copy"; node "$SLBIN" rebuild --data-dir "$W/copy" >/dev/null 2>&1
q="select id,status,claim_actor,claim_expires_at,row_version,last_seq from sea_tickets order by id"
a=$(node -e 'const D=require(process.argv[1]);for(const f of process.argv.slice(3)){const db=new D(f,{readonly:true});console.log(require("crypto").createHash("sha256").update(JSON.stringify(db.prepare(process.argv[2]).all())).digest("hex"))}' "$(dirname "$SLBIN")/../../better-sqlite3" "$q" "$D/kronicle-lite.db" "$W/copy/kronicle-lite.db")
[ "$(echo "$a" | sed -n 1p)" = "$(echo "$a" | sed -n 2p)" ] && echo "sea projection == rebuild" || echo "SEA PROJECTION DIFFERS from rebuild"
big final; node "$KLBIN" put big "$W/big.md" --data-dir "$D" >/dev/null 2>&1; echo "fresh kl put exit=$?"
SEA_LITE_ACTOR=z SEA_LITE_SESSION=z node "$SLBIN" next --json --data-dir "$D" >/dev/null 2>&1; echo "fresh sl next exit=$?"
node "$HERE/sl-claim-invariant.mjs" < "$W/ev.jsonl"
