#!/usr/bin/env bash
# probe: cc-anchor 0.5.0 per-subagent cursors + shared kronicle actor.
TB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Coordinator reads v1; sub1 builds (v2 lands) and re-reads; coordinator IGNORES its push and hands
# the stale target to sub3; sub3 (started after) deploys stale. What does sub3 get from push/pulse?
set -u
D=$(mktemp -d -p "${WORK:-${TMPDIR:-/tmp}}")
CCA=$TB/vendor/cc-anchor/scripts
export HOME=$D/home CLAUDE_CONFIG_DIR=$D/home/.claude KL=$TB/node_modules/kronicle-lite/dist/cli.js
export CC_ANCHOR_KRONICLE=1 CC_ANCHOR_KRONICLE_DATA_DIR=$D/kl CC_ANCHOR_KRONICLE_LITE_BIN=$KL CLAUDE_PROJECT_DIR=$D/repo CC_ANCHOR_KRONICLE_ACTOR=agent
mkdir -p $D/repo $HOME/.claude; cd $D/repo; git init -q
printf '# RB\n\n## Steps\n1. Deploy target: `stg-a`\n' > $D/v1.md
node $KL put runbook $D/v1.md --data-dir $D/kl >/dev/null
S=sess12345678
P() { # event tool agent input
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"%s","tool_name":"%s","tool_input":%s,"tool_response":{"stdout":"ok"}%s}' $S "$D/repo" "$1" "$2" "$4" "${3:+,\"agent_id\":\"$3\"}"; }
echo '{"session_id":"'$S'","cwd":"'$D/repo'","hook_event_name":"SessionStart","source":"startup"}' | bash $CCA/session-start.sh >/dev/null
node $KL get runbook --actor agent --data-dir $D/kl >/dev/null                                   # coordinator reads v1
P PostToolUse mcp__kronicle-lite__recall "" '{"query":"runbook"}' | bash $CCA/post-tool-use.sh >/dev/null
echo '{"session_id":"'$S'","cwd":"'$D/repo'","hook_event_name":"SubagentStart","agent_id":"sub1"}' | bash $CCA/subagent-start.sh
sed 's/stg-a/stg-b/' $D/v1.md > $D/v2.md; node $KL put runbook $D/v2.md --data-dir $D/kl >/dev/null   # lands during sub1's build
echo "sub1 push after build: $(P PostToolUse Bash sub1 '{"command":"./bin/build"}' | bash $CCA/post-tool-use.sh | grep -c 'retraction')"
node $KL get runbook --actor agent --data-dir $D/kl >/dev/null                                   # sub1 re-reads (same actor)
P PostToolUse mcp__kronicle-lite__recall sub1 '{"query":"runbook"}' | bash $CCA/post-tool-use.sh >/dev/null
echo "coordinator push on Task result: $(P PostToolUse Task "" '{"prompt":"build"}' | bash $CCA/post-tool-use.sh | grep -c 'retraction')"
# coordinator ignores it, starts sub3 with the stale command
echo '{"session_id":"'$S'","cwd":"'$D/repo'","hook_event_name":"SubagentStart","agent_id":"sub3"}' | bash $CCA/subagent-start.sh
echo "sub3 pulse before stale deploy: $(P PreToolUse Bash sub3 '{"command":"./bin/deploy --target stg-a"}' | bash $CCA/pulse.sh | head -c 160)"
echo "pending for agent: $(node $KL pending --actor agent --json --data-dir $D/kl | jq .pending_count)"
