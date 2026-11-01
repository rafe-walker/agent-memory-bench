#!/usr/bin/env bash
# Round 2 (hardening track 3): cc-anchor 0.5.0 pending gate end-to-end with the real kronicle-lite
# 0.8.0 CLI. Each case: temp HOME + project, a runbook read by the agent's actor, then changed by
# another actor, so `kronicle-lite pending --actor <agent>` = 1. The PreToolUse pulse must DENY a
# world-changing command until the agent re-reads.
# usage: CCA=<cc-anchor> KLBIN=<kl>/dist/cli.js stress/cca/gate.sh [case]
set -uo pipefail
CCA=${CCA:?}; KLBIN=${KLBIN:?}; only=${1:-}
TMPROOT=${TMPROOT:-${TMPDIR:-/tmp}}
pass=0; fail=0; export SID=sess-0001-aaaa
ok() { echo "ok   $1"; pass=$((pass+1)); }; bad() { echo "FAIL $1"; fail=$((fail+1)); }
run() { [[ -z "$only" || "$only" == "$1" ]]; }
kl() { (cd "$P" && node "$KLBIN" "$@" --data-dir "$DD"); }
# setup [mcp-json-jq-filter] — $MCP: jq program producing the .mcp.json given $kl $dd
setup() {
  W=$(mktemp -d "$TMPROOT/gate.XXXXXX"); P=$W/proj; DD=$W/kl; mkdir -p "$P/.claude" "$W/home"; git -C "$P" init -q
  export HOME=$W/home CLAUDE_PROJECT_DIR=$P CC_ANCHOR_KRONICLE_LITE_BIN=$KLBIN CC_ANCHOR_SEA=0
  unset CC_ANCHOR_KRONICLE_ACTOR CC_ANCHOR_PULSE_MODE KRONICLE_LITE_ACTOR KRONICLE_LITE_DATA_DIR
  local f=${MCP:-'{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd,"--actor","agent-a"]}}}'}
  jq -n --arg kl "$KLBIN" --arg dd "$DD" "$f" > "${MCPFILE:-$P/.mcp.json}"
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-west-2.\n' > "$W/r.md"; kl put runbook "$W/r.md" --actor ops >/dev/null
  kl get runbook --actor "${READER:-agent-a}" >/dev/null
  hook session-start.sh SessionStart >/dev/null; hook post-tool-use.sh PostToolUse >/dev/null
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-east-1.\n' > "$W/r.md"; kl put runbook "$W/r.md" --actor ops >/dev/null
}
hook() { # script event [agent] [extra-json]
  local s=$1 ev=$2 ag=${3:-} x=${4:-'{}'}
  jq -nc --arg ev "$ev" --arg a "$ag" --arg cwd "$P" --argjson x "$x" \
    '{session_id:"sess-0001-aaaa",hook_event_name:$ev,cwd:$cwd,source:"startup",tool_name:"Read",tool_use_id:"t1",tool_input:{file_path:"x"},tool_response:{}} + (if $a=="" then {} else {agent_id:$a,agent_type:"general-purpose"} end) + $x' \
  | bash "$CCA/scripts/$s" 2>/dev/null
}
pulse() { # command [agent]
  jq -nc --arg c "$1" --arg a "${2:-}" --arg cwd "$P" '{session_id:($ENV.SID // "sess-0001-aaaa"),hook_event_name:"PreToolUse",cwd:$cwd,tool_name:"Bash",tool_use_id:("tb"+($c|length|tostring)),tool_input:{command:$c}} + (if $a=="" then {} else {agent_id:$a,agent_type:"general-purpose"} end)' \
  | bash "$CCA/scripts/pulse.sh" 2>/dev/null
}
pend() { kl pending --actor "${1:-agent-a}" --cwd "$P" --json 2>/dev/null | jq -r .pending_count; }
expect_deny() { # name command [agent]
  local o; o=$(pulse "$2" "${3:-}")
  if [[ "$o" == *'"deny"'* ]]; then ok "$1"; else bad "$1 :: pending($(pend "${PA:-agent-a}"))>0 but pulse allowed \`$2\` (out: ${o:0:100})"; fi; }
done_() { [[ -n "${KEEP:-}" ]] && echo "kept $W" || rm -rf "$W"; }

if run control; then setup; expect_deny "control: git push denied while pending" "git push"; done_; fi

if run assign; then setup
  for c in 'TAG=v1.2.3; git push origin "$TAG"' 'set -e; DIR=infra; terraform -chdir=$DIR apply -auto-approve' \
           'git push; RC=$?' 'NS=prod\nkubectl -n $NS apply -f k8s/' 'npm publish && DONE=1'; do
    expect_deny "assignment-only segment: $(printf '%q' "$c" | cut -c1-50)" "$(printf '%b' "$c")"; done; done_; fi

if run heredoc; then setup
  expect_deny "hyphenated here-doc delimiter, push after" $'cat > notes.md <<\'END-NOTES\'\nhello\nEND-NOTES\ngit push'
  expect_deny "C++ '<<endl' in a quoted string, push after" $'printf \'std::cout<<endl;\\n\' >> main.cpp\ngit push'
  expect_deny "here-string, push after" $'wc -w <<<hello\ngit push'; done_; fi

if run source; then setup; expect_deny "source ./scripts/deploy.sh" "source ./scripts/deploy.sh"; expect_deny "process substitution" "cat <(./deploy.sh)"; done_; fi
if run makej; then setup; expect_deny "make -j release" "make -j release"; done_; fi

