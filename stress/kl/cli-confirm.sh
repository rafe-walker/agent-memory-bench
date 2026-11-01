#!/usr/bin/env bash
# CLI (push-hook contract) confirmation of one false-cosmetic case.
# usage: KLBIN=<path to dist/cli.js> stress/kl/cli-confirm.sh "<old line>" "<new line>"
set -euo pipefail
KLBIN=${KLBIN:?set KLBIN=.../dist/cli.js}
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
kl() { node "$KLBIN" "$@" --data-dir "$D/data"; }
printf '# Runbook\n\n## Deploy\n\n%s\n' "$1" > "$D/r.md"; kl put runbook "$D/r.md" --cwd "$D" >/dev/null
C=$(kl orient --actor push-hook --json --cwd "$D" --focus pulse | jq -r .cursor)
printf '# Runbook\n\n## Deploy\n\n%s\n' "$2" > "$D/r.md"; kl put runbook "$D/r.md" --cwd "$D" >/dev/null
kl orient --actor push-hook --json --cwd "$D" --cursor "$C" --focus retractions | jq -c '{retractions: (.retractions|length), cosmetic_edits: [.cosmetic_edits[]?|{rules,diff}]}'
