#!/usr/bin/env bash
# Read-only checks vs one long write transaction. In WAL mode a reader never waits for a writer, but
# kronicle-lite's open() runs its schema setup in a BEGIN IMMEDIATE transaction, so every pulse /
# orient / pending / get (and sea-lite's scope-check) first queues for the WRITE lock. A writer that
# holds it HOLD seconds (a big put, rebuild, import, a slow disk) stalls every check; past the 10 s
# busy deadline the check fails (pulse exit 3 -> the shims fail OPEN), racing the 10 s shim timeout.
# usage: KLBIN=… SLBIN=… HOLD=4 stress/chaos/kl-writer-blocks-readers.sh
set -uo pipefail
KLBIN=${KLBIN:?}; SLBIN=${SLBIN:?}; HOLD=${HOLD:-4}
W=$(mktemp -d); trap 'kill $HP 2>/dev/null; rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/r"; cd "$W/r"; git init -q; unset KRONICLE_LITE_DATA_DIR SEA_LITE_ACTOR SEA_LITE_SESSION
D=$W/d
printf '# RB\n\n## Deploy\n\nhost alpha\n' > "$W/rb.md"; node "$KLBIN" put rb "$W/rb.md" --data-dir "$D" >/dev/null
node "$KLBIN" pulse --data-dir "$D" --state "$W/st" --cwd "$W/r" --pending-actor agent -- git push >/dev/null 2>&1   # seed
node "$KLBIN" get rb --actor agent --data-dir "$D" >/dev/null; T=$(node "$SLBIN" create t --triaged --json --data-dir "$D" | jq -r .ticket.id)
SEA_LITE_ACTOR=alice SEA_LITE_SESSION=sa node "$SLBIN" claim "$T" --paths src/a.ts --lease 900 --data-dir "$D" >/dev/null   # alice holds src/a.ts
printf '# RB\n\n## Deploy\n\nhost beta\n' > "$W/rb.md"; node "$KLBIN" put rb "$W/rb.md" --data-dir "$D" >/dev/null           # unreconciled change for agent
export SEA_LITE_ACTOR=bob SEA_LITE_SESSION=sb

ms() { local t=$(date +%s%N); "$@" >/dev/null 2>"$W/e"; local rc=$?; echo "$(( ($(date +%s%N) - t) / 1000000 ))ms rc=$rc"; }
echo "(want: pulse rc=77 [unreconciled change], scope-check rc=1 [alice holds src/a.ts])"
echo "no writer:   pulse $(ms node "$KLBIN" pulse --data-dir "$D" --state "$W/st" --cwd "$W/r" --pending-actor agent -- git push)  pending $(ms node "$KLBIN" pending --actor agent --data-dir "$D" --json)  sl scope-check $(ms node "$SLBIN" scope-check --paths src/a.ts --data-dir "$D")"
# a writer that holds the write lock for HOLD s (stand-in for a long put / rebuild / import)
node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2]);db.exec("BEGIN IMMEDIATE");db.prepare("insert into meta(key,value) values(?,?)").run("hold",String(Date.now()));console.log("locked");setTimeout(()=>{db.exec("ROLLBACK");process.exit(0)},Number(process.argv[3])*1000)' "$(dirname "$KLBIN")/../../better-sqlite3" "$D/kronicle-lite.db" "$HOLD" > "$W/h" & HP=$!
while ! grep -q locked "$W/h" 2>/dev/null; do sleep 0.05; done
echo "writer holds the lock for ${HOLD}s:"
echo "  raw sqlite read while locked: $(ms node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2],{readonly:true});db.prepare("select count(*) from events").get()' "$(dirname "$KLBIN")/../../better-sqlite3" "$D/kronicle-lite.db")"
echo "  kl pulse:        $(ms node "$KLBIN" pulse --data-dir "$D" --state "$W/st" --cwd "$W/r" --pending-actor agent -- git push) $(head -c 120 "$W/e" | tr '\n' ' ')" &
echo "  kl pending:      $(ms node "$KLBIN" pending --actor agent --data-dir "$D" --json) $(head -c 0 /dev/null)" &
echo "  sl scope-check:  $(ms node "$SLBIN" scope-check --paths src/a.ts --data-dir "$D")" &
wait $HP; wait
