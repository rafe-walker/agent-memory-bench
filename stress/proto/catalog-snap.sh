#!/usr/bin/env bash
# mcp-catalog-snap 0.1.0 against kronicle-lite / sea-lite: exit codes (0 same, 1 drift, 2 could not check),
# the cases where a check could pass without checking anything, determinism, stdio vs HTTP.
# usage: SNAP=<mcp-catalog-snap bin> KLBIN=… SLBIN=… stress/proto/catalog-snap.sh
set -uo pipefail
B=/tmp/claude-0/proto/node_modules/.bin
S=${SNAP:-$B/mcp-catalog-snap}; KL=${KLBIN:-$B/kronicle-lite}; SL=${SLBIN:-$B/sea-lite}
W=$(mktemp -d "${TMPDIR:-/tmp}/proto-snap-XXXXXX"); trap '[[ -n "$W" && -d "$W" ]] && rm -rf -- "$W"' EXIT
cd "$W" || exit 2; export HOME=$W KRONICLE_LITE_DATA_DIR=$W/data
FAILS=0
res() { [[ " $3 " == *" $2 "* ]] || FAILS=$((FAILS+1)); printf '%-4s %-64s exit=%s %s\n' "$([[ " $3 " == *" $2 "* ]] && echo ok || echo FAIL)" "$1" "$2" "${4:-}"; }
$S snapshot -- "$KL" serve >/dev/null 2>&1; res "snapshot kl (stdio)" $? "0"
$S snapshot --name sea-lite -- "$SL" serve >/dev/null 2>&1; res "snapshot sl (stdio)" $? "0"
cp .mcp-catalog/kronicle-lite.json k1.json; $S snapshot --no-write -- "$KL" serve >/dev/null 2>&1
$S check -- "$KL" serve >/dev/null 2>&1; res "check kl unchanged" $? "0"
$S check --name sea-lite -- "$SL" serve --actor someone-else --session other >/dev/null 2>&1; res "check sl with another actor/session (catalog must not depend on identity)" $? "0"
$S check --name sea-lite -- "$SL" serve --tracks work,design >/dev/null 2>&1; res "check sl --tracks work,design (enum may widen)" $? "0 1" "(informational)"
$S check -- "$KL" serve --core >/dev/null 2>&1; res "check kl --core = drift" $? "1"
$S check --name nope -- "$KL" serve >/dev/null 2>&1; res "check with no snapshot file for the server" $? "1 2"
echo '{"snapshotDir":".mcp-catalog","servers":[]}' > .mcp-catalog.json; $S check >/dev/null 2>&1; res "config with zero servers (checks nothing)" $? "2"
echo "{\"snapshotDir\":\".mcp-catalog\",\"servers\":[{\"name\":\"kronicle-lite\",\"command\":[\"$KL\",\"serve\"]}]}" > .mcp-catalog.json
$S check >/dev/null 2>&1; res "config with kl" $? "0"
$S check --server sea-lite >/dev/null 2>&1; res "check --server <name not in config>" $? "2"
echo "{\"snapshotDir\":\".mcp-catalog\",\"servers\":[{\"name\":\"api\",\"url\":\"http://127.0.0.1:9/mcp\",\"headers\":{\"Authorization\":\"Bearer \${MCP_TOKEN_MISSING}\"}}]}" > .mcp-catalog.json
$S check >/dev/null 2>&1; res "config with a missing \${VAR}" $? "2"
rm -f .mcp-catalog.json
$S check >/dev/null 2>&1; res "no config and no args" $? "2"
python3 -c "
import json; p='.mcp-catalog/kronicle-lite.json'; d=json.load(open(p)); d['catalog']['tools'][0]['description']+=' X'; open(p,'w').write(json.dumps(d))"
$S check -- "$KL" serve >/dev/null 2>&1; res "hand-edited snapshot (catalog edited, stale sha256)" $? "1 2"
cp k1.json .mcp-catalog/kronicle-lite.json
python3 -c "
import json; p='.mcp-catalog/kronicle-lite.json'; d=json.load(open(p)); d['catalog']['tools']=[]; open(p,'w').write(json.dumps(d))"
$S check -- "$KL" serve >/dev/null 2>&1; res "snapshot with tools emptied by hand (sha256 left stale)" $? "1 2"
$S check --allow-additions -- "$KL" serve >/dev/null 2>&1; res "  same, --allow-additions (every live tool is an 'addition')" $? "1 2"
cp k1.json .mcp-catalog/kronicle-lite.json
python3 -c "
import json; p='.mcp-catalog/kronicle-lite.json'; d=json.load(open(p)); d['sha256']='0'*64; open(p,'w').write(json.dumps(d))"
out=$($S check -- "$KL" serve 2>&1); c=$?; res "snapshot whose sha256 field is wrong (catalog intact)" $c "1 2" "$(echo "$out" | grep -i -m1 sha || echo '(no mention of sha256)')"
cp k1.json .mcp-catalog/kronicle-lite.json
$S check -- false >/dev/null 2>&1; res "server command exits 1" $? "2"
$S check -- sh -c 'echo not-json; sleep 1' >/dev/null 2>&1; res "server prints garbage then exits" $? "2"
t0=$(date +%s); timeout 120 $S check -- sleep 100 >/dev/null 2>&1; c=$?; res "server that never answers (timeout 30 s)" $c "2" "after $(( $(date +%s)-t0 )) s"
# stdio vs HTTP: the same server, same catalog?
P=$(( 20000 + RANDOM % 20000 )); "$KL" serve --http --host 127.0.0.1 --port $P >/dev/null 2>&1 & HP=$!
for i in $(seq 50); do [[ -s data/http-bearer.token ]] && curl -s -o /dev/null --noproxy '*' "http://127.0.0.1:$P/" && break; sleep 0.2; done
$S check --name kronicle-lite --url "http://127.0.0.1:$P/mcp" --header "Authorization: Bearer $(cat data/http-bearer.token)" >/dev/null 2>&1; res "check kl over HTTP vs stdio snapshot (literal header)" $? "0"
kill $HP; wait $HP 2>/dev/null
# fingerprint stable across two captures
a=$($S hash -- "$KL" serve 2>/dev/null); b=$($S hash -- "$KL" serve 2>/dev/null); [[ -n "$a" && "$a" == "$b" ]]; res "hash stable across captures" $? "0"
exit $(( FAILS > 0 ))
