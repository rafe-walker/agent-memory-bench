// #19: --isolation linux-sandbox. The e2e tests need Linux + root + bwrap + nft; they skip elsewhere
// unless MCP_BENCH_REQUIRE_SANDBOX=1 (then they fail). The publish gate test runs everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, FAKE, tmpdir as mk, makeTask } from './helpers.mjs';
import { runAttempt } from '../lib/runner.mjs';
import { resolveArm, loadTask } from '../lib/spec.mjs';

const canSandbox = process.platform === 'linux' && process.getuid?.() === 0
  && spawnSync('bwrap', ['--version']).status === 0 && spawnSync('nft', ['--version']).status === 0;
if (!canSandbox && process.env.MCP_BENCH_REQUIRE_SANDBOX === '1') throw new Error('MCP_BENCH_REQUIRE_SANDBOX=1 but this host cannot run agent-sandbox (need Linux, root, bwrap, nft)');
// why: the sandbox uid must traverse the task and out dirs (mkdtemp makes them 0700).
const tmpdir = () => { const d = mk(); fs.chmodSync(d, 0o755); return d; };
const skip = canSandbox ? false : 'needs Linux + root + bwrap + nft';

const MODEL_KEY = `sk-ant-benchMODELKEY-${crypto.randomBytes(12).toString('hex')}`;
const HARNESS_CANARY = `harness-only-${crypto.randomBytes(12).toString('hex')}`;

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mcp-bench.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

async function signedPreflight(dir, o = {}) {
  const a = await import('agent-sandbox');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = path.join(dir, 'pub.pem');
  fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  fs.chmodSync(pub, 0o644);
  const caps = Object.fromEntries(a.CAPABILITY_NAMES.map((c) => [c, { status: 'pass' }]));
  const report = { schemaVersion: 1, profile: 'linux-sandbox', createdAt: new Date().toISOString(), host: { platform: 'linux', release: 'x', arch: 'x64', euid: 0 }, capabilities: caps, suite: a.foldSuite([{ id: 'a', title: 't', blocked: true, controlSucceeded: true, status: 'pass' }]), publishable: true, reasons: [], ...o };
  const f = path.join(dir, 'pf.json');
  fs.writeFileSync(f, JSON.stringify(a.signPreflight(report, { privateKey })));
  return { file: f, pub, report };
}

test('#19: --purpose publish refuses --isolation dev; isolation flag is validated', () => {
  const d = tmpdir(); const task = makeTask(d);
  let r = cli(['run', task, '--purpose', 'publish', '--n', '20', '--model', 'claude-opus-4-5-20251101', '--max-total-usd', '1', '--claude-bin', FAKE, '--out', path.join(d, 'o')]);
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /publish refuses --isolation dev/);
  r = cli(['run', task, '--isolation', 'container', '--max-total-usd', '1', '--claude-bin', FAKE]);
  assert.equal(r.code, 1);
  assert.match(r.err, /--isolation: one of dev, linux-sandbox/);
  r = cli(['run', task, '--max-total-usd', '1', '--claude-bin', FAKE, '--dry-run']);
  assert.match(r.err, /NO sandbox/, 'dev warns loudly');
  for (const bad of ['-1', 'NaN', '1e400', '1e20', '1.5', 'abc']) {
    r = cli(['run', task, '--max-total-usd', '1', '--claude-bin', FAKE, '--dry-run', '--max-tokens-per-attempt', bad]);
    assert.equal(r.code, 1, bad); assert.match(r.err, /max-tokens-per-attempt/);
  }
});

