#!/usr/bin/env bash
# kronicle-lite upgrade / downgrade: build a store with OLD (instruction import through a symlinked
# project path, a CLI note, MCP recall + get_system_state), open it with NEW (verify, doctor,
# old cursor, re-import, change a host, retraction via both spellings, all-projects recall of the
# stale copy), then write with OLD again (downgrade) and re-check with NEW, including projection
# vs a fresh `rebuild` of a copy.
# usage: OLD=<kl old>/dist/cli.js NEW=<kl 0.8.0>/dist/cli.js stress/chaos/kl-upgrade.sh
set -uo pipefail
OLD=${OLD:?}; NEW=${NEW:?}; HERE=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home CLAUDE_CONFIG_DIR=$W/home/.claude; mkdir -p "$CLAUDE_CONFIG_DIR"
unset KRONICLE_LITE_DATA_DIR KRONICLE_LITE_PROJECT
D=$W/data; R=$W/real/proj; mkdir -p "$R"; ln -s "$W/real" "$W/link"; L=$W/link/proj
if [ "${GIT:-1}" = 1 ]; then git -C "$R" init -q; git -C "$R" -c user.email=a@b -c user.name=a commit -q --allow-empty -m init; fi
printf '# Rules\n\n## Deploy\n\nDeploy to host alpha-01.internal on port 8443.\n\n## Style\n\nUse tabs.\n' > "$R/CLAUDE.md"
printf '# Note\n\n## Runbook\n\nRestart svc-blue with systemctl restart blue.\n' > "$W/note.md"
o() { node "$OLD" "$@"; }; n() { node "$NEW" "$@"; }
sq() { node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2],{readonly:true});console.log(JSON.stringify(db.prepare(process.argv[3]).all()))' "$(dirname "$NEW")/../../better-sqlite3" "$1" "$2"; }
ov=$(node -p "require('$(dirname "$OLD")/../package.json').version"); nv=$(node -p "require('$(dirname "$NEW")/../package.json').version")
echo "== OLD $ov -> NEW $nv -> OLD -> NEW (git=${GIT:-1})"
# --- OLD
(cd "$L" && o put --from-instructions --cwd "$L" --data-dir "$D" >/dev/null 2>"$W/e") ; echo "[old] import via symlink exit=$? $(head -c 150 "$W/e")"
(cd "$R" && o put note "$W/note.md" --data-dir "$D" >/dev/null 2>"$W/e"); echo "[old] put note exit=$?"
(cd "$R" && node "$HERE/mcpcall.mjs" "$OLD" "serve --data-dir $D --actor a1" '[["recall",{"query":"deploy host port","top_k":5,"actor_id":"a1"}],["get_system_state",{"response_format":"json","actor_id":"a1"}]]' > "$W/old.mcp"); echo "[old] mcp exit=$?"
C_OLD=$(tail -1 "$W/old.mcp" | jq -r '.result.cursor // empty'); echo "[old] cursor=${C_OLD:0:24}… recall hits=$(head -1 "$W/old.mcp" | jq ".result.hits | length")"
sq "$D/kronicle-lite.db" "select slug, $( [[ $ov == 0.5.* || $ov == 0.6.* ]] && echo "null as" ) project_key from documents" 2>/dev/null | head -c 400; echo
# --- NEW
n verify-chain --full --data-dir "$D" >"$W/vc" 2>&1; echo "[new] verify-chain --full exit=$? $(tail -1 "$W/vc")"
n doctor --data-dir "$D" --no-network --json >"$W/dr" 2>&1; echo "[new] doctor exit=$? fails=$(jq -c '[.checks[]?|select(.status!="ok")|{id,status,detail}]' "$W/dr" 2>/dev/null | head -c 600)"
n orient --data-dir "$D" --cwd "$R" --actor a1 --cursor "$C_OLD" --focus retractions --json >"$W/or" 2>"$W/e"; echo "[new] orient old cursor exit=$? $(jq -c '{retr:(.retractions|length),pending_count,integrity:.integrity.ok}' "$W/or" 2>/dev/null) $(head -c 200 "$W/e")"
n put --from-instructions --cwd "$R" --data-dir "$D" --json >"$W/imp" 2>&1; echo "[new] re-import (real path) exit=$? $(jq -c '[.results[]?|{action,slug}]' "$W/imp" 2>/dev/null | head -c 300)"
sq "$D/kronicle-lite.db" "select slug, project_key from documents" | head -c 500; echo
sed -i 's/alpha-01/beta-02/' "$R/CLAUDE.md"
n put --from-instructions --cwd "$R" --data-dir "$D" >/dev/null 2>&1
for sp in "$R" "$L"; do
  n orient --data-dir "$D" --cwd "$sp" --actor a1 --cursor "$C_OLD" --focus retractions --json >"$W/or" 2>/dev/null
  echo "[new] after host change, orient --cwd ${sp#$W/} retractions=$(jq -c '[.retractions[]?|(.slug // .doc_slug // "?")]' "$W/or" | head -c 300)"
