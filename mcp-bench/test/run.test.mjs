// End-to-end through the CLI with the fake claude. Never calls the real CLI or a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { ROOT, FAKE, tmpdir, makeTask, readJsonl } from './helpers.mjs';
import { secretValues, redactor } from '../lib/runner.mjs';

const CLI = path.join(ROOT, 'bin', 'mcp-bench.mjs');
const SECRET = 'not-a-real-secret-0123456789';

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, FAKE_SECRET: SECRET, LEAK_ME: 'x', ...env }, timeout: 120000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('paired run: results.json + REPORT.md, overrides applied, env scrubbed, secrets not written, cleanup always runs', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d);
  const r = cli(['run', task, '--n', '3', '--seed', '5', '--model', 'tiny-model', '--max-turns', '3', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { CLEANUP_LOG: path.join(d, 'cleanup.log'), VERIFY_LOG: path.join(d, 'verify.log') });
  assert.equal(r.code, 0, r.err);
  const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  const t = res.tasks[0];
  assert.equal(t.completed_attempts, 6);
  assert.equal(res.claude_version, '0.0.0-fake');
  const arms = t.models['tiny-model'].arms;
  assert.equal(arms.baseline.verified, 3);
  assert.equal(arms.variant.verified, 3);
  // fake: base tokens per turn; 2 turns: (b+200+50+40) + (b+100+300+0+20)
  assert.equal(arms.baseline.tokens.total.p50, 2 * 1000 + 710);
  assert.equal(arms.variant.tokens.total.p50, 2 * 400 + 710);
  assert.equal(arms.baseline.expected_tokens_per_verified_success, 2710);
  assert.equal(arms.baseline.tool_errors, 0);
  assert.deepEqual(arms.baseline.model_ids, ['tiny-model'], 'resolved model id from the init event');
  assert.equal(arms.baseline.duplicate_side_effects.n, 3);
  assert.equal(arms.baseline.duplicate_side_effects.k, 0);
  assert.equal(t.records[0].agent.estimated.method, 'utf8_bytes/4');
  assert.equal(t.balanced, false, 'n=3 with 2 arms is flagged');
  for (const line of fs.readFileSync(path.join(d, 'verify.log'), 'utf8').trim().split('\n')) {
    assert.doesNotMatch(line, /transcript/, 'transcript is not on disk while the verifier runs');
    assert.match(line, /ANSWER=none$/, 'verifier gets no agent text');
  }
  const pair = t.models['tiny-model'].paired.variant;
  assert.equal(pair.pairs, 3);
  assert.equal(pair.delta_tokens.p50, -1200);
  assert.equal(pair.variant_fewer_tokens, 3);

  const calls = readJsonl(path.join(d, 'fake.log'));
  assert.equal(calls.length, 6);
  for (const c of calls) {
    const a = c.argv;
    assert.equal(a[a.indexOf('--model') + 1], 'tiny-model');
    assert.equal(a[a.indexOf('--max-turns') + 1], '3');
    assert.equal(a[a.indexOf('--max-budget-usd') + 1], '0.05');
    assert.equal(a[a.indexOf('--output-format') + 1], 'stream-json');
    assert.ok(a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'));
    assert.equal(a[a.indexOf('--tools') + 1], '');
    assert.ok(!a.join(' ').includes(SECRET), 'secret never in argv');
    assert.ok(c.env_keys.includes('FAKE_SECRET'), 'env_passthrough reaches the agent');
    assert.ok(!c.env_keys.includes('LEAK_ME'), 'everything else is scrubbed');
    assert.match(c.cwd, /work$/);
    const mcp = fs.readFileSync(a[a.indexOf('--mcp-config') + 1], 'utf8');
    assert.ok(mcp.includes('${FAKE_SECRET}') && !mcp.includes(SECRET), 'placeholder kept, value never written');
    assert.ok(mcp.includes(path.join(d, 'nothing.mjs')), '${TASK_DIR} filled');
  }
  // arm order randomized within pairs
  const firsts = new Set(t.records.filter((x) => x.order === 0).map((x) => x.arm));
  assert.ok(firsts.size >= 1);
  assert.equal(fs.readFileSync(path.join(d, 'cleanup.log'), 'utf8').trim().split('\n').length, 6);
  const md = fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8');
  assert.match(md, /Expected tokens per verified success/);
  assert.match(md, /\| baseline \| 2,710 \| 100% \([0-9]+%–100%\) \| 3 \/ 3 \| 2,710 \/ 2,710 \(3\) \|/);
  assert.match(md, /Resolved model ID\(s\): `tiny-model`/);
  assert.match(md, /Unbalanced/);
  assert.match(md, /variant vs baseline \| 3 \| -1,200/);
  assert.ok(!fs.existsSync(path.join(t.records[0].run_dir, 'home')), 'isolated HOME removed after the attempt');
  assert.ok(fs.existsSync(path.join(t.records[0].run_dir, 'transcript.jsonl.gz')));
  assert.equal(readJsonl(path.join(out, 'attempts.jsonl')).length, 6);
});

