#!/usr/bin/env bash
# Install every Track B arm locally (nothing global). Idempotent.
#   kronicle-lite 0.7.0, sea-lite 0.5.0, @beads/bd 1.3.2  -> npm (package.json; released versions)
#   basic-memory 1.0.0 + its embedding model              -> .venv + vendor/fastembed_cache
#   cc-anchor v0.4.0                                      -> vendor/cc-anchor, `git archive` of the release tag
# Override the cc-anchor clone / ref with CC_ANCHOR_SRC / CC_ANCHOR_REF. The pre-release run
# (kronicle-lite 0.5.0, sea-lite 0.4.0 + cc-anchor 0.3.0/push-hook/next-cycle local snapshots) used
# this file at commit cb3ba5b; its results are in results/prerelease/track-b*.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
CC_ANCHOR_SRC="${CC_ANCHOR_SRC:-/home/claude/cc-anchor}"
CC_ANCHOR_REF="${CC_ANCHOR_REF:-v0.4.0}"

npm install --no-audit --no-fund

command -v uv >/dev/null || { echo "setup: uv is required for basic-memory" >&2; exit 2; }
[[ -x .venv/bin/basic-memory ]] || { uv venv -q .venv; VIRTUAL_ENV="$PWD/.venv" uv pip install -q basic-memory==1.0.0; }

# basic-memory 1.0 always loads a fastembed model; fetch it with curl (works
# behind TLS-intercepting proxies where Python's certifi store does not).
SHA=aa8f8b060edb00e03bfdd08813a2949946c8ba55
M="vendor/fastembed_cache/models--qdrant--bge-small-en-v1.5-onnx-q"
if [[ ! -s "$M/snapshots/$SHA/model_optimized.onnx" ]]; then
  mkdir -p "$M/snapshots/$SHA" "$M/refs"; printf %s "$SHA" > "$M/refs/main"
  for f in config.json model_optimized.onnx special_tokens_map.json tokenizer.json tokenizer_config.json vocab.txt ort_config.json; do
    curl -sSLf -o "$M/snapshots/$SHA/$f" "https://huggingface.co/Qdrant/bge-small-en-v1.5-onnx-Q/resolve/$SHA/$f"
  done
fi

# cc-anchor is a Claude Code plugin (no npm package): a frozen `git archive` of the release tag.
if [[ ! -f vendor/cc-anchor/scripts/anchor.mjs ]]; then
  git -C "$CC_ANCHOR_SRC" fetch -q --tags origin 2>/dev/null || true
  mkdir -p vendor/cc-anchor
  git -C "$CC_ANCHOR_SRC" archive "$CC_ANCHOR_REF" | tar -x -C vendor/cc-anchor
  echo "$CC_ANCHOR_REF $(git -C "$CC_ANCHOR_SRC" rev-parse "$CC_ANCHOR_REF^{commit}")" > vendor/cc-anchor/VERSION
fi

echo "versions:"
node node_modules/kronicle-lite/dist/cli.js --help | head -1
node node_modules/sea-lite/dist/cli.js --help | head -1
node -e "console.log('cc-anchor', require('./vendor/cc-anchor/package.json').version)"; cat vendor/cc-anchor/VERSION
node_modules/.bin/bd --version
.venv/bin/python -I -c "import importlib.metadata as m; print('basic-memory', m.version('basic-memory'))"