done
(cd "$R" && node "$HERE/mcpcall.mjs" "$NEW" "serve --data-dir $D --actor a2" '[["recall",{"query":"deploy host alpha","top_k":10,"actor_id":"a2","all_projects":true}]]' > "$W/new.mcp")
echo "[new] all_projects recall 'alpha' hits: $(jq -c '[.result.hits[]?|{slug:.doc_slug,status,authority,why:.authority_reason,t:(.content|.[0:50])}]' "$W/new.mcp" | head -c 900)"
# --- OLD again (downgrade)
printf '# Note 2\n\n## Runbook\n\nRestart svc-green.\n' > "$W/note2.md"
(cd "$R" && o put note2 "$W/note2.md" --data-dir "$D" >/dev/null 2>"$W/e"); echo "[down] old put exit=$? $(head -c 200 "$W/e")"
sed -i 's/beta-02/gamma-03/' "$R/CLAUDE.md"
o put --from-instructions --cwd "$R" --data-dir "$D" >/dev/null 2>"$W/e"; echo "[down] old re-import exit=$? $(head -c 200 "$W/e")"
o orient --data-dir "$D" --cwd "$R" --actor a1 --json >/dev/null 2>"$W/e"; echo "[down] old orient exit=$? $(head -c 200 "$W/e")"
o verify-chain --full --data-dir "$D" >"$W/vc" 2>&1; echo "[down] old verify-chain --full exit=$? $(tail -1 "$W/vc")"
o doctor --data-dir "$D" --no-network >"$W/dr" 2>&1; echo "[down] old doctor exit=$? $(grep -o '[0-9]* ok, [0-9]* warn, [0-9]* fail' "$W/dr")"
# --- NEW again
n verify-chain --full --data-dir "$D" >"$W/vc" 2>&1; echo "[new2] verify-chain --full exit=$? $(tail -1 "$W/vc")"
n doctor --data-dir "$D" --no-network --json >"$W/dr" 2>&1; echo "[new2] doctor exit=$? notok=$(jq -c '[.checks[]?|select(.status!="ok")|{id,status,detail}]' "$W/dr" 2>/dev/null | head -c 600)"
sq "$D/kronicle-lite.db" "select slug, project_key from documents order by slug" > "$W/proj.before"
sq "$D/kronicle-lite.db" "select doc_id, source_block_id, inferred from doc_lineage order by 1,2,3" > "$W/lin.before"
cp -r "$D" "$W/copy"; n rebuild --data-dir "$W/copy" >/dev/null 2>&1; echo "[new2] rebuild(copy) exit=$?"
sq "$W/copy/kronicle-lite.db" "select slug, project_key from documents order by slug" > "$W/proj.after"
sq "$W/copy/kronicle-lite.db" "select doc_id, source_block_id, inferred from doc_lineage order by 1,2,3" > "$W/lin.after"
cmp -s "$W/proj.before" "$W/proj.after" && echo "[new2] project_key projection == rebuild" || { echo "[new2] PROJECTION DIFFERS from rebuild:"; echo "  live:    $(cat "$W/proj.before")"; echo "  rebuilt: $(cat "$W/proj.after")"; }
cmp -s "$W/lin.before" "$W/lin.after" && echo "[new2] lineage projection == rebuild" || echo "[new2] LINEAGE DIFFERS: live=$(wc -c <"$W/lin.before") rebuilt=$(wc -c <"$W/lin.after")"
n orient --data-dir "$D" --cwd "$L" --actor a1 --cursor "$C_OLD" --focus retractions --json >"$W/or" 2>/dev/null
echo "[new2] orient via link retractions=$(jq -c '[.retractions[]?|(.slug // .doc_slug // "?")]' "$W/or" | head -c 300)"
