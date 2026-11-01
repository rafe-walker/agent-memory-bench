#!/usr/bin/env bash
# kronicle-lite chaos: kill -9 mid-put, disk full (1 MB tmpfs, needs root), read-only data dir,
# torn/corrupted DB bytes. usage: KLBIN=<kl>/dist/cli.js stress/kl/chaos.sh [kill|full|ro|corrupt|all]
set -uo pipefail
KLBIN=${KLBIN:?}; what=${1:-all}
W=$(mktemp -d); trap 'umount "$W/tm" 2>/dev/null; rm -rf "$W"' EXIT
kl() { node "$KLBIN" "$@"; }
bigdoc() { { echo "# Big $1"; for s in $(seq 1 40); do printf '\n## Sec %s\n\n' "$s"; for p in $(seq 1 5); do printf 'Paragraph %s.%s rev %s says host-%s.\n\n' "$s" "$p" "$1" "$RANDOM"; done; done; } > "$2"; }
check() { # $1 data dir, $2 label
  kl verify-chain --data-dir "$1" --full >"$W/vc" 2>&1; local v=$?
  kl doctor --data-dir "$1" --no-network >"$W/dr" 2>&1; local d=$?
  echo "[$2] verify-chain=$v doctor=$d $(grep -o '[0-9]* ok, [0-9]* warn, [0-9]* fail' "$W/dr")"
  [ $v -ne 0 ] && grep -m3 -i -E "mismatch|error|problem" "$W/vc"; [ $d -ne 0 ] && grep -i -E "^ *(✗|fail|x )" "$W/dr" | head -4
}
if [[ $what == kill || $what == all ]]; then
  D=$W/kill; bigdoc 0 "$W/b.md"; kl put big "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null
  for i in $(seq 1 40); do
    bigdoc "$i" "$W/b.md"; kl put big "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null 2>&1 & pid=$!
    sleep "0.$((RANDOM % 6))$((RANDOM % 10))"; kill -9 $pid 2>/dev/null; wait $pid 2>/dev/null
  done
  check "$D" "kill -9 x40"
  bigdoc final "$W/b.md"; kl put big "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null 2>"$W/e" ; echo "[kill] put after kills exit=$? $(head -c 200 "$W/e")"
  check "$D" "kill -9 then put"
fi
if [[ $what == full || $what == all ]]; then
  mkdir -p "$W/tm"; mount -t tmpfs -o size=1m tmpfs "$W/tm" || { echo "[full] skipped: cannot mount tmpfs"; }
  D=$W/tm/data; n=0; last=0
  for i in $(seq 1 200); do
    bigdoc "$i" "$W/b.md"; kl put "big-$i" "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null 2>"$W/e"; last=$?
    [ $last -ne 0 ] && break; n=$i
  done
  echo "[full] puts before failure=$n exit=$last err=$(head -c 200 "$W/e")"
  kl orient --data-dir "$D" --cwd "$W" --actor a --json >/dev/null 2>"$W/e"; echo "[full] orient while full exit=$? $(head -c 150 "$W/e")"
  mount -o remount,size=64m "$W/tm"; check "$D" "after ENOSPC, space freed"
  kl put after "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null 2>"$W/e"; echo "[full] put after freeing exit=$?"
  umount "$W/tm"
fi
if [[ $what == ro || $what == all ]]; then
  mkdir -p "$W/tm"; mount -t tmpfs -o size=16m tmpfs "$W/tm"; D=$W/tm/data
  bigdoc 1 "$W/b.md"; kl put big "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null
  C=$(kl orient --data-dir "$D" --cwd "$W" --actor a --json | jq -r .cursor)
  mount -o remount,ro "$W/tm"
  for c in "orient --actor a --json --cursor $C --focus retractions" "orient --actor a --json" "verify-chain" "doctor --no-network"; do
    timeout 20 node "$KLBIN" $c --data-dir "$D" --cwd "$W" >"$W/o" 2>"$W/e"; echo "[ro] $c -> exit=$? $(head -c 160 "$W/e" | tr '\n' ' ')"
  done
  umount "$W/tm"
fi
if [[ $what == corrupt || $what == all ]]; then
  D=$W/cor; bigdoc 1 "$W/b.md"; kl put big "$W/b.md" --data-dir "$D" --cwd "$W" >/dev/null
  kl orient --data-dir "$D" --actor a --json >/dev/null
  sz=$(stat -c %s "$D/kronicle-lite.db"); cp "$D/kronicle-lite.db" "$W/orig.db"
  for off in 100 4096 $((sz/2)) $((sz-200)); do
    cp "$W/orig.db" "$D/kronicle-lite.db"; rm -f "$D"/kronicle-lite.db-wal "$D"/kronicle-lite.db-shm
    printf '\xff\xfe\xfd\xfc\xfb\xfa\xf9\xf8' | dd of="$D/kronicle-lite.db" bs=1 seek="$off" conv=notrunc status=none
    timeout 20 node "$KLBIN" orient --data-dir "$D" --cwd "$W" --actor a --json >"$W/o" 2>"$W/e"; oe=$?
    echo "[corrupt@$off] orient exit=$oe integrity.ok=$(jq -r '.integrity.ok // "n/a"' "$W/o" 2>/dev/null) err=$(head -c 120 "$W/e"|tr '\n' ' ')"
    check "$D" "corrupt@$off"
  done
  cp "$W/orig.db" "$D/kronicle-lite.db"; truncate -s $((sz/2)) "$D/kronicle-lite.db"; rm -f "$D"/kronicle-lite.db-wal "$D"/kronicle-lite.db-shm
  timeout 20 node "$KLBIN" orient --data-dir "$D" --cwd "$W" --actor a --json >"$W/o" 2>"$W/e"; echo "[truncated] orient exit=$? $(head -c 120 "$W/e")"
  check "$D" "truncated"
fi