test('#19: linux-sandbox refuses a missing, hand-written, edited or foreign-key preflight', { skip }, async () => {
  const d = tmpdir(); const task = makeTask(d);
  const base = ['run', task, '--isolation', 'linux-sandbox', '--max-total-usd', '1', '--claude-bin', FAKE, '--dry-run'];
  process.env.FAKE_SECRET = 'passthrough-secret-value';
  let r = cli(base);
  assert.equal(r.code, 2); assert.match(r.err, /--sandbox-preflight/);
  const { file, pub, report } = await signedPreflight(d);
  fs.writeFileSync(path.join(d, 'bare.json'), JSON.stringify(report));
  r = cli([...base, '--sandbox-preflight', path.join(d, 'bare.json'), '--sandbox-pubkey', pub]);
  assert.equal(r.code, 2); assert.match(r.err, /preflight rejected/);
  const env = JSON.parse(fs.readFileSync(file, 'utf8'));
  const inner = JSON.parse(Buffer.from(env.payload, 'base64').toString());
  inner.report.capabilities.net_enforced = { status: 'pass', detail: 'edited' };
  fs.writeFileSync(path.join(d, 'edited.json'), JSON.stringify({ ...env, payload: Buffer.from(JSON.stringify(inner)).toString('base64') }));
  r = cli([...base, '--sandbox-preflight', path.join(d, 'edited.json'), '--sandbox-pubkey', pub]);
  assert.equal(r.code, 2); assert.match(r.err, /signature does not verify/);
  const other = fs.mkdtempSync(path.join(d, 'o-'));
  const foreign = await signedPreflight(other);
  r = cli([...base, '--sandbox-preflight', foreign.file, '--sandbox-pubkey', pub]);
  assert.equal(r.code, 2); assert.match(r.err, /different key/);
  r = cli([...base, '--sandbox-preflight', file, '--sandbox-pubkey', pub]);
  assert.equal(r.code, 0, r.err); assert.match(r.err, /preflight verified/);
  const remote = makeTask(fs.mkdtempSync(path.join(d, 'r-')), { mcp_servers: { ph: { type: 'http', url: 'https://mcp.example.com/mcp' } }, env_passthrough: [] });
  r = cli(['run', remote, '--isolation', 'linux-sandbox', '--max-total-usd', '1', '--claude-bin', FAKE, '--dry-run', '--sandbox-preflight', file, '--sandbox-pubkey', pub]);
  assert.equal(r.code, 2); assert.match(r.err, /cannot reach remote MCP servers \(ph\)/);
  r = cli(['run', task, '--purpose', 'publish', '--n', '20', '--model', 'claude-opus-4-5-20251101', '--max-total-usd', '1', '--claude-bin', FAKE, '--dry-run', '--isolation', 'linux-sandbox', '--sandbox-preflight', file, '--sandbox-pubkey', pub]);
  assert.equal(r.code, 0, `publish accepts linux-sandbox with a verified preflight: ${r.err}`);
});

test('#19 e2e: in the sandbox, the state.json forge and the /proc/1/environ read both fail', { skip }, async () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const clog = path.join(d, 'c.log');
  fs.writeFileSync(path.join(d, 'verify-state.mjs'), [
    "import fs from 'node:fs';",
    "const s = JSON.parse(fs.readFileSync(process.env.BENCH_STATE, 'utf8'));",
    "console.log(JSON.stringify({ pass: s.pass === true || fs.existsSync(process.env.BENCH_WORKDIR + '/out.txt') }));",
  ].join('\n'));
  const forged = JSON.stringify({ greeting: 'hello', pass: true });
  const task = makeTask(d, {
    verifier: 'node verify-state.mjs', cleanup: 'cat "$BENCH_STATE" >> "$CLEANUP_LOG"', env: {},
    arms: { tamper: { env: { FAKE_CLAUDE_MODE: 'skip', FAKE_TAMPER_STATE: forged, FAKE_PROC_READ: '1' } }, ok: { env: { FAKE_TAMPER_STATE: forged, FAKE_PROC_READ: '1' } } },
  });
  const { file, pub } = await signedPreflight(d);
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE, '--isolation', 'linux-sandbox', '--sandbox-preflight', file, '--sandbox-pubkey', pub],
    { CLEANUP_LOG: clog, FAKE_SECRET: 'passthrough-secret-value', ANTHROPIC_API_KEY: MODEL_KEY, MCP_BENCH_HARNESS_CANARY: HARNESS_CANARY });
  assert.equal(r.code, 0, r.err);
  const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  assert.equal(res.isolation.profile, 'linux-sandbox');
  assert.equal(res.isolation.preflight.capabilities.net_enforced, 'pass');
  assert.match(fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8'), /Isolation: linux-sandbox/);
  const t = res.tasks[0];
  const rec = (a) => t.records.find((x) => x.arm === a);
  // state.json forge: the agent cannot reach <out>/.harness, so nothing was tampered and the verdict holds
  assert.equal(rec('tamper').status, 'unverified', 'forged state did not verify a failed attempt');
  assert.equal(rec('tamper').state_tampered, false, 'the forge never reached the harness state');
  assert.equal(rec('ok').status, 'verified', 'honest work verifies; the forge had no effect');
  assert.equal(rec('ok').state_tampered, false);
  for (const a of ['tamper', 'ok']) {
    const runName = path.basename(rec(a).run_dir);
    assert.equal(fs.readFileSync(path.join(out, '.harness', runName, 'state.json'), 'utf8').trim(), '{"greeting":"hello"}');
    assert.equal(rec(a).agent.survivors, 0);
    assert.equal(rec(a).agent.usage_source, 'gateway');
    assert.ok(rec(a).sandbox?.worker_uid > 0 && rec(a).sandbox.worker_uid !== process.getuid());
    const tamper = fs.readFileSync(path.join(rec(a).run_dir, 'work', 'tamper.txt'), 'utf8');
    assert.ok(tamper.split('\n').filter(Boolean).length === 3, tamper);
    // /proc/1/environ (bwrap's minimal env) and every visible environ: no harness secret
    const seen = Buffer.from(fs.readFileSync(path.join(rec(a).run_dir, 'work', 'proc_environ.hex'), 'utf8'), 'hex').toString('latin1');
    assert.ok(seen.length > 0, 'the fake read at least its own environ');
    for (const s of [MODEL_KEY, HARNESS_CANARY]) assert.ok(!seen.includes(s), 'harness secret visible in the sandbox');
    assert.ok(!seen.includes('ANTHROPIC_API_KEY=sk-ant'), 'no real model key in any env');
  }
  assert.equal(fs.statSync(path.join(out, '.harness')).mode & 0o777, 0o700);
  for (const s of fs.readFileSync(clog, 'utf8').trim().split('\n')) assert.deepEqual(JSON.parse(s), { greeting: 'hello' }, 'cleanup ran host-side with setup state');
  // no secret reached disk
  const walk = (p) => fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : e.isFile() ? [path.join(p, e.name)] : []));
  for (const f of walk(out)) { const b = fs.readFileSync(f, 'latin1'); assert.ok(!b.includes(MODEL_KEY) && !b.includes(HARNESS_CANARY), f); }
});

