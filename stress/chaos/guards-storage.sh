#!/usr/bin/env bash
# Safety guards when the shared store is on bad storage (needs root for tmpfs):
#   ro   : data dir remounted read-only (e.g. a ro bind mount, a full-disk remount)
#   full : data dir full (tmpfs filled to the last byte by an unrelated file)
# Before: alice holds a live sea-lite claim on src/a.ts; a kronicle retraction is pending for the
# agent's cursor. Then every guard must still refuse (or fail CLOSED / loudly), never pass quietly:
#   sea-lite scope-check (CLI, exit 1), scope-check --hook (exit 2), precommit (refuse);
#   kronicle-lite pulse --cursor (77), orient --focus retractions (retraction listed), pending.
# usage: KLBIN=… SLBIN=… stress/chaos/guards-storage.sh ro|full
set -uo pipefail
KLBIN=${KLBIN:?}; SLBIN=${SLBIN:?}; MODE=${1:-ro}
W=$(mktemp -d); trap 'umount "$W/tm" 2>/dev/null; rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/tm" "$W/repo/src"; unset SEA_LITE_ACTOR SEA_LITE_SESSION CLAUDE_CODE_SESSION_ID KRONICLE_LITE_DATA_DIR
mount -t tmpfs -o size=8m tmpfs "$W/tm" || { echo "cannot mount tmpfs (need root)"; exit 2; }
D=$W/tm/data; R=$W/repo; cd "$R"; git init -q; git -c user.email=a@b -c user.name=a commit -q --allow-empty -m i
echo 'x' > src/a.ts
kl() { node "$KLBIN" "$@" --data-dir "$D"; }; sl() { node "$SLBIN" "$@" --data-dir "$D"; }
printf '# RB\n\n## Deploy\n\nDeploy to host alpha-01 port 1.\n' > "$W/rb.md"; kl put rb "$W/rb.md" >/dev/null
C=$(kl orient --actor agent --json | jq -r .cursor); kl get rb --actor agent >/dev/null
printf '# RB\n\n## Deploy\n\nDeploy to host beta-02 port 2.\n' > "$W/rb.md"; kl put rb "$W/rb.md" >/dev/null
T=$(sl create "work on a" --triaged --json | jq -r .ticket.id)
SEA_LITE_ACTOR=alice SEA_LITE_SESSION=s-alice sl claim "$T" --paths src/a.ts --lease 900 --json >/dev/null
check() { # label
  local L=$1
  SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob sl scope-check --paths src/a.ts >"$W/o" 2>"$W/e"; echo "[$L] sl scope-check (want 1)       exit=$? $(head -c 140 "$W/e" | tr '\n' ' ')"
  echo "{\"session_id\":\"s-bob\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Edit\",\"cwd\":\"$R\",\"tool_input\":{\"file_path\":\"$R/src/a.ts\"}}" \
    | SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob node "$SLBIN" scope-check --hook --data-dir "$D" >"$W/o" 2>"$W/e"; echo "[$L] sl scope-check --hook (want 2) exit=$? $(head -c 140 "$W/e" | tr '\n' ' ')"
  echo y >> src/a.ts; git add src/a.ts; SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob sl precommit >"$W/o" 2>"$W/e"; echo "[$L] sl precommit (want !=0)      exit=$? $(head -c 140 "$W/e" | tr '\n' ' ')"; git reset -q
  kl pulse --cursor "$C" --json >"$W/o" 2>"$W/e"; echo "[$L] kl pulse --cursor (want 77)  exit=$? $(head -c 140 "$W/e" | tr '\n' ' ')"
  kl orient --actor agent --cursor "$C" --focus retractions --json >"$W/o" 2>"$W/e"; echo "[$L] kl orient retractions      exit=$? n=$(jq '.retractions|length' "$W/o" 2>/dev/null) $(head -c 140 "$W/e" | tr '\n' ' ')"
  kl pending --actor agent --json >"$W/o" 2>"$W/e"; echo "[$L] kl pending (want >=1)       exit=$? count=$(jq .pending_count "$W/o" 2>/dev/null) $(head -c 140 "$W/e" | tr '\n' ' ')"
  SEA_LITE_ACTOR=bob SEA_LITE_SESSION=s-bob sl claim "$T" --json >"$W/o" 2>"$W/e"; echo "[$L] sl bob claims alice's (want 1) exit=$? $(head -c 140 "$W/e" | tr '\n' ' ')"
}
check baseline
if [ "$MODE" = ro ]; then mount -o remount,ro "$W/tm"; else dd if=/dev/zero of="$W/tm/fill" bs=64k status=none 2>/dev/null; echo "[full] free bytes: $(df --output=avail -B1 "$W/tm" | tail -1)"; fi
check "$MODE"
