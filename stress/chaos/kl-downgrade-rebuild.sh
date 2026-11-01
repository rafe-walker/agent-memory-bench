#!/usr/bin/env bash
# Downgrade: an 0.8.0 store with two projects (notes + instruction files, lineage, reads) is
# rebuilt / written by an OLD kronicle-lite. Does OLD refuse? Does 0.8.0 afterwards notice that its
# projection (project_key, doc_lineage) no longer matches the chain? Does recall leak project B into A?
# usage: OLD=<old>/dist/cli.js NEW=<0.8.0>/dist/cli.js stress/chaos/kl-downgrade-rebuild.sh [rebuild|import]
set -uo pipefail
OLD=${OLD:?}; NEW=${NEW:?}; MODE=${1:-rebuild}; HERE=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home CLAUDE_CONFIG_DIR=$W/home/.claude; mkdir -p "$CLAUDE_CONFIG_DIR"; unset KRONICLE_LITE_DATA_DIR KRONICLE_LITE_PROJECT
D=$W/data; mkdir -p "$W/A" "$W/B"
printf '# A\n\n## Deploy\n\nProject A deploys to host aaa-01 port 1111.\n' > "$W/A/CLAUDE.md"
printf '# B\n\n## Deploy\n\nProject B deploys to host bbb-02 port 2222.\n' > "$W/B/CLAUDE.md"
printf '# B note\n\n## Secret plan\n\nProject B deploys with the bbb rollback flag.\n' > "$W/bnote.md"
n() { node "$NEW" "$@"; }; o() { node "$OLD" "$@"; }
sq() { node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2],{readonly:true});console.log(JSON.stringify(db.prepare(process.argv[3]).all()))' "$(dirname "$NEW")/../../better-sqlite3" "$1" "$2"; }
recallA() { (cd "$W/A" && node "$HERE/mcpcall.mjs" "$NEW" "serve --data-dir $D --actor ra" '[["recall",{"query":"deploys host","top_k":10,"actor_id":"ra"}]]' | jq -c '[.result.hits[]?.doc_slug]'); }
for p in A B; do (cd "$W/$p" && n put --from-instructions --cwd "$W/$p" --data-dir "$D" >/dev/null); done
(cd "$W/B" && n put bnote "$W/bnote.md" --data-dir "$D" >/dev/null)
echo "before: project_key=$(sq "$D/kronicle-lite.db" 'select slug,project_key from documents' | head -c 400)"
echo "before: recall from A -> $(recallA)"
ov=$(node -p "require('$(dirname "$OLD")/../package.json').version")
if [ "$MODE" = rebuild ]; then
  o rebuild --data-dir "$D" >"$W/o" 2>&1; echo "OLD $ov rebuild exit=$? $(tail -c 200 "$W/o" | tr '\n' ' ')"
else
  n export --data-dir "$D" --out "$W/ev.jsonl"; o import --data-dir "$W/d2" --in "$W/ev.jsonl" >"$W/o" 2>&1; echo "OLD $ov import exit=$? $(tail -c 200 "$W/o"|tr '\n' ' ')"; D=$W/d2
fi
echo "after:  project_key=$(sq "$D/kronicle-lite.db" 'select slug,project_key from documents' | head -c 400)"
echo "after:  recall from A -> $(recallA)"
n doctor --data-dir "$D" --no-network --full --json > "$W/dr" 2>&1; echo "0.8.0 doctor --full exit=$? notok=$(jq -c '[.checks[]?|select(.status!="ok" and .status!="skip")|{id,status}]' "$W/dr")"
n verify-chain --data-dir "$D" --full >/dev/null 2>&1; echo "0.8.0 verify-chain --full exit=$?"
n orient --data-dir "$D" --cwd "$W/A" --actor x --json > "$W/or" 2>/dev/null; echo "0.8.0 orient(A) integrity.ok=$(jq .integrity.ok "$W/or")"
