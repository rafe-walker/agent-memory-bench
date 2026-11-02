#!/usr/bin/env bash
# Install the npm-published targets and the client SDKs the protocol track drives, into $PROTO_PKG
# (default /tmp/claude-0/proto). Python: venv (mcp latest = Hermes Agent) and venv1 (mcp<2).
set -euo pipefail
P=${PROTO_PKG:-/tmp/claude-0/proto}; mkdir -p "$P"; cd "$P"
[[ -f package.json ]] || npm init -y >/dev/null
npm i --no-audit --no-fund kronicle-lite@0.8.0 sea-lite@0.6.0 mcp-catalog-snap@0.1.0 \
  ajv@8 ajv-formats@3 json-schema-faker@0.5.9 @modelcontextprotocol/sdk@1 @modelcontextprotocol/client@2
[[ -x venv/bin/python ]] || { python3 -m venv venv && venv/bin/pip install -q mcp; }
[[ -x venv1/bin/python ]] || { python3 -m venv venv1 && venv1/bin/pip install -q "mcp<2"; }
# optional: Codex CLI to validate the Codex TOML snippets (CODEX_BIN)
[[ -x codex/node_modules/.bin/codex ]] || { mkdir -p codex && (cd codex && npm init -y >/dev/null && npm i --no-audit --no-fund @openai/codex) || true; }
# bare imports (ajv, json-schema-faker) resolve from the script dir: link the deps next to the harness
ln -sfn "$P/node_modules" "$(cd "$(dirname "$0")" && pwd)/node_modules"
