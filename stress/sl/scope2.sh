#!/usr/bin/env bash
# Round 2 (hardening track 3): sea-lite 0.6.0 scope-check / precommit edge paths (F07 follow-up).
# Session sA claims src/handlers; session sB checks / commits paths that land inside it.
# usage: SLBIN=<sea-lite>/dist/cli.js stress/sl/scope2.sh
set -uo pipefail
SLBIN=${SLBIN:?}; W=$(mktemp -d "${TMPROOT:-${TMPDIR:-/tmp}}/scope2.XXXXXX"); trap 'rm -rf "$W"' EXIT
export HOME=$W/home KRONICLE_LITE_DATA_DIR=$W/data; mkdir -p "$HOME"; P=$W/repo; mkdir -p "$P/src/handlers" "$P/other"
git init -q "$P"; echo x > "$P/src/handlers/claims.ts"; echo o > "$P/other/o.ts"
cd "$P"; git add -A; git -c user.name=t -c user.email=t@x commit -qm init
ln -s src/handlers hlink; ln -s hlink hlink2; ln -s loopA loopB; ln -s loopB loopA; ln -s src/handlers/nope.ts dangling
ln -s "$P/src" "$W/outside-link"
T=$(node "$SLBIN" create T1 --triaged --json | jq -r .ticket.id); node "$SLBIN" claim "$T" --paths src/handlers --session sA --actor a >/dev/null
pass=0; fail=0
chk() { # want(1 conflict|0 free) path note
  node "$SLBIN" scope-check --session sB --actor b -- "$2" >/dev/null 2>"$W/err"; local rc=$?
  if [[ $rc == "$1" ]]; then echo "ok   scope-check $2 -> $rc ($3)"; pass=$((pass+1)); else echo "FAIL scope-check $2 -> $rc, want $1 ($3) $(head -c 100 "$W/err")"; fail=$((fail+1)); fi; }
chk 1 src/handlers/claims.ts "control"
chk 1 hlink/new.ts "NEW file through a symlinked dir"
chk 1 hlink2/claims.ts "symlink chain"
chk 1 src/../src/handlers/claims.ts ".. segments"
chk 1 ./src//handlers/claims.ts "./ and //"
chk 1 src/handlers "the claimed dir itself"
chk 1 src/handlers/ "trailing slash"
chk 1 src "a PARENT of the claim (rm -rf src would wipe it)"
chk 1 . "the repo root"
chk 1 "$W/outside-link/handlers/claims.ts" "absolute path via a symlink OUTSIDE the repo"
chk 1 SRC/handlers/claims.ts "case-variant (case-insensitive FS only; Linux: info)"
chk 0 other/o.ts "unclaimed control"
chk 0 loopA "symlink loop (must not hang or crash)"
chk 1 dangling "dangling symlink into the claim"
# precommit: sB stages a change inside the claim via the symlinked dir
node "$SLBIN" precommit --install >/dev/null 2>&1; ls -la .git/hooks/pre-commit >/dev/null 2>&1 || echo "info precommit --install wrote no .git/hooks/pre-commit"
commit_try() { # note, then stage+commit as sB
  echo "$RANDOM" >> "$1"; git add -- "$1"
  SEA_LITE_SESSION=sB SEA_LITE_ACTOR=b git -c user.name=t -c user.email=t@x commit -qm "$2" >/dev/null 2>"$W/err"; local rc=$?
  if [[ $rc != 0 ]]; then echo "ok   precommit refused: $2"; pass=$((pass+1)); git reset -q; git checkout -q -- . 2>/dev/null
  else echo "FAIL precommit allowed: $2 ($(head -c 100 "$W/err"))"; fail=$((fail+1)); git reset -q --soft HEAD~1; git reset -q; git checkout -q -- . 2>/dev/null; fi; }
commit_try src/handlers/claims.ts "control: commit a claimed file"
git add -- hlink/claims.ts >/dev/null 2>&1 || echo "info git refuses to stage through a symlinked dir (beyond a symbolic link): precommit sees real paths only"
mv src/handlers/claims.ts src/handlers/renamed.ts; git add -A src/handlers
SEA_LITE_SESSION=sB SEA_LITE_ACTOR=b git -c user.name=t -c user.email=t@x commit -qm rename >/dev/null 2>"$W/err" && { echo "FAIL precommit allowed a rename inside the claim"; fail=$((fail+1)); git reset -q --soft HEAD~1; } || { echo "ok   precommit refused a rename inside the claim"; pass=$((pass+1)); }
git reset -q; git checkout -q -- . 2>/dev/null; rm -f src/handlers/renamed.ts
echo "$RANDOM" >> src/handlers/claims.ts; git add src/handlers/claims.ts
SEA_LITE_SESSION=sB SEA_LITE_ACTOR=b git -c user.name=t -c user.email=t@x commit -qm nv --no-verify >/dev/null 2>&1 && echo "info git commit --no-verify skips the precommit guard (documented git behaviour, not a bug)"
echo; echo "scope2: pass=$pass fail=$fail"; exit $(( fail > 0 ))
