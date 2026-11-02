#!/usr/bin/env bash
# N concurrent instruction imports of the SAME changed CLAUDE.md (N SessionStart / FileChanged hooks
# firing at once): want exactly one new revision per change, not N, and a verifying chain.
# usage: KLBIN=… stress/chaos/kl-import-race.sh [N=20]
set -uo pipefail
KLBIN=${KLBIN:?}; N=${1:-20}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export HOME=$W/home CLAUDE_CONFIG_DIR=$W/home/.claude; mkdir -p "$CLAUDE_CONFIG_DIR" "$W/p"; git -C "$W/p" init -q; cd "$W/p"; unset KRONICLE_LITE_DATA_DIR
D=$W/d
printf '# Rules\n\n## Deploy\n\nhost alpha\n' > CLAUDE.md; node "$KLBIN" put --from-instructions --cwd "$W/p" --data-dir "$D" >/dev/null
for round in beta gamma; do
  sed -i "s/host .*/host $round/" CLAUDE.md
  for i in $(seq 1 "$N"); do
    if [ $((i % 2)) = 0 ]; then echo "{\"session_id\":\"s$i\",\"hook_event_name\":\"FileChanged\",\"cwd\":\"$W/p\",\"file_path\":\"$W/p/CLAUDE.md\"}" | node "$KLBIN" put --from-instructions --stdin-hook --data-dir "$D" >/dev/null 2>>"$W/err" &
    else node "$KLBIN" put --from-instructions --cwd "$W/p" --data-dir "$D" >/dev/null 2>>"$W/err" & fi
  done; wait
done
node "$KLBIN" export --data-dir "$D" --out "$W/ev" >/dev/null 2>&1
echo "N=$N: document.put events for CLAUDE.md = $(jq -r 'select(.event_type=="document.put") | .payload.slug' "$W/ev" | grep -c claude-md) (want 3: alpha, beta, gamma); stderr lines=$(wc -l < "$W/err") $(sort "$W/err" | uniq -c | head -3 | tr '\n' ' ' | cut -c1-200)"
node "$KLBIN" verify-chain --full --data-dir "$D" >/dev/null 2>&1; echo "verify-chain --full exit=$?"
echo "event types: $(jq -r .event_type "$W/ev" | grep -v null | sort | uniq -c | tr "\n" " ")"
echo "distinct (revision content) among the claude-md puts: $(jq -r 'select(.event_type=="document.put") | .payload.markdown // .payload.content // "" | select(test("host"))' "$W/ev" | sort | uniq -c | tr "\n" " " | cut -c1-200)"
