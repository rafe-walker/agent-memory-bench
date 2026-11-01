#!/usr/bin/env bash
# cc-anchor kronicle push/pulse end-to-end + fail-open timing + subagent cursors.
# usage: CCA=<cc-anchor> KLBIN=<kl>/dist/cli.js stress/cca/push.sh [case]
set -uo pipefail
CCA=${CCA:?}; KLBIN=${KLBIN:?}; only=${1:-}
pass=0; fail=0
ok() { echo "ok   $1"; pass=$((pass+1)); }; bad() { echo "FAIL $1"; fail=$((fail+1)); }
run() { [[ -z "$only" || "$only" == "$1" ]]; }
setup() {
  W=$(mktemp -d); P=$W/proj; mkdir -p "$P/.claude" "$W/home"; git -C "$P" init -q
  export HOME=$W/home CLAUDE_PROJECT_DIR=$P CC_ANCHOR_KRONICLE_LITE_BIN=${BIN:-$KLBIN} CC_ANCHOR_SEA=0
  jq -n --arg kl "$KLBIN" --arg dd "$W/kl" '{mcpServers:{"kronicle-lite":{command:"node",args:[$kl,"serve","--data-dir",$dd]}}}' > "$P/.mcp.json"
  printf '# Runbook\n\n## Deploy\n\nDeploy to stg-west-2.\n' > "$W/r.md"; node "$KLBIN" put runbook "$W/r.md" --data-dir "$W/kl" --cwd "$P" >/dev/null
}
change() { printf '# Runbook\n\n## Deploy\n\nDeploy to %s.\n' "$1" > "$W/r.md"; node "$KLBIN" put runbook "$W/r.md" --data-dir "$W/kl" --cwd "$P" >/dev/null; }
hook() { # script event session [agent] [extra-json]
  local s=$1 ev=$2 sid=$3 ag=${4:-} x=${5:-'{}'}
  jq -nc --arg ev "$ev" --arg s "$sid" --arg a "$ag" --arg cwd "$P" --argjson x "$x" \
    '{session_id:$s,hook_event_name:$ev,cwd:$cwd,source:"startup",tool_name:"Read",tool_use_id:("t"+($s)),tool_input:{file_path:"x"},tool_response:{}} + (if $a=="" then {} else {agent_id:$a,agent_type:"general-purpose"} end) + $x' \
  | bash "$CCA/scripts/$s" 2>/dev/null
}
ms() { local t0=$(date +%s%N); "$@" >/dev/null; echo $(( ($(date +%s%N)-t0)/1000000 )); }
done_() { rm -rf "$W"; }

if run basic; then setup; hook session-start.sh SessionStart S1 >/dev/null; hook post-tool-use.sh PostToolUse S1 >/dev/null; change stg-east-1
  out=$(hook post-tool-use.sh PostToolUse S1); [[ "$out" == *stg-east-1* ]] && ok "push delivers a semantic change" || bad "push silent on a semantic change (${out:0:120})"
  out=$(hook post-tool-use.sh PostToolUse S1); [[ -z "$out" ]] && ok "push delivers once" || bad "pushed twice"; done_; fi

if run hidden_by_classifier; then setup; hook session-start.sh SessionStart S1 >/dev/null; hook post-tool-use.sh PostToolUse S1 >/dev/null
  printf '# Runbook\n\n## Deploy\n\nRun the deploy with --target staging-a first.\n' > "$W/r.md"; node "$KLBIN" put runbook "$W/r.md" --data-dir "$W/kl" --cwd "$P" >/dev/null
  hook post-tool-use.sh PostToolUse S1 >/dev/null
  printf '# Runbook\n\n## Deploy\n\nRun the deploy with --target staging-b first.\n' > "$W/r.md"; node "$KLBIN" put runbook "$W/r.md" --data-dir "$W/kl" --cwd "$P" >/dev/null
  out=$(hook post-tool-use.sh PostToolUse S1)
  deny=$(jq -nc --arg cwd "$P" '{session_id:"S1",hook_event_name:"PreToolUse",cwd:$cwd,tool_name:"Bash",tool_use_id:"tb",tool_input:{command:"./deploy.sh --target staging-a"}}' | bash "$CCA/scripts/pulse.sh" 2>/dev/null)
  [[ -n "$out$deny" ]] && ok "staging-a->staging-b reaches the agent (push or pulse)" || bad "staging-a->staging-b: push silent AND pulse lets './deploy.sh --target staging-a' run (end-to-end S1)"; done_; fi

