// Process lifecycle: no orphans after an attempt, a signalled runner, or a SIGKILLed runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, FAKE, tmpdir, makeTask } from './helpers.mjs';

const CLI = path.join(ROOT, 'bin', 'mcp-bench.mjs');
process.env.FAKE_SECRET ||= 'not-a-real-secret-0123456789';
// why: a killed orphan re-parented to an init that does not reap stays a zombie; zombies are dead.
const alive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; }

test('a background child the agent left behind is killed when the agent exits', () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'orphan.pid');
  const task = makeTask(d, { arms: { a: { env: { FAKE_CLAUDE_MODE: 'orphan', FAKE_ORPHAN_PID_FILE: pidf } } } });
  const r = spawnSync(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { encoding: 'utf8', env: { ...process.env, CLEANUP_LOG: path.join(d, 'c.log') }, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const pid = Number(fs.readFileSync(pidf, 'utf8'));
  assert.ok(!alive(pid), `orphan ${pid} still running`);
});

test('the verifier never sees the isolated HOME (claude config, logs) in the run dir', () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const vlog = path.join(d, 'v.log');
  const task = makeTask(d, { arms: { a: {} } });
  spawnSync(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env: { ...process.env, CLEANUP_LOG: path.join(d, 'c.log'), VERIFY_LOG: vlog } });
  assert.doesNotMatch(fs.readFileSync(vlog, 'utf8'), /\bhome\b/);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  test(`${sig} to the runner kills the agent group, runs cleanup, writes results and exits non-zero`, async () => {
    const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'agent.pid'); const clog = path.join(d, 'c.log');
    const task = makeTask(d, { timeout_sec: 120, arms: { a: { env: { FAKE_CLAUDE_MODE: 'hang', FAKE_PID_FILE: pidf } } } });
    const p = spawn(process.execPath, [CLI, 'run', task, '--n', '3', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env: { ...process.env, CLEANUP_LOG: clog }, stdio: 'ignore' });
    const exited = new Promise((r) => p.on('exit', (code, s) => r({ code, s })));
    assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')), 'agent started');
    const agent = Number(fs.readFileSync(pidf, 'utf8'));
    p.kill(sig);
    const e = await Promise.race([exited, sleep(15000).then(() => null)]);
    assert.ok(e, 'runner exited');
    assert.equal(e.code, 130);
    assert.ok(await waitFor(() => !alive(agent), 3000), 'agent killed');
    assert.equal(fs.readFileSync(clog, 'utf8').trim().split('\n').length, 1, 'cleanup ran once');
    const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
    assert.match(t.stopped, /interrupted/);
    assert.equal(t.records.length, 1);
    assert.equal(t.records[0].status, 'interrupted');
    assert.equal(t.models.haiku.arms.a.attempts, 0, 'an interrupted attempt is not an agent failure');
  });
}

test('SIGKILL of the runner still takes the agent process group down', async () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'agent.pid');
  const task = makeTask(d, { timeout_sec: 120, cleanup: undefined, arms: { a: { env: { FAKE_CLAUDE_MODE: 'hang', FAKE_PID_FILE: pidf } } } });
  const p = spawn(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { stdio: 'ignore' });
  assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')));
  const agent = Number(fs.readFileSync(pidf, 'utf8'));
  p.kill('SIGKILL');
  assert.ok(await waitFor(() => !alive(agent), 5000), `agent ${agent} orphaned after runner SIGKILL`);
});
