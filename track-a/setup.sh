#!/usr/bin/env bash
# Install every Track A arm at a pinned version into .arms/ (gitignored). Idempotent.
# Needs: node >= 20, npm, git, rg (ripgrep), uv (Python arms), curl, jq + bash (cc-anchor hooks).
# Our own arms are the RELEASED versions: kronicle-lite 0.7.0 and sea-lite 0.5.0 from npm, cc-anchor
# v0.4.0 as a `git archive` of the release tag (cc-anchor is a Claude Code plugin, not an npm package):
#   CC_ANCHOR_SRC  (default /home/claude/cc-anchor)  a clone that has the tag;  CC_ANCHOR_REF (default v0.4.0)
# The pre-release run (kronicle-lite 0.5.0 npm + 0.6.0 local, sea-lite 0.4.0 local, cc-anchor 0.3.0 local)
# is archived in results/prerelease/; its setup is this file at commit 4240247.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARMS="${AMB_ARMS_DIR:-$ROOT/.arms}"
mkdir -p "$ARMS"
cd "$ARMS"

echo "== npm arms (pinned)"
[ -f package.json ] || echo '{"name":"amb-arms","private":true}' > package.json
npm i --no-audit --no-fund --save-exact \
  kronicle-lite@0.7.0 sea-lite@0.5.0 @modelcontextprotocol/server-memory@2.0.1 backlog.md@1.55.3 task-master-ai@0.43.1 @beads/bd@1.3.2

echo "== basic-memory 1.0.0 (uv venv)"
[ -x bm-venv/bin/basic-memory ] || { uv venv -q -p 3.12 bm-venv && VIRTUAL_ENV="$ARMS/bm-venv" uv pip install -q basic-memory==1.0.0; }
# basic-memory's semantic search downloads bge-small-en-v1.5 (Qdrant ONNX) on first use. Fetch it once
# into the HF cache layout so runs are offline and identical (HF_HUB_OFFLINE=1 at run time).
REV=aa8f8b060edb00e03bfdd08813a2949946c8ba55
D="fastembed-cache/models--Qdrant--bge-small-en-v1.5-onnx-Q"
if [ ! -s "$D/snapshots/$REV/model_optimized.onnx" ]; then
  mkdir -p "$D/refs" "$D/snapshots/$REV"; printf '%s' "$REV" > "$D/refs/main"
  for f in config.json model_optimized.onnx special_tokens_map.json tokenizer.json tokenizer_config.json; do
    curl -sSL --fail -o "$D/snapshots/$REV/$f" "https://huggingface.co/Qdrant/bge-small-en-v1.5-onnx-Q/resolve/$REV/$f"
  done
fi

echo "== beads-mcp 1.3.2 (uv venv; MCP front-end for bd, used by S14 only)"
[ -x beads-mcp-venv/bin/beads-mcp ] || { uv venv -q -p 3.12 beads-mcp-venv && VIRTUAL_ENV="$ARMS/beads-mcp-venv" uv pip install -q beads-mcp==1.3.2; }

echo "== mcp_agent_mail (git, pinned commit)"
AM_REV=426d4f30dca7ea41189c31a617382be616dd1aa7
if [ ! -d mcp_agent_mail/.git ]; then git clone -q https://github.com/Dicklesworthstone/mcp_agent_mail mcp_agent_mail; fi
git -C mcp_agent_mail fetch -q --depth 50 origin || true
git -C mcp_agent_mail checkout -q "$AM_REV" 2>/dev/null || echo "   (could not check out $AM_REV; using $(git -C mcp_agent_mail rev-parse --short HEAD))"
(cd mcp_agent_mail && uv sync -q)

echo "== cc-anchor (git archive of a release tag)"
CCA_SRC="${CC_ANCHOR_SRC:-/home/claude/cc-anchor}"; CCA_REF="${CC_ANCHOR_REF:-v0.4.0}"
if [ ! -f cc-anchor/scripts/pre-tool-use.sh ]; then
  git -C "$CCA_SRC" fetch -q --tags origin 2>/dev/null || true
  mkdir -p cc-anchor && git -C "$CCA_SRC" archive "$CCA_REF" | tar -x -C cc-anchor
  echo "cc-anchor $CCA_REF@$(git -C "$CCA_SRC" rev-parse --short "$CCA_REF^{commit}")" > cc-anchor/SNAPSHOT
fi
cat cc-anchor/SNAPSHOT

echo "== done: $(ls "$ARMS")"
