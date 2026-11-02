#!/usr/bin/env bash
# probe: cc-anchor 0.5.0 pulse gate with the actor named vs not named
TB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -u
ACT="${1:-}"
D=$(mktemp -d -p "${WORK:-${TMPDIR:-/tmp}}")
CCA=$TB/vendor/cc-anchor/scripts
export HOME=$D/home CLAUDE_CONFIG_DIR=$D/home/.claude KL=$TB/node_modules/kronicle-lite/dist/cli.js
export CC_ANCHOR_KRONICLE=1 CC_ANCHOR_KRONICLE_DATA_DIR=$D/kl CC_ANCHOR_KRONICLE_LITE_BIN=$KL CLAUDE_PROJECT_DIR=$D/repo
[[ -n "$ACT" ]] && export CC_ANCHOR_KRONICLE_ACTOR=$ACT
mkdir -p $D/repo $HOME/.claude; cd $D/repo; git init -q
printf '# RB\n\n## Steps\n1. Deploy target: `stg-a`\n2. Channel: `#x`\n' > $D/v1.md
node $KL put runbook $D/v1.md --data-dir $D/kl >/dev/null
P() { printf '{"session_id":"sess12345678","cwd":"%s","hook_event_name":"%s","tool_name":"%s","tool_input":%s,"tool_response":{"stdout":"ok"}}' "$D/repo" "$1" "$2" "$3"; }
echo '{"session_id":"sess12345678","cwd":"'$D/repo'","hook_event_name":"SessionStart","source":"startup"}' | bash $CCA/session-start.sh >/dev/null
node $KL get runbook --actor agent --data-dir $D/kl >/dev/null
P PostToolUse mcp__kronicle-lite__recall '{"query":"runbook"}' | bash $CCA/post-tool-use.sh | head -c 300; echo
sed 's/stg-a/stg-b/' $D/v1.md > $D/v2.md; node $KL put runbook $D/v2.md --data-dir $D/kl >/dev/null
echo "--- push after build:"; P PostToolUse Bash '{"command":"./bin/build"}' | bash $CCA/post-tool-use.sh | head -c 600; echo
echo "--- pulse before deploy:"; P PreToolUse Bash '{"command":"./bin/deploy --target stg-a"}' | bash $CCA/pulse.sh | head -c 600; echo
echo "--- log:"; cat $D/repo/.claude/cc-anchor/*.log 2>/dev/null | tail -5; find $D/repo/.claude -name '*.cfg' -exec cat {} \;
