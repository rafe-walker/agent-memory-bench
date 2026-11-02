#!/usr/bin/env bash
# Does the exec-time pulse shim (README "Exec-time pulse shims", "for any client") still refuse a
# `git push` when the agent's MCP server uses the README's own Cursor / Copilot data dir
# (${workspaceFolder}/.kronicle-lite, ./.kronicle-lite)? Control: the default ~/.kronicle-lite.
# usage: KLBIN=<kronicle-lite bin> stress/proto/datadir-split.sh
set -uo pipefail
KL=${KLBIN:-/tmp/claude-0/proto/node_modules/.bin/kronicle-lite}
here=$(cd "$(dirname "$0")" && pwd)
run_case() { # $1 = label, $2 = server data dir ("" = default)
  local W; W=$(mktemp -d); export HOME=$W/home; mkdir -p "$HOME"; unset KRONICLE_LITE_DATA_DIR
  git init -q --bare "$W/remote.git"; git init -q "$W/repo"; cd "$W/repo"
  git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init; git remote add origin "$W/remote.git"
  local dd=${2//\$\{workspaceFolder\}/$W/repo}
  "$KL" shim install >/dev/null 2>&1
  node "$here/datadir-split-agent.mjs" "$KL" "$W/repo" "$dd" read 2>/dev/null || { echo "agent step failed"; return; }
  # baseline check (what a first `git push` would do), then the runbook changes, then the real push
  PATH="$HOME/.kronicle-lite/shims:$PATH" git push -q --dry-run origin HEAD:main >/dev/null 2>&1
  node "$here/datadir-split-agent.mjs" "$KL" "$W/repo" "$dd" change 2>/dev/null || { echo "agent step failed"; return; }
  local out code
  out=$(PATH="$HOME/.kronicle-lite/shims:$PATH" git -c user.email=a@b -c user.name=a push -q origin HEAD:main 2>&1); code=$?
  local pushed=no; git --git-dir="$W/remote.git" rev-parse -q --verify main >/dev/null && pushed=yes
  local verdict=ok; [[ $pushed == yes ]] && verdict=FAIL && FAILS=$((FAILS+1))
  printf '%-4s %-48s shim exit=%-3s pushed=%-3s %s\n' "$verdict" "$1" "$code" "$pushed" "$(echo "$out" | head -1 | cut -c1-110)"
  cd /; rm -rf "$W"
}
FAILS=0
run_case "control: server on default ~/.kronicle-lite" ""
run_case "README Cursor: \${workspaceFolder}/.kronicle-lite" '${workspaceFolder}/.kronicle-lite'
run_case "README Copilot: ./.kronicle-lite (cwd = repo)" './.kronicle-lite'
exit $(( FAILS > 0 ))
