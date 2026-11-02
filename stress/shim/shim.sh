#!/usr/bin/env bash
# Round 2 (hardening track 3): kronicle-lite 0.8.0 exec-time shims, adversarial.
# Each case: temp HOME, a project with a real local bare remote, a runbook that actor agent-a read,
# shims installed (cursor at head), then the runbook changed by `ops` => one blocking retraction.
# A case "gets around the guard" when the push LANDS in the bare remote. Run under dash and bash:
#   KLBIN=<kl>/dist/cli.js SH=dash stress/shim/shim.sh [case]
set -uo pipefail
KLBIN=${KLBIN:?}; SH=${SH:-dash}; only=${1:-}
HERE=$(cd "$(dirname "$0")" && pwd); KLMOD=${KLMOD:-$(dirname "$(dirname "$KLBIN")")/node_modules}
TMPROOT=${TMPROOT:-${TMPDIR:-/tmp}}
pass=0; fail=0; note=0
ok() { echo "ok   [$SH] $1"; pass=$((pass+1)); }; bad() { echo "FAIL [$SH] $1"; fail=$((fail+1)); }; info() { echo "info [$SH] $1"; note=$((note+1)); }
run() { [[ -z "$only" || "$only" == "$1" ]]; }
kl() { (cd "$P" && node "$KLBIN" "$@" --data-dir "$DD"); }
g() { git -c user.name=t -c user.email=t@x -c protocol.file.allow=always "$@"; }
setup() {
  W=$(mktemp -d "$TMPROOT/shim.XXXXXX"); P=$W/proj; R=$W/remote.git; DD=$W/kl; S=$W/shims
  mkdir -p "$P/src" "$W/home"; export HOME=$W/home GIT_CONFIG_NOSYSTEM=1; git config --global protocol.file.allow always; git config --global user.name t; git config --global user.email t@x
  unset KRONICLE_SHIM_EXEC KRONICLE_SHIM_DEPTH KRONICLE_SHIM_TIMEOUT KRONICLE_LITE_DATA_DIR
  git init -q --bare -b main "$R"; git init -q -b main "$P"; g -C "$P" commit -q --allow-empty -m init
  git -C "$P" remote add origin "$R"; git -C "$P" push -q origin main
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-west-2.\n' > "$W/r.md"; kl put runbook "$W/r.md" --actor ops >/dev/null
  kl get runbook --actor agent-a >/dev/null
  node "$KLBIN" shim install --dir "$S" --data-dir "$DD" ${SHIM_OPTS:-} >/dev/null 2>&1 || { echo "install failed"; exit 2; }
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-east-1.\n' > "$W/r.md"; kl put runbook "$W/r.md" --actor ops >/dev/null
  g -C "$P" commit -q --allow-empty -m work
  BASEPATH=/usr/local/bin:/usr/bin:/bin:$(dirname "$(command -v node)")
}
# sh_run CMD [cwd] [PATH] — the agent's Bash call; sets RC, ERR
sh_run() { local cwd=${2:-$P} path=${3:-$S:$BASEPATH}
  ERR=$(cd "$cwd" && PATH=$path timeout 60 "$SH" -c "$1" </dev/null 2>&1 >/dev/null); RC=$?; }
landed() { [[ "$(git -C "$R" rev-parse -q --verify main 2>/dev/null)" == "$(git -C "$P" rev-parse HEAD)" ]]; }
expect_refused() { # name cmd [cwd] [path]
  sh_run "$2" "${3:-}" "${4:-}"
  if landed; then bad "$1 :: push LANDED (rc=$RC) $(tr '\n' ' ' <<<"$ERR" | cut -c1-140)"; else ok "$1 (rc=$RC)"; fi; }
done_() { [[ -n "${KEEP:-}" ]] && echo "kept $W" || rm -rf "$W"; }

if run control; then setup; expect_refused "control: git push" "git push origin HEAD:main"; done_; fi
if run reread; then setup; kl get runbook --actor agent-a >/dev/null; sh_run "git push origin HEAD:main"
  landed && ok "re-read by agent-a clears the gate" || bad "re-read did not clear (rc=$RC ${ERR:0:120})"; done_; fi