# --- actor resolution: the gate must check the actor whose reads kronicle-lite recorded
if run actor_eq; then MCP='{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd,"--actor=agent-a"]}}}' setup
  expect_deny "actor via --actor=agent-a (kl accepts the = form)" "git push"; done_; fi
if run datadir_eq; then MCP='{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir="+$dd,"--actor","agent-a"]}}}' setup
  expect_deny "data dir via --data-dir=DIR" "git push"; done_; fi
if run server_key; then MCP='{mcpServers:{"memory":{command:"kronicle-lite",args:["serve","--data-dir",$dd,"--actor","agent-a"]}}}' setup
  expect_deny "server key 'memory', command kronicle-lite (detected as configured)" "git push"; done_; fi
if run env_actor; then MCP='{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd],env:{KRONICLE_LITE_ACTOR:"agent-a"}}}}' setup
  expect_deny "actor via env KRONICLE_LITE_ACTOR in .mcp.json" "git push"; done_; fi
if run home_cfg; then MCPFILE=/dev/null setup; rm -f "$P/.mcp.json"
  jq -n --arg kl "$KLBIN" --arg dd "$DD" --arg p "$P" '{projects:{($p):{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd,"--actor","agent-a"]}}}}}' > "$HOME/.claude.json"
  rm -rf "$P/.claude/cc-anchor/push"; hook session-start.sh SessionStart >/dev/null
  expect_deny "~/.claude.json per-project server (temp HOME)" "git push"; done_; fi
if run home_cfg_symlink; then MCPFILE=/dev/null setup; rm -f "$P/.mcp.json"; ln -s "$P" "$W/link"
  jq -n --arg kl "$KLBIN" --arg dd "$DD" --arg p "$P" '{projects:{($p):{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd,"--actor","agent-a"]}}}}}' > "$HOME/.claude.json"
  rm -rf "$P/.claude/cc-anchor/push"; P0=$P; P=$W/link; export CLAUDE_PROJECT_DIR=$P; hook session-start.sh SessionStart >/dev/null
  expect_deny "~/.claude.json keyed by the physical path, CLAUDE_PROJECT_DIR via a symlink" "git push"; P=$P0; done_; fi
if run cc_actor_env; then setup; export CC_ANCHOR_KRONICLE_ACTOR=agent-a; rm -rf "$P/.claude/cc-anchor/push"; hook session-start.sh SessionStart >/dev/null
  expect_deny "CC_ANCHOR_KRONICLE_ACTOR=agent-a" "git push"; unset CC_ANCHOR_KRONICLE_ACTOR; done_; fi
# the agent passes its own actor_id on an MCP call that is NOT a read: the gate follows it
if run actor_switch; then setup
  hook post-tool-use.sh PostToolUse "" '{"tool_name":"mcp__kronicle-lite__get_system_state","tool_input":{"actor_id":"claude"}}' >/dev/null
  expect_deny "agent passes actor_id 'claude' to get_system_state (reads were recorded as agent-a)" "git push"; done_; fi
if run actor_switch_memkey; then MCP='{mcpServers:{"memory":{command:"node",args:[$kl,"serve","--data-dir",$dd]}}}' READER=claude setup
  # server key without "kronicle": the agent's actor_id on mcp__memory__* calls is never learned
  hook post-tool-use.sh PostToolUse "" '{"tool_name":"mcp__memory__recall","tool_input":{"query":"deploy","actor_id":"claude"}}' >/dev/null
  PA=claude expect_deny "agent reads as actor_id 'claude' through server key 'memory'" "git push"; done_; fi

# --- subagents
if run sub_actor; then READER=sub-1 setup
  hook subagent-start.sh SubagentStart ag-1 >/dev/null
  hook post-tool-use.sh PostToolUse ag-1 '{"tool_name":"mcp__kronicle-lite__recall","tool_input":{"query":"deploy","actor_id":"sub-1"}}' >/dev/null
  PA=sub-1 expect_deny "subagent with its own actor_id sub-1: gated on sub-1" "git push" ag-1
  o=$(pulse "git push"); [[ "$o" == *deny* ]] && bad "parent (agent-a, no reads) denied for sub-1's pending" || ok "parent not gated on the subagent's actor"; done_; fi
if run sub_nostart; then setup
  expect_deny "subagent with no SubagentStart, first call is the deploy" "git push" ag-9; done_; fi

# --- reconciling: a re-read clears; nothing else should
if run reread; then setup; kl get runbook --actor agent-a >/dev/null
  o=$(pulse "git push"); [[ "$o" != *deny* ]] && ok "re-read clears the gate" || bad "re-read did not clear: ${o:0:100}"; done_; fi
if run retry; then setup; pulse "git push" >/dev/null; expect_deny "plain retry still denied" "git push"; done_; fi

# --- warn mode / compaction / resume
if run compact; then setup; hook session-start.sh SessionStart "" '{"source":"compact"}' >/dev/null; expect_deny "after compaction SessionStart" "git push"; done_; fi
if run resume; then setup; hook session-start.sh SessionStart "" '{"source":"resume"}' >/dev/null; expect_deny "after resume SessionStart" "git push"; done_; fi
if run clear; then setup; hook session-start.sh SessionStart "" '{"source":"clear","session_id":"sess-0002-bbbb"}' >/dev/null; SID=sess-0002-bbbb expect_deny "after /clear (new session id)" "git push"; done_; fi

echo; echo "gate: pass=$pass fail=$fail"; exit $(( fail > 0 ))
