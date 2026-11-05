// End-to-end through the CLI with the fake claude. Never calls the real CLI or a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { ROOT, FAKE, tmpdir, makeTask, readJsonl } from './helpers.mjs';

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
  assert.equal(cli(['run', task, '--purpose', 'publish', '--n', '20', '--model', 'claude-sonnet-9-9-20990101', '--dry-run', '--claude-bin', FAKE]).code, 0);
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
  ]) {
    const r = cli(['validate', makeTask(d, over)]);
    assert.equal(r.code, 1, JSON.stringify(over) + r.out);
    assert.match(r.out, re);
  }
  assert.equal(cli(['validate', makeTask(d, { extra_args: ['--add-dir', '/tmp'] })]).code, 0);
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

  const out2 = path.join(d, 'out2');
  const rel = path.relative(process.cwd(), FAKE);
  cli(['run', task, '--n', '1', '--arms', 'baseline', '--max-total-usd', '1', '--out', out2, '--claude-bin', rel], { CLEANUP_LOG: path.join(d, 'c.log'), VERIFY_LOG: path.join(d, 'v2.log') });
  const t2 = JSON.parse(fs.readFileSync(path.join(out2, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t2.records[0].agent?.spawn_error ?? null, null, `relative ${rel} resolved against the caller's cwd`);
});
