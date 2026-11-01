#!/usr/bin/env bash
# Track B — live headless agents. Resumable: re-running skips finished runs
# (results/track-b/runs.jsonl) and never exceeds the invocation cap recorded in
# results/track-b/ledger.jsonl (default 240 `claude -p` processes, all time).
#
#   bash track-b/run.sh                         # plans/main.json, model from plan (haiku)
#   bash track-b/run.sh --plan=plans/sonnet.json
#   bash track-b/run.sh --setup-only            # build every fixture, no LLM calls
#   bash track-b/run.sh --dry-run               # list the queue
#   bash track-b/run.sh --report                # only regenerate REPORT tables
#
# Options: --plan=FILE --cap=N --concurrency=N --run-root=DIR --model=ALIAS
# Env: TRACKB_RUN_ROOT (per-run temp dirs; default $TMPDIR/amb-track-b),
#      TRACKB_CAP, TRACKB_RESULTS.
# Requires: claude (Claude Code CLI, authenticated), node >= 20, git, jq, bash;
#   `npm install` and `bash track-b/setup.sh` once (installs the arms locally).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
if [[ " $* " == *" --report "* ]]; then exec node lib/report.mjs; fi
plan="plans/main.json"
for a in "$@"; do [[ "$a" == --plan=* ]] && plan="${a#--plan=}"; done
[[ -d node_modules/kronicle-lite ]] || { echo "run: npm install && bash setup.sh first" >&2; exit 2; }
command -v claude >/dev/null || { echo "run: claude CLI not on PATH" >&2; exit 2; }
node lib/runner.mjs --plan="$plan" "$@"
node lib/report.mjs
