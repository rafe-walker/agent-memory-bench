#!/usr/bin/env bash
# The exec-time pulse (`pulse --state D`, what every shim runs) when its stored per-project cursor
# can no longer be read: a real, unreconciled host change must still refuse `git push` (exit 77).
#   garbage  : cursor file overwritten with junk (torn/foreign write)
#   secret   : DIR/cursor-secret regenerated (data dir restored without it, re-created store)
#   rollback : chain rolled back below the stored cursor (WAL lost / snapshot restore), then the change
#   control  : nothing broken (must be 77)
# usage: KLBIN=<kl>/dist/cli.js stress/chaos/kl-shim-cursor.sh [control|garbage|secret|rollback]
set -uo pipefail
KLBIN=${KLBIN:?}; MODE=${1:-control}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/p"; cd "$W/p"; unset KRONICLE_LITE_DATA_DIR
D=$W/data; ST=$W/state; kl() { node "$KLBIN" "$@" --data-dir "$D"; }
doc() { printf '# Runbook\n\n## Deploy\n\nDeploy to host %s on port 8443.\n' "$1" > "$W/rb.md"; kl put runbook "$W/rb.md" --actor writer --cwd "$W/p" >/dev/null; }
pulse() { node "$KLBIN" pulse --data-dir "$D" --state "$ST" --cwd "$W/p" --pending-actor agent --json -- git push origin main; }
doc alpha-01; kl get runbook --actor agent --cwd "$W/p" >/dev/null
pulse >/dev/null 2>&1; echo "[$MODE] seed exit=$? cursor files: $(ls "$ST/cursors" 2>/dev/null | wc -l)"
CF=$(ls -d "$ST"/cursors/* | head -1)
case $MODE in
  garbage) printf 'sxt1.garbage\n' > "$CF" ;;
  secret) rm -f "$D/cursor-secret" ;;
  rollback) cp "$D/kronicle-lite.db" "$W/snap.db"
            for i in 1 2 3 4 5 6; do printf '# n%s\n\n## x\n\nfiller %s\n' $i $i > "$W/n.md"; kl put "filler-$i" "$W/n.md" --cwd "$W/p" >/dev/null; done
            pulse >/dev/null 2>&1; echo "[rollback] cursor advanced to head; restoring the snapshot"
            cp "$W/snap.db" "$D/kronicle-lite.db"; rm -f "$D/kronicle-lite.db-wal" "$D/kronicle-lite.db-shm" ;;
esac
doc beta-02   # the real change the agent has not re-read
pulse >"$W/o" 2>"$W/e"; rc=$?
echo "[$MODE] pulse -- git push after an unreconciled host change: exit=$rc (want 77) decision=$(jq -r .decision "$W/o") reason=$(jq -r .reason "$W/o") blocking=$(jq '.blocking|length' "$W/o")"
echo "         stderr: $(head -c 220 "$W/e" | tr '\n' ' ')"
pulse >"$W/o" 2>"$W/e"; echo "[$MODE] retry: exit=$? decision=$(jq -r .decision "$W/o") reason=$(jq -r .reason "$W/o") recovery=$(jq -c .recovery.method "$W/o") pending_count=$(jq -c .pending_count "$W/o") stderr=$(head -c 160 "$W/e" | tr "\n" " ")"
kl pending --actor agent --json --cwd "$W/p" > "$W/pd" 2>/dev/null; echo "[$MODE] pending(agent)=$(jq .pending_count "$W/pd") (the change is still unread)"
