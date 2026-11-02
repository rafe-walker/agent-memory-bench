#!/usr/bin/env bash
# Run every deterministic stress check against built checkouts. Raw logs go to stress/logs/ (gitignored).
#   KL=<kronicle-lite checkout, built>  SL=<sea-lite checkout, built, with kronicle-lite 0.7.0 installed>
#   SLW=<sea-lite `wait` checkout, built>  CCA=<cc-anchor checkout>  [CCA_NEXT=<cc-anchor next-cycle>]
#   stress/run-all.sh [--live]      (--live adds the headless claude -p arms; costs ~$0.03)
# Root is needed for the tmpfs disk-full / read-only cases (skipped otherwise).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); LOG=$HERE/logs; mkdir -p "$LOG"
: "${KL:?}" "${SL:?}" "${CCA:?}"; SLW=${SLW:-$SL}; CCA_NEXT=${CCA_NEXT:-$CCA}
export KLBIN=$KL/dist/cli.js
step() { local name=$1; shift; printf '%-28s ' "$name"; if "$@" > "$LOG/$name.log" 2>&1; then echo ok; else echo "FAIL (stress/logs/$name.log)"; fi; }
step kl-classifier     env KL="$KL" node "$HERE/kl/classifier-corpus.mjs"
step kl-section-move   env KL="$KL" node "$HERE/kl/section-move.mjs"
step kl-tamper-badjson env KL="$KL" MODE=badjson bash "$HERE/kl/tamper-json.sh"
step kl-property       env KL="$KL" node "$HERE/kl/property.mjs" --runs 100 --steps 25 --seed 42
step kl-concurrency    bash "$HERE/kl/concurrency.sh" 60
step kl-chaos          bash "$HERE/kl/chaos.sh" all
step kl-mcp-fuzz       node "$HERE/kl/mcp-fuzz.mjs" kl
step kl-http           env BIN="$KLBIN" KIND=kl PORT=7495 bash "$HERE/kl/http-probe.sh"
step sl-concurrency    env SLBIN="$SL/dist/cli.js" bash "$HERE/sl/concurrency.sh" 40
step sl-apply          env SLBIN="$SL/dist/cli.js" node "$HERE/sl/apply.mjs"
step sl-symlink-scope  env SLBIN="$SL/dist/cli.js" bash "$HERE/sl/symlink-scope.sh"
step sl-wait           env SLBIN="$SLW/dist/cli.js" node "$HERE/sl/wait.mjs"
step sl-mcp-fuzz       env SLBIN="$SL/dist/cli.js" node "$HERE/kl/mcp-fuzz.mjs" sl
step sl-http           env BIN="$SL/dist/cli.js" KIND=sl PORT=7496 bash "$HERE/kl/http-probe.sh"
step cca-pulse-corpus  env CCA="$CCA" bash "$HERE/cca/pulse-corpus.sh"
step cca-push          env CCA="$CCA" KLMOD="$KL/node_modules" bash "$HERE/cca/push.sh"
step cca-bash-guard    env CCA="$CCA_NEXT" SLBIN="$SL/dist/cli.js" bash "$HERE/cca/bash-guard.sh"
step cca-pulse-corpus2  env CCA="$CCA" bash "$HERE/cca/pulse-corpus2.sh"
step cca-gate          env CCA="$CCA" KLBIN="$KLBIN" KLMOD="$KL/node_modules" bash "$HERE/cca/gate.sh"
step cca-bash-guard2   env CCA="$CCA_NEXT" SLBIN="$SL/dist/cli.js" bash "$HERE/cca/bash-guard2.sh"
step cca-scope-guard   env CCA="$CCA" SLBIN="$SL/dist/cli.js" bash "$HERE/cca/scope-guard.sh"
step sl-scope2         env SLBIN="$SL/dist/cli.js" bash "$HERE/sl/scope2.sh"
step shim-dash         env KLBIN="$KLBIN" SH=dash bash "$HERE/shim/shim.sh"
step shim-bash         env KLBIN="$KLBIN" SH=bash bash "$HERE/shim/shim.sh"
if [[ " $* " == *" --live "* ]]; then
  step live-hidden  env CCA="$CCA_NEXT" bash "$HERE/live/run.sh" hidden 4
  step live-control env CCA="$CCA_NEXT" bash "$HERE/live/run.sh" control 4
fi
# kl/scale.mjs (10k-40k docs, minutes) is not in the default set:  KL=... node stress/kl/scale.mjs --docs 10000