test('#19 positive control: unsandboxed (dev), the same fake reads harness env through /proc', { skip }, () => {
  const d = tmpdir(); const out = path.join(d, 'out');
  const task = makeTask(d, { env: {}, arms: { a: { env: { FAKE_PROC_READ: '1' } } } });
  const r = cli(['run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { CLEANUP_LOG: path.join(d, 'c.log'), FAKE_SECRET: 'passthrough-secret-value', MCP_BENCH_HARNESS_CANARY: HARNESS_CANARY });
  assert.equal(r.code, 0, r.err);
  const runDir = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0].records[0].run_dir;
  const seen = Buffer.from(fs.readFileSync(path.join(runDir, 'work', 'proc_environ.hex'), 'utf8'), 'hex').toString('latin1');
  assert.ok(seen.includes(HARNESS_CANARY), 'in dev the harness env is readable, so the sandbox check above is meaningful');
});

test('#19: the model gateway is the token meter (provider-reported), and holds the key', { skip }, async () => {
  const d = tmpdir(); const out = path.join(d, 'out'); fs.mkdirSync(out);
  const file = makeTask(d, { env: {}, cleanup: undefined, arms: { a: { env: { FAKE_GATEWAY: '1', FAKE_TOKENS: '7' } } } });
  const task = loadTask(file);
  const seenKeys = [];
  const dispatch = async (req) => {
    seenKeys.push(req.headers['x-api-key']);
    return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 50 } })) };
  };
  process.env.FAKE_SECRET = 'passthrough-secret-value';
  const rec = await runAttempt({ task, armCfg: resolveArm(task, 'a'), model: 'haiku', maxTurns: 3, maxBudgetUsd: 0.01, claudeBin: FAKE, outDir: out, trial: 0, order: 'AB', runTag: 'mcpbench-fake-task-a-t0-000000-00000000', isolation: 'linux-sandbox', sandbox: { dispatch, realKey: MODEL_KEY, gatewayPort: 18953 } });
  assert.equal(rec.status, 'verified', JSON.stringify({ s: rec.status, setup: rec.setup, agent: rec.agent && { e: rec.agent.exit_code, st: rec.agent.stderr_tail } }));
  assert.equal(fs.readFileSync(path.join(rec.run_dir, 'work', 'gateway.txt'), 'utf8'), '200');
  assert.deepEqual(seenKeys, [MODEL_KEY], 'upstream got the real key; the agent only had a session token');
  assert.equal(rec.agent.usage_source, 'gateway');
  assert.deepEqual(rec.agent.usage, { input: 120, cache_read: 50, cache_creation: 0, output: 30, total: 200 });
  assert.equal(rec.agent.gateway_requests, 1);
  assert.equal(rec.agent.usage_mismatch, true, 'the fake stream claims other numbers; the gateway figure wins');
});
