#!/usr/bin/env bash
# cc-anchor next-cycle Bash claimed-path guard, adversarial. Session sB runs Bash that changes
# files inside a live sea-lite claim held by session sA; the guard must name the path.
# usage: CCA=<cc-anchor next-cycle> SLBIN=<sea-lite>/dist/cli.js stress/cca/bash-guard.sh [case]
set -uo pipefail
CCA=${CCA:?}; SLBIN=${SLBIN:?}; only=${1:-}
pass=0; fail=0
setup() {
  W=$(mktemp -d); P=$W/proj; mkdir -p "$P/src/auth" "$P/src/billing" "$W/home"
  git -C "$P" init -q; echo 'export const a = 1;' > "$P/src/auth/login.ts"; echo 'b' > "$P/src/billing/pay.ts"
  git -C "$P" add -A; git -C "$P" -c user.name=t -c user.email=t@x commit -qm init
  export HOME=$W/home KRONICLE_LITE_DATA_DIR=$W/sea CLAUDE_PROJECT_DIR=$P CC_ANCHOR_SEA_LITE_BIN=$SLBIN CC_ANCHOR_SEA=1 CC_ANCHOR_KRONICLE=0
  T=$(cd "$P" && node "$SLBIN" create "Auth work" --triaged --json | jq -r .ticket.id)
  (cd "$P" && node "$SLBIN" claim "$T" --paths "${CLAIM:-src/auth}" --lease 900 --actor claude --session sess-A >/dev/null)
  n=0
}
pre()  { jq -nc --arg s "$1" --arg t "$2" --arg c "$3" --arg cwd "$P" '{session_id:$s,hook_event_name:"PreToolUse",tool_name:"Bash",tool_use_id:$t,tool_input:{command:$c},cwd:$cwd}' | bash "$CCA/scripts/pulse.sh" >/dev/null 2>&1; }
post() { jq -nc --arg s "$1" --arg t "$2" --arg cwd "$P" '{session_id:$s,hook_event_name:"PostToolUse",tool_name:"Bash",tool_use_id:$t,tool_input:{command:"x"},tool_response:{stdout:""},cwd:$cwd}' | bash "$CCA/scripts/post-tool-use.sh" 2>/dev/null; }
# one Bash call by session sB: pre -> work -> post ; echo hook output
call() { local tid="toolu_$((++n))"; pre sess-B "$tid" "$1"; sleep "${GAP:-0}"; (cd "$P" && eval "$1"); post sess-B "$tid"; }
verbose() { [[ -n "${VERBOSE:-}" ]] && jq -r .hookSpecificOutput.additionalContext <<<"$1" >&2; return 0; }
expect_warn() { # name output path-fragment
  verbose "$2"
  if [[ "$2" == *"bash guard"* && "$2" == *"$3"* ]]; then echo "ok   $1"; pass=$((pass+1)); else echo "FAIL $1 :: no warning naming $3 (got: ${2:0:160})"; fail=$((fail+1)); fi; }
run() { [[ -z "$only" || "$only" == "$1" ]]; }
done_() { rm -rf "$W"; }

# warm the claims cache once, so timing doesn't include the first board call
warm() { local t="toolu_w$RANDOM"; pre sess-B "$t" true; post sess-B "$t" >/dev/null; sleep 1.1; }

if run control; then setup; warm; out=$(call "echo x >> src/auth/login.ts"); expect_warn "control: append via redirect" "$out" login.ts; done_; fi
if run sed; then setup; warm; out=$(call "sed -i s/1/2/ src/auth/login.ts"); expect_warn "sed -i" "$out" login.ts; done_; fi
if run mv_old; then setup; echo 'evil' > "$P/new.ts"; touch -d '2 hours ago' "$P/new.ts"; warm
  out=$(call "mv new.ts src/auth/login.ts"); expect_warn "mv of an older file into a claimed dir (dir entry changes)" "$out" src/auth; done_; fi
