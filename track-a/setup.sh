#!/usr/bin/env bash
# Install every Track A arm at a pinned version into .arms/ (gitignored). Idempotent.
# Needs: node >= 20, npm, git, rg (ripgrep), uv (Python arms), curl, jq + bash (cc-anchor hooks).
# Unreleased arms come from local checkouts:
#   AMB_SEA_LITE_DIR   (default /home/claude/sea-lite)     sea-lite 0.4.0, built with `npm run build`
#   AMB_CC_ANCHOR_DIR  (default /home/claude/cc-anchor)    cc-anchor 0.3.0 hook scripts
#   KRONICLE_LITE_SRC  (default /home/claude/kronicle-lite) kronicle-lite 0.6.0: `git archive HEAD` → .arms/kronicle-lite-local, built
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARMS="${AMB_ARMS_DIR:-$ROOT/.arms}"
mkdir -p "$ARMS"
cd "$ARMS"

echo "== npm arms (pinned)"
[ -f package.json ] || echo '{"name":"amb-arms","private":true}' > package.json
npm i --no-audit --no-fund --save-exact \
  kronicle-lite@0.5.0 @modelcontextprotocol/server-memory@2.0.1 backlog.md@1.55.3 task-master-ai@0.43.1 @beads/bd@1.3.2

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

echo "== mcp_agent_mail (git, pinned commit)"
AM_REV=426d4f30dca7ea41189c31a617382be616dd1aa7
if [ ! -d mcp_agent_mail/.git ]; then git clone -q https://github.com/Dicklesworthstone/mcp_agent_mail mcp_agent_mail; fi
git -C mcp_agent_mail fetch -q --depth 50 origin || true
git -C mcp_agent_mail checkout -q "$AM_REV" 2>/dev/null || echo "   (could not check out $AM_REV; using $(git -C mcp_agent_mail rev-parse --short HEAD))"
(cd mcp_agent_mail && uv sync -q)

echo "== sea-lite 0.4.0 (local, unreleased)"
SEA="${AMB_SEA_LITE_DIR:-/home/claude/sea-lite}"
if [ -d "$SEA" ]; then [ -f "$SEA/dist/cli.js" ] || (cd "$SEA" && npm ci && npm run build); else echo "   missing $SEA: sea-lite arms will error"; fi

echo "== cc-anchor 0.3.0 (local, unreleased)"
CCA="${AMB_CC_ANCHOR_DIR:-/home/claude/cc-anchor}"
[ -f "$CCA/scripts/pre-tool-use.sh" ] || echo "   missing $CCA: cc-anchor arms will error"

echo "== kronicle-lite 0.6.0 (local HEAD snapshot, unreleased)"
KSRC="${KRONICLE_LITE_SRC:-/home/claude/kronicle-lite}"
if [ -d "$KSRC/.git" ]; then
  rm -rf kronicle-lite-local && mkdir kronicle-lite-local
  git -C "$KSRC" archive HEAD | tar -x -C kronicle-lite-local
  ln -s "$KSRC/node_modules" kronicle-lite-local/node_modules
  echo "kronicle-lite $(git -C "$KSRC" rev-parse --short HEAD) (git archive of HEAD, $(date -u +%FT%TZ))" > kronicle-lite-local/SNAPSHOT
  (cd kronicle-lite-local && npm run -s build >/dev/null)
else echo "   missing $KSRC: kronicle-lite-0.6 arms will error"; fi

echo "== done: $(ls "$ARMS")"
