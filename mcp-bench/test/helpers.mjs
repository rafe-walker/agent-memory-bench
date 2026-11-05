import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const FAKE = path.join(HERE, 'fake-claude.mjs');
fs.chmodSync(FAKE, 0o755);

export function tmpdir(name = 'mcpbench-') { return fs.mkdtempSync(path.join(os.tmpdir(), name)); }

/** A local JSON task whose verifier checks a file the fake agent writes, and whose cleanup logs. */
export function makeTask(dir, over = {}) {
  fs.writeFileSync(path.join(dir, 'verify.sh'), [
    '#!/usr/bin/env bash',
    'f="$BENCH_WORKDIR/out.txt"',
    'if [ -f "$f" ] && [ "$(cat "$f")" = "hello $BENCH_RUN_TAG" ]; then echo \'{"pass":true,"details":{"ok":1}}\'; else echo \'{"pass":false,"details":{"missing":"out.txt"}}\'; fi',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'setup.sh'), 'echo "{\\"greeting\\":\\"hello\\"}" > "$BENCH_STATE"\n');
  fs.writeFileSync(path.join(dir, 'cleanup.sh'), 'echo "$BENCH_ARM $BENCH_TRIAL" >> "$CLEANUP_LOG"\n');
  const spec = {
    id: 'fake-task', model: 'haiku', max_turns: 7, max_budget_usd: 0.05, timeout_sec: 20, script_timeout_sec: 10,
    prompt: 'Do the thing.\nWRITE out.txt {{state.greeting}} {{run_tag}}\n',
    mcp_servers: { fake: { command: 'node', args: ['${TASK_DIR}/nothing.mjs'], env: { TOKEN: '${FAKE_SECRET}' } } },
    env_passthrough: ['FAKE_SECRET'],
    allowed_tools: ['mcp__fake'], builtin_tools: [],
    setup: 'bash setup.sh', verifier: 'bash verify.sh', cleanup: 'bash cleanup.sh',
    env: { FAKE_CLAUDE_LOG: path.join(dir, 'fake.log') },
    arms: { baseline: {}, variant: { env: { FAKE_TOKENS: '400' } } },
    ...over,
  };
  const file = path.join(dir, 'task.json');
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  return file;
}

export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