if run other_reader; then setup; kl get runbook --actor someone-else >/dev/null; expect_refused "a read by another actor does not clear" "git push origin HEAD:main"; done_; fi

# --- PATH tricks
if run abs; then setup; expect_refused "absolute /usr/bin/git (documented)" "/usr/bin/git push origin HEAD:main"; done_; fi
if run command_p; then setup; expect_refused "command -p git push" "command -p git push origin HEAD:main"; done_; fi
if run env_i; then setup; expect_refused "env -i git push" "env -i git push origin HEAD:main"; done_; fi
if run path_prefix; then setup; expect_refused "PATH=/usr/bin:\$PATH git push" 'PATH=/usr/bin:$PATH git push origin HEAD:main'; done_; fi
if run sudo; then setup; expect_refused "sudo git push (secure_path)" "sudo -n git push origin HEAD:main"; done_; fi
if run sudo_e; then setup; expect_refused "sudo -E git push" "sudo -nE git push origin HEAD:main"; done_; fi
if run hash_p; then setup; [[ $SH == bash ]] && expect_refused "hash -p /usr/bin/git git; git push" "hash -p /usr/bin/git git; git push origin HEAD:main" || info "hash -p: bash only"; done_; fi
if run forge_exec; then setup; expect_refused "forged KRONICLE_SHIM_EXEC + exec (same pid)" 'KRONICLE_SHIM_EXEC="$$:1:" exec git push origin HEAD:main'; done_; fi
if run depth_env; then setup; expect_refused "KRONICLE_SHIM_DEPTH=8 git push" "KRONICLE_SHIM_DEPTH=8 git push origin HEAD:main"; done_; fi
if run timeout_env; then setup; expect_refused "KRONICLE_SHIM_TIMEOUT=0 git push" "KRONICLE_SHIM_TIMEOUT=0 git push origin HEAD:main"; done_; fi

# --- git runs git: exec-path (/usr/lib/git-core) is prepended to PATH for aliases, hooks, --exec, foreach
if run alias_builtin; then setup; expect_refused "git -c alias.p=push p (in-process; documented)" "git -c alias.p=push p origin HEAD:main"; done_; fi
if run alias_shell; then setup; expect_refused "git -c alias.p='!git push …' p" "git -c alias.p='!git push origin HEAD:main' p"; done_; fi
if run hook; then setup; printf '#!/bin/sh\ngit push -q origin HEAD:main\n' > "$P/.git/hooks/post-commit"; chmod +x "$P/.git/hooks/post-commit"
  expect_refused "post-commit hook runs git push" "git -c user.name=t -c user.email=t@x commit -q --allow-empty -m hooked"; done_; fi
if run rebase_x; then setup; expect_refused "git rebase -x 'git push …'" "GIT_EDITOR=true git -c user.name=t -c user.email=t@x rebase -q --no-ff -x 'git push -q origin HEAD:main' HEAD~1"; done_; fi
if run foreach; then setup
  SR=$W/sub.git; git init -q --bare -b main "$SR"; git init -q -b main "$W/subsrc"; g -C "$W/subsrc" commit -q --allow-empty -m s; git -C "$W/subsrc" push -q "$SR" main
  g -C "$P" submodule add -q "$SR" sub >/dev/null 2>&1; g -C "$P" commit -q -m sub; g -C "$P/sub" commit -q --allow-empty -m subwork
  sh_run "git submodule foreach -q 'git push -q origin HEAD:main'"
  if [[ "$(git -C "$SR" rev-parse main)" == "$(git -C "$P/sub" rev-parse HEAD)" ]]; then bad "git submodule foreach 'git push' :: submodule push LANDED (rc=$RC)"; else ok "submodule foreach (rc=$RC)"; fi; done_; fi
if run bisect; then setup; info "git bisect run / any git-run child: \`command -v git\` = $(cd "$P" && PATH=$S:$BASEPATH git -c alias.w='!command -v git' w) (exec-path first on PATH)"; done_; fi