test('failures count in the denominator: skip (unverified), error, crash, hang (timeout)', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, {
    timeout_sec: 2,
    arms: { ok: {}, dup: { env: { FAKE_CLAUDE_MODE: 'dup' } }, skip: { env: { FAKE_CLAUDE_MODE: 'skip' } }, err: { env: { FAKE_CLAUDE_MODE: 'error' } }, crash: { env: { FAKE_CLAUDE_MODE: 'crash' } }, hang: { env: { FAKE_CLAUDE_MODE: 'hang' } } },
  });
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { CLEANUP_LOG: path.join(d, 'c.log') });
  assert.equal(r.code, 0, r.err);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  const a = t.models.haiku.arms;
  assert.equal(a.ok.verified, 1);
  assert.equal(a.dup.verified, 0);
  assert.deepEqual([a.dup.duplicate_side_effects.k, a.dup.duplicate_side_effects.n], [1, 1], 'duplicate side effect counted');
  assert.equal(a.skip.verified, 0); assert.equal(a.skip.attempts, 1); assert.equal(a.skip.tool_errors, 1);
  assert.equal(a.err.agent_errors, 1);
  assert.equal(a.crash.agent_errors, 1);
  assert.equal(t.records.find((x) => x.arm === 'crash').agent.usage_source, 'turns');
  assert.equal(a.hang.timeouts, 1); assert.equal(a.hang.attempts, 1);
  assert.equal(a.hang.expected_tokens_per_verified_success, null);
  assert.equal(fs.readFileSync(path.join(d, 'c.log'), 'utf8').trim().split('\n').length, 6, 'cleanup ran after every attempt');
  assert.match(fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8'), /∞ \(0 verified\)/);
});

test('setup failure is a setup_error (agent never started), verifier crash is a verifier_error', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { setup: 'exit 3', cleanup: undefined });
  cli(['run', task, '--n', '1', '--arms', 'baseline', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE]);
  let t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t.records[0].status, 'setup_error');
  assert.equal(t.models.haiku.arms.baseline.attempts, 0);
  assert.equal(readJsonl(path.join(d, 'fake.log')).length, 0);

  const d2 = tmpdir(); const out2 = path.join(d2, 'out');
  const task2 = makeTask(d2, { verifier: 'echo boom >&2; exit 7', cleanup: undefined });
  cli(['run', task2, '--n', '1', '--arms', 'baseline', '--max-total-usd', '1', '--out', out2, '--claude-bin', FAKE]);
  t = JSON.parse(fs.readFileSync(path.join(out2, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t.records[0].status, 'verifier_error');
  assert.match(t.records[0].verifier.details, /exit 7: boom/);
  assert.equal(t.models.haiku.arms.baseline.attempts, 1, 'verifier errors stay in the denominator');
});

test('budget cap stops before an attempt that could exceed it', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { cleanup: undefined });
  // max_budget_usd 0.05/attempt; fake spends $0.001 → cap 0.053 allows the first, then 0.001+0.05 ≤ 0.053 allows a second, not a third.
  cli(['run', task, '--n', '3', '--max-total-usd', '0.053', '--out', out, '--claude-bin', FAKE]);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.ok(t.completed_attempts >= 1 && t.completed_attempts < 6, String(t.completed_attempts));
  assert.match(t.stopped, /^budget:/);
  assert.match(fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8'), /Stopped early/);
});

