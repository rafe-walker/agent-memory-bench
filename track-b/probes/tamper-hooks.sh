#!/usr/bin/env bash
# probe: tamper vs shim pulse (--state, seeded first) and cc-anchor pulse hook
TB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -u
KIND="${1:-block}"
D=$(mktemp -d -p "${WORK:-${TMPDIR:-/tmp}}")
CCA=$TB/vendor/cc-anchor/scripts
export HOME=$D/home CLAUDE_CONFIG_DIR=$D/home/.claude KL=$TB/node_modules/kronicle-lite/dist/cli.js
export CC_ANCHOR_KRONICLE=1 CC_ANCHOR_KRONICLE_DATA_DIR=$D/kl CC_ANCHOR_KRONICLE_LITE_BIN=$KL CLAUDE_PROJECT_DIR=$D/repo CC_ANCHOR_KRONICLE_ACTOR=agent
mkdir -p $D/repo $HOME/.claude $D/st; cd $D/repo; git init -q
printf '# RB\n\n## Steps\n1. Deploy target: `stg-a`\n2. Channel: `#x`\n' > $D/v1.md
node $KL put runbook $D/v1.md --data-dir $D/kl >/dev/null
P() { printf '{"session_id":"sess12345678","cwd":"%s","hook_event_name":"%s","tool_name":"%s","tool_input":%s,"tool_response":{"stdout":"ok"}}' "$D/repo" "$1" "$2" "$3"; }
echo '{"session_id":"sess12345678","cwd":"'$D/repo'","hook_event_name":"SessionStart","source":"startup"}' | bash $CCA/session-start.sh >/dev/null
node $KL get runbook --actor agent --data-dir $D/kl >/dev/null
node $KL pulse --data-dir $D/kl --state $D/st --json >/dev/null 2>&1; echo "seed pulse exit=$?"
P PostToolUse Bash '{"command":"./bin/preflight"}' | bash $CCA/post-tool-use.sh >/dev/null
python3 -I - "$D/kl/kronicle-lite.db" "$KIND" <<'PY'
import sqlite3,sys
k=sys.argv[2]
if k=='garbage':
    f=open(sys.argv[1],'r+b'); f.seek(4096*2); f.write(b'\x00'*4096); f.close(); sys.exit()
c=sqlite3.connect(sys.argv[1])
if k=='block': c.execute("update blocks set content=replace(content,'stg-a','stg-evil')")
if k=='event': c.execute("update events set payload_canonical=replace(payload_canonical,'stg-a','stg-evil')")
c.commit()
PY
echo "[$KIND] shim pulse (state):"; node $KL pulse --data-dir $D/kl --state $D/st --json 2>/dev/null | jq -c '{decision,integrity:(.integrity.ok)}'; echo " exit=${PIPESTATUS[0]}"
echo "[$KIND] cc push after build:"; P PostToolUse Bash '{"command":"./bin/build"}' | bash $CCA/post-tool-use.sh | head -c 400; echo
echo "[$KIND] cc pulse before deploy:"; P PreToolUse Bash '{"command":"./bin/deploy --target stg-a"}' | bash $CCA/pulse.sh | head -c 400; echo
echo "[$KIND] cc log:"; tail -3 $D/repo/.claude/cc-anchor/*.log 2>/dev/null
