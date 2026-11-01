#!/usr/bin/env bash
# sea-lite scope-check: an absolute path through a symlink resolves into the claim (conflict),
# the same file named by a RELATIVE symlinked path does not. usage: SLBIN=... stress/sl/symlink-scope.sh
set -uo pipefail
SLBIN=${SLBIN:?}; W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export KRONICLE_LITE_DATA_DIR=$W/data; P=$W/repo; mkdir -p "$P/src/handlers"; git init -q "$P"; echo x > "$P/src/handlers/claims.ts"
cd "$P"; ln -s src/handlers hlink; ln -s src/handlers/claims.ts flink
T=$(node "$SLBIN" create T1 --triaged --json | jq -r .ticket.id); node "$SLBIN" claim "$T" --paths src/handlers --session sA --actor a >/dev/null
for p in src/handlers/claims.ts "$P/flink" "$P/hlink/claims.ts" flink hlink/claims.ts; do node "$SLBIN" scope-check --session sB --actor b "$p" >/dev/null 2>&1; echo "exit=$? ($([ $? ] ) ${p#$P/})"; done
# claim side: a scope given through a symlinked dir vs the real path
T2=$(node "$SLBIN" create T2 --triaged --json | jq -r .ticket.id)
node "$SLBIN" claim "$T2" --paths hlink --session sC --actor c >/dev/null 2>&1; echo "claim of 'hlink' (symlink to a claimed dir) by another session: exit=$? (1 = scope_conflict expected)"
