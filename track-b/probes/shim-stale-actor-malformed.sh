#!/usr/bin/env bash
# probe: kronicle-lite shims — (B) a dead session's actor keeps the gate shut; (C) a malformed store
TB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -u
D=$(mktemp -d -p "${WORK:-${TMPDIR:-/tmp}}")
export HOME=$D/home KL=$TB/node_modules/kronicle-lite/dist/cli.js
mkdir -p $D/repo $HOME; cd $D/repo; git init -q
printf 'release:\n\t@echo REAL-MAKE-RELEASE\n' > Makefile
printf '# RB\n\n## Steps\n1. Deploy target: `stg-a`\n' > $D/v1.md
node $KL put runbook $D/v1.md --data-dir $D/kl >/dev/null
node $KL shim install --dir $D/shims --commands make --data-dir $D/kl >/dev/null 2>&1
export PATH=$D/shims:$PATH
node $KL get runbook --actor "agent-A1#11111111" --data-dir $D/kl >/dev/null     # session 1 reads
sed 's/stg-a/stg-b/' $D/v1.md > $D/v2.md; node $KL put runbook $D/v2.md --data-dir $D/kl >/dev/null
node $KL get runbook --actor "agent-A1#22222222" --data-dir $D/kl >/dev/null     # session 2 re-reads current
echo "(B) after session 2 re-read:"; make release 2>&1 | grep -o 'REAL-MAKE-RELEASE\|did NOT run.\{0,60\}\|not yet re-read[^]]*' | head -3
node $KL pending --actor "agent-A1#22222222" --json --data-dir $D/kl | jq -c '{session2_pending:.pending_count}'
dd if=/dev/zero of=$D/kl/kronicle-lite.db bs=4096 seek=2 count=1 conv=notrunc 2>/dev/null
echo "(C) malformed store:"; make release 2>&1 | head -3 | cut -c1-200; echo "rc=$?"
tail -2 $D/shims/.kronicle-shim/shim.log | cut -c1-200