# --- children that inherit PATH (should all be caught)
if run npm_script; then setup; printf '{"name":"x","version":"1.0.0","scripts":{"ship":"git push -q origin HEAD:main"}}\n' > "$P/package.json"; expect_refused "npm run ship (script runs git push)" "npm run -s ship"; done_; fi
if run make_recipe; then setup; printf 'ship:\n\tgit push -q origin HEAD:main\n' > "$P/Makefile"; expect_refused "make ship (recipe runs git push)" "make -s ship"; done_; fi
if run python; then setup; expect_refused "python subprocess git push" "python3 -c 'import subprocess; subprocess.run([\"git\",\"push\",\"-q\",\"origin\",\"HEAD:main\"])'"; done_; fi
if run xargs; then setup; expect_refused "echo push | xargs git" "echo push origin HEAD:main | xargs git"; done_; fi

# --- project scope taken from $PWD
if run git_C_outside; then setup; expect_refused "cd outside the project; git -C <proj> push" "git -C '$P' push origin HEAD:main" "$W"; done_; fi
if run subdir; then setup; expect_refused "from a project subdirectory" "git push origin HEAD:main" "$P/src"; done_; fi
if run git_C_tmp; then setup; expect_refused "cd /tmp; git -C <proj> push" "git -C '$P' push origin HEAD:main" /tmp; done_; fi

# --- recursion / PATH spellings
if run dup_path; then setup; expect_refused "shim dir 3x on PATH (S, S/, S/./)" "git push origin HEAD:main" "" "$S:$S/:$S/./:$BASEPATH"; done_; fi
if run symlink_dir; then setup; ln -s "$S" "$W/shimlink"; expect_refused "symlinked shim dir first, real dir second" "git push origin HEAD:main" "" "$W/shimlink:$S:$BASEPATH"; done_; fi
if run wrapper_exec; then setup; mkdir "$W/wrap"; printf '#!/bin/sh\nexec git "$@"\n' > "$W/wrap/git"; chmod +x "$W/wrap/git"
  sh_run "git push origin HEAD:main" "" "$S:$W/wrap:$BASEPATH"; info "self-recursive wrapper (loops without shims too): rc=$RC landed=$(landed && echo y || echo n) $(tr '\n' ' ' <<<"$ERR" | cut -c1-90)"; done_; fi
if run wrapper_child; then setup; mkdir "$W/wrap"; printf '#!/bin/sh\ngit "$@"\n' > "$W/wrap/git"; chmod +x "$W/wrap/git"
  t0=$(date +%s); sh_run "git push origin HEAD:main" "" "$S:$W/wrap:$BASEPATH"; t=$(( $(date +%s)-t0 ))
  info "self-recursive child wrapper: rc=$RC in ${t}s landed=$(landed && echo y || echo n)"; done_; fi

# --- reconciling without re-reading
if run ack; then setup; sh_run "git push origin HEAD:main"; seq=$(grep -o 'ack --through [0-9]*' <<<"$ERR" | head -1 | awk '{print $3}')
  [[ -n "$seq" ]] && info "denial text offers: kronicle-lite shim ack --through $seq" || info "denial text has no ack hint"
  ( cd "$P" && PATH=$S:$BASEPATH node "$KLBIN" shim ack --dir "$S" --through "$seq" >/dev/null 2>&1 ); sh_run "git push origin HEAD:main"
  landed && bad "agent clears the gate itself with the ack the denial printed (no re-read) :: push LANDED" || ok "ack did not clear"; done_; fi
if run blind_read; then setup; kl get runbook --actor agent-a >/dev/null 2>&1 </dev/null; sh_run "git push origin HEAD:main"
  landed && info "a 'read' with output discarded (get --actor agent-a >/dev/null) clears the gate (by design: a read is a read)" || info "blind read did not clear"; done_; fi
if run two_readers; then
  W=$(mktemp -d "$TMPROOT/shim.XXXXXX"); P=$W/proj; R=$W/remote.git; DD=$W/kl; S=$W/shims; mkdir -p "$W/home"; export HOME=$W/home
  git init -q --bare -b main "$R"; git init -q -b main "$P"; g -C "$P" commit -q --allow-empty -m init; git -C "$P" remote add origin "$R"; git -C "$P" push -q origin main
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-west-2.\n' > "$W/r.md"; kl put runbook "$W/r.md" --actor ops >/dev/null
  kl get runbook --actor agent-a >/dev/null; kl get runbook --actor agent-b >/dev/null
  node "$KLBIN" shim install --dir "$S" --data-dir "$DD" >/dev/null 2>&1
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-east-1.\n' > "$W/r.md"; kl put runbook "$W/r.md" --actor ops >/dev/null; g -C "$P" commit -q --allow-empty -m work
  BASEPATH=/usr/local/bin:/usr/bin:/bin:$(dirname "$(command -v node)"); kl get runbook --actor agent-a >/dev/null
  sh_run "git push origin HEAD:main"; landed && info "two readers: agent-a's re-read alone clears" || info "two readers (default config): agent-a re-read, still refused until agent-b re-reads or ack — sticky for agent-a: $(tr '\n' ' ' <<<"$ERR" | grep -o 'not yet re-read[^]]*')"; done_; fi