test('run refuses without --max-total-usd; dry-run spawns nothing and flags missing env', () => {
  const d = tmpdir();
  const task = makeTask(d);
  assert.equal(cli(['run', task, '--claude-bin', FAKE]).code, 2);
  const dry = cli(['run', task, '--n', '2', '--dry-run', '--claude-bin', FAKE]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  assert.match(dry.out, /4 attempts/);
  assert.match(dry.out, /argv\[variant\]: -p/);
  assert.equal(readJsonl(path.join(d, 'fake.log')).length, 0, 'fake --version only; no agent run logged');
  const ph = cli(['run', path.join(ROOT, 'tasks/posthog/insight-update/task.yaml'), '--arms', 'direct', '--dry-run', '--claude-bin', FAKE], { POSTHOG_AUDIT_KEY: '', POSTHOG_PROJECT_ID: '' });
  assert.equal(ph.code, 3);
  assert.match(ph.out, /missing env POSTHOG_AUDIT_KEY, POSTHOG_PROJECT_ID$/m);
  assert.doesNotMatch(ph.out, /MCP_WIRE_PROXY/, 'only the selected arms\' env is required');
});

test('--purpose sets n and guards published numbers', () => {
  const d = tmpdir();
  const task = makeTask(d);
  const ba = cli(['run', task, '--purpose', 'before-after', '--dry-run', '--claude-bin', FAKE]);
  assert.equal(ba.code, 0, ba.out + ba.err);
  assert.match(ba.out, /20 attempts/);
  assert.match(ba.out, /model "haiku" is an alias/);
  assert.notEqual(cli(['run', task, '--purpose', 'publish', '--n', '5', '--dry-run', '--claude-bin', FAKE]).code, 0);
  const pub = cli(['run', task, '--purpose', 'publish', '--n', '20', '--dry-run', '--claude-bin', FAKE]);
  assert.equal(pub.code, 2);
  assert.match(pub.err, /small models are for smoke runs only/);
  // #19: a frozen large model is not enough; publish also refuses --isolation dev (see sandbox.test.mjs)
  const dev = cli(['run', task, '--purpose', 'publish', '--n', '20', '--model', 'claude-sonnet-9-9-20990101', '--dry-run', '--claude-bin', FAKE]);
  assert.equal(dev.code, 2);
  assert.match(dev.err, /publish refuses --isolation dev/);
});

test('validate and report commands', () => {
  const v = cli(['validate', ...['posthog/dashboard-create', 'posthog/insight-update', 'posthog/list-paginate', 'local-notes'].map((x) => path.join(ROOT, 'tasks', x, 'task.yaml'))]);
  assert.equal(v.code, 0, v.out);
  const d = tmpdir(); const f = path.join(d, 'bad.yaml');
  fs.writeFileSync(f, 'id: x\nprompt: y\n');
  assert.equal(cli(['validate', f]).code, 1);
  const out = path.join(d, 'out');
  cli(['run', makeTask(d), '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { CLEANUP_LOG: path.join(d, 'c.log') });
  const rep = cli(['report', path.join(out, 'results.json')]);
  assert.equal(rep.code, 0);
  assert.match(rep.out, /## fake-task/);
});

test('budget: an attempt with no reported cost (crash, timeout) is charged at the per-attempt cap', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  // crash mode never emits a result event, so total_cost_usd is unknown; cap 0.12 at $0.05/attempt
  // must allow at most 2 attempts, not all 6.
  const task = makeTask(d, { cleanup: undefined, env: { FAKE_CLAUDE_MODE: 'crash', FAKE_CLAUDE_LOG: path.join(d, 'fake.log') } });
  cli(['run', task, '--n', '3', '--max-total-usd', '0.12', '--out', out, '--claude-bin', FAKE]);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.equal(readJsonl(path.join(d, 'fake.log')).length, 2, 'agent started at most cap / per-attempt times');
  assert.equal(t.completed_attempts, 2);
  assert.match(t.stopped, /^budget:/);
  assert.ok(t.spent_usd <= 0.12 + 1e-9 && t.spent_usd >= 0.1 - 1e-9, String(t.spent_usd));
  assert.equal(t.unpriced_attempts, 2);
  assert.match(fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8'), /2 attempt\(s\) reported no cost/);
});

test('budget: an attempt that overshot the per-attempt cap raises the reservation for the next one', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  // fake cost = FAKE_TOKENS / 1e6 = $0.08 > max_budget_usd 0.05; after one such attempt, 0.08 + 0.08 > 0.15.
  const task = makeTask(d, { cleanup: undefined, env: { FAKE_TOKENS: '80000', FAKE_CLAUDE_LOG: path.join(d, 'fake.log') }, arms: { a: {}, b: {} } });
  cli(['run', task, '--n', '3', '--max-total-usd', '0.15', '--out', out, '--claude-bin', FAKE]);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t.completed_attempts, 1);
  assert.ok(t.spent_usd <= 0.15, String(t.spent_usd));
});

test('spec: extra_args may not override harness-controlled flags; env may not move HOME', () => {
  const d = tmpdir();
  for (const [over, re] of [
    [{ extra_args: ['--max-budget-usd', '50'] }, /extra_args.*--max-budget-usd/],
    [{ arms: { a: { extra_args: ['--model=opus'] } } }, /extra_args.*--model/],
    [{ arms: { a: { extra_args: ['--dangerously-skip-permissions'] } } }, /extra_args.*--dangerously-skip-permissions/],
    [{ arms: { a: { env: { HOME: '/root' } } } }, /env\.HOME: reserved/],
    [{ env: { CLAUDE_CONFIG_DIR: '/root/.claude' } }, /env\.CLAUDE_CONFIG_DIR: reserved/],
    // model selection through the env would change the model mid-comparison
    [{ arms: { a: { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-opus-x' } } } }, /env\.ANTHROPIC_DEFAULT_SONNET_MODEL: reserved/],
    [{ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' } }, /env\.CLAUDE_CODE_SUBAGENT_MODEL: reserved/],
    [{ env: { ANTHROPIC_MODEL: 'opus' } }, /env\.ANTHROPIC_MODEL: reserved/],
    [{ arms: { a: { env_passthrough: ['ANTHROPIC_DEFAULT_HAIKU_MODEL'] } } }, /env_passthrough: ANTHROPIC_DEFAULT_HAIKU_MODEL is reserved/],
    // combined short flags: -pc is -p -c
    [{ arms: { a: { extra_args: ['-pc'] } } }, /extra_args.*-c is set by the harness/],
    [{ extra_args: ['-dr=abc'] }, /extra_args.*-r is set by the harness/],
  ]) {
    const r = cli(['validate', makeTask(d, over)]);
    assert.equal(r.code, 1, JSON.stringify(over) + r.out);
    assert.match(r.out, re);
  }
  assert.equal(cli(['validate', makeTask(d, { extra_args: ['--add-dir', '/tmp'] })]).code, 0);
  assert.equal(cli(['validate', makeTask(d, { extra_args: ['-d'] })]).code, 0, 'a single unreserved short flag is fine');
});

test('redaction: every passed-through / ${VAR} value is redacted unless plain_env lists it; secret_env and credential names win', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant-harness-key-123', DATA_DIR: '/srv/data/bench', RULES_PATH: '/srv/rules.json',
    DATABASE_URL: 'postgres://bench:hunter2pw@db.internal:5432/bench', HOOK: 'https://hooks.example.com/services/T0/B0/abcdef123456',
    DB_DSN: 'mysql://u:p4ssw0rd@h/db', MY_TOKEN: 'tok-0123456789', PLAIN: 'marked-secret-value',
  };
  const armCfg = {
    env_passthrough: ['DATA_DIR', 'DATABASE_URL', 'HOOK', 'MY_TOKEN', 'PLAIN'],
    plain_env: ['DATA_DIR', 'RULES_PATH', 'MY_TOKEN', 'PLAIN'], secret_env: ['PLAIN'],
    mcp_servers: { x: { command: 'node', args: ['${RULES_PATH}', '${DB_DSN}'] } },
  };
  const names = [...new Set(secretValues(armCfg, env).map(([k]) => k))].sort();
  assert.deepEqual(names, ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'DB_DSN', 'HOOK', 'MY_TOKEN', 'PLAIN'], 'DSN / webhook redacted by default; credential name and secret_env beat plain_env');
  const red = redactor(secretValues(armCfg, env));
  assert.equal(red(`dir /srv/data/bench rules /srv/rules.json db ${env.DATABASE_URL}`), 'dir /srv/data/bench rules /srv/rules.json db [REDACTED:DATABASE_URL]', 'only plain_env paths stay readable');
});

test('spec: secret_env and plain_env are known keys and merge across top level and arm', () => {
  const d = tmpdir();
  const r = cli(['validate', makeTask(d, { secret_env: ['FAKE_SECRET'], plain_env: ['DATA_DIR'], arms: { a: { secret_env: ['OTHER_VALUE'], plain_env: ['RULES'] } } })]);
  assert.equal(r.code, 0, r.out);
  const w = cli(['validate', makeTask(d, { plain_env: ['FAKE_SECRET'] })]);
  assert.equal(w.code, 0, w.out);
  assert.match(w.out, /warn: spec\.plain_env: FAKE_SECRET looks like a credential and is redacted anyway/);
});

test('agent output: multi-byte UTF-8 split across pipe chunks is decoded intact', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { cleanup: undefined, arms: { a: { env: { FAKE_CLAUDE_MODE: 'unicode' } } } });
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE]);
  assert.equal(r.code, 0, r.err);
  const rec = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0].records[0];
  assert.equal(rec.agent.tool_result_bytes, Buffer.byteLength('😀é'.repeat(60000)));
  assert.ok(!rec.agent.result_text.includes('�'), 'no replacement characters');
});

