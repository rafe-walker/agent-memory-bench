#!/usr/bin/env bash
# Build a snapshot of a kronicle-lite ref for the kronicle-lite-lineage arm.
#   KRONICLE_LITE_SRC (default /home/claude/kronicle-lite; any worktree of the repo)  KL_REF (default lineage)
#   KL_LINEAGE_PKG (default <bench>/.arms-lineage/kronicle-lite-lineage)
# Before/after: KL_REF=<0.7.0 commit> KL_LINEAGE_PKG=<dir>/before, then the default.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${KRONICLE_LITE_SRC:-/home/claude/kronicle-lite}"
REF="${KL_REF:-lineage}"
OUT="${KL_LINEAGE_PKG:-$ROOT/.arms-lineage/kronicle-lite-lineage}"
rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
ln -s "$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)/../node_modules" "$OUT/node_modules"
echo "kronicle-lite $REF@$(git -C "$SRC" rev-parse --short "$REF") (git archive, $(date -u +%FT%TZ))" > "$OUT/SNAPSHOT"
(cd "$OUT" && npx tsup >/dev/null)
cat "$OUT/SNAPSHOT"