for mode in sleep_wrapper exit1 garbage hang_child; do
  if run "slow_$mode"; then
    setup; F=$W/fake-kl; case $mode in
      sleep_wrapper) printf '#!/bin/bash\nsleep 30\nexec node %q "$@"\n' "$KLBIN" > "$F";;
      hang_child) printf '#!/bin/bash\n( sleep 30; echo late ) &\nnode %q "$@"\nwait\n' "$KLBIN" > "$F";;
      exit1) printf '#!/bin/bash\necho "{oops" ; exit 1\n' > "$F";;
      garbage) printf '#!/bin/bash\necho "not json at all"; exit 0\n' > "$F";;
    esac; chmod +x "$F"
    export CC_ANCHOR_KRONICLE_LITE_BIN=$F
    hook session-start.sh SessionStart S1 >/dev/null 2>&1; change stg-east-1
    t=$(ms hook post-tool-use.sh PostToolUse S1); out=$(hook post-tool-use.sh PostToolUse S1)
    if [[ -z "$out" ]] || jq -e . >/dev/null 2>&1 <<<"$out"; then valid=1; else valid=0; fi
    t2=$(ms bash -c "jq -nc --arg cwd '$P' '{session_id:\"S2\",hook_event_name:\"PreToolUse\",cwd:\$cwd,tool_name:\"Bash\",tool_use_id:\"tb\",tool_input:{command:\"git push\"}}' | bash '$CCA/scripts/pulse.sh'")
    d=$(jq -nc --arg cwd "$P" '{session_id:"S3",hook_event_name:"PreToolUse",cwd:$cwd,tool_name:"Bash",tool_use_id:"tb",tool_input:{command:"git push"}}' | bash "$CCA/scripts/pulse.sh" 2>/dev/null)
    if (( t < 5000 && t2 < 5000 )) && [[ $valid == 1 && "$d" != *deny* ]]; then ok "fail-open with CLI=$mode (post ${t} ms, pulse ${t2} ms)"; else bad "fail-open with CLI=$mode: post ${t} ms, pulse ${t2} ms, valid_json=$valid, pulse_out=${d:0:80}"; fi
    done_; fi
done

if run integrity; then setup; hook session-start.sh SessionStart S1 >/dev/null; hook post-tool-use.sh PostToolUse S1 >/dev/null
  NODE_PATH=${KLMOD:?set KLMOD=<kl>/node_modules} node "$(dirname "$0")/../kl/tamper-event.cjs" "$W/kl" valid stg-west-2 stg-evil-9 >/dev/null
  r=$(node "$KLBIN" orient --data-dir "$W/kl" --cwd "$P" --actor x --json | jq -r .integrity.ok)
  out=$(hook post-tool-use.sh PostToolUse S1); d=$(jq -nc --arg cwd "$P" '{session_id:"S1",hook_event_name:"PreToolUse",cwd:$cwd,tool_name:"Bash",tool_use_id:"tb",tool_input:{command:"git push"}}' | bash "$CCA/scripts/pulse.sh" 2>/dev/null)
  [[ -n "$out$d" ]] && ok "tampered store (integrity.ok=$r) surfaced by push/pulse" || bad "tampered store (orient integrity.ok=$r) never surfaced: push and pulse silent, git push allowed"; done_; fi

if run subagents; then setup; hook session-start.sh SessionStart S1 >/dev/null; hook post-tool-use.sh PostToolUse S1 >/dev/null
  for a in agentAAAAAAAAAAAAAAAA1 agentAAAAAAAAAAAAAAAA2; do hook subagent-start.sh SubagentStart S1 "$a" >/dev/null; done
  change stg-east-1
  o1=$(hook post-tool-use.sh PostToolUse S1 agentAAAAAAAAAAAAAAAA1); o2=$(hook post-tool-use.sh PostToolUse S1 agentAAAAAAAAAAAAAAAA2); om=$(hook post-tool-use.sh PostToolUse S1)
  [[ "$o1" == *stg-east-1* && "$o2" == *stg-east-1* && "$om" == *stg-east-1* ]] && ok "each subagent and the parent get the push" || bad "subagents with ids sharing a 16-char prefix: sub1=$([[ $o1 == *east* ]] && echo y || echo n) sub2=$([[ $o2 == *east* ]] && echo y || echo n) main=$([[ $om == *east* ]] && echo y || echo n)"
  hook subagent-stop.sh SubagentStop S1 agentAAAAAAAAAAAAAAAA1 >/dev/null
  left=$(ls "$P/.claude/cc-anchor/push" 2>/dev/null | grep -c '\.a-' ); echo "     files left for subagents after one SubagentStop: $left ($(ls "$P/.claude/cc-anchor/push" | tr '\n' ' '))"
  done_; fi

if run subagent_leak; then setup; hook session-start.sh SessionStart S1 >/dev/null; hook post-tool-use.sh PostToolUse S1 >/dev/null
  for i in $(seq 1 50); do a=$(printf 'sub%016d' $i); hook subagent-start.sh SubagentStart S1 "$a" >/dev/null; hook post-tool-use.sh PostToolUse S1 "$a" >/dev/null; hook subagent-stop.sh SubagentStop S1 "$a" >/dev/null; done
  left=$(ls "$P/.claude/cc-anchor/push" | grep -c '\.a-'); [[ $left == 0 ]] && ok "50 subagent start/stop cycles leave no cursor files" || bad "50 subagent start/stop cycles leave $left files: $(ls "$P/.claude/cc-anchor/push" | grep '\.a-' | head -3 | tr '\n' ' ')"
  done_; fi
echo; echo "push: pass=$pass fail=$fail"; exit $(( fail > 0 ))