test('agent output: never-ending stdout is capped and the agent killed; the run still completes', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { arms: { a: { env: { FAKE_CLAUDE_MODE: 'flood' } } } });
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { MCP_BENCH_MAX_OUTPUT_BYTES: '2000000', CLEANUP_LOG: path.join(d, 'c.log') });
  assert.equal(r.code, 0, r.err);
  const rec = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0].records[0];
  assert.equal(rec.agent.output_truncated, true);
  assert.ok(rec.agent.wall_ms < 15000, 'killed at the cap, not at the timeout');
  assert.equal(fs.readFileSync(path.join(d, 'c.log'), 'utf8').trim().split('\n').length, 1, 'cleanup ran');
});

test('secrets echoed by the agent, a server, setup or the verifier never reach disk', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, {
    setup: 'bash setup.sh; echo "setup saw $FAKE_SECRET" >&2',
    verifier: 'echo "verifier saw $FAKE_SECRET"; exit 1',
    arms: { a: { env: { FAKE_CLAUDE_MODE: 'leak' } } },
  });
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { CLEANUP_LOG: path.join(d, 'c.log') });
  assert.equal(r.code, 0, r.err);
  assert.ok(!(r.out + r.err).includes(SECRET), 'not in console output');
  const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f))) : [p]);
  for (const f of walk(out)) {
    const buf = fs.readFileSync(f);
    const text = f.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    assert.ok(!text.includes(SECRET), `canary in ${path.relative(out, f)}`);
  }
  const rec = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0].records[0];
  assert.match(rec.agent.result_text, /\[REDACTED:FAKE_SECRET\]/);
});

