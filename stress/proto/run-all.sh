#!/usr/bin/env bash
# Round-2 protocol track (P2-xx). Targets are the npm-published kronicle-lite 0.8.0, sea-lite 0.6.0,
# mcp-catalog-snap 0.1.0 installed by stress/proto/setup.sh into $PROTO_PKG (default /tmp/claude-0/proto);
# override with KLBIN / SLBIN / SNAP. Logs: stress/logs/proto/ (gitignored). Binds 127.0.0.1 only.
#   stress/proto/run-all.sh [--slow]   (--slow adds the oversized-response runs, ~6 min)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); LOG=$HERE/../logs/proto; mkdir -p "$LOG"
P=${PROTO_PKG:-/tmp/claude-0/proto}; export PROTO_PKG=$P NODE_PATH=$P/node_modules
ln -sfn "$P/node_modules" "$HERE/node_modules"   # ESM resolves bare imports from the script dir
step() { local name=$1; shift; printf '%-26s ' "$name"; if "$@" > "$LOG/$name.log" 2>&1; then echo ok; else echo "FAIL (stress/logs/proto/$name.log)"; fi; }
step kl-schema-fuzz     node "$HERE/schema-fuzz.mjs" kl --n 600 --seed 7
step kl-schema-core     node "$HERE/schema-fuzz.mjs" kl --n 300 --seed 3 --core
step sl-schema-fuzz     node "$HERE/schema-fuzz.mjs" sl --n 600
step sl-outputs         node "$HERE/outputs-sl.mjs"
step sl-outputs-core    node "$HERE/outputs-sl.mjs" --core
step kl-conformance     node "$HERE/conformance.mjs" kl
step sl-conformance     node "$HERE/conformance.mjs" sl
step ts-clients         node "$HERE/ts-clients.mjs" both
step py-clients         "$P/venv/bin/python" -I "$HERE/py_client.py" "$P/node_modules/.bin"
step py1-clients        "$P/venv1/bin/python" "$HERE/py1_client.py" "$P/node_modules/.bin"
step sl-actor-tokens    node "$HERE/actor-tokens.mjs"
step sl-dry-run         node "$HERE/dry-run.mjs"
step kl-http-hard       node "$HERE/http-hard.mjs" kl
step sl-http-hard       node "$HERE/http-hard.mjs" sl
step kl-fuzz            node "$HERE/fuzz.mjs" kl
step sl-fuzz            node "$HERE/fuzz.mjs" sl
step first-start-race   node "$HERE/first-start-race.mjs" 20
step sl-add-token-order node "$HERE/add-token-order.mjs"
step sl-actor-mismatch  node "$HERE/actor-mismatch.mjs"
step kl-datadir-split   bash "$HERE/datadir-split.sh"
step catalog-snap       bash "$HERE/catalog-snap.sh"
step config-snippets    env CODEX_BIN="$P/codex/node_modules/.bin/codex" node "$HERE/config-snippets.mjs"
if [[ " $* " == *" --slow "* ]]; then
  step sl-big-response  node "$HERE/big-response.mjs" sl
  step kl-big-response  node "$HERE/big-response.mjs" kl 100000
  step sl-client-bigresp node "$HERE/client-bigresp.mjs" sl
  step kl-client-bigresp node "$HERE/client-bigresp.mjs" kl
fi
