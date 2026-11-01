#!/usr/bin/env bash
# Build a snapshot of a kronicle-lite ref for the kronicle-lite-next-release arm.
#   KRONICLE_LITE_SRC (default /home/claude/kl-next-release; any worktree of the repo)  KL_REF (default next-release)
#   KL_NEXT_PKG (default <bench>/.arms-next-release/kronicle-lite-next-release)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${KRONICLE_LITE_SRC:-/home/claude/kl-next-release}"
REF="${KL_REF:-next-release}"
OUT="${KL_NEXT_PKG:-$ROOT/.arms-next-release/kronicle-lite-next-release}"
case "$OUT" in "$ROOT"/.arms-next-release/*|/tmp/*) ;; *) echo "refusing to build outside the bench (.arms-next-release) or /tmp: $OUT" >&2; exit 2;; esac
rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
ln -s "$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)/../node_modules" "$OUT/node_modules"
echo "kronicle-lite $REF@$(git -C "$SRC" rev-parse --short "$REF") (git archive, $(date -u +%FT%TZ))" > "$OUT/SNAPSHOT"
(cd "$OUT" && npx tsup >/dev/null)
cat "$OUT/SNAPSHOT"