test('--seed: 0 is its own seed; non-integer or out-of-range seeds are rejected, not silently 1', () => {
  const d = tmpdir();
  const task = makeTask(d);
  const plan = (seed) => cli(['run', task, '--n', '4', '--seed', seed, '--dry-run', '--claude-bin', FAKE]).out.split('\n').filter((l) => /^ {2}\S+ t\d/.test(l)).join('\n');
  assert.notEqual(plan('0'), plan('1'), 'seed 0 is not seed 1');
  for (const bad of ['abc', '1.5', '-1', '4294967296']) assert.notEqual(cli(['run', task, '--seed', bad, '--dry-run', '--claude-bin', FAKE]).code, 0, bad);
});

test('an agent that never started is a harness error, not an unverified attempt; a relative --claude-bin works', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { verifier: 'echo verifier-ran >> "$VERIFY_LOG"; echo \'{"pass":false}\'' });
  cli(['run', task, '--n', '2', '--max-total-usd', '1', '--out', out, '--claude-bin', path.join(d, 'no-such-claude')], { CLEANUP_LOG: path.join(d, 'c.log'), VERIFY_LOG: path.join(d, 'v.log') });
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t.records[0].status, 'setup_error');
  assert.match(t.records[0].setup.error, /agent did not start.*ENOENT/);
  assert.equal(t.models.haiku.arms.baseline.attempts + t.models.haiku.arms.variant.attempts, 0, 'not in any denominator');
  assert.ok(!fs.existsSync(path.join(d, 'v.log')), 'verifier not run for an agent that never started');
  assert.match(t.stopped, /claude binary/);
  assert.equal(t.completed_attempts, 1, 'stops instead of failing every attempt');

  // why: a binary that never started gives agent=null, so only a verified attempt proves it ran.
  const d2 = tmpdir(); const out2 = path.join(d2, 'out');
  const rel = path.relative(process.cwd(), FAKE);
  assert.ok(rel.includes('/') && !path.isAbsolute(rel), rel);
  cli(['run', makeTask(d2), '--n', '1', '--arms', 'baseline', '--max-total-usd', '1', '--out', out2, '--claude-bin', rel], { CLEANUP_LOG: path.join(d2, 'c.log') });
  const t2 = JSON.parse(fs.readFileSync(path.join(out2, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t2.records[0].status, 'verified', `relative ${rel} resolved against the caller's cwd`);
});

