#!/usr/bin/env bash
# Build a snapshot of a kronicle-lite ref for the kronicle-lite-081 / kronicle-lite-080 arms.
#   KRONICLE_LITE_SRC (default /home/claude/kl-fix-081; any worktree of the repo)  KL_REF (default fix-0.8.1)
#   KL_OUT (default <bench>/.arms-081/kronicle-lite-081)
# The 0.8.0 before-arm: KL_REF=7e50702 KL_OUT=<bench>/.arms-081/kronicle-lite-080 bash track-a/setup-kl-081.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${KRONICLE_LITE_SRC:-/home/claude/kl-fix-081}"
REF="${KL_REF:-fix-0.8.1}"
OUT="${KL_OUT:-$ROOT/.arms-081/kronicle-lite-081}"
case "$OUT" in "$ROOT"/.arms-081/*|/tmp/*) ;; *) echo "refusing to build outside the bench (.arms-081) or /tmp: $OUT" >&2; exit 2;; esac
rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
ln -s "$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)/../node_modules" "$OUT/node_modules"
echo "kronicle-lite $REF@$(git -C "$SRC" rev-parse --short "$REF") (git archive, $(date -u +%FT%TZ))" > "$OUT/SNAPSHOT"
(cd "$OUT" && npx tsup >/dev/null)
cat "$OUT/SNAPSHOT"
