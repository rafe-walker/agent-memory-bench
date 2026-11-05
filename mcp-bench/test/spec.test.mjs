import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTask, resolveArm, renderTemplate, validateSpec } from '../lib/spec.mjs';
import { ROOT, tmpdir, makeTask } from './helpers.mjs';

const TEMPLATES = ['posthog/dashboard-create', 'posthog/insight-update', 'posthog/list-paginate', 'local-notes']
  .map((t) => path.join(ROOT, 'tasks', t, 'task.yaml'));

test('shipped task templates load and validate', () => {
  for (const f of TEMPLATES) {
    const t = loadTask(f);
    assert.ok(t.verifier, f);
    assert.ok(Object.keys(t.arms).length >= 2, `${f}: paired arms`);
  }
});

test('JSON spec loads with defaults and arms resolve with overrides', () => {
  const d = tmpdir();
  const t = loadTask(makeTask(d, { max_turns: undefined }));
  assert.equal(t.max_turns, 20);
  const b = resolveArm(t, 'baseline'), v = resolveArm(t, 'variant');
  assert.deepEqual(b.allowed_tools, ['mcp__fake']);
  assert.equal(v.env.FAKE_TOKENS, '400');
  assert.equal(b.env.FAKE_TOKENS, undefined);
  assert.equal(v.env.FAKE_CLAUDE_LOG, b.env.FAKE_CLAUDE_LOG, 'top-level env is inherited');
  assert.throws(() => resolveArm(t, 'nope'), /no arm "nope"/);
});

test('validation lists every error: unknown keys, missing verifier, bad arm, literal secret, missing script', () => {
  const d = tmpdir();
  const { errors } = validateSpec({
    id: 'Bad Id', prompt: 'x', setup: 'python3 missing.py', verifer: 'typo',
    mcp_servers: { s: { url: 'https://x', headers: { Authorization: 'Bearer phx_abcdefghijklmnop' } } },
    arms: { a: { model: 'opus' } },
  }, d);
  const all = errors.join('\n');
  for (const re of [/spec\.id/, /verifer: unknown key/, /spec\.verifier: required/, /arms\.a\.model: unknown key/, /literal secret/, /script not found: missing\.py/]) assert.match(all, re);
});

test('YAML parse errors and invalid specs throw with the file name', () => {
  const d = tmpdir();
  const f = path.join(d, 't.yaml');
  fs.writeFileSync(f, 'id: [unclosed');
  assert.throws(() => loadTask(f), /t\.yaml: parse error/);
  fs.writeFileSync(f, 'id: ok\nprompt: hi\n');
  assert.throws(() => loadTask(f), /verifier: required/);
});

test('renderTemplate fills run vars and state, and refuses unknown variables', () => {
  assert.equal(renderTemplate('a {{run_tag}} {{ state.n }} {{state.o}}', { run_tag: 'T', state: { n: 3, o: { k: 1 } } }), 'a T 3 {"k":1}');
  assert.throws(() => renderTemplate('{{state.missing}}', { state: {} }), /state\.missing/);
});