test('budget: an unpriced attempt after an overshoot is charged the largest charge seen, not the cap', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  // over: $0.08 > max_budget_usd 0.05; crash: no result event. AB/BA over n=2 puts a crash after an over.
  const task = makeTask(d, { cleanup: undefined, arms: { over: { env: { FAKE_TOKENS: '80000' } }, crash: { env: { FAKE_CLAUDE_MODE: 'crash' } } } });
  cli(['run', task, '--n', '2', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE]);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t.completed_attempts, 4);
  let seen = 0, checked = 0;
  for (const r of t.records) {
    if (r.arm === 'crash') { assert.equal(r.cost_charged_usd, Math.max(0.05, seen), `t${r.trial}`); checked += seen > 0.05; }
    seen = Math.max(seen, r.cost_charged_usd);
  }
  assert.ok(checked >= 1, 'a crash ran after an overshoot');
});

test('#10: attempts without a result event are counted per arm and their tokens reported as lower bounds', () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { cleanup: undefined, arms: { ok: {}, nores: { env: { FAKE_CLAUDE_MODE: 'noresult' } } } });
  const r = cli(['run', task, '--n', '2', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE]);
  assert.equal(r.code, 0, r.err);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  const a = t.models.haiku.arms;
  assert.equal(a.nores.verified, 2, 'the work was done; only the result event is missing');
  assert.equal(a.nores.usage_lower_bound, 2);
  assert.equal(a.ok.usage_lower_bound, 0);
  const md = fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8');
  assert.match(md, /\| nores \| ≥ 2,710 \|/, 'expected tokens per success marked as a lower bound');
  assert.match(md, /\| ok \| 2,710 \|/, 'provider totals unmarked');
  assert.match(md, /Lower bound.*nores: 2\/2 attempts/);
  assert.match(md, /tokens p50 \/ p95 \(n\)[^\n]*\| no result event \|/, 'per-arm count column');
});

test('#17: an agent rewriting harness state (old path, ../../.harness, the real path) cannot turn a failure into verified', () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const clog = path.join(d, 'c.log'); const vlog = path.join(d, 'v.log');
  // A verifier that trusts state, like one sent to an already-correct resource by a rewritten id.
  fs.writeFileSync(path.join(d, 'verify-state.mjs'), [
    "import fs from 'node:fs';",
    "const s = JSON.parse(fs.readFileSync(process.env.BENCH_STATE, 'utf8'));",
    "fs.appendFileSync(process.env.VERIFY_LOG, process.env.BENCH_STATE + '\\n');",
    "console.log(JSON.stringify({ pass: s.pass === true || fs.existsSync(process.env.BENCH_WORKDIR + '/out.txt') }));",
  ].join('\n'));
  const forged = JSON.stringify({ greeting: 'hello', pass: true });
  const task = makeTask(d, {
    verifier: 'node verify-state.mjs', cleanup: 'cat "$BENCH_STATE" >> "$CLEANUP_LOG"',
    arms: { tamper: { env: { FAKE_CLAUDE_MODE: 'skip', FAKE_TAMPER_STATE: forged } }, ok: { env: { FAKE_TAMPER_STATE: forged } }, honest: {} },
  });
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { CLEANUP_LOG: clog, VERIFY_LOG: vlog });
  assert.equal(r.code, 0, r.err);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  const rec = (a) => t.records.find((x) => x.arm === a);
  assert.equal(rec('tamper').status, 'unverified', 'forged state did not verify a failed attempt');
  assert.equal(rec('tamper').state_tampered, true);
  assert.equal(rec('ok').status, 'unverified', 'tampering is never verified, even when the work was done');
  assert.equal(rec('honest').status, 'verified');
  assert.equal(rec('honest').state_tampered, false);
  for (const p of fs.readFileSync(vlog, 'utf8').trim().split('\n')) {
    assert.ok(!p.startsWith(path.join(out, 'runs')), `BENCH_STATE ${p} is outside the agent's run dir`);
    assert.ok(p.startsWith(path.join(out, '.harness')), p);
  }
  const seen = fs.readFileSync(clog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(seen.length, 3);
  for (const s of seen) assert.deepEqual(s, { greeting: 'hello' }, 'cleanup gets the state setup wrote');
});
