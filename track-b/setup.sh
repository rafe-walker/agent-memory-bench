#!/usr/bin/env bash
# Install every Track B arm locally (nothing global). Idempotent.
#   kronicle-lite 0.5.0, @beads/bd 1.3.2      -> npm (package.json)
#   basic-memory 1.0.0 + its embedding model  -> .venv + vendor/fastembed_cache
#   sea-lite 0.4.0 (unreleased), cc-anchor    -> snapshots in vendor/ from local checkouts
# Override checkouts with SEA_LITE_SRC / CC_ANCHOR_SRC.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
SEA_LITE_SRC="${SEA_LITE_SRC:-/home/claude/sea-lite}"
CC_ANCHOR_SRC="${CC_ANCHOR_SRC:-/home/claude/cc-anchor}"

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

# Frozen snapshots of the local builds so a concurrent rebuild can't change an arm mid-run.
if [[ ! -f vendor/sea-lite/dist/cli.js ]]; then
  mkdir -p vendor/sea-lite
  cp -a "$SEA_LITE_SRC"/{dist,package.json,skills,hooks} vendor/sea-lite/
  ln -sfn "$SEA_LITE_SRC/node_modules" vendor/sea-lite/node_modules
fi
if [[ ! -f vendor/cc-anchor/scripts/anchor.mjs ]]; then
  mkdir -p vendor/cc-anchor
  (cd "$CC_ANCHOR_SRC" && tar --exclude=.git -cf - .) | (cd vendor/cc-anchor && tar -xf -)
fi

echo "versions:"
node node_modules/kronicle-lite/dist/cli.js --help | head -1
node vendor/sea-lite/dist/cli.js --help | head -1
node -e "console.log('cc-anchor', require('./vendor/cc-anchor/package.json').version)"
node_modules/.bin/bd --version
.venv/bin/python -I -c "import importlib.metadata as m; print('basic-memory', m.version('basic-memory'))"
