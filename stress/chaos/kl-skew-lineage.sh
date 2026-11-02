#!/usr/bin/env bash
# Clock skew vs derived-note lineage inference (0.8.0). Inference keeps the reads made "since the
# session started" by comparing wall-clock strings (reads.read_at >= briefing.issued_at). If the clock
# that stamped the briefing is ahead of the one that stamps the reads (NTP step back, VM resume, a
# hook process with a different TZ/clock), the agent's reads are dropped and its note records no
# lineage: a later change to the source never marks the note stale.
# SKEW="+2h" (libfaketime offset for the orient only; "" = control)
# usage: KLBIN=<kl>/dist/cli.js SKEW=+2h stress/chaos/kl-skew-lineage.sh
set -uo pipefail
KLBIN=${KLBIN:?}; SKEW=${SKEW-+2h}; HERE=$(cd "$(dirname "$0")" && pwd)
command -v faketime >/dev/null || { echo "needs libfaketime (apt install faketime)"; exit 2; }
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home; mkdir -p "$HOME" "$W/p"; cd "$W/p"; unset KRONICLE_LITE_DATA_DIR
D=$W/data; kl() { node "$KLBIN" "$@" --data-dir "$D" --cwd "$W/p"; }
printf '# Svc\n\n## Deploy\n\nDeploy svc to host alpha-01 on port 8443.\n' > "$W/src.md"; kl put svc-runbook "$W/src.md" --actor writer >/dev/null
if [ -n "$SKEW" ]; then C=$(faketime -f "$SKEW" node "$KLBIN" orient --actor agent --json --data-dir "$D" --cwd "$W/p" | jq -r .cursor)
else C=$(kl orient --actor agent --json | jq -r .cursor); fi
kl get svc-runbook --actor agent >/dev/null           # the agent reads the source (real clock)
printf '# My plan\n\n## Steps\n\nI will deploy svc to alpha-01 on 8443 tonight.\n' > "$W/note.md"
kl put my-plan "$W/note.md" --actor agent --cursor "$C" --json > "$W/put"
echo "[skew=${SKEW:-none}] note lineage: $(jq -c '.lineage // {} | {declared:(.derived_from // [] | length), inferred:(.derived_from_inferred // [] | length), truncated:(.derived_from_inferred_truncated // false)}' "$W/put")"
printf '# Svc\n\n## Deploy\n\nDeploy svc to host beta-02 on port 9443.\n' > "$W/src.md"; kl put svc-runbook "$W/src.md" --actor writer >/dev/null
kl orient --actor agent --cursor "$C" --focus retractions --json > "$W/or"
echo "[skew=${SKEW:-none}] retractions after the source change: $(jq -c '[.retractions[]? | {kind, slug:.doc_slug}]' "$W/or")"
(cd "$W/p" && node "$HERE/mcpcall.mjs" "$KLBIN" "serve --data-dir $D --actor reader" '[["recall",{"query":"deploy svc alpha-01 tonight","top_k":5,"actor_id":"reader"}]]' > "$W/rc" 2>/dev/null)
echo "[skew=${SKEW:-none}] recall of the note: $(jq -c '[.result.hits[]? | select(.doc_slug=="my-plan") | {authority, why:.authority_reason, stale_derived:(.stale_derived // [] | length)}]' "$W/rc")"
