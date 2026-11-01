#!/usr/bin/env bash
# serve --http hardening probes (kl or sea-lite). usage: BIN=<dist/cli.js> KIND=kl|sl PORT=7499 stress/kl/http-probe.sh
set -uo pipefail
BIN=${BIN:?}; KIND=${KIND:-kl}; PORT=${PORT:-7499}
W=$(mktemp -d); trap 'kill $SP 2>/dev/null; rm -rf "$W"' EXIT
git init -q "$W/repo"; cd "$W/repo"
if [[ $KIND == kl ]]; then node "$BIN" serve --http --port "$PORT" --data-dir "$W/d" >"$W/log" 2>&1 & SP=$!; TOK=$W/d/http-bearer.token
else KRONICLE_LITE_DATA_DIR=$W/d node "$BIN" serve --http --port "$PORT" >"$W/log" 2>&1 & SP=$!; TOK=$W/d/http-bearer.token; fi
for i in $(seq 1 50); do [[ -s "$TOK" ]] && curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.2; done
T=$(cat "$TOK"); U="http://127.0.0.1:$PORT/mcp"
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"p","version":"0"}}}'
probe() { local name=$1 want=$2; shift 2; local code; code=$(curl -s -o "$W/body" -w '%{http_code}' --noproxy '*' "$@"); if [[ " $want " == *" $code "* ]]; then echo "ok   $name -> $code"; else echo "FAIL $name -> $code (want $want) $(head -c 150 "$W/body")"; fi; }
H=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
probe "no bearer" "401" -X POST "${H[@]}" --data "$INIT" "$U"
probe "wrong bearer" "401 403" -X POST "${H[@]}" -H "Authorization: Bearer x$T" --data "$INIT" "$U"
probe "bearer prefix only" "401 403" -X POST "${H[@]}" -H "Authorization: Bearer ${T:0:8}" --data "$INIT" "$U"
probe "good bearer, 2025 initialize" "200" -X POST "${H[@]}" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "DNS-rebinding Host: evil.com" "403 421 400" -X POST "${H[@]}" -H "Host: evil.com" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "Host: 127.0.0.1.evil.com" "403 421 400" -X POST "${H[@]}" -H "Host: 127.0.0.1.evil.com:$PORT" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "Host: localhost.evil.com" "403 421 400" -X POST "${H[@]}" -H "Host: localhost.evil.com" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "Origin: https://evil.com" "403" -X POST "${H[@]}" -H "Origin: https://evil.com" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "Origin: http://localhost.evil.com" "403" -X POST "${H[@]}" -H "Origin: http://localhost.evil.com" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "Origin: null" "403" -X POST "${H[@]}" -H "Origin: null" -H "Authorization: Bearer $T" --data "$INIT" "$U"
probe "GET /mcp" "405" -H "Authorization: Bearer $T" "$U"
probe "path /mcp/../mcp" "200 404" -X POST "${H[@]}" -H "Authorization: Bearer $T" --data "$INIT" --path-as-is "http://127.0.0.1:$PORT/mcp/../mcp"
head -c 30000000 /dev/zero | tr '\0' a > "$W/big"; printf '{"jsonrpc":"2.0","id":2,"method":"ping","params":{"x":"%s"}}' "$(cat "$W/big")" > "$W/bigreq" 2>/dev/null
probe "30 MB body" "413 400" -X POST "${H[@]}" -H "Authorization: Bearer $T" --data-binary @"$W/bigreq" "$U"
probe "garbage body" "400" -X POST "${H[@]}" -H "Authorization: Bearer $T" --data 'nope' "$U"
probe "server alive after abuse" "200" -X POST "${H[@]}" -H "Authorization: Bearer $T" --data "$INIT" "$U"
ps -o rss= -p $SP | awk '{print "     server RSS after abuse: " int($1/1024) " MB"}'
stat -c '     token file mode %a' "$TOK"