# --- warn mode, integrity, timeouts
if run warn; then SHIM_OPTS="--mode warn" setup; sh_run "git push origin HEAD:main"; landed && ok "warn mode runs (expected) and says: $(head -c 80 <<<"$ERR")" || bad "warn mode refused"; done_; fi
for m in deny warn; do if run "integrity_$m"; then SHIM_OPTS="--mode $m" setup; kl get runbook --actor agent-a >/dev/null
  NODE_PATH=$KLMOD node "$HERE/../kl/tamper-event.cjs" "$DD" valid stg-east-1 stg-evil-9 >/dev/null
  expect_refused "integrity failure refuses in $m mode" "git push origin HEAD:main"; done_; fi; done
# lock the store: an EXCLUSIVE transaction held for $1 s
lockdb() { NODE_PATH=$KLMOD node -e 'const D=require("better-sqlite3");const db=new D(process.argv[1]);db.exec("BEGIN EXCLUSIVE");setTimeout(()=>{db.exec("COMMIT");process.exit(0)},+process.argv[2]*1000)' "$DD/kronicle-lite.db" "$1" & LOCKPID=$!; sleep 0.5; }
if run timeout_allow; then setup; lockdb 20; t0=$(date +%s); sh_run "KRONICLE_SHIM_TIMEOUT=3 git push origin HEAD:main"; t=$(( $(date +%s)-t0 )); kill $LOCKPID 2>/dev/null; wait $LOCKPID 2>/dev/null
  landed && info "--on-timeout allow (default) under a held lock: ran after ${t}s, stderr: $(tr '\n' ' ' <<<"$ERR" | cut -c1-120)" || info "--on-timeout allow under lock: refused rc=$RC after ${t}s: $(tr '\n' ' ' <<<"$ERR" | cut -c1-120)"; done_; fi
if run timeout_deny; then SHIM_OPTS="--on-timeout deny" setup; kl get runbook --actor agent-a >/dev/null; lockdb 20; t0=$(date +%s); sh_run "KRONICLE_SHIM_TIMEOUT=3 git push origin HEAD:main"; t=$(( $(date +%s)-t0 )); kill $LOCKPID 2>/dev/null; wait $LOCKPID 2>/dev/null
  landed && bad "--on-timeout deny under a held lock: push LANDED after ${t}s rc=$RC $(tr '\n' ' ' <<<"$ERR" | cut -c1-120)" || ok "--on-timeout deny: refused rc=$RC after ${t}s"; done_; fi
# lock held for less than KRONICLE_SHIM_TIMEOUT but longer than the store's busy wait: does it fail OPEN quietly?
if run busy; then setup; lockdb 25; t0=$(date +%s); sh_run "git push origin HEAD:main"; t=$(( $(date +%s)-t0 )); e1=$ERR
  g -C "$P" commit -q --allow-empty -m w2; sh_run "git push origin HEAD:main"; e2=$ERR; kill $LOCKPID 2>/dev/null; wait $LOCKPID 2>/dev/null
  if landed; then info "store locked by a writer (default --on-timeout allow, default 10 s): 2nd push LANDED; 1st after ${t}s said: $(tr '\n' ' ' <<<"$e1" | cut -c1-110); 2nd said: $(tr '\n' ' ' <<<"$e2" | cut -c1-110)"; else ok "locked store: refused (rc=$RC)"; fi
  tail -3 "$S/.kronicle-shim/shim.log" | sed 's/^/     log: /'; done_; fi

echo; echo "shim[$SH]: pass=$pass fail=$fail info=$note"; exit $(( fail > 0 ))
