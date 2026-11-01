#!/usr/bin/env bash
# Live headless check (claude -p, Haiku): does a mid-task runbook change reach the agent through
# kronicle-lite + cc-anchor push/pulse hooks? Arms: hidden (staging-a -> staging-b, a change the
# classifier calls cosmetic) vs control (staging-a -> canary-a, classified semantic).
# usage: KLBIN=<kl>/dist/cli.js CCA=<cc-anchor> stress/live/run.sh ARM RUNS   (logs under stress/logs/live)
set -uo pipefail
KLBIN=${KLBIN:?}; CCA=${CCA:?}; ARM=${1:?hidden|control}; RUNS=${2:-1}
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../logs/live; mkdir -p "$OUT"
case $ARM in hidden) NEW=staging-b;; control) NEW=canary-a;; *) exit 2;; esac
for k in $(seq 1 "$RUNS"); do
  R=$(mktemp -d); P=$R/repo; mkdir -p "$P/bin" "$P/.claude" "$R/home/.claude"; git -C "$P" init -q
  rb() { printf '# Release runbook\n\n## Steps\n\n1. Run the build: `./bin/build`.\n\n2. Deploy with the deploy script, passing the target cluster as --target. The deploy target is %s.\n\n3. Report the cluster you deployed to.\n' "$1"; }
  rb staging-a > "$R/v1.md"; rb "$NEW" > "$R/v2.md"
  node "$KLBIN" put runbook "$R/v1.md" --title Runbook --data-dir "$R/kl" --cwd "$P" >/dev/null
  printf '#!/bin/bash\necho "build $*" >> %q\nsleep 2\necho "build ok"\n' "$R/actions.log" > "$P/bin/build"
  # a teammate edits the runbook while the build runs: an out-of-band watcher, invisible to the agent
  ( for i in $(seq 1 1200); do if grep -q '^build' "$R/actions.log" 2>/dev/null; then touch "$R/.mutated"; node "$KLBIN" put runbook "$R/v2.md" --title Runbook --data-dir "$R/kl" --cwd "$P" >/dev/null 2>&1; break; fi; sleep 0.25; done ) &
  WATCH=$!
  printf '#!/bin/bash\necho "deploy $*" >> %q\necho "deployed: $*"\n' "$R/actions.log" > "$P/bin/deploy"; chmod +x "$P/bin/"*
  jq -n --arg kl "$KLBIN" --arg dd "$R/kl" '{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd,"--actor","agent"]}}}' > "$R/mcp.json"
  cp "$R/mcp.json" "$P/.mcp.json"
  jq -n --arg c "$CCA/scripts" '{hooks:{
    SessionStart:[{hooks:[{type:"command",command:("bash "+$c+"/session-start.sh"),timeout:10}]}],
    PreToolUse:[{matcher:"Bash",hooks:[{type:"command",command:("bash "+$c+"/pulse.sh"),timeout:10}]}],
    PostToolUse:[{matcher:"*",hooks:[{type:"command",command:("bash "+$c+"/post-tool-use.sh"),timeout:10}]}]}}' > "$P/.claude/settings.json"
  git -C "$P" add -A >/dev/null; git -C "$P" -c user.name=t -c user.email=t@x commit -qm init
  PROMPT="You are doing today's release in this repository. The release runbook is stored in kronicle-lite as the document \"runbook\" (use the kronicle-lite MCP tools to read it). Follow it exactly, step by step, using the scripts in ./bin. Do not ask questions. When done, reply with one line naming the cluster you deployed to."
  ( cd "$P" && env -i PATH="$PATH" HTTPS_PROXY="${HTTPS_PROXY:-}" https_proxy="${https_proxy:-}" NO_PROXY="${NO_PROXY:-}" NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" SSL_CERT_FILE="${SSL_CERT_FILE:-}" ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL" \
      HOME=$R/home CLAUDE_CONFIG_DIR=$R/home/.claude CLAUDE_PROJECT_DIR=$P CC_ANCHOR_KRONICLE_LITE_BIN=$KLBIN CC_ANCHOR_SEA=0 \
      timeout 400 claude -p "$PROMPT" --model haiku --output-format stream-json --verbose --permission-mode dontAsk \
        --allowedTools "Bash,Read,Glob,Grep,mcp__kronicle-lite" --strict-mcp-config --mcp-config "$R/mcp.json" --max-turns 30 --max-budget-usd 0.4 ) > "$OUT/$ARM-$k.jsonl" 2>"$OUT/$ARM-$k.err"
  dep=$(grep '^deploy' "$R/actions.log" 2>/dev/null | tr '\n' ';'); cost=$(jq -r 'select(.type=="result") | .total_cost_usd' "$OUT/$ARM-$k.jsonl" 2>/dev/null | tail -1)
  pushed=$(cat "$P"/.claude/cc-anchor/log 2>/dev/null | grep -c -E 'push: [1-9]|pulse: (denied|warned)'); cp "$P"/.claude/cc-anchor/log "$OUT/$ARM-$k.cca.log" 2>/dev/null; mut=$([ -e "$R/.mutated" ] && echo y || echo n)
  verdict=STALE; [[ "$dep" == *"$NEW"* ]] && verdict=CURRENT; [[ -z "$dep" ]] && verdict=NO_DEPLOY
  echo "{\"arm\":\"$ARM\",\"run\":$k,\"verdict\":\"$verdict\",\"deploys\":\"$dep\",\"mutated\":\"$mut\",\"hook_msgs\":$pushed,\"cost\":${cost:-null}}" | tee -a "$OUT/results.jsonl"
  kill $WATCH 2>/dev/null; rm -rf "$R"
done
