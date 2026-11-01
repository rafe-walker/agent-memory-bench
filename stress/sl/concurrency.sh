#!/usr/bin/env bash
# sea-lite claim races: N sessions claim one ticket; N sessions `next` over M tickets;
# N sessions claim different tickets with one overlapping path. Exactly-one / no-double invariants,
# then `sea-lite verify`. usage: SLBIN=<sea-lite>/dist/cli.js stress/sl/concurrency.sh [N]
set -uo pipefail
SLBIN=${SLBIN:?}; N=${1:-40}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export KRONICLE_LITE_DATA_DIR=$W/data
git init -q "$W/repo"; cd "$W/repo"; mkdir -p shared; echo x > shared/file.ts; git add .; git -c user.email=a@b -c user.name=a commit -qm i
sl() { node "$SLBIN" "$@"; }
T=$(sl create "race-one" --triaged --json | jq -r '.id // .ticket.id')
for i in $(seq 1 "$N"); do sl claim "$T" --session "s$i" --actor "a$i" --json >"$W/c1.$i" 2>"$W/c1e.$i" & done; wait
ok=0; locked=0; other=0; for i in $(seq 1 "$N"); do if jq -e '.claims // .claimed // .tokens' "$W/c1.$i" >/dev/null 2>&1; then ok=$((ok+1)); elif grep -q -i 'already_claimed\|claimed by' "$W/c1e.$i" "$W/c1.$i"; then locked=$((locked+1)); else other=$((other+1)); [ $other -le 3 ] && echo "  other#$i: $(head -c 200 "$W/c1e.$i") $(head -c 200 "$W/c1.$i")"; fi; done
echo "[one ticket] winners=$ok already_claimed=$locked other_errors=$other (expect winners=1)"
M=$((N/2)); for j in $(seq 1 "$M"); do sl create "q$j" --triaged >/dev/null; done
for i in $(seq 1 "$N"); do sl next --session "n$i" --actor "n$i" --json >"$W/n.$i" 2>"$W/ne.$i" & done; wait
cat "$W"/n.* | jq -r '.ticket.id // empty' 2>/dev/null | sort | uniq -c | awk '$1>1{d++} {t++} END{print "[next] distinct tickets claimed="t+0" double-claimed="d+0}'
errs=$(cat "$W"/ne.* | grep -v -i -c 'no eligible\|nothing\|empty' ); echo "[next] unexpected stderr lines=$errs"; cat "$W"/ne.* | grep -v -i 'no eligible\|nothing\|empty' | sort | uniq -c | head -3
for j in $(seq 1 "$N"); do sl create "p$j" --triaged --json | jq -r '.id // .ticket.id' > "$W/pid.$j"; done
for i in $(seq 1 "$N"); do sl claim "$(cat "$W/pid.$i")" --paths shared/file.ts --session "p$i" --actor "p$i" --json >"$W/p.$i" 2>"$W/pe.$i" & done; wait
pw=0; for i in $(seq 1 "$N"); do [ ! -s "$W/pe.$i" ] && jq -e . "$W/p.$i" >/dev/null 2>&1 && ! grep -q scope_conflict "$W/p.$i" && pw=$((pw+1)); done
echo "[overlapping scope] holders=$pw (expect 1); conflicts=$(grep -l scope_conflict "$W"/pe.* "$W"/p.* 2>/dev/null | wc -l)"
cat "$W"/pe.* | grep -v scope_conflict | sort | uniq -c | head -3
sl board --json > "$W/board.json" 2>/dev/null; echo "[board] live scopes on shared/file.ts: $(jq '[.tickets[] | select(.claim != null) | .claim.scope[]? | select(.=="shared/file.ts")] | length' "$W/board.json")"
sl verify >"$W/v" 2>&1; echo "[verify] exit=$? $(tail -1 "$W/v")"
