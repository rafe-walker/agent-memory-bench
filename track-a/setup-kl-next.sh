#!/usr/bin/env bash
# Build a snapshot of a kronicle-lite ref for the kronicle-lite-next arm.
#   KRONICLE_LITE_SRC (default /home/claude/kronicle-lite)  KL_REF (default next)
#   KL_NEXT_PKG (default <bench>/.arms-next/kronicle-lite-next)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${KRONICLE_LITE_SRC:-/home/claude/kronicle-lite}"
REF="${KL_REF:-next}"
OUT="${KL_NEXT_PKG:-$ROOT/.arms-next/kronicle-lite-next}"
rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
ln -s "$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)/../node_modules" "$OUT/node_modules"
echo "kronicle-lite $REF@$(git -C "$SRC" rev-parse --short "$REF") (git archive, $(date -u +%FT%TZ))" > "$OUT/SNAPSHOT"
(cd "$OUT" && npx tsup >/dev/null)
cat "$OUT/SNAPSHOT"
