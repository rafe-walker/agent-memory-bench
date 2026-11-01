#!/usr/bin/env bash
# sea-lite upgrade / downgrade on one shared data dir (sea-lite shares kronicle-lite's store):
# OLD sea-lite creates/claims tickets -> NEW sea-lite + kronicle-lite 0.8.0 read/verify/claim ->
# OLD again (downgrade) -> NEW again. Holds: a live claim is never stolen across versions, verify
# and doctor agree, the kl chain verifies, and a too-old build refuses loudly or works correctly.
# usage: OLD=<sl old>/dist/cli.js NEW=<sl 0.6.0>/dist/cli.js KL=<kl 0.8.0>/dist/cli.js stress/chaos/sl-upgrade.sh
set -uo pipefail
OLD=${OLD:?}; NEW=${NEW:?}; KL=${KL:?}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/repo"; unset KRONICLE_LITE_DATA_DIR SEA_LITE_ACTOR SEA_LITE_SESSION SEA_LITE_PROJECT CLAUDE_CODE_SESSION_ID
git -C "$W/repo" init -q; cd "$W/repo"
D=$W/data
o() { node "$OLD" "$@" --data-dir "$D"; }; n() { node "$NEW" "$@" --data-dir "$D"; }
ov=$(node -p "require('$(dirname "$OLD")/../package.json').version"); nv=$(node -p "require('$(dirname "$NEW")/../package.json').version")
echo "== sea-lite $ov -> $nv -> $ov -> $nv (+ kronicle-lite $(node "$KL" --help | head -1 | awk '{print $2}'))"
for i in 1 2 3; do o create "old ticket $i" --triaged --json >"$W/c$i" 2>"$W/e" || echo "[old] create $i failed: $(head -c 200 "$W/e")"; done
T1=$(jq -r '.id // .ticket.id // .ticket_id' "$W/c1"); T2=$(jq -r '.id // .ticket.id // .ticket_id' "$W/c2")
SEA_LITE_ACTOR=alice SEA_LITE_SESSION=s-alice o claim "$T1" --paths src/a.ts --lease 600 --json >"$W/cl" 2>"$W/e"; echo "[old] alice claims $T1 exit=$? $(head -c 160 "$W/e")"
# --- NEW
n verify --json >"$W/v" 2>&1; echo "[new] verify exit=$? $(jq -c '{ok}' "$W/v" 2>/dev/null || head -c 200 "$W/v")"
n doctor --json >"$W/d" 2>&1; echo "[new] doctor exit=$? notok=$(jq -c '[.checks[]?|select(.status!="ok" and .status!="skip")|{id,status,detail}]' "$W/d" 2>/dev/null | head -c 400)"
node "$KL" verify-chain --full --data-dir "$D" >/dev/null 2>&1; echo "[new] kl 0.8.0 verify-chain --full exit=$?"
node "$KL" orient --data-dir "$D" --cwd "$W/repo" --actor k --json >"$W/or" 2>"$W/e"; echo "[new] kl 0.8.0 orient exit=$? integrity=$(jq .integrity.ok "$W/or" 2>/dev/null) $(head -c 150 "$W/e")"
SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob n claim "$T1" --json >"$W/x" 2>&1; echo "[new] bob claims alice's $T1 exit=$? (want refusal) $(head -c 160 "$W/x" | tr '\n' ' ')"
SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob n scope-check --paths src/a.ts >/dev/null 2>&1; echo "[new] bob scope-check src/a.ts exit=$? (want 1)"
SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob n claim "$T2" --paths src/b.ts --lease 600 --json >"$W/x" 2>&1; echo "[new] bob claims $T2 exit=$?"
n create "new ticket" --triaged --json >"$W/c4" 2>&1
# --- OLD again
o board --json >"$W/b" 2>"$W/e"; echo "[down] old board exit=$? $(head -c 160 "$W/e")"
SEA_LITE_ACTOR=carol SEA_LITE_SESSION=s-carol o claim "$T2" --json >"$W/x" 2>&1; echo "[down] carol(old) claims bob's $T2 exit=$? (want refusal) $(head -c 160 "$W/x" | tr '\n' ' ')"
SEA_LITE_ACTOR=carol SEA_LITE_SESSION=s-carol o scope-check --paths src/b.ts >/dev/null 2>&1; echo "[down] carol(old) scope-check src/b.ts exit=$? (want 1)"
SEA_LITE_ACTOR=carol SEA_LITE_SESSION=s-carol o next --json >"$W/x" 2>&1; echo "[down] carol(old) next exit=$? got=$(jq -r '.ticket.id // .id // .ticket_id // empty' "$W/x" 2>/dev/null) $(head -c 120 "$W/x" | tr '\n' ' ')"
o create "old ticket after upgrade" --triaged --json >/dev/null 2>"$W/e"; echo "[down] old create exit=$? $(head -c 160 "$W/e")"
o verify --json >"$W/v" 2>&1; echo "[down] old verify exit=$? $(jq -c '{ok}' "$W/v" 2>/dev/null || head -c 200 "$W/v")"
# --- NEW again
n verify --json >"$W/v" 2>&1; echo "[new2] verify exit=$? $(jq -c '{ok}' "$W/v" 2>/dev/null || head -c 300 "$W/v")"
n doctor --json >"$W/d" 2>&1; echo "[new2] doctor exit=$? notok=$(jq -c '[.checks[]?|select(.status!="ok" and .status!="skip")|{id,status,detail}]' "$W/d" 2>/dev/null | head -c 400)"
node "$KL" verify-chain --full --data-dir "$D" >/dev/null 2>&1; echo "[new2] kl verify-chain --full exit=$?"
n board --json > "$W/b" 2>&1; echo "[new2] board holders: $(jq -c '[.. | objects | select(has("claimed_by") or has("holder")) | {id:(.id // .ticket_id), by:(.claimed_by // .holder)}] | unique' "$W/b" 2>/dev/null | head -c 400)"
cp -r "$D" "$W/copy"; node "$NEW" rebuild --data-dir "$W/copy" --json >/dev/null 2>&1; echo "[new2] rebuild(copy) exit=$?"
for q in "select id,status,claim_actor,claim_session,claim_scope,claim_expires_at,project,row_version,last_seq from sea_tickets order by id"; do
  a=$(node -e 'const D=require(process.argv[1]);for(const f of process.argv.slice(3)){const db=new D(f,{readonly:true});console.log(JSON.stringify(db.prepare(process.argv[2]).all()))}' "$(dirname "$NEW")/../../better-sqlite3" "$q" "$D/kronicle-lite.db" "$W/copy/kronicle-lite.db" 2>&1)
  [ "$(echo "$a" | sed -n 1p)" = "$(echo "$a" | sed -n 2p)" ] && echo "[new2] tickets projection == rebuild" || { echo "[new2] TICKETS PROJECTION DIFFERS from rebuild"; echo "$a" | cut -c1-600; }
done
