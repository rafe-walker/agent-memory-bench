#!/usr/bin/env bash
# Round 2, track 2 (concurrency, chaos, storage, upgrades). Installs the published versions from npm
# into a temp dir (or reuse VERS=<dir> laid out as <dir>/kl-0.8.0/node_modules/…), then runs every
# check. Root for the tmpfs cases; libfaketime (apt install faketime) for the skew cases.
#   stress/chaos/run-chaos.sh [--soak]      findings: stress/findings/chaos.md
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); LOG=$HERE/../logs/chaos; mkdir -p "$LOG"
if [ -z "${VERS:-}" ]; then VERS=$(mktemp -d); trap 'rm -rf "$VERS"' EXIT
  for p in kronicle-lite@0.5.0 kronicle-lite@0.6.0 kronicle-lite@0.7.0 kronicle-lite@0.8.0 sea-lite@0.4.0 sea-lite@0.5.0 sea-lite@0.6.0; do
    n=${p%@*}; v=${p#*@}; d="$VERS/$([ "$n" = kronicle-lite ] && echo kl || echo sl)-$v"; mkdir -p "$d"
    (cd "$d" && npm init -y >/dev/null && npm i --no-audit --no-fund "$p" >/dev/null 2>&1) &
  done; wait
fi
k() { echo "$VERS/kl-$1/node_modules/kronicle-lite/dist/cli.js"; }; s() { echo "$VERS/sl-$1/node_modules/sea-lite/dist/cli.js"; }
K8=$(k 0.8.0); S6=$(s 0.6.0)
step() { local name=$1; shift; printf '%-34s ' "$name"; if "$@" > "$LOG/$name.log" 2>&1; then echo "done (stress/logs/chaos/$name.log)"; else echo "exit $? (stress/logs/chaos/$name.log)"; fi; }
for o in 0.5.0 0.6.0 0.7.0; do step "kl-upgrade-$o" env GIT=0 OLD="$(k $o)" NEW="$K8" bash "$HERE/kl-upgrade.sh"; done
for o in 0.5.0 0.6.0; do step "C2-01-downgrade-rebuild-$o" env OLD="$(k $o)" NEW="$K8" bash "$HERE/kl-downgrade-rebuild.sh" rebuild; done
step C2-01-mixed-0.6-0.8           env NEW="$K8" OLD="$(k 0.6.0)" SLBIN="$S6" bash "$HERE/mixed-versions.sh" 16 6
step mixed-0.7-0.8                 env NEW="$K8" OLD="$(k 0.7.0)" SLBIN="$S6" bash "$HERE/mixed-versions.sh" 16 6
for o in 0.4.0 0.5.0; do step "sl-upgrade-$o" env OLD="$(s $o)" NEW="$S6" KL="$K8" bash "$HERE/sl-upgrade.sh"; done
step C2-07-idem-upgrade-0.4.0      node "$HERE/sl-idem-upgrade.mjs" "$(s 0.4.0)" "$S6"
step C2-02-cli-tokens              env SLBIN="$S6" bash "$HERE/sl-cli-tokens.sh" 40
for m in control garbage secret rollback; do step "C2-03-04-shim-cursor-$m" env KLBIN="$K8" bash "$HERE/kl-shim-cursor.sh" $m; done
step C2-05-skew-lineage-control    env KLBIN="$K8" SKEW= bash "$HERE/kl-skew-lineage.sh"
step C2-05-skew-lineage-3s         env KLBIN="$K8" SKEW=+3s bash "$HERE/kl-skew-lineage.sh"
step C2-06-skew-lease              env SLBIN="$S6" KLBIN="$K8" bash "$HERE/sl-skew-lease.sh"
step C2-08-writer-blocks-readers   env KLBIN="$K8" SLBIN="$S6" HOLD=14 bash "$HERE/kl-writer-blocks-readers.sh"
step C2-10-import-race             env KLBIN="$K8" bash "$HERE/kl-import-race.sh" 20
step storm-40                      env KLBIN="$K8" SLBIN="$S6" bash "$HERE/storm.sh" 40 5
step kill9-both                    env KLBIN="$K8" SLBIN="$S6" bash "$HERE/kill9-both.sh" 40
step rollback-snapshot             env KLBIN="$K8" bash "$HERE/kl-rollback.sh" snapshot
step rollback-wal                  env KLBIN="$K8" bash "$HERE/kl-rollback.sh" wal
step guards-ro                     env KLBIN="$K8" SLBIN="$S6" bash "$HERE/guards-storage.sh" ro
step guards-full                   env KLBIN="$K8" SLBIN="$S6" bash "$HERE/guards-storage.sh" full
step sl-fence-fresh                node "$HERE/sl-fence-fresh.mjs" "$S6" "$K8" 4 4 8 2
step sl-herd-http-50               env SLBIN="$S6" node "$HERE/sl-herd-http.mjs" 50
if [[ " $* " == *" --soak "* ]]; then
  step sl-scale-10k                env SLBIN="$S6" node "$HERE/sl-scale.mjs" --tickets 10000 --herd 2
  [ -n "${KLSTORE:-}" ] && step kl-reads-growth env KL="$VERS/kl-0.8.0/node_modules/kronicle-lite" node "$HERE/kl-reads-growth.mjs" --store "$KLSTORE"   # KLSTORE = a pre-built 10k store
  step kl-scale-10k                env KL="$VERS/kl-0.8.0/node_modules/kronicle-lite" node "$HERE/../kl/scale.mjs" --docs 10000 --loops 300
fi
