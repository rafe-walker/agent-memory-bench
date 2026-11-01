#!/usr/bin/env bash
# N processes hit one fresh kronicle-lite data dir at once (first-start race), then a mixed
# put/orient/recall storm; afterwards: every command exited 0, verify-chain passes, doctor ok,
# one key id, seqs contiguous. usage: KLBIN=<kl>/dist/cli.js stress/kl/concurrency.sh [N]
set -uo pipefail
KLBIN=${KLBIN:?}; N=${1:-30}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
D=$W/data; fails=0
for i in $(seq 1 "$N"); do printf '# Doc %s\n\n## S\n\nValue %s is current.\n' "$i" "$i" > "$W/d$i.md"; done
# phase 1: first-start race
for i in $(seq 1 "$N"); do node "$KLBIN" put "doc-$i" "$W/d$i.md" --data-dir "$D" --cwd "$W" >"$W/p1.$i.out" 2>"$W/p1.$i.err" & done
wait
for i in $(seq 1 "$N"); do [ -s "$W/p1.$i.err" ] && { echo "phase1 #$i stderr: $(head -c 300 "$W/p1.$i.err")"; fails=$((fails+1)); }; done
node "$KLBIN" keys --data-dir "$D" 2>&1 | head -2
# phase 2: mixed storm
for i in $(seq 1 "$N"); do
  ( printf '# Doc %s\n\n## S\n\nValue %s is now changed.\n' "$i" "$((i+1000))" > "$W/e$i.md"
    node "$KLBIN" put "doc-$i" "$W/e$i.md" --data-dir "$D" --cwd "$W" >/dev/null 2>"$W/p2a.$i.err"
    node "$KLBIN" orient --data-dir "$D" --cwd "$W" --actor "a$i" --json >/dev/null 2>"$W/p2b.$i.err"
    node "$KLBIN" put shared "$W/e$i.md" --data-dir "$D" --cwd "$W" >/dev/null 2>"$W/p2c.$i.err" ) &
done
wait
for f in "$W"/p2*.err; do [ -s "$f" ] && { echo "$(basename "$f"): $(head -c 300 "$f")"; fails=$((fails+1)); }; done
node "$KLBIN" verify-chain --data-dir "$D" --full >"$W/vc.out" 2>&1; echo "verify-chain exit=$?"; tail -3 "$W/vc.out"
node "$KLBIN" doctor --data-dir "$D" --no-network >"$W/doc.out" 2>&1; echo "doctor exit=$?"; grep -i -E 'fail|error' "$W/doc.out" | head -5
echo "stderr-failures=$fails"
# every put landed exactly once
node "$KLBIN" export --data-dir "$D" --out "$W/ev.jsonl" 2>/dev/null
puts=$(grep -c '"document.put"' "$W/ev.jsonl"); echo "document.put events=$puts expected=$((2*N + N))"
seqs=$(tail -n +2 "$W/ev.jsonl" | jq -r .seq | sort -n | awk 'NR!=$1{bad++} END{print bad+0}'); echo "non-contiguous seqs=$seqs"
