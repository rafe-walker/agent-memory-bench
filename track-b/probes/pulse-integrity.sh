#!/usr/bin/env bash
# probe: integrity field per orient focus after a projection (blocks) tamper
TB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -u
D=$(mktemp -d -p "${WORK:-${TMPDIR:-/tmp}}")
export HOME=$D/home KL=$TB/node_modules/kronicle-lite/dist/cli.js
mkdir -p $D/repo $HOME; cd $D/repo; git init -q
printf '# RB\n\n## Steps\n1. Deploy target: `stg-a`\n2. Channel: `#x`\n' > $D/v1.md
node $KL put runbook $D/v1.md --data-dir $D/kl >/dev/null
C=$(node $KL orient --json --actor agent --data-dir $D/kl | jq -r .cursor)
python3 -I -c "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(\"update blocks set content=replace(content,'stg-a','stg-evil')\");c.commit()" $D/kl/kronicle-lite.db
for f in pulse retractions full; do echo -n "focus=$f: "; node $KL orient --json --actor x --cursor "$C" --focus $f --pending-actor agent --data-dir $D/kl | jq -c '.integrity'; done
echo -n "no cursor pulse: "; node $KL orient --json --actor x --focus pulse --data-dir $D/kl | jq -c '.integrity'
