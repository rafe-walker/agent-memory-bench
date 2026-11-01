#!/usr/bin/env bash
# Chain rollback (WAL/SHM deleted after a crash, or a restored backup / VM snapshot): an agent holds a
# cursor past the new head; new events then reuse those seqs. Does orient with the old cursor notice
# the fork, and does the agent still see the retraction that landed after the rollback?
# MODE=wal: writer killed -9 with commits only in the WAL, then -wal/-shm deleted.
# MODE=snapshot: copy of the db files restored.
# usage: KLBIN=<kl>/dist/cli.js stress/chaos/kl-rollback.sh [wal|snapshot]
set -uo pipefail
KLBIN=${KLBIN:?}; MODE=${1:-snapshot}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/p"; cd "$W/p"; unset KRONICLE_LITE_DATA_DIR
D=$W/data; kl() { node "$KLBIN" "$@" --data-dir "$D"; }
doc() { printf '# Runbook\n\n## Deploy\n\nDeploy to host %s on port 8443.\n\n## Notes\n\nnote %s\n' "$1" "$2" > "$W/rb.md"; kl put runbook "$W/rb.md" --actor writer >/dev/null; }
doc alpha-01 0
for i in 1 2 3; do printf '# Other %s\n\n## X\n\nfiller %s\n' $i $i > "$W/o.md"; kl put "other-$i" "$W/o.md" >/dev/null; done
C1=$(kl orient --actor agent --json | jq -r .cursor); H1=$(kl orient --actor probe --json | jq -r '.head.seq // .chain_head.seq // empty')
cp "$D/kronicle-lite.db" "$W/snap.db"; [ -f "$D/kronicle-lite.db-wal" ] && cp "$D/kronicle-lite.db-wal" "$W/snap.db-wal"
if [ "$MODE" = wal ]; then
  # a long-lived connection (an MCP server) keeps the WAL from being checkpointed on close; the
  # changes then live only in the WAL until it is killed -9 and the -wal/-shm files go away
  node -e 'const D=require(process.argv[1]);const db=new D(process.argv[2]);db.prepare("select count(*) from events").get();setInterval(()=>{},1e6)' "$(dirname "$KLBIN")/../../better-sqlite3" "$D/kronicle-lite.db" & HOLD=$!
  sleep 1; for i in 1 2 3 4; do doc "beta-0$i" "w$i"; done
else
  for i in 1 2 3 4; do doc "beta-0$i" "s$i"; done
fi
C2=$(kl orient --actor agent --cursor "$C1" --json | jq -r .cursor); H2=$(kl orient --actor probe --json | jq -r '.head.seq // .chain_head.seq // empty')
echo "[$MODE] agent cursor C1 at head $H1, after the changes C2 at head $H2"
if [ "$MODE" = wal ]; then echo "[wal] wal bytes before kill: $(stat -c %s "$D/kronicle-lite.db-wal")"; kill -9 $HOLD; wait $HOLD 2>/dev/null; rm -f "$D/kronicle-lite.db-wal" "$D/kronicle-lite.db-shm"; echo "[wal] holder killed -9, -wal/-shm deleted"
else cp "$W/snap.db" "$D/kronicle-lite.db"; rm -f "$D/kronicle-lite.db-wal" "$D/kronicle-lite.db-shm"; [ -f "$W/snap.db-wal" ] && cp "$W/snap.db-wal" "$D/kronicle-lite.db-wal"; echo "[snapshot] restored"; fi
kl verify-chain --full >/dev/null 2>&1; echo "verify-chain --full after rollback exit=$?"
H3=$(kl orient --actor probe --json | jq -r '.head.seq // .chain_head.seq // empty'); echo "head now $H3"
# the change that matters lands AFTER the rollback, reusing seqs the agent's cursor already covers
doc gamma-99 post
kl orient --actor agent --cursor "$C2" --focus retractions --json > "$W/or" 2>"$W/e"; rc=$?
echo "orient --cursor C2 (from the lost timeline) exit=$rc: retractions=$(jq '.retractions|length' "$W/or" 2>/dev/null) drift=$(jq -c '.drift // .drift_banner // .cursor_status // .recovery // null' "$W/or" 2>/dev/null | head -c 300) err=$(head -c 200 "$W/e")"
jq -r '[.. | strings | select(test("gamma-99|fork|rollback|ahead|diverg|unknown cursor|rewound"; "i"))] | unique | .[0:4][]' "$W/or" 2>/dev/null | cut -c1-200 | sed 's/^/   mentions: /'
kl pulse --cursor "$C2" --json > "$W/pl" 2>"$W/e"; echo "pulse --cursor C2 exit=$? (77 = refused) $(head -c 200 "$W/e" | tr '\n' ' ')"
kl pending --actor agent --json > "$W/pd" 2>/dev/null; echo "pending(agent) count=$(jq .pending_count "$W/pd")"
