#!/usr/bin/env bash
# Build a snapshot of a kronicle-lite ref for the kronicle-lite-shims arm (S16 exec-time gate).
#   KRONICLE_LITE_SRC (default /home/claude/kronicle-lite)  KL_REF (default shims)
#   KL_SHIMS_PKG (default <bench>/.arms-shims/kronicle-lite-shims)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${KRONICLE_LITE_SRC:-/home/claude/kronicle-lite}"
REF="${KL_REF:-shims}"
OUT="${KL_SHIMS_PKG:-$ROOT/.arms-shims/kronicle-lite-shims}"
case "$OUT" in "$ROOT"/.arms-shims/*|/tmp/*) ;; *) echo "refusing to build outside the bench (.arms-shims) or /tmp: $OUT" >&2; exit 2;; esac
rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
ln -s "$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)/../node_modules" "$OUT/node_modules"
echo "kronicle-lite $REF@$(git -C "$SRC" rev-parse --short "$REF") (git archive, $(date -u +%FT%TZ))" > "$OUT/SNAPSHOT"
(cd "$OUT" && npx tsup >/dev/null)
cat "$OUT/SNAPSHOT"