if run mv_file; then CLAIM=src/auth/login.ts setup; echo 'evil' > "$P/new.ts"; touch -d '2 hours ago' "$P/new.ts"; warm
  out=$(call "mv new.ts src/auth/login.ts"); expect_warn "mv of an older file over a claimed FILE" "$out" login.ts; done_; fi
if run cp_p; then setup; mkdir -p "$P/bak"; echo 'old' > "$P/bak/login.ts"; touch -d '1 day ago' "$P/bak/login.ts"; warm
  out=$(call "cp -p bak/login.ts src/auth/login.ts"); expect_warn "cp -p (preserves mtime)" "$out" login.ts; done_; fi
if run rsync; then setup; mkdir -p "$P/vendor"; echo 'v' > "$P/vendor/login.ts"; touch -d '1 day ago' "$P/vendor/login.ts"; warm
  out=$(call "cp -a vendor/login.ts src/auth/login.ts"); expect_warn "cp -a (archive)" "$out" login.ts; done_; fi
if run tar; then setup; (cd "$W" && mkdir t && mkdir -p t/src/auth && echo z > t/src/auth/login.ts && touch -d '3 days ago' t/src/auth/login.ts && tar -C t -cf a.tar src); warm
  out=$(call "tar -xf $W/a.tar"); expect_warn "tar -x over claimed file" "$out" login.ts; done_; fi
if run touch_r; then setup; touch -d '1 day ago' "$P/src/billing/pay.ts"; warm
  out=$(call "echo hacked > src/auth/login.ts; touch -r src/billing/pay.ts src/auth/login.ts"); expect_warn "write then touch -r back-dates mtime" "$out" login.ts; done_; fi
if run parallel; then setup; warm
  # two Bash calls of the same session overlap (parallel tool calls / two subagents): pre t1, pre t2, t1 edits, post t1
  pre sess-B toolu_p1 "echo y >> src/auth/login.ts"; pre sess-B toolu_p2 "ls"; (cd "$P" && echo y >> src/auth/login.ts)
  out=$(post sess-B toolu_p1); post sess-B toolu_p2 >/dev/null
  expect_warn "overlapping Bash calls in one session (parallel/subagents)" "$out" login.ts; done_; fi
if run fresh_claim; then CLAIM=src/billing setup; warm
  # another session claims src/auth AFTER our cache was filled; we then edit it within the TTL
  T2=$(cd "$P" && node "$SLBIN" create "Auth 2" --triaged --json | jq -r .ticket.id)
  (cd "$P" && node "$SLBIN" claim "$T2" --paths src/auth --lease 900 --actor other --session sess-C >/dev/null)
  out=$(call "echo z >> src/auth/login.ts"); expect_warn "claim made by another session within bash_guard_ttl (cache stale)" "$out" login.ts; done_; fi
if run budget; then setup; mkdir -p "$P/src/auth/gen"; for i in $(seq 1 4500); do : > "$P/src/auth/gen/f$i.ts"; done; : > "$P/src/auth/zz-last.ts"; touch -d '1 hour ago' "$P/src/auth/gen"/* "$P/src/auth/gen" "$P/src/auth/zz-last.ts" "$P/src/auth"; warm
  out=$(call "echo z >> src/auth/zz-last.ts"); expect_warn "claimed dir with >4000 entries (walk budget)" "$out" zz-last.ts; done_; fi
if run symlink; then setup; ln -s src/auth "$P/authlink"; warm
  out=$(call "echo z >> authlink/login.ts"); expect_warn "edit through a symlink into the claim" "$out" login.ts; done_; fi
if run samesec; then setup; warm
  # holder (sess-A) edits the file in the same second our call starts; our call does nothing
  (cd "$P" && echo holder >> src/auth/login.ts); out=$(call "true")
  if [[ "$out" == *"bash guard"* ]]; then echo "FAIL same-second: false alarm for a no-op Bash call (holder's own edit in the same second) bash=${BASH_VERSION}"; fail=$((fail+1)); else echo "ok   same-second: no false alarm (bash ${BASH_VERSION})"; pass=$((pass+1)); fi; done_; fi
echo; echo "bash-guard: pass=$pass fail=$fail"
exit $(( fail > 0 ))
