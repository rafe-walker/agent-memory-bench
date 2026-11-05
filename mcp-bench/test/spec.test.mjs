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

test('fuzz: timeouts that overflow setTimeout, prototype keys, and broader literal-key patterns are rejected', () => {
  const base = { id: 'x', prompt: 'p', verifier: 'true' };
  const errs = (o) => validateSpec({ ...base, ...o }, '/tmp').errors.join('\n');
  assert.match(errs({ timeout_sec: 3000000 }), /timeout_sec/);
  assert.match(errs({ script_timeout_sec: 1e12 }), /script_timeout_sec/);
  assert.equal(errs({ timeout_sec: 86400 }), '');
  assert.match(errs({ max_budget_usd: Infinity }), /max_budget_usd/);
  assert.match(errs(JSON.parse('{"toString":"x","constructor":"y"}')), /toString: unknown key[\s\S]*constructor: unknown key/);
  assert.match(errs({ arms: JSON.parse('{"a":{"__proto__":{"x":1}}}') }), /unknown key|expected/);
  assert.match(errs({ mcp_servers: { s: { url: 'https://x', headers: { Authorization: 'Bearer sk-proj-ABCDEFGHIJKLMNOPQRST' } } } }), /literal secret/);
  assert.equal(errs({ mcp_servers: { s: { url: 'https://x', headers: { Authorization: 'Bearer ${KEY}' } } } }), '');
});

test('templates only read own properties of run vars', () => {
  assert.throws(() => renderTemplate('{{state.constructor}}', { state: {} }), /not set/);
  assert.throws(() => renderTemplate('{{toString}}', {}), /not set/);
  assert.equal(renderTemplate('{{state.x}}', { state: { x: '$(id); `rm -rf /`' } }), '$(id); `rm -rf /`');
});
