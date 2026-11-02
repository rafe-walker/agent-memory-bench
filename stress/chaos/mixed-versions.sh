#!/usr/bin/env bash
# Two (three) versions writing ONE store at the same time — the default install shape, since
# sea-lite 0.6.0 ships its own kronicle-lite 0.7.0 and shares ~/.kronicle-lite with the kronicle-lite
# CLI the user installed. N workers: half kronicle-lite NEW, half OLD (put/get/orient on shared
# slugs, two projects), plus sea-lite create/next. Then: verify-chain --full, doctor --full (NEW),
# sea verify, and NEW's projection (documents.project_key, blocks, doc_lineage) == a NEW rebuild.
# usage: NEW=<kl 0.8.0 cli> OLD=<kl 0.7.0 cli> SLBIN=<sl cli> stress/chaos/mixed-versions.sh [N=16] [ITER=6]
set -uo pipefail
NEW=${NEW:?}; OLD=${OLD:?}; SLBIN=${SLBIN:?}; N=${1:-16}; ITER=${2:-6}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/A" "$W/B"; git -C "$W/A" init -q; git -C "$W/B" init -q
unset KRONICLE_LITE_DATA_DIR SEA_LITE_ACTOR SEA_LITE_SESSION CLAUDE_CODE_SESSION_ID
D=$W/d; errs=$W/errs; : > "$errs"
w() { local bin=$1 id=$2 p
  for j in $(seq 1 "$ITER"); do p=$([ $((RANDOM % 2)) = 0 ] && echo A || echo B); cd "$W/$p"
    case $((RANDOM % 4)) in
      0) printf '# Doc\n\n## Deploy\n\nhost h%s port %s (%s)\n\n## Notes\n\nnote %s\n' $RANDOM $RANDOM "$id" $RANDOM > "$W/$id.md"; node "$bin" put "doc-$(echo $p | tr AB ab)-$((RANDOM % 3))" "$W/$id.md" --data-dir "$D" >/dev/null 2>>"$errs.$id" || echo "put $id rc=$?" >> "$errs" ;;
      1) printf '# Rules %s\n\n## Deploy\n\nUse host r%s.\n' "$p" $RANDOM > "$W/$p/CLAUDE.md"; node "$bin" put --from-instructions --cwd "$W/$p" --data-dir "$D" >/dev/null 2>>"$errs.$id" || echo "import $id rc=$?" >> "$errs" ;;
      2) node "$bin" orient --actor "$id" --json --data-dir "$D" --cwd "$W/$p" >/dev/null 2>>"$errs.$id" || echo "orient $id rc=$?" >> "$errs" ;;
      3) SEA_LITE_ACTOR="$id" SEA_LITE_SESSION="$id" node "$SLBIN" create "t $id $j" --triaged --data-dir "$D" >/dev/null 2>>"$errs.$id" || echo "sl create $id rc=$?" >> "$errs"
         SEA_LITE_ACTOR="$id" SEA_LITE_SESSION="$id" node "$SLBIN" next --lease 5 --data-dir "$D" >/dev/null 2>>"$errs.$id" || echo "sl next $id rc=$?" >> "$errs" ;;
    esac
  done; }
for i in $(seq 1 "$N"); do if [ $((i % 2)) = 0 ]; then w "$NEW" "n$i" & else w "$OLD" "o$i" & fi; done; wait
nv=$(node -p "require('$(dirname "$NEW")/../package.json').version"); ov=$(node -p "require('$(dirname "$OLD")/../package.json').version")
echo "== $N workers ($nv / $ov / sea-lite) x $ITER on one store"
echo "failed commands: $(wc -l < "$errs") $(sort "$errs" | awk '{print $1}' | uniq -c | tr '\n' ' ')"; cat "$errs".* 2>/dev/null | grep -v '^$' | cut -c1-160 | sort | uniq -c | sort -rn | head -5
node "$NEW" verify-chain --full --data-dir "$D" >/dev/null 2>&1; echo "verify-chain --full ($nv) exit=$?"
node "$NEW" doctor --full --no-network --json --data-dir "$D" > "$W/dr" 2>&1; echo "doctor --full ($nv) exit=$? fails=$(jq -c '[.checks[]?|select(.status=="fail")|{id,detail}]' "$W/dr" | head -c 300)"
node "$SLBIN" verify --json --data-dir "$D" | jq -c '{sea_verify_ok: .ok}'
sq() { node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2],{readonly:true});const h=require("crypto").createHash("sha256");for(const q of process.argv.slice(3))h.update(JSON.stringify(db.prepare(q).all()));console.log(h.digest("hex").slice(0,16))' "$(dirname "$NEW")/../../better-sqlite3" "$1" "${@:2}"; }
Q1="select slug,project_key,current_revision,tombstoned_at from documents order by slug"; Q2="select block_id,doc_id,revision,content_hash,valid_to,superseded_by from blocks order by block_id"; Q3="select doc_id,source_block_id,source_content_hash,inferred from doc_lineage order by 1,2,4"
cp -r "$D" "$W/copy"; node "$NEW" rebuild --data-dir "$W/copy" >/dev/null 2>&1
for q in "$Q1" "$Q2" "$Q3"; do a=$(sq "$D/kronicle-lite.db" "$q"); b=$(sq "$W/copy/kronicle-lite.db" "$q"); t=$(echo "$q" | awk '{print $NF=="" ? "" : $0}' | grep -oE 'from [a-z_]+' ); [ "$a" = "$b" ] && echo "$t: live == rebuild" || echo "$t: LIVE PROJECTION DIFFERS from $nv rebuild"; done
node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2],{readonly:true});console.log("documents with NULL project_key:",JSON.stringify(db.prepare("select slug from documents where project_key is null").all().map(r=>r.slug)))' "$(dirname "$NEW")/../../better-sqlite3" "$D/kronicle-lite.db"
node -e 'const D=require(process.argv[1]);const q=process.argv[4];const a=new D(process.argv[2],{readonly:true}).prepare(q).all(),b=new D(process.argv[3],{readonly:true}).prepare(q).all();const m=new Map(b.map(r=>[r.slug,r]));for(const r of a){const s=JSON.stringify(r),t=JSON.stringify(m.get(r.slug));if(s!==t)console.log("  live   ",s,"\n  rebuilt",t)}' "$(dirname "$NEW")/../../better-sqlite3" "$D/kronicle-lite.db" "$W/copy/kronicle-lite.db" "$Q1" | head -12
